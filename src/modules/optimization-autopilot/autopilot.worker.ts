import { Prisma, type AutopilotExecutionReservation, type OptimizationAutopilotDecision } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { prisma } from '../../db/prisma.js';
import {
  authorizePublicationAutomation,
  type AuthorizePublicationAutomationInput
} from '../publication/publication-automation-authorization.js';
import {
  publicationAutomationPreparation,
  type PublicationAutomationPreparationPort
} from '../publication/publication-automation-preparation.js';
import {
  buildPublicationExecutionJobOptions,
  type PublicationExecutionQueuePort
} from '../publication/publication-execution.queue.js';
import {
  PublicationExecutionService
} from '../publication/publication-execution.service.js';
import { parseControlledAutopilotGlobalKillSwitch } from './autopilot.config.js';
import { evaluateStaticAutopilotGates } from './autopilot.gates.js';
import {
  buildOptimizationAutopilotDecisionKey
} from './autopilot.identity.js';
import {
  normalizeAutopilotPolicy,
  toAutopilotPolicySnapshot
} from './autopilot.policy.js';
import {
  OptimizationAutopilotQueue,
  type OptimizationAutopilotJobData
} from './autopilot.queue.js';
import { OptimizationAutopilotRepository } from './autopilot.repository.js';
import type {
  AutopilotPolicySnapshot,
  AutopilotSourceSnapshot,
  CreateAutopilotDecisionInput,
  NormalizedAutopilotPolicy
} from './autopilot.types.js';

export const OPTIMIZATION_AUTOPILOT_RECONCILIATION_LIMIT = 100;
export const OPTIMIZATION_AUTOPILOT_AUTHORIZATION_TTL_MS = 24 * 60 * 60 * 1000;

export type AutopilotRunItemQueuePort = Pick<OptimizationAutopilotQueue, 'enqueueRunItem'>;

type AutopilotAuthorizer = (
  input: AuthorizePublicationAutomationInput
) => ReturnType<typeof authorizePublicationAutomation>;

type AutomationExecutionServicePort = Pick<
  PublicationExecutionService,
  'createAutomationAuthorizedExecution'
>;

type AutopilotEmitPort = (event: Record<string, unknown>) => void;

export type OptimizationAutopilotWorkerDeps = {
  repository: OptimizationAutopilotRepository;
  queue: AutopilotRunItemQueuePort;
  preparation?: PublicationAutomationPreparationPort;
  authorizePublicationAutomation?: AutopilotAuthorizer;
  executionService?: AutomationExecutionServicePort;
  executionQueue?: PublicationExecutionQueuePort;
  now?: () => Date;
  beforeMachineAuthorization?: () => void | Promise<void>;
  emit?: AutopilotEmitPort;
};

type ReadyEvaluation = {
  runItemId: string;
  projectId: string;
  runId: string;
  optimizationPlanId: string;
  growthOpportunityIdentityId: string;
  candidateGrowthSnapshotId: string;
  growthEvidenceCoverage: number;
  recommendedActionType: string;
  automationEligibility: boolean;
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE';
};

type P8Facts = NonNullable<Awaited<ReturnType<OptimizationAutopilotRepository['loadExactP8AuthorityFacts']>>>;

type CapacityClaim =
  | {
      reserved: true;
      decision: OptimizationAutopilotDecision;
      reservation: AutopilotExecutionReservation;
    }
  | {
      reserved: false;
      reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' | 'AUTOPILOT_CONCURRENCY_LIMIT';
    };

function workerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function jsonStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return [...new Set(value as string[])].sort((left, right) => left.localeCompare(right));
}

function storedPolicyToNormalized(policy: {
  enabled: boolean;
  allowedRiskClass: string;
  allowedOperationClasses: unknown;
  dailyDraftPrLimit: number;
  maxConcurrentRuns: number;
  requireFreshEvidence: boolean;
  minimumEvidenceCoverage: number;
  pauseOnVerificationFailure: boolean;
  killSwitch: boolean;
}): NormalizedAutopilotPolicy | null {
  const operations = jsonStringArray(policy.allowedOperationClasses);
  if (!operations) return null;
  try {
    return normalizeAutopilotPolicy({
      enabled: policy.enabled,
      allowedRiskClass: policy.allowedRiskClass as 'LOW',
      allowedOperationClasses: operations,
      dailyDraftPrLimit: policy.dailyDraftPrLimit,
      maxConcurrentRuns: policy.maxConcurrentRuns,
      requireFreshEvidence: policy.requireFreshEvidence,
      minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
      pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
      killSwitch: policy.killSwitch
    });
  } catch {
    return null;
  }
}

function operationPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const path = (item as Record<string, unknown>).path;
    return typeof path === 'string' && path.trim() ? [path.trim()] : [];
  });
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function utcDateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function emit(
  port: AutopilotEmitPort | undefined,
  event: string,
  fields: Record<string, unknown>
): void {
  port?.({ event, ...fields });
}

async function loadReadyEvaluation(
  runItemId: string,
  projectId: string
): Promise<ReadyEvaluation | null> {
  const [item, project] = await Promise.all([
    prisma.optimizationRunItem.findFirst({
      where: {
        id: runItemId,
        projectId,
        currentStage: 'READY_FOR_POLICY',
        status: 'COMPLETED',
        run: { projectId, status: 'SUCCEEDED' },
        optimizationPlan: { projectId }
      },
      select: {
        id: true,
        runId: true,
        projectId: true,
        optimizationPlanId: true,
        optimizationPlan: {
          select: {
            recommendedActionType: true,
            automationEligibility: true,
            candidate: {
              select: {
                projectId: true,
                growthOpportunityIdentityId: true,
                growthSnapshotId: true,
                growthEvidenceCoverage: true
              }
            }
          }
        }
      }
    }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, planLevel: true }
    })
  ]);
  if (!item || !project || item.optimizationPlan.candidate.projectId !== projectId) return null;
  return {
    runItemId: item.id,
    projectId: item.projectId,
    runId: item.runId,
    optimizationPlanId: item.optimizationPlanId,
    growthOpportunityIdentityId: item.optimizationPlan.candidate.growthOpportunityIdentityId,
    candidateGrowthSnapshotId: item.optimizationPlan.candidate.growthSnapshotId,
    growthEvidenceCoverage: item.optimizationPlan.candidate.growthEvidenceCoverage,
    recommendedActionType: item.optimizationPlan.recommendedActionType,
    automationEligibility: item.optimizationPlan.automationEligibility,
    planLevel: project.planLevel
  };
}

function sourceSnapshot(input: {
  evaluation: ReadyEvaluation;
  latestGrowthSnapshotId: string | null;
  growthScoreState: string;
  growthRankingEligible: boolean;
  growthLifecycleStatus: string | null;
  verificationState: string | null;
  hasConflict: boolean;
  entitled: boolean;
  globalKillSwitch: boolean;
  p8: P8Facts | null;
}): AutopilotSourceSnapshot {
  const base: AutopilotSourceSnapshot = {
    runItemId: input.evaluation.runItemId,
    optimizationPlanId: input.evaluation.optimizationPlanId,
    growthOpportunityIdentityId: input.evaluation.growthOpportunityIdentityId,
    candidateGrowthSnapshotId: input.evaluation.candidateGrowthSnapshotId,
    latestGrowthSnapshotId: input.latestGrowthSnapshotId,
    growthEvidenceCoverage: input.evaluation.growthEvidenceCoverage,
    growthScoreState: input.growthScoreState,
    growthRankingEligible: input.growthRankingEligible,
    growthLifecycleStatus: input.growthLifecycleStatus,
    verificationState: input.verificationState,
    hasConflict: input.hasConflict,
    controlledAutopilotEntitled: input.entitled,
    globalKillSwitch: input.globalKillSwitch
  };
  if (!input.p8) return base;
  return {
    ...base,
    publicationPlanId: input.p8.p8PlanId,
    publicationPlanHash: input.p8.planHash,
    publicationPreviewId: input.p8.p8PreviewId,
    publicationPreviewHash: input.p8.previewHash,
    publicationRiskClass: input.p8.riskClass,
    publicationBaseSha: input.p8.baseSha,
    publicationTargetRepository: input.p8.targetRepository,
    publicationTargetBranch: input.p8.targetBranch,
    publicationOperationTypes: [...input.p8.operationTypes]
  };
}

