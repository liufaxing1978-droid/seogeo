import type { OptimizationCandidate, OptimizationPlan, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildRunItemKey } from './orchestration.identity.js';
import type {
  OptimizationOrchestrationJobData,
  OptimizationPlanningJobData
} from './orchestration.queue.js';
import {
  OptimizationOrchestrationRepository,
  type OrchestrationDbClient
} from './orchestration.repository.js';

export class OptimizationOrchestrationWorkerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OptimizationOrchestrationWorkerError';
  }
}

const NON_RETRYABLE_CODES = new Set([
  'INVALID_PLANNING_JOB',
  'RUN_NOT_FOUND',
  'RUN_PROJECT_MISMATCH',
  'INVALID_RUN_STATE',
  'CANDIDATE_PROJECT_MISMATCH',
  'PLAN_PROJECT_MISMATCH',
  'ASYNC_AI_NOT_ALLOWED',
  'PLANNING_CHECKPOINT_CONFLICT',
  'WORKER_DEPENDENCIES_MISSING'
]);

export function classifyOptimizationOrchestrationError(
  code: string
): 'RETRYABLE' | 'NON_RETRYABLE' {
  return NON_RETRYABLE_CODES.has(code) ? 'NON_RETRYABLE' : 'RETRYABLE';
}

export type MaterializeOptimizationResultPort = {
  candidates: OptimizationCandidate[];
  plans: OptimizationPlan[];
  aiTaskId: string | null;
};

export type PlanningWorkerRepositoryPort = Pick<
  OptimizationOrchestrationRepository,
  'getRun' | 'transitionRun'
>;

export type PlanningWorkerDeps = {
  repository: PlanningWorkerRepositoryPort;
  materializeProject(
    projectId: string,
    options: { advisoryRootDir: string; useAi: false }
  ): Promise<MaterializeOptimizationResultPort>;
  orchestrationQueue: {
    enqueueRun(runId: string, projectId: string): Promise<unknown>;
  };
  orchestrationService: {
    reconcileUtcDate(utcDate: string): Promise<unknown>;
  };
  advisoryRootDir: string;
  now?: () => Date;
  transaction?: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

function requireDeps(deps?: PlanningWorkerDeps): PlanningWorkerDeps {
  if (!deps) {
    throw new OptimizationOrchestrationWorkerError(
      'WORKER_DEPENDENCIES_MISSING',
      'Optimization orchestration worker dependencies are required'
    );
  }
  return deps;
}

function workerError(code: string, message: string): OptimizationOrchestrationWorkerError {
  return new OptimizationOrchestrationWorkerError(code, message);
}

function transactionRunner<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(callback);
}

async function persistDeterministicFailure(input: {
  repository: PlanningWorkerRepositoryPort;
  runId: string;
  code: string;
  now: Date;
}): Promise<void> {
  await input.repository.transitionRun({
    runId: input.runId,
    from: 'RUNNING',
    to: 'FAILED',
    patch: {
      failureCount: 1,
      lastErrorCode: input.code,
      completedAt: input.now
    }
  });
}

async function processDailyReconciliation(
  data: Extract<OptimizationPlanningJobData, { kind: 'RECONCILE_DAILY' }>,
  deps: PlanningWorkerDeps
): Promise<void> {
  void data;
  const utcDate = (deps.now ?? (() => new Date()))().toISOString().slice(0, 10);
  await deps.orchestrationService.reconcileUtcDate(utcDate);
}

