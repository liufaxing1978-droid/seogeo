import {
  Prisma,
  type AutopilotPolicy,
  type AutopilotPolicyRevision,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  normalizeAutopilotPolicy,
  toAutopilotPolicySnapshot,
} from '../optimization-autopilot/autopilot.policy.js';
import type { AutopilotPolicyMutation } from '../optimization-autopilot/autopilot.types.js';
import {
  AUTOPILOT_POLICY_REVISION_VERSION,
  buildAutopilotPolicyRevisionIdentity,
} from './policy-revision.identity.js';

export type PolicyRevisionCommandInput = {
  projectId: string;
  requestId: string;
  expectedUpdatedAt: string | null;
  actorId: string;
  policy: AutopilotPolicyMutation;
};

export type PolicyRevisionCommandEvent = {
  type:
    | 'AUTOPILOT_POLICY_REVISION_APPLIED'
    | 'AUTOPILOT_POLICY_REVISION_IDEMPOTENT_REPLAY'
    | 'AUTOPILOT_POLICY_REVISION_REJECTED';
  projectId: string;
  requestId: string;
  actorId: string | null;
  expectedUpdatedAt: string | null;
  reasonCode?:
    | 'ACTOR_REQUIRED'
    | 'OPTIMISTIC_CONCURRENCY_CONFLICT'
    | 'IDEMPOTENCY_CONFLICT'
    | 'COMMAND_FAILED';
  policyId?: string;
  revisionId?: string;
  revisionKey?: string;
  commandFingerprint?: string;
  appliedPolicyUpdatedAt?: string;
};

export type PolicyRevisionCommandOptions = {
  observe?: (event: PolicyRevisionCommandEvent) => void;
};

export type PolicyRevisionCommandResult = {
  status: 'APPLIED' | 'IDEMPOTENT_REPLAY';
  policyId: string;
  revisionId: string;
  revisionKey: string;
  commandFingerprint: string;
  appliedPolicyUpdatedAt: string;
};

function commandError(code: string): Error {
  return new Error(code);
}

