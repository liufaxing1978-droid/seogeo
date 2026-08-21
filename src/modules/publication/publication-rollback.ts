import { Prisma } from '@prisma/client';
import type { MutationAdapter, TargetSnapshot } from './mutation-adapter.js';
import { planHashV1, previewHashV1 } from './publication.hash.js';
import { PublicationRepository } from './publication.repository.js';
import type { CreatePublicationRollbackProposalInput } from './publication.types.js';

type JsonMap = Record<string, unknown>;

export interface RollbackExecutionContext {
  id: string;
  projectId: string;
  status: string;
  commitSha: string | null;
  branchName: string | null;
  pullRequestNo: number | null;
  errorCode?: string | null;
  plan: {
    id: string;
    projectId: string;
    proposalId: string;
    draftId: string;
    draftVersion: number;
    targetRepository: string;
    targetBranch: string;
    baseSha: string;
    targetBlobHashes: Prisma.JsonValue | null;
    operations: Prisma.JsonValue;
    expectedOutcomes: Prisma.JsonValue;
    validatorVersion: string;
    riskClass: string;
    rollbackStrategy: string;
    planHash: string;
    preview: {
      id: string;
      previewHash: string;
      diffPayload: Prisma.JsonValue | null;
    } | null;
  };
}

export interface RepairVerificationContext {
  id: string;
  projectId: string;
  status: string;
  reasonCode: string | null;
  execution: RollbackExecutionContext;
}

export interface PublicationRollbackRepositoryPort {
  getExecutionRollbackContext(executionId: string): Promise<RollbackExecutionContext | null>;
  getVerificationRepairContext(verificationId: string): Promise<RepairVerificationContext | null>;
  createRollbackProposal(input: CreatePublicationRollbackProposalInput): Promise<unknown>;
}

export interface PublicationRollbackPlannerDeps {
  repository?: PublicationRollbackRepositoryPort;
  adapter: Pick<MutationAdapter, 'readTargetSnapshot' | 'rollback'>;
}

export class PublicationRollbackPlannerError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationRollbackPlannerError';
  }
}

function fail(code: string, message: string): never {
  throw new PublicationRollbackPlannerError(code, message);
}

function stringMap(value: Prisma.JsonValue | null): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(entries);
}

function assertContext(execution: RollbackExecutionContext): void {
  if (!execution.plan.targetRepository || !execution.plan.targetBranch || !execution.plan.baseSha) {
    fail('INVALID_ROLLBACK_CONTEXT', 'Publication rollback context is missing repository binding');
  }
  if (!execution.plan.preview) {
    fail('INVALID_ROLLBACK_CONTEXT', 'Publication rollback requires the exact original preview binding');
  }
}

