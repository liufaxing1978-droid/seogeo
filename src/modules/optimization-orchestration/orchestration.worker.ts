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
  'INVALID_ORCHESTRATION_JOB',
  'RUN_NOT_FOUND',
  'RUN_PROJECT_MISMATCH',
  'INVALID_RUN_STATE',
  'PLANNING_NOT_COMPLETE',
  'CANDIDATE_PROJECT_MISMATCH',
  'RUN_ITEM_PROJECT_MISMATCH',
  'RUN_ITEM_INVALID_STATE',
  'PLAN_NOT_FOUND',
  'PLAN_PROJECT_MISMATCH',
  'ASYNC_AI_NOT_ALLOWED',
  'PLANNING_CHECKPOINT_CONFLICT',
  'RUN_TERMINAL_TRANSITION_CONFLICT',
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

export type AdvanceWorkerRepositoryPort = Pick<
  OptimizationOrchestrationRepository,
  'getRun' | 'getPlan' | 'listRunItems' | 'transitionItem' | 'refreshRunCounters' | 'transitionRun'
>;

export type AdvanceWorkerDeps = {
  repository: AdvanceWorkerRepositoryPort;
  now?: () => Date;
};

function requirePlanningDeps(deps?: PlanningWorkerDeps): PlanningWorkerDeps {
  if (!deps) {
    throw new OptimizationOrchestrationWorkerError(
      'WORKER_DEPENDENCIES_MISSING',
      'Optimization planning worker dependencies are required'
    );
  }
  return deps;
}

function requireAdvanceDeps(deps?: AdvanceWorkerDeps): AdvanceWorkerDeps {
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
  const resolved = requirePlanningDeps(deps);

  if (job.data.kind === 'RECONCILE_DAILY') {
    if (job.name !== 'reconcile-daily') {
      throw workerError('INVALID_PLANNING_JOB', 'Unexpected daily reconciliation job name');
    }
    await processDailyReconciliation(job.data, resolved);
    return;
  }

  await processMaterializeRun(job.name, job.data, resolved);
}

async function failAdvanceRun(input: {
  repository: AdvanceWorkerRepositoryPort;
  runId: string;
  itemId?: string;
  itemStatus?: 'PENDING' | 'COMPLETED' | 'FAILED';
  code: string;
  completedAt: Date;
}): Promise<void> {
  if (input.itemId && input.itemStatus && input.itemStatus !== 'FAILED') {
    await input.repository.transitionItem({
      itemId: input.itemId,
      from: input.itemStatus,
      to: 'FAILED',
      patch: {
        reasonCode: input.code,
        completedAt: input.completedAt
      }
    });
  }

  const refreshed = await input.repository.refreshRunCounters(input.runId);
  await input.repository.transitionRun({
    runId: input.runId,
    from: 'RUNNING',
    to: 'FAILED',
    patch: {
      itemCount: refreshed.itemCount,
      completedCount: refreshed.completedCount,
      failureCount: refreshed.failureCount === 0 ? 1 : refreshed.failureCount,
      completedAt: input.completedAt,
      lastErrorCode: input.code
    }
  });
}

export type OrchestrationWorkerDeps = AdvanceWorkerDeps;