function decisionInput(input: {
  evaluation: ReadyEvaluation;
  policyId: string;
  policyVersion: string;
  policySnapshot: AutopilotPolicySnapshot;
  sourceSnapshot: AutopilotSourceSnapshot;
  status: CreateAutopilotDecisionInput['status'];
  reasonCodes: readonly string[];
  p8: P8Facts | null;
}): CreateAutopilotDecisionInput {
  const p8PlanId = input.p8?.p8PlanId ?? null;
  const p8PreviewId = input.p8?.p8PreviewId ?? null;
  return {
    projectId: input.evaluation.projectId,
    runId: input.evaluation.runId,
    runItemId: input.evaluation.runItemId,
    optimizationPlanId: input.evaluation.optimizationPlanId,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    policySnapshot: input.policySnapshot,
    sourceSnapshot: input.sourceSnapshot,
    status: input.status,
    reasonCodes: input.reasonCodes,
    p8PlanId,
    p8PreviewId,
    decisionKey: buildOptimizationAutopilotDecisionKey({
      projectId: input.evaluation.projectId,
      runItemId: input.evaluation.runItemId,
      optimizationPlanId: input.evaluation.optimizationPlanId,
      policyVersion: input.policyVersion,
      policySnapshot: input.policySnapshot,
      sourceSnapshot: input.sourceSnapshot,
      p8PlanId,
      p8PreviewId
    })
  };
}

async function claimReadyCapacity(
  input: CreateAutopilotDecisionInput,
  policy: NormalizedAutopilotPolicy,
  date: string
): Promise<CapacityClaim> {
  const day = utcDateValue(date);
  const lockKey = `p9c:${input.projectId}:${date}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ lock: string }>>(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"
    `);

    const txRepository = new OptimizationAutopilotRepository(tx as unknown as typeof prisma);
    const existingDecision = await tx.optimizationAutopilotDecision.findUnique({
      where: { decisionKey: input.decisionKey }
    });
    if (existingDecision) {
      const decision = await txRepository.createOrGetDecision(input);
      const reservation = await tx.autopilotExecutionReservation.findUnique({
        where: { decisionId: decision.id }
      });
      if (!reservation) throw workerError('AUTOPILOT_RESERVATION_MISSING', 'Existing ready decision has no capacity reservation');
      if (
        reservation.projectId !== input.projectId
        || reservation.utcDate.toISOString().slice(0, 10) !== date
        || reservation.status === 'RELEASED'
      ) {
        throw workerError('AUTOPILOT_RESERVATION_STALE', 'Existing capacity reservation is not reusable');
      }
      return { reserved: true as const, decision, reservation };
    }

    const dailyReservations = await tx.autopilotExecutionReservation.count({
      where: {
        projectId: input.projectId,
        utcDate: day,
        status: { in: ['RESERVED', 'CONSUMED'] }
      }
    });
    if (dailyReservations >= policy.dailyDraftPrLimit) {
      return { reserved: false as const, reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' as const };
    }

    const activeMachineExecutions = await tx.publicationExecution.count({
      where: {
        projectId: input.projectId,
        automationAuthorizationId: { not: null },
        status: { in: ['AUTOMATION_AUTHORIZED', 'QUEUED', 'EXECUTING'] }
      }
    });
    if (activeMachineExecutions >= policy.maxConcurrentRuns) {
      return { reserved: false as const, reasonCode: 'AUTOPILOT_CONCURRENCY_LIMIT' as const };
    }

    const decision = await txRepository.createOrGetDecision(input);
    const reservation = await tx.autopilotExecutionReservation.create({
      data: {
        projectId: input.projectId,
        decisionId: decision.id,
        utcDate: day,
        reservationKey: `p9c:${input.projectId}:${date}:${decision.id}`,
        status: 'RESERVED'
      }
    });
    return { reserved: true as const, decision, reservation };
  });
}

async function consumeReservation(reservationId: string, decisionId: string): Promise<void> {
  const updated = await prisma.autopilotExecutionReservation.updateMany({
    where: { id: reservationId, decisionId, status: 'RESERVED', releasedAt: null },
    data: { status: 'CONSUMED' }
  });
  if (updated.count === 1) return;
  const existing = await prisma.autopilotExecutionReservation.findUnique({ where: { id: reservationId } });
  if (existing?.decisionId === decisionId && existing.status === 'CONSUMED' && existing.releasedAt === null) return;
  throw workerError('AUTOPILOT_RESERVATION_STALE', 'Capacity reservation could not be consumed');
}