async function currentSnapshot(
  adapter: Pick<MutationAdapter, 'readTargetSnapshot'>,
  execution: RollbackExecutionContext
): Promise<TargetSnapshot> {
  assertContext(execution);
  const plan = execution.plan;
  const snapshot = await adapter.readTargetSnapshot({
    repositoryIdentity: plan.targetRepository,
    branch: plan.targetBranch,
    headSha: plan.baseSha,
    touchedBlobShas: stringMap(plan.targetBlobHashes)
  });
  if (
    snapshot.repositoryIdentity !== plan.targetRepository
    || snapshot.branch !== plan.targetBranch
    || !snapshot.headSha
  ) {
    fail('TARGET_REVISION_CHANGED', 'Current rollback target no longer matches the approved repository binding');
  }
  return {
    ...snapshot,
    touchedBlobShas: Object.fromEntries(
      Object.entries(snapshot.touchedBlobShas).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

function sourceBinding(execution: RollbackExecutionContext) {
  const preview = execution.plan.preview;
  if (!preview) return fail('INVALID_ROLLBACK_CONTEXT', 'Original publication preview is unavailable');
  return {
    executionId: execution.id,
    commitSha: execution.commitSha,
    planId: execution.plan.id,
    planHash: execution.plan.planHash,
    previewHash: preview.previewHash
  };
}

function proposalPayload(
  kind: 'ROLLBACK' | 'REPAIR',
  source: ReturnType<typeof sourceBinding>,
  plan: JsonMap,
  preview: JsonMap,
  extra: JsonMap = {}
): Prisma.InputJsonObject {
  const generatedPlanHash = planHashV1(plan);
  const generatedPreviewHash = previewHashV1({ generatedPlanHash, preview });
  return {
    kind,
    requiresFreshApproval: true,
    remoteWritePerformed: false,
    source: source as Prisma.InputJsonObject,
    plan: plan as Prisma.InputJsonObject,
    preview: preview as Prisma.InputJsonObject,
    planHash: generatedPlanHash,
    previewHash: generatedPreviewHash,
    ...extra
  } as Prisma.InputJsonObject;
}

export class PublicationRollbackPlanner {
  private readonly repository: PublicationRollbackRepositoryPort;
  private readonly adapter: Pick<MutationAdapter, 'readTargetSnapshot' | 'rollback'>;

  constructor(deps: PublicationRollbackPlannerDeps) {
    this.repository = deps.repository ?? new PublicationRepository();
    this.adapter = deps.adapter;
  }

  async createRollbackProposal(executionId: string, actorId: string) {
    const execution = await this.repository.getExecutionRollbackContext(executionId);
    if (!execution) fail('EXECUTION_NOT_FOUND', 'Publication execution was not found');
    if (!execution.commitSha) {
      fail('ROLLBACK_NOT_AVAILABLE', 'Git-backed rollback requires the exact published commit SHA');
    }

    const snapshot = await currentSnapshot(this.adapter, execution);
    const rollback = await this.adapter.rollback({
      executionId: execution.id,
      branchName: execution.branchName,
      commitSha: execution.commitSha,
      pullRequestNo: execution.pullRequestNo
    });
    if (rollback.remoteWritePerformed) {
      fail('REMOTE_WRITE_NOT_ALLOWED', 'Rollback planning must never perform a production write');
    }

    const plan: JsonMap = {
      version: 'PUBLICATION_ROLLBACK_PLAN_V1',
      repositoryIdentity: execution.plan.targetRepository,
      branch: execution.plan.targetBranch,
      baseSha: snapshot.headSha,
      originalBaseSha: execution.plan.baseSha,
      touchedBlobShas: snapshot.touchedBlobShas,
      forceReset: false,
      autoMerge: false,
      operations: [{
        type: 'REVERT_COMMIT',
        commitSha: execution.commitSha
      }]
    };
    const preview: JsonMap = {
      version: 'PUBLICATION_ROLLBACK_PREVIEW_V1',
      summary: `Prepare a reviewable revert of ${execution.commitSha}`,
      sourcePreviewHash: execution.plan.preview?.previewHash ?? null,
      artifactSha256: rollback.artifactSha256 ?? null,
      adapterStatus: rollback.status
    };

    return this.repository.createRollbackProposal({
      projectId: execution.projectId,
      executionId: execution.id,
      strategy: rollback.strategy,
      status: 'PROPOSED',
      reasonCode: execution.errorCode ?? 'ROLLBACK_REQUESTED',
      proposedBy: actorId,
      payload: proposalPayload('ROLLBACK', sourceBinding(execution), plan, preview)
    });
  }

  async createRepairProposal(verificationId: string, actorId: string) {
    const verification = await this.repository.getVerificationRepairContext(verificationId);
    if (!verification) fail('VERIFICATION_NOT_FOUND', 'Publication verification was not found');
    if (verification.status === 'VERIFIED') {
      fail('REPAIR_NOT_REQUIRED', 'A verified publication does not require a repair proposal');
    }

    const execution = verification.execution;
    const snapshot = await currentSnapshot(this.adapter, execution);
    const plan: JsonMap = {
      version: 'PUBLICATION_REPAIR_PLAN_V1',
      repositoryIdentity: execution.plan.targetRepository,
      branch: execution.plan.targetBranch,
      baseSha: snapshot.headSha,
      originalBaseSha: execution.plan.baseSha,
      touchedBlobShas: snapshot.touchedBlobShas,
      forceReset: false,
      autoMerge: false,
      operations: [{
        type: 'REAPPLY_APPROVED_PLAN',
        sourcePlanId: execution.plan.id,
        sourcePlanHash: execution.plan.planHash,
        operations: execution.plan.operations
      }]
    };
    const preview: JsonMap = {
      version: 'PUBLICATION_REPAIR_PREVIEW_V1',
      summary: `Prepare a reviewable repair for ${verification.reasonCode ?? 'VERIFICATION_FAILED'}`,
      sourcePreviewHash: execution.plan.preview?.previewHash ?? null,
      verificationId
    };

    return this.repository.createRollbackProposal({
      projectId: verification.projectId,
      executionId: execution.id,
      strategy: 'REPAIR_VERIFICATION_FAILURE',
      status: 'PROPOSED',
      reasonCode: verification.reasonCode ?? 'VERIFICATION_FAILED',
      proposedBy: actorId,
      payload: proposalPayload(
        'REPAIR',
        sourceBinding(execution),
        plan,
        preview,
        { verificationId }
      )
    });
  }
}
