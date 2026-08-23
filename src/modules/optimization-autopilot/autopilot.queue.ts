import type { JobsOptions, Queue } from 'bullmq';

export const OPTIMIZATION_AUTOPILOT_QUEUE_NAME = 'optimization-autopilot' as const;
export const OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS = 2;

export type OptimizationAutopilotJobData =
  | {
      kind: 'EVALUATE_RUN_ITEM';
      runItemId: string;
      projectId: string;
    }
  | {
      kind: 'RECONCILE_DAILY';
    };

type QueueAdder = Pick<Queue, 'add'>;

export function buildOptimizationAutopilotJobOptions(runItemId: string): JobsOptions {
  return {
    jobId: `optimization-autopilot-${runItemId}`,
    attempts: OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200
  };
}

export class OptimizationAutopilotQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueRunItem(runItemId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationAutopilotJobData = {
      kind: 'EVALUATE_RUN_ITEM',
      runItemId,
      projectId
    };
    return this.queue.add(
      'evaluate-run-item',
      payload,
      buildOptimizationAutopilotJobOptions(runItemId)
    );
  }
}