export async function processOptimizationOrchestrationJob(
  job: { name: string; data: OptimizationOrchestrationJobData },
  deps?: OrchestrationWorkerDeps
): Promise<void> {
  const resolved = requireAdvanceDeps(deps);
  if (job.name !== 'advance-run') {
    throw workerError('INVALID_ORCHESTRATION_JOB', 'Unexpected optimization orchestration job name');
  }

  const run = await resolved.repository.getRun(job.data.runId);
  if (!run) throw workerError('RUN_NOT_FOUND', 'Optimization run does not exist');
  if (run.projectId !== job.data.projectId) {
    throw workerError('RUN_PROJECT_MISMATCH', 'Optimization run project mismatch');
  }
  if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return;
  if (run.status !== 'RUNNING') {
    throw workerError('INVALID_RUN_STATE', 'Optimization run is not eligible for orchestration');
  }

  const completedAt = (resolved.now ?? (() => new Date()))();
  if (!run.planningCompletedAt) {
    await failAdvanceRun({
      repository: resolved.repository,
      runId: run.id,
      code: 'PLANNING_NOT_COMPLETE',
      completedAt
    });
    throw workerError('PLANNING_NOT_COMPLETE', 'Optimization planning checkpoint is missing');
  }

  const items = await resolved.repository.listRunItems(run.id);
  for (const item of items) {
    if (item.projectId !== run.projectId) {
      await failAdvanceRun({
        repository: resolved.repository,
        runId: run.id,
        itemId: item.id,
        itemStatus: item.status,
        code: 'RUN_ITEM_PROJECT_MISMATCH',
        completedAt
      });
      throw workerError('RUN_ITEM_PROJECT_MISMATCH', 'Optimization run item project mismatch');
    }

    const plan = await resolved.repository.getPlan(item.optimizationPlanId);
    if (!plan) {
      await failAdvanceRun({
        repository: resolved.repository,
        runId: run.id,
        itemId: item.id,
        itemStatus: item.status,
        code: 'PLAN_NOT_FOUND',
        completedAt
      });
      throw workerError('PLAN_NOT_FOUND', 'Optimization plan does not exist');
    }
    if (plan.projectId !== run.projectId) {
      await failAdvanceRun({
        repository: resolved.repository,
        runId: run.id,
        itemId: item.id,
        itemStatus: item.status,
        code: 'PLAN_PROJECT_MISMATCH',
        completedAt
      });
      throw workerError('PLAN_PROJECT_MISMATCH', 'Optimization plan project mismatch');
    }

    if (item.status === 'FAILED') {
      const code = item.reasonCode ?? 'RUN_ITEM_INVALID_STATE';
      await failAdvanceRun({
        repository: resolved.repository,
        runId: run.id,
        code,
        completedAt
      });
      throw workerError(code, 'Optimization run already contains a failed item');
    }

    if (item.status === 'COMPLETED') {
      if (item.currentStage !== 'READY_FOR_POLICY') {
        await failAdvanceRun({
          repository: resolved.repository,
          runId: run.id,
          itemId: item.id,
          itemStatus: item.status,
          code: 'RUN_ITEM_INVALID_STATE',
          completedAt
        });
        throw workerError('RUN_ITEM_INVALID_STATE', 'Completed run item is not at policy checkpoint');
      }
      continue;
    }

    await resolved.repository.transitionItem({
      itemId: item.id,
      from: 'PENDING',
      to: 'COMPLETED',
      patch: {
        currentStage: 'READY_FOR_POLICY',
        reasonCode: null,
        completedAt
      }
    });
  }

  const refreshed = await resolved.repository.refreshRunCounters(run.id);
  if (refreshed.failureCount > 0) {
    await resolved.repository.transitionRun({
      runId: run.id,
      from: 'RUNNING',
      to: 'FAILED',
      patch: {
        itemCount: refreshed.itemCount,
        completedCount: refreshed.completedCount,
        failureCount: refreshed.failureCount,
        completedAt,
        lastErrorCode: 'RUN_ITEM_INVALID_STATE'
      }
    });
    throw workerError('RUN_ITEM_INVALID_STATE', 'Optimization run contains failed items');
  }

  if (refreshed.completedCount !== refreshed.itemCount) {
    throw workerError('RUN_ITEM_INVALID_STATE', 'Optimization run items did not reach a terminal checkpoint');
  }

  const transitioned = await resolved.repository.transitionRun({
    runId: run.id,
    from: 'RUNNING',
    to: 'SUCCEEDED',
    patch: {
      itemCount: refreshed.itemCount,
      completedCount: refreshed.completedCount,
      failureCount: refreshed.failureCount,
      completedAt,
      lastErrorCode: null
    }
  });
  if (!transitioned) {
    const latest = await resolved.repository.getRun(run.id);
    if (latest?.status === 'SUCCEEDED' || latest?.status === 'FAILED') return;
    throw workerError(
      'RUN_TERMINAL_TRANSITION_CONFLICT',
      'Optimization run terminal transition was not applied'
    );
  }
}
