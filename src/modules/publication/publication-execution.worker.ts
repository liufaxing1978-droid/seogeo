import {
  Prisma,
  type AutopilotExecutionReservation,
  type AutopilotPolicy,
  type OptimizationAutopilotDecision,
  type PlanLevel,
  type PublicationAdapterType,
  type PublicationAutomationAuthorization,
  type PublicationExecutionEventType,
  type PublicationExecutionStatus,
  type PublicationRiskClass,
  type PublicationWriteCapability
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { parseControlledAutopilotGlobalKillSwitch } from '../optimization-autopilot/autopilot.config.js';
import {
  assertApprovalCurrent,
  type ApprovalPlanRecord,
  type ApprovalPreviewRecord,
  type ApprovalRecord
} from './publication-approval.js';
import { assertAutomationAuthorizationCurrent } from './publication-automation-authorization.js';
import { ExportMutationAdapter } from './export-mutation.adapter.js';
import type {
  ApprovedPlanInput,
  MutationAdapter,
  TargetSnapshot
} from './mutation-adapter.js';
import {
  emitPublicationEvent,
  serializePublicationEvent
} from './publication-observability.js';

export const PUBLICATION_EXECUTION_WORKER_CONCURRENCY = 2;

export type PublicationExecutionJobData = {
  executionId: string;
};

type PublicationExecutionJobLike = {
  name: string;
  data: PublicationExecutionJobData;
};

export class PublicationExecutionWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationExecutionWorkerError';
  }
}

export interface PublicationExecutionContext {
  execution: {
    id: string;
    projectId: string;
    executionKey: string;
    status: PublicationExecutionStatus;
    branchName: string | null;
    commitSha: string | null;
    pullRequestNo: number | null;
    pullRequestUrl: string | null;
  };
  planLevel: PlanLevel;
  site: {
    id: string;
    enabled: boolean;
    adapterType: PublicationAdapterType;
    writeCapability: PublicationWriteCapability;
  };
  plan: ApprovalPlanRecord & {
    targetRepository: string;
    targetBranch: string;
    targetBlobHashes: unknown;
    operations: unknown;
    riskClass: PublicationRiskClass;
  };
  preview: ApprovalPreviewRecord & {
    diffPayload: unknown;
  };
  approval: ApprovalRecord | null;
  automationAuthorization?: PublicationAutomationAuthorization | null;
  automationDecision?: OptimizationAutopilotDecision | null;
  automationPolicy?: AutopilotPolicy | null;
  automationReservation?: AutopilotExecutionReservation | null;
  authorizationKind?: 'HUMAN' | 'MACHINE';
  approvedPlan: ApprovedPlanInput;
}

export interface PublicationExecutionTransition {
  executionId: string;
  fromStatus: PublicationExecutionStatus;
  toStatus: PublicationExecutionStatus;
  eventType: PublicationExecutionEventType;
  reasonCode: string;
  patch?: {
    branchName?: string | null;
    commitSha?: string | null;
    pullRequestNo?: number | null;
    pullRequestUrl?: string | null;
    errorCode?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
  };
}

export interface PublicationExecutionWorkerDeps {
  loadContext?: (executionId: string) => Promise<PublicationExecutionContext>;
  resolveAdapter?: (context: PublicationExecutionContext) => MutationAdapter | null;
  transition?: (transition: PublicationExecutionTransition) => Promise<boolean>;
  emit?: (event: Record<string, unknown>) => void;
  now?: () => Date;
}

const TERMINAL_OR_EXTERNAL_STATES = new Set<PublicationExecutionStatus>([
  'PR_CREATED',
  'DEPLOYED',
  'VERIFYING',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'STALE_REVIEW_REQUIRED',
  'ROLLBACK_PROPOSED',
  'ROLLED_BACK',
  'APPROVAL_STALE',
  'TARGET_REVISION_CHANGED',
  'FAILED'
]);