async function enqueueExecution(
  queue: PublicationExecutionQueuePort,
  execution: { id: string; executionKey: string }
): Promise<void> {
  await queue.add(
    'execute',
    { executionId: execution.id },
    buildPublicationExecutionJobOptions(execution.executionKey)
  );
}

async function resumeExistingHandoff(input: {
  evaluation: ReadyEvaluation;
  policy: NormalizedAutopilotPolicy;
  executionQueue: PublicationExecutionQueuePort | undefined;
  emitPort: AutopilotEmitPort | undefined;
  date: string;
}): Promise<boolean> {
  const decision = await prisma.optimizationAutopilotDecision.findFirst({
    where: {
      projectId: input.evaluation.projectId,
      runItemId: input.evaluation.runItemId,
      optimizationPlanId: input.evaluation.optimizationPlanId,
      status: 'AUTOPILOT_READY'
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  });
  if (!decision) return false;
  const authorization = await prisma.publicationAutomationAuthorization.findUnique({
    where: { automationDecisionId: decision.id }
  });
  if (!authorization) return false;
  const execution = await prisma.publicationExecution.findFirst({
    where: {
      projectId: input.evaluation.projectId,
      planId: authorization.planId,
      automationAuthorizationId: authorization.id,
      approvalId: null
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  if (!execution) return false;
  const reservation = await prisma.autopilotExecutionReservation.findUnique({
    where: { decisionId: decision.id }
  });
  if (
    !reservation
    || reservation.releasedAt !== null
    || !['RESERVED', 'CONSUMED'].includes(reservation.status)
    || reservation.utcDate.toISOString().slice(0, 10) !== input.date
  ) {
    throw workerError('AUTOPILOT_RESERVATION_STALE', 'Existing automatic handoff has no current capacity reservation');
  }

  if (
    !input.policy.enabled
    || input.policy.killSwitch
    || parseControlledAutopilotGlobalKillSwitch(process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH)
  ) return true;

  if (['PR_CREATED', 'DEPLOYED', 'VERIFYING', 'VERIFIED', 'VERIFICATION_FAILED'].includes(execution.status)) {
    return true;
  }
  if (!input.executionQueue) {
    throw workerError('AUTOPILOT_EXECUTION_QUEUE_MISSING', 'P8 execution queue is required for automatic handoff');
  }
  await consumeReservation(reservation.id, decision.id);
  await enqueueExecution(input.executionQueue, execution);
  emit(input.emitPort, 'optimization.autopilot.execution.queued', {
    projectId: input.evaluation.projectId,
    runItemId: input.evaluation.runItemId,
    decisionId: decision.id,
    executionId: execution.id,
    policyVersion: decision.policyVersion,
    p8PlanId: authorization.planId,
    status: execution.status,
    utcDate: input.date
  });
  return true;
}

export async function processOptimizationAutopilotJob(
  job: { name: string; data: OptimizationAutopilotJobData },
  deps?: OptimizationAutopilotWorkerDeps
): Promise<void> {
  if (!deps) {
    throw workerError(
      'AUTOPILOT_WORKER_DEPENDENCIES_MISSING',
      'Optimization autopilot worker dependencies are required'
    );
  }

  if (job.data.kind === 'RECONCILE_DAILY') {
    if (job.name !== 'reconcile-daily') {
      throw workerError('INVALID_AUTOPILOT_JOB', 'Unexpected autopilot reconciliation job name');
    }
    const readyItems = await deps.repository.listReadyItemsWithoutEffectiveDecision(
      OPTIMIZATION_AUTOPILOT_RECONCILIATION_LIMIT
    );
    for (const item of readyItems) await deps.queue.enqueueRunItem(item.id, item.projectId);
    return;
  }

  if (job.name !== 'evaluate-run-item') {
    throw workerError('INVALID_AUTOPILOT_JOB', 'Unexpected autopilot evaluation job name');
  }

  const now = deps.now?.() ?? new Date();
  const date = utcDate(now);
  const evaluation = await loadReadyEvaluation(job.data.runItemId, job.data.projectId);
  if (!evaluation) return;

  const storedPolicy = await deps.repository.getPolicy(evaluation.projectId);
  if (!storedPolicy) return;
  const policy = storedPolicyToNormalized(storedPolicy);
  if (!policy) {
    emit(deps.emit, 'optimization.autopilot.blocked', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      reason: 'AUTOPILOT_POLICY_INVALID',
      policyVersion: storedPolicy.policyVersion,
      utcDate: date
    });
    return;
  }
  const policySnapshot = toAutopilotPolicySnapshot(policy);
  const entitled = hasFeature(evaluation.planLevel, 'CONTROLLED_AUTOPILOT');
  const globalKillSwitch = parseControlledAutopilotGlobalKillSwitch(
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
  );

  if (await resumeExistingHandoff({
    evaluation,
    policy,
    executionQueue: deps.executionQueue,
    emitPort: deps.emit,
    date
  })) return;

  const growth = await deps.repository.loadGrowthAuthorityFacts(
    evaluation.projectId,
    evaluation.growthOpportunityIdentityId
  );
  const verificationState = await deps.repository.loadLatestVerificationState(evaluation.projectId);
  let p8 = await deps.repository.loadExactP8AuthorityFacts({
    projectId: evaluation.projectId,
    optimizationPlanId: evaluation.optimizationPlanId,
    runItemId: evaluation.runItemId
  });

  if (!entitled || !policy.enabled || policy.killSwitch || globalKillSwitch || !evaluation.automationEligibility) {
    const snapshot = sourceSnapshot({
      evaluation,
      latestGrowthSnapshotId: growth?.latestGrowthSnapshotId ?? null,
      growthScoreState: growth?.growthScoreState ?? 'UNKNOWN',
      growthRankingEligible: growth?.growthRankingEligible ?? false,
      growthLifecycleStatus: growth?.growthLifecycleStatus ?? null,
      verificationState,
      hasConflict: false,
      entitled,
      globalKillSwitch,
      p8
    });
    const reasonCode = !entitled
      ? 'AUTOPILOT_FEATURE_NOT_AVAILABLE'
      : !evaluation.automationEligibility
        ? 'AUTOPILOT_PLAN_NOT_ELIGIBLE'
        : globalKillSwitch
          ? 'AUTOPILOT_GLOBAL_KILL_SWITCH'
          : policy.killSwitch
            ? 'AUTOPILOT_PROJECT_KILL_SWITCH'
            : 'AUTOPILOT_POLICY_DISABLED';
    await deps.repository.createOrGetDecision(decisionInput({
      evaluation,
      policyId: storedPolicy.id,
      policyVersion: storedPolicy.policyVersion,
      policySnapshot,
      sourceSnapshot: snapshot,
      status: 'POLICY_BLOCKED',
      reasonCodes: [reasonCode],
      p8
    }));
    emit(deps.emit, 'optimization.autopilot.blocked', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      reason: reasonCode,
      policyVersion: storedPolicy.policyVersion,
      p8PlanId: p8?.p8PlanId ?? null,
      status: 'POLICY_BLOCKED',
      utcDate: date
    });
    return;
  }

  if (!p8) {
    const preparation = deps.preparation ?? publicationAutomationPreparation;
    const prepared = await preparation.prepareContentCreation({
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      optimizationPlanId: evaluation.optimizationPlanId,
      decisionId: buildOptimizationAutopilotDecisionKey({
        projectId: evaluation.projectId,
        runItemId: evaluation.runItemId,
        optimizationPlanId: evaluation.optimizationPlanId,
        policyVersion: storedPolicy.policyVersion,
        policySnapshot,
        sourceSnapshot: { preparation: true },
        p8PlanId: null,
        p8PreviewId: null
      })
    });
    if (prepared.state === 'P8_READY') {
      p8 = await deps.repository.loadExactP8AuthorityFacts({
        projectId: evaluation.projectId,
        optimizationPlanId: evaluation.optimizationPlanId,
        runItemId: evaluation.runItemId
      });
    }
    if (!p8) {
      const status = prepared.state === 'MANUAL_REQUIRED'
        ? 'MANUAL_REQUIRED'
        : prepared.state === 'VALIDATION_BLOCKED'
          ? 'P8_VALIDATION_BLOCKED'
          : 'P8_PREPARATION_REQUIRED';
      const reasonCode = prepared.reasonCode ?? 'AUTOPILOT_P8_PREPARATION_REQUIRED';
      const snapshot = sourceSnapshot({
        evaluation,
        latestGrowthSnapshotId: growth?.latestGrowthSnapshotId ?? null,
        growthScoreState: growth?.growthScoreState ?? 'UNKNOWN',
        growthRankingEligible: growth?.growthRankingEligible ?? false,
        growthLifecycleStatus: growth?.growthLifecycleStatus ?? null,
        verificationState,
        hasConflict: false,
        entitled,
        globalKillSwitch,
        p8: null
      });
      await deps.repository.createOrGetDecision(decisionInput({
        evaluation,
        policyId: storedPolicy.id,
        policyVersion: storedPolicy.policyVersion,
        policySnapshot,
        sourceSnapshot: { ...snapshot, preparationState: prepared.state, preparationReason: prepared.reasonCode },
        status,
        reasonCodes: [reasonCode],
        p8: null
      }));
      emit(deps.emit, 'optimization.autopilot.deferred', {
        projectId: evaluation.projectId,
        runItemId: evaluation.runItemId,
        reason: reasonCode,
        policyVersion: storedPolicy.policyVersion,
        status,
        utcDate: date
      });
      return;
    }
  }

  const planRow = await prisma.publicationPlan.findUnique({
    where: { id: p8.p8PlanId },
    select: { operations: true }
  });
  const paths = operationPaths(planRow?.operations);
  const hasConflict = paths.length !== 1
    ? true
    : await deps.repository.hasActivePublicationConflict({
        projectId: evaluation.projectId,
        targetPublicUrl: p8.targetPublicUrl,
        targetRepository: p8.targetRepository,
        repositoryPath: paths[0]!
      });

  const gateResult = evaluateStaticAutopilotGates({
    recommendedActionType: evaluation.recommendedActionType,
    evidenceCoverage: evaluation.growthEvidenceCoverage,
    minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
    requireFreshEvidence: policy.requireFreshEvidence,
    candidateGrowthSnapshotId: evaluation.candidateGrowthSnapshotId,
    latestGrowthSnapshotId: growth?.latestGrowthSnapshotId ?? null,
    growthScoreState: growth?.growthScoreState ?? 'UNKNOWN',
    growthRankingEligible: growth?.growthRankingEligible ?? false,
    growthLifecycleStatus: growth?.growthLifecycleStatus ?? null,
    pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
    verificationPaused: verificationState === 'VERIFICATION_FAILED',
    hasConflict,
    p8: {
      projectMatches: true,
      preparationMatches: true,
      riskClass: p8.riskClass as 'LOW' | 'MEDIUM' | 'HIGH',
      operationTypes: p8.operationTypes,
      blockingCodes: p8.blockingCodes,
      warningCodes: p8.warningCodes,
      gitDraftPrAvailable: p8.gitDraftPrAvailable,
      targetBindingCurrent: true
    }
  });

  const snapshot = sourceSnapshot({
    evaluation,
    latestGrowthSnapshotId: growth?.latestGrowthSnapshotId ?? null,
    growthScoreState: growth?.growthScoreState ?? 'UNKNOWN',
    growthRankingEligible: growth?.growthRankingEligible ?? false,
    growthLifecycleStatus: growth?.growthLifecycleStatus ?? null,
    verificationState,
    hasConflict,
    entitled,
    globalKillSwitch,
    p8
  });

  if (!gateResult.allowed) {
    await deps.repository.createOrGetDecision(decisionInput({
      evaluation,
      policyId: storedPolicy.id,
      policyVersion: storedPolicy.policyVersion,
      policySnapshot,
      sourceSnapshot: snapshot,
      status: gateResult.status,
      reasonCodes: [gateResult.reasonCode],
      p8
    }));
    emit(deps.emit, 'optimization.autopilot.deferred', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      reason: gateResult.reasonCode,
      policyVersion: storedPolicy.policyVersion,
      p8PlanId: p8.p8PlanId,
      p8PreviewId: p8.p8PreviewId,
      risk: p8.riskClass,
      operationCount: p8.operationTypes.length,
      status: gateResult.status,
      utcDate: date
    });
    return;
  }

  const readyInput = decisionInput({
    evaluation,
    policyId: storedPolicy.id,
    policyVersion: storedPolicy.policyVersion,
    policySnapshot,
    sourceSnapshot: snapshot,
    status: 'AUTOPILOT_READY',
    reasonCodes: [],
    p8
  });
  const capacity = await claimReadyCapacity(readyInput, policy, date);
  if (!capacity.reserved) {
    const deferredSnapshot = {
      ...snapshot,
      capacityReason: capacity.reasonCode,
      capacityUtcDate: date
    };
    await deps.repository.createOrGetDecision(decisionInput({
      evaluation,
      policyId: storedPolicy.id,
      policyVersion: storedPolicy.policyVersion,
      policySnapshot,
      sourceSnapshot: deferredSnapshot,
      status: 'DEFERRED_QUOTA',
      reasonCodes: [capacity.reasonCode],
      p8
    }));
    emit(deps.emit, 'optimization.autopilot.deferred', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      reason: capacity.reasonCode,
      policyVersion: storedPolicy.policyVersion,
      p8PlanId: p8.p8PlanId,
      p8PreviewId: p8.p8PreviewId,
      status: 'DEFERRED_QUOTA',
      utcDate: date
    });
    return;
  }

  await deps.beforeMachineAuthorization?.();
  const killedBeforeAuthorization = parseControlledAutopilotGlobalKillSwitch(
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
  ) || !policy.enabled || policy.killSwitch;
  if (killedBeforeAuthorization) {
    emit(deps.emit, 'optimization.autopilot.deferred', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      decisionId: capacity.decision.id,
      reason: 'AUTOPILOT_KILL_SWITCH_RECHECK',
      policyVersion: storedPolicy.policyVersion,
      p8PlanId: p8.p8PlanId,
      status: 'AUTOPILOT_READY',
      utcDate: date
    });
    return;
  }

  const authorizer = deps.authorizePublicationAutomation ?? authorizePublicationAutomation;
  let authorization = await prisma.publicationAutomationAuthorization.findUnique({
    where: { automationDecisionId: capacity.decision.id }
  });
  if (!authorization) {
    authorization = await authorizer({
      projectId: evaluation.projectId,
      planId: p8.p8PlanId,
      decisionId: capacity.decision.id,
      reservationId: capacity.reservation.id,
      expiresAt: new Date(Date.now() + OPTIMIZATION_AUTOPILOT_AUTHORIZATION_TTL_MS)
    });
    emit(deps.emit, 'optimization.autopilot.authorization.created', {
      projectId: evaluation.projectId,
      runItemId: evaluation.runItemId,
      decisionId: capacity.decision.id,
      authorizationId: authorization.id,
      policyVersion: storedPolicy.policyVersion,
      p8PlanId: p8.p8PlanId,
      p8PreviewId: p8.p8PreviewId,
      risk: p8.riskClass,
      operationCount: p8.operationTypes.length,
      utcDate: date
    });
  }

  const executionService = deps.executionService ?? new PublicationExecutionService();
  const execution = await executionService.createAutomationAuthorizedExecution({
    projectId: evaluation.projectId,
    planId: p8.p8PlanId,
    automationAuthorizationId: authorization.id
  });

  const killedBeforeEnqueue = parseControlledAutopilotGlobalKillSwitch(
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
  ) || !policy.enabled || policy.killSwitch;
  if (killedBeforeEnqueue) return;
  if (!deps.executionQueue) {
    throw workerError('AUTOPILOT_EXECUTION_QUEUE_MISSING', 'P8 execution queue is required for automatic handoff');
  }

  await consumeReservation(capacity.reservation.id, capacity.decision.id);
  await enqueueExecution(deps.executionQueue, execution);
  emit(deps.emit, 'optimization.autopilot.execution.queued', {
    projectId: evaluation.projectId,
    runItemId: evaluation.runItemId,
    decisionId: capacity.decision.id,
    authorizationId: authorization.id,
    executionId: execution.id,
    policyVersion: storedPolicy.policyVersion,
    p8PlanId: p8.p8PlanId,
    p8PreviewId: p8.p8PreviewId,
    risk: p8.riskClass,
    operationCount: p8.operationTypes.length,
    status: execution.status,
    utcDate: date
  });
}
