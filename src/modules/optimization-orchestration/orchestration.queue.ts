import type { JobsOptions, Queue } from 'bullmq';

export const OPTIMIZATION_PLANNING_QUEUE_NAME = 'optimization-planning' as const;
export const OPTIMIZATION_ORCHESTRATION_QUEUE_NAME = 'optimization-orchestration' as const;

export type OptimizationPlanningJob = {
  kind: 'MATERIALIZE_RUN';
  runId: string;
  projectId: string;
};

export type OptimizationOrchestrationJob = {
  runId: string;
  projectId: string;
};

type QueueAdder = Pick<Queue, 'add'>;

function boundedOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 2,
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

  async enqueueRun(runId: string, projectId: string): Promise<void> {
    const payload: OptimizationPlanningJob = {
      kind: 'MATERIALIZE_RUN',
      runId,
      projectId
    };
    await this.queue.add(
      'materialize-run',
      payload,
      buildOptimizationPlanningJobOptions(runId)
    );
  }
}

export class OptimizationOrchestrationQueue {
  constructor(private readonly queue: QueueAdder) {}

  async enqueueRun(runId: string, projectId: string): Promise<void> {
    const payload: OptimizationOrchestrationJob = { runId, projectId };
    await this.queue.add(
      'advance-run',
      payload,
      buildOptimizationOrchestrationJobOptions(runId)
    );
  }
}