function fail(code: string, message: string): never {
  throw new PublicationExecutionWorkerError(code, message);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringMap(value: unknown): Record<string, string> {
  const record = objectRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function operationArray(value: unknown): ApprovedPlanInput['operations'] {
  if (!Array.isArray(value)) return fail('VALIDATION_FAILED', 'Publication plan operations are invalid');
  const operations = value.filter(
    (item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item)
  );
  if (operations.length !== value.length || operations.length === 0) {
    return fail('VALIDATION_FAILED', 'Publication plan operations are invalid');
  }
  return operations.map((operation) => ({ ...operation })) as ApprovedPlanInput['operations'];
}

function unifiedDiff(value: unknown): string {
  const payload = objectRecord(value);
  const diff = payload?.unifiedDiff;
  if (typeof diff !== 'string') return fail('VALIDATION_FAILED', 'Publication preview diff is unavailable');
  return diff;
}

function defaultEmit(payload: Record<string, unknown>): void {
  const event = payload.event;
  if (event !== 'mutation.execution.started'
    && event !== 'mutation.execution.applied'
    && event !== 'mutation.execution.failed') return;
  const { event: _event, ...fields } = payload;
  emitPublicationEvent(event, fields);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'EXECUTION_FAILED';
}

export function classifyPublicationExecutionError(code: string): 'RETRYABLE' | 'NON_RETRYABLE' {
  return code === 'PROVIDER_RATE_LIMITED' || code === 'PROVIDER_TRANSIENT_ERROR'
    ? 'RETRYABLE'
    : 'NON_RETRYABLE';
}

async function defaultLoadContext(executionId: string): Promise<PublicationExecutionContext> {
  const execution = await prisma.publicationExecution.findUnique({
    where: { id: executionId },
    include: {
      plan: {
        include: {
          site: true,
          preview: true
        }
      },
      approval: true,
      automationAuthorization: true
    }
  });
  if (!execution) return fail('TARGET_NOT_FOUND', 'Publication execution was not found');

  const project = await prisma.project.findUnique({
    where: { id: execution.projectId },
    select: { planLevel: true }
  });
  if (!project) return fail('TARGET_NOT_FOUND', 'Publication project was not found');
  if (!execution.plan.preview) return fail('VALIDATION_FAILED', 'Publication preview is missing');

  const storedApproval = execution.approval;
  const storedAutomationAuthorization = execution.automationAuthorization;
  if ((storedApproval === null) === (storedAutomationAuthorization === null)) {
    return fail('VALIDATION_FAILED', 'Publication execution must have exactly one authorization source');
  }

  let automationDecision: OptimizationAutopilotDecision | null = null;
  let automationPolicy: AutopilotPolicy | null = null;
  let automationReservation: AutopilotExecutionReservation | null = null;
  if (storedAutomationAuthorization) {
    automationDecision = await prisma.optimizationAutopilotDecision.findUnique({
      where: { id: storedAutomationAuthorization.automationDecisionId }
    });
    if (!automationDecision) {
      return fail('VALIDATION_FAILED', 'Machine publication decision is missing');
    }
    automationPolicy = await prisma.autopilotPolicy.findUnique({
      where: { id: automationDecision.policyId }
    });
    if (!automationPolicy) {
      return fail('VALIDATION_FAILED', 'Machine publication policy is missing');
    }
    automationReservation = await prisma.autopilotExecutionReservation.findFirst({
      where: {
        projectId: execution.projectId,
        decisionId: automationDecision.id
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    if (!automationReservation) {
      return fail('VALIDATION_FAILED', 'Machine publication reservation is missing');
    }
  }

  const targetBlobHashes = stringMap(execution.plan.targetBlobHashes);
  const operations = operationArray(execution.plan.operations);
  const diff = unifiedDiff(execution.plan.preview.diffPayload);

  const plan: PublicationExecutionContext['plan'] = {
    id: execution.plan.id,
    projectId: execution.plan.projectId,
    proposalId: execution.plan.proposalId,
    draftId: execution.plan.draftId,
    draftVersion: execution.plan.draftVersion,
    version: execution.plan.version,
    planHash: execution.plan.planHash,
    baseSha: execution.plan.baseSha,
    targetRepository: execution.plan.targetRepository,
    targetBranch: execution.plan.targetBranch,
    targetBlobHashes,
    operations,
    riskClass: execution.plan.riskClass
  };
  const preview: PublicationExecutionContext['preview'] = {
    id: execution.plan.preview.id,
    planId: execution.plan.preview.planId,
    projectId: execution.plan.preview.projectId,
    previewHash: execution.plan.preview.previewHash,
    validationResult: execution.plan.preview.validationResult,
    diffPayload: execution.plan.preview.diffPayload
  };
  const approval: PublicationExecutionContext['approval'] = storedApproval
    ? {
        id: storedApproval.id,
        projectId: storedApproval.projectId,
        planId: storedApproval.planId,
        planVersion: storedApproval.planVersion,
        planHash: storedApproval.planHash,
        contentVersion: storedApproval.contentVersion,
        contentHash: storedApproval.contentHash,
        previewHash: storedApproval.previewHash,
        baseSha: storedApproval.baseSha,
        targetRepository: storedApproval.targetRepository,
        targetBranch: storedApproval.targetBranch,
        targetBlobHashes: storedApproval.targetBlobHashes,
        approverActorId: storedApproval.approverActorId,
        approvedRiskClass: storedApproval.approvedRiskClass,
        confirmedWarningCodes: storedApproval.confirmedWarningCodes,
        expiresAt: storedApproval.expiresAt
      }
    : null;
  const authorizationContentHash = approval?.contentHash ?? storedAutomationAuthorization?.contentHash;
  if (!authorizationContentHash) {
    return fail('VALIDATION_FAILED', 'Publication authorization content hash is missing');
  }

  return {
    execution: {
      id: execution.id,
      projectId: execution.projectId,
      executionKey: execution.executionKey,
      status: execution.status,
      branchName: execution.branchName,
      commitSha: execution.commitSha,
      pullRequestNo: execution.pullRequestNo,
      pullRequestUrl: execution.pullRequestUrl
    },
    planLevel: project.planLevel,
    site: {
      id: execution.plan.site.id,
      enabled: execution.plan.site.enabled,
      adapterType: execution.plan.site.adapterType,
      writeCapability: execution.plan.site.writeCapability
    },
    plan,
    preview,
    approval,
    automationAuthorization: storedAutomationAuthorization,
    automationDecision,
    automationPolicy,
    automationReservation,
    authorizationKind: storedApproval ? 'HUMAN' : 'MACHINE',
    approvedPlan: {
      publicationId: execution.id,
      planId: execution.plan.id,
      planHash: execution.plan.planHash,
      previewHash: execution.plan.preview.previewHash,
      contentHash: authorizationContentHash,
      repositoryIdentity: execution.plan.targetRepository,
      branch: execution.plan.targetBranch,
      baseSha: execution.plan.baseSha,
      touchedBlobShas: targetBlobHashes,
      riskClass: execution.plan.riskClass,
      operations,
      unifiedDiff: diff
    }
  };
}

function prismaExecutionPatch(
  transition: PublicationExecutionTransition
): Prisma.PublicationExecutionUpdateManyMutationInput {
  const patch = transition.patch ?? {};
  return {
    status: transition.toStatus,
    ...(patch.branchName !== undefined ? { branchName: patch.branchName } : {}),
    ...(patch.commitSha !== undefined ? { commitSha: patch.commitSha } : {}),
    ...(patch.pullRequestNo !== undefined ? { pullRequestNo: patch.pullRequestNo } : {}),
    ...(patch.pullRequestUrl !== undefined ? { pullRequestUrl: patch.pullRequestUrl } : {}),
    ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
    ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {})
  };
}

async function defaultTransition(transition: PublicationExecutionTransition): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.publicationExecution.updateMany({
      where: {
        id: transition.executionId,
        status: transition.fromStatus
      },
      data: prismaExecutionPatch(transition)
    });
    if (updated.count !== 1) return false;

    await tx.publicationExecutionEvent.create({
      data: {
        executionId: transition.executionId,
        eventType: transition.eventType,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        reasonCode: transition.reasonCode
      }
    });
    return true;
  });
}

function defaultResolveAdapter(context: PublicationExecutionContext): MutationAdapter | null {
  if (context.site.enabled
    && context.site.adapterType === 'EXPORT_ONLY'
    && context.site.writeCapability === 'EXPORT_ONLY') {
    return new ExportMutationAdapter();
  }
  return null;
}

function assertFeatureAndConfiguration(context: PublicationExecutionContext): void {
  if (!context.site.enabled) {
    fail('MUTATION_NOT_CONFIGURED', 'Publication site mutation is disabled');
  }
  if (context.site.writeCapability === 'GIT_DRAFT_PR' && context.planLevel === 'STANDARD') {
    fail('FEATURE_NOT_AVAILABLE', 'Git Draft PR publication requires Advanced or Enterprise');
  }
}

function isMachineAuthorization(context: PublicationExecutionContext): boolean {
  if (context.authorizationKind === 'MACHINE') return true;
  if (context.authorizationKind === 'HUMAN') return false;
  return context.approval === null && context.automationAuthorization !== null && context.automationAuthorization !== undefined;
}

function assertStoredAuthorization(context: PublicationExecutionContext, now: Date): void {
  if (!isMachineAuthorization(context)) {
    if (!context.approval || context.automationAuthorization) {
      fail('VALIDATION_FAILED', 'Human publication execution authorization cardinality is invalid');
    }
    assertApprovalCurrent(
      context.plan,
      context.preview,
      context.approval,
      {
        repositoryIdentity: context.plan.targetRepository,
        branch: context.plan.targetBranch,
        headSha: context.plan.baseSha,
        files: stringMap(context.plan.targetBlobHashes)
      },
      now
    );
    return;
  }

  if (
    context.approval
    || !context.automationAuthorization
    || !context.automationDecision
    || !context.automationPolicy
    || !context.automationReservation
  ) {
    fail('VALIDATION_FAILED', 'Machine publication execution authorization context is incomplete');
  }
  assertAutomationAuthorizationCurrent({
    authorization: context.automationAuthorization,
    plan: context.plan,
    preview: context.preview,
    decision: context.automationDecision,
    policy: context.automationPolicy,
    reservation: context.automationReservation,
    liveTarget: {
      repositoryIdentity: context.plan.targetRepository,
      branch: context.plan.targetBranch,
      headSha: context.plan.baseSha,
      files: stringMap(context.plan.targetBlobHashes)
    },
    globalKillSwitch: parseControlledAutopilotGlobalKillSwitch(
      process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
    ),
    now
  });
}

function assertLiveTarget(
  context: PublicationExecutionContext,
  target: TargetSnapshot,
  now: Date
): void {
  if (!isMachineAuthorization(context)) {
    if (!context.approval) {
      fail('VALIDATION_FAILED', 'Human publication approval is missing');
    }
    assertApprovalCurrent(
      context.plan,
      context.preview,
      context.approval,
      {
        repositoryIdentity: target.repositoryIdentity,
        branch: target.branch,
        headSha: target.headSha,
        files: target.touchedBlobShas
      },
      now
    );
    return;
  }

  if (
    !context.automationAuthorization
    || !context.automationDecision
    || !context.automationPolicy
    || !context.automationReservation
  ) {
    fail('VALIDATION_FAILED', 'Machine publication execution authorization context is incomplete');
  }
  assertAutomationAuthorizationCurrent({
    authorization: context.automationAuthorization,
    plan: context.plan,
    preview: context.preview,
    decision: context.automationDecision,
    policy: context.automationPolicy,
    reservation: context.automationReservation,
    liveTarget: {
      repositoryIdentity: target.repositoryIdentity,
      branch: target.branch,
      headSha: target.headSha,
      files: target.touchedBlobShas
    },
    globalKillSwitch: parseControlledAutopilotGlobalKillSwitch(
      process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
    ),
    now
  });
}

function failureState(code: string): {
  status: PublicationExecutionStatus;
  eventType: PublicationExecutionEventType;
} {
  if (code === 'APPROVAL_STALE') return { status: 'APPROVAL_STALE', eventType: 'APPROVAL_STALE' };
  if (code === 'TARGET_REVISION_CHANGED') {
    return { status: 'TARGET_REVISION_CHANGED', eventType: 'TARGET_REVISION_CHANGED' };
  }
  return { status: 'FAILED', eventType: 'FAILED' };
}

async function recordNonRetryableFailure(
  context: PublicationExecutionContext,
  transition: PublicationExecutionWorkerDeps['transition'],
  code: string,
  now: Date
): Promise<void> {
  const destination = failureState(code);
  if (context.execution.status === destination.status || TERMINAL_OR_EXTERNAL_STATES.has(context.execution.status)) {
    return;
  }
  const applyTransition = transition ?? defaultTransition;
  await applyTransition({
    executionId: context.execution.id,
    fromStatus: context.execution.status,
    toStatus: destination.status,
    eventType: destination.eventType,
    reasonCode: code,
    patch: {
      errorCode: code,
      completedAt: now
    }
  });
  context.execution.status = destination.status;
}

export async function processPublicationExecutionJob(
  job: PublicationExecutionJobLike,
  deps: PublicationExecutionWorkerDeps = {}
): Promise<void> {
  if (job.name !== 'execute' || !job.data?.executionId) {
    fail('VALIDATION_FAILED', 'Publication execution job data is invalid');
  }

  const loadContext = deps.loadContext ?? defaultLoadContext;
  const resolveAdapter = deps.resolveAdapter ?? defaultResolveAdapter;
  const transition = deps.transition ?? defaultTransition;
  const emit = deps.emit ?? defaultEmit;
  const now = deps.now ?? (() => new Date());
  const context = await loadContext(job.data.executionId);

  if (TERMINAL_OR_EXTERNAL_STATES.has(context.execution.status)) return;

  const startedAt = now();
  try {
    assertFeatureAndConfiguration(context);
    assertStoredAuthorization(context, startedAt);

    const adapter = resolveAdapter(context);
    if (!adapter) fail('MUTATION_NOT_CONFIGURED', 'Publication mutation adapter is not configured');
    if (context.site.writeCapability === 'GIT_DRAFT_PR' && adapter.capability !== 'DRAFT_PR') {
      fail('MUTATION_NOT_CONFIGURED', 'Publication mutation adapter capability does not match site configuration');
    }

    const target = await adapter.readTargetSnapshot({
      repositoryIdentity: context.plan.targetRepository,
      branch: context.plan.targetBranch,
      headSha: context.plan.baseSha,
      touchedBlobShas: stringMap(context.plan.targetBlobHashes)
    });
    assertLiveTarget(context, target, startedAt);

    if (context.execution.status === 'APPROVED' || context.execution.status === 'AUTOMATION_AUTHORIZED') {
      const fromStatus = context.execution.status;
      const queued = await transition({
        executionId: context.execution.id,
        fromStatus,
        toStatus: 'QUEUED',
        eventType: 'QUEUED',
        reasonCode: 'EXECUTION_QUEUED',
        patch: { errorCode: null }
      });
      if (!queued) return;
      context.execution.status = 'QUEUED';
    }

    if (context.execution.status === 'QUEUED') {
      const executing = await transition({
        executionId: context.execution.id,
        fromStatus: 'QUEUED',
        toStatus: 'EXECUTING',
        eventType: 'STARTED',
        reasonCode: 'EXECUTION_STARTED',
        patch: {
          startedAt,
          errorCode: null
        }
      });
      if (!executing) return;
      context.execution.status = 'EXECUTING';
      emit(serializePublicationEvent('mutation.execution.started', {
        projectId: context.execution.projectId,
        executionId: context.execution.id,
        status: 'EXECUTING',
        capability: adapter.capability
      }));
    }

    if (context.execution.status !== 'EXECUTING') {
      return fail('VALIDATION_FAILED', `Unsupported publication execution state: ${context.execution.status}`);
    }

    const result = await adapter.apply(context.approvedPlan);
    if (result.status !== 'APPLIED' || result.capability !== 'DRAFT_PR') {
      fail('MUTATION_NOT_CONFIGURED', 'Queued publication execution requires a Draft PR capable adapter');
    }

    const completedAt = now();
    const completed = await transition({
      executionId: context.execution.id,
      fromStatus: 'EXECUTING',
      toStatus: 'PR_CREATED',
      eventType: 'PR_CREATED',
      reasonCode: 'DRAFT_PR_CREATED',
      patch: {
        branchName: result.branchName ?? null,
        commitSha: result.commitSha ?? null,
        pullRequestNo: result.pullRequestNo ?? null,
        pullRequestUrl: result.pullRequestUrl ?? null,
        errorCode: null,
        completedAt
      }
    });
    if (!completed) return;
    context.execution.status = 'PR_CREATED';
    context.execution.branchName = result.branchName ?? null;
    context.execution.commitSha = result.commitSha ?? null;
    context.execution.pullRequestNo = result.pullRequestNo ?? null;
    context.execution.pullRequestUrl = result.pullRequestUrl ?? null;

    emit(serializePublicationEvent('mutation.execution.applied', {
      projectId: context.execution.projectId,
      executionId: context.execution.id,
      status: 'PR_CREATED',
      capability: result.capability,
      pullRequestNo: result.pullRequestNo,
      durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime())
    }));
  } catch (error) {
    const code = errorCode(error);
    const endedAt = now();
    emit(serializePublicationEvent('mutation.execution.failed', {
      projectId: context.execution.projectId,
      executionId: context.execution.id,
      status: context.execution.status,
      errorCode: code,
      durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime())
    }));

    if (classifyPublicationExecutionError(code) === 'NON_RETRYABLE') {
      await recordNonRetryableFailure(context, transition, code, endedAt);
    }
    throw error;
  }
}