async function processMaterializeRun(
  jobName: string,
  data: Extract<OptimizationPlanningJobData, { kind: 'MATERIALIZE_RUN' }>,
  deps: PlanningWorkerDeps
): Promise<void> {
  if (jobName !== 'materialize-run') {
    throw workerError('INVALID_PLANNING_JOB', 'Unexpected optimization planning job name');
  }

  const now = deps.now ?? (() => new Date());
  let run = await deps.repository.getRun(data.runId);
  if (!run) throw workerError('RUN_NOT_FOUND', 'Optimization run does not exist');
  if (run.projectId !== data.projectId) {
    throw workerError('RUN_PROJECT_MISMATCH', 'Optimization run project mismatch');
  }
  if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return;

  if (run.status === 'QUEUED') {
    await deps.repository.transitionRun({
      runId: run.id,
      from: 'QUEUED',
      to: 'RUNNING',
      patch: { startedAt: now(), lastErrorCode: null }
    });
    const reloaded = await deps.repository.getRun(run.id);
    if (!reloaded) throw workerError('RUN_NOT_FOUND', 'Optimization run disappeared after transition');
    run = reloaded;
    if (run.projectId !== data.projectId) {
      throw workerError('RUN_PROJECT_MISMATCH', 'Optimization run project mismatch after transition');
    }
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return;
  }

  if (run.status !== 'RUNNING') {
    throw workerError('INVALID_RUN_STATE', 'Optimization run is not eligible for planning');
  }

  if (run.planningCompletedAt) {
    await deps.orchestrationQueue.enqueueRun(run.id, run.projectId);
    return;
  }

  try {
    const result = await deps.materializeProject(run.projectId, {
      advisoryRootDir: deps.advisoryRootDir,
      useAi: false
    });

    if (result.aiTaskId !== null) {
      throw workerError('ASYNC_AI_NOT_ALLOWED', 'P9-B deterministic planning cannot await an AI continuation');
    }
    for (const candidate of result.candidates) {
      if (candidate.projectId !== run.projectId) {
        throw workerError('CANDIDATE_PROJECT_MISMATCH', 'Optimization candidate project mismatch');
      }
    }

    const runId = run.id;
    const projectId = run.projectId;
    const planningCompletedAt = now();
    const executeTransaction = deps.transaction ?? transactionRunner;

    await executeTransaction(async (tx) => {
      const txRepository = new OptimizationOrchestrationRepository(
        tx as unknown as OrchestrationDbClient
      );

      for (const plan of result.plans) {
        if (plan.projectId !== projectId) {
          throw workerError('PLAN_PROJECT_MISMATCH', 'Optimization plan project mismatch');
        }
        await txRepository.createOrGetRunItem({
          runId,
          projectId,
          optimizationPlanId: plan.id,
          itemKey: buildRunItemKey({ runId, optimizationPlanId: plan.id })
        });
      }

      const items = await txRepository.listRunItems(runId);
      const checkpointed = await txRepository.markPlanningComplete({
        runId,
        candidateCount: result.candidates.length,
        plannedCount: result.plans.length,
        itemCount: items.length,
        planningCompletedAt
      });
      if (!checkpointed) {
        throw workerError(
          'PLANNING_CHECKPOINT_CONFLICT',
          'Optimization planning checkpoint was already advanced'
        );
      }
    });

    await deps.orchestrationQueue.enqueueRun(run.id, run.projectId);
  } catch (error) {
    if (
      error instanceof OptimizationOrchestrationWorkerError &&
      classifyOptimizationOrchestrationError(error.code) === 'NON_RETRYABLE'
    ) {
      await persistDeterministicFailure({
        repository: deps.repository,
        runId: run.id,
        code: error.code,
        now: now()
      });
    }
    throw error;
  }
}

export async function processOptimizationPlanningJob(
  job: { name: string; data: OptimizationPlanningJobData },
  deps?: PlanningWorkerDeps
): Promise<void> {
  const resolved = requireDeps(deps);

  if (job.data.kind === 'RECONCILE_DAILY') {
    if (job.name !== 'reconcile-daily') {
      throw workerError('INVALID_PLANNING_JOB', 'Unexpected daily reconciliation job name');
    }
    await processDailyReconciliation(job.data, resolved);
    return;
  }

  await processMaterializeRun(job.name, job.data, resolved);
}

export type OrchestrationWorkerDeps = PlanningWorkerDeps;

export async function processOptimizationOrchestrationJob(
  _job: { name: string; data: OptimizationOrchestrationJobData },
  _deps?: OrchestrationWorkerDeps
): Promise<void> {
  throw workerError('INVALID_RUN_STATE', 'Optimization advance worker is not implemented yet');
}