function observeSafely(
  options: PolicyRevisionCommandOptions | undefined,
  event: PolicyRevisionCommandEvent,
): void {
  try {
    options?.observe?.(event);
  } catch {
    // Observability must never alter a committed command outcome.
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function storedPolicySnapshot(policy: AutopilotPolicy): Prisma.InputJsonValue {
  return asJson({
    version: policy.policyVersion,
    enabled: policy.enabled,
    allowedRiskClass: policy.allowedRiskClass,
    allowedOperationClasses: policy.allowedOperationClasses,
    dailyDraftPrLimit: policy.dailyDraftPrLimit,
    maxConcurrentRuns: policy.maxConcurrentRuns,
    requireFreshEvidence: policy.requireFreshEvidence,
    minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
    pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
    killSwitch: policy.killSwitch,
  });
}

function resultFromRevision(
  status: PolicyRevisionCommandResult['status'],
  revision: AutopilotPolicyRevision,
  commandFingerprint: string,
): PolicyRevisionCommandResult {
  return {
    status,
    policyId: revision.policyId,
    revisionId: revision.id,
    revisionKey: revision.revisionKey,
    commandFingerprint,
    appliedPolicyUpdatedAt: revision.appliedPolicyUpdatedAt.toISOString(),
  };
}

function rejectionReason(error: unknown): PolicyRevisionCommandEvent['reasonCode'] {
  if (!(error instanceof Error)) return 'COMMAND_FAILED';
  if (error.message === 'AUTOPILOT_POLICY_REVISION_CONFLICT') {
    return 'OPTIMISTIC_CONCURRENCY_CONFLICT';
  }
  if (error.message === 'AUTOPILOT_POLICY_REVISION_IDEMPOTENCY_CONFLICT') {
    return 'IDEMPOTENCY_CONFLICT';
  }
  return 'COMMAND_FAILED';
}

export async function reviseAutopilotPolicy(
  input: PolicyRevisionCommandInput,
  options?: PolicyRevisionCommandOptions,
): Promise<PolicyRevisionCommandResult> {
  const actorId = input.actorId.trim();
  if (actorId.length === 0) {
    observeSafely(options, {
      type: 'AUTOPILOT_POLICY_REVISION_REJECTED',
      projectId: input.projectId,
      requestId: input.requestId,
      actorId: null,
      expectedUpdatedAt: input.expectedUpdatedAt,
      reasonCode: 'ACTOR_REQUIRED',
    });
    throw commandError('AUTOPILOT_POLICY_REVISION_ACTOR_REQUIRED');
  }

  let rejectionRevisionKey: string | undefined;
  let rejectionCommandFingerprint: string | undefined;
  let result: PolicyRevisionCommandResult;
  try {
    const normalizedPolicy = normalizeAutopilotPolicy(input.policy);
    const { revisionKey, commandFingerprint } = buildAutopilotPolicyRevisionIdentity({
      revisionVersion: AUTOPILOT_POLICY_REVISION_VERSION,
      projectId: input.projectId,
      requestId: input.requestId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      actorId,
      normalizedPolicy,
    });
    rejectionRevisionKey = revisionKey;
    rejectionCommandFingerprint = commandFingerprint;

    result = await prisma.$transaction(async (tx) => {
      const lockKey = `p9f-policy:${input.projectId}`;
      await tx.$queryRaw<Array<{ lock: string }>>(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"
      `);

      const previousRevision = await tx.autopilotPolicyRevision.findUnique({
        where: {
          projectId_requestId: {
            projectId: input.projectId,
            requestId: input.requestId,
          },
        },
      });
      if (previousRevision) {
        if (previousRevision.revisionKey !== revisionKey) {
          throw commandError('AUTOPILOT_POLICY_REVISION_IDEMPOTENCY_CONFLICT');
        }
        return resultFromRevision('IDEMPOTENT_REPLAY', previousRevision, commandFingerprint);
      }

      const existing = await tx.autopilotPolicy.findUnique({
        where: { projectId: input.projectId },
      });
      if (existing) {
        if (
          input.expectedUpdatedAt === null
          || existing.updatedAt.toISOString() !== input.expectedUpdatedAt
        ) {
          throw commandError('AUTOPILOT_POLICY_REVISION_CONFLICT');
        }
      } else if (input.expectedUpdatedAt !== null) {
        throw commandError('AUTOPILOT_POLICY_REVISION_CONFLICT');
      }

      const now = new Date();
      const enabling = normalizedPolicy.enabled && existing?.enabled !== true;
      const enabledBy = enabling ? actorId : existing?.enabledBy ?? null;
      const enabledAt = enabling ? now : existing?.enabledAt ?? null;
      const policy = existing
        ? await tx.autopilotPolicy.update({
          where: { id: existing.id },
          data: {
            enabled: normalizedPolicy.enabled,
            policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
            allowedRiskClass: normalizedPolicy.allowedRiskClass,
            allowedOperationClasses: asJson([...normalizedPolicy.allowedOperationClasses]),
            dailyDraftPrLimit: normalizedPolicy.dailyDraftPrLimit,
            maxConcurrentRuns: normalizedPolicy.maxConcurrentRuns,
            requireFreshEvidence: normalizedPolicy.requireFreshEvidence,
            minimumEvidenceCoverage: normalizedPolicy.minimumEvidenceCoverage,
            pauseOnVerificationFailure: normalizedPolicy.pauseOnVerificationFailure,
            killSwitch: normalizedPolicy.killSwitch,
            enabledBy,
            enabledAt,
            updatedBy: actorId,
          },
        })
        : await tx.autopilotPolicy.create({
          data: {
            projectId: input.projectId,
            enabled: normalizedPolicy.enabled,
            policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
            allowedRiskClass: normalizedPolicy.allowedRiskClass,
            allowedOperationClasses: asJson([...normalizedPolicy.allowedOperationClasses]),
            dailyDraftPrLimit: normalizedPolicy.dailyDraftPrLimit,
            maxConcurrentRuns: normalizedPolicy.maxConcurrentRuns,
            requireFreshEvidence: normalizedPolicy.requireFreshEvidence,
            minimumEvidenceCoverage: normalizedPolicy.minimumEvidenceCoverage,
            pauseOnVerificationFailure: normalizedPolicy.pauseOnVerificationFailure,
            killSwitch: normalizedPolicy.killSwitch,
            enabledBy: normalizedPolicy.enabled ? actorId : null,
            enabledAt: normalizedPolicy.enabled ? now : null,
            updatedBy: actorId,
          },
        });

      const revision = await tx.autopilotPolicyRevision.create({
        data: {
          projectId: input.projectId,
          policyId: policy.id,
          revisionVersion: AUTOPILOT_POLICY_REVISION_VERSION,
          requestId: input.requestId,
          revisionKey,
          previousPolicyUpdatedAt: existing?.updatedAt ?? null,
          appliedPolicyUpdatedAt: policy.updatedAt,
          beforeSnapshotJson: existing ? storedPolicySnapshot(existing) : Prisma.JsonNull,
          afterSnapshotJson: asJson(toAutopilotPolicySnapshot(normalizedPolicy)),
          actorId,
        },
      });

      return resultFromRevision('APPLIED', revision, commandFingerprint);
    });
  } catch (error) {
    observeSafely(options, {
      type: 'AUTOPILOT_POLICY_REVISION_REJECTED',
      projectId: input.projectId,
      requestId: input.requestId,
      actorId,
      expectedUpdatedAt: input.expectedUpdatedAt,
      reasonCode: rejectionReason(error),
      ...(rejectionRevisionKey === undefined ? {} : { revisionKey: rejectionRevisionKey }),
      ...(rejectionCommandFingerprint === undefined
        ? {}
        : { commandFingerprint: rejectionCommandFingerprint }),
    });
    throw error;
  }

  observeSafely(options, {
    type: result.status === 'APPLIED'
      ? 'AUTOPILOT_POLICY_REVISION_APPLIED'
      : 'AUTOPILOT_POLICY_REVISION_IDEMPOTENT_REPLAY',
    projectId: input.projectId,
    requestId: input.requestId,
    actorId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    policyId: result.policyId,
    revisionId: result.revisionId,
    revisionKey: result.revisionKey,
    commandFingerprint: result.commandFingerprint,
    appliedPolicyUpdatedAt: result.appliedPolicyUpdatedAt,
  });

  return result;
}
