import type { JobsOptions, Queue } from 'bullmq';

export const OPTIMIZATION_PLANNING_QUEUE_NAME = 'optimization-planning' as const;
export const OPTIMIZATION_ORCHESTRATION_QUEUE_NAME = 'optimization-orchestration' as const;
export const OPTIMIZATION_QUEUE_ATTEMPTS = 2;

export type OptimizationPlanningJobData =
  | {
      kind: 'MATERIALIZE_RUN';
      runId: string;
      projectId: string;
    }
  | {
      kind: 'RECONCILE_DAILY';
    };

export type OptimizationOrchestrationJobData = {
  runId: string;
  projectId: string;
};

type QueueAdder = Pick<Queue, 'add'>;

function boundedOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: OPTIMIZATION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200
  };
}

export function buildOptimizationPlanningJobOptions(runId: string): JobsOptions {
  return boundedOptions(`optimization-planning-${runId}`);
}

export function buildOptimizationOrchestrationJobOptions(runId: string): JobsOptions {
  return boundedOptions(`optimization-orchestration-${runId}`);
}

export class OptimizationPlanningQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueRun(runId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationPlanningJobData = {
      kind: 'MATERIALIZE_RUN',
      runId,
      projectId
    };
    return this.queue.add(
      'materialize-run',
      payload,
      buildOptimizationPlanningJobOptions(runId)
    );
  }
}

export class OptimizationOrchestrationQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueRun(runId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationOrchestrationJobData = { runId, projectId };
    return this.queue.add(
      'advance-run',
      payload,
      buildOptimizationOrchestrationJobOptions(runId)
    );
  }
}
