import type { JobsOptions, Queue } from 'bullmq';
import type { ExperimentWindowType } from './experiment.types.js';

export const OPTIMIZATION_EXPERIMENT_QUEUE_NAME = 'optimization-experiment-evaluation' as const;
export const OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS = 2;

export type OptimizationExperimentJobData =
  | {
      kind: 'START_EXPERIMENT';
      publicationExecutionId: string;
      projectId: string;
    }
  | {
      kind: 'EVALUATE_WINDOW';
      experimentId: string;
      projectId: string;
      windowType: ExperimentWindowType;
    }
  | {
      kind: 'RECONCILE_DAILY';
    };

type QueueAdder = Pick<Queue, 'add'>;

function boundedOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 200
  };
}

export function buildOptimizationExperimentStartJobOptions(
  publicationExecutionId: string
): JobsOptions {
  return boundedOptions(`optimization-experiment-start-${publicationExecutionId}`);
}

export function buildOptimizationExperimentWindowJobOptions(
  experimentId: string,
  windowType: ExperimentWindowType
): JobsOptions {
  return boundedOptions(`optimization-experiment-window-${experimentId}-${windowType}`);
}

export class OptimizationExperimentQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueStart(publicationExecutionId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationExperimentJobData = {
      kind: 'START_EXPERIMENT',
      publicationExecutionId,
      projectId
    };
    return this.queue.add(
      'start-experiment',
      payload,
      buildOptimizationExperimentStartJobOptions(publicationExecutionId)
    );
  }

  enqueueWindow(
    experimentId: string,
    projectId: string,
    windowType: ExperimentWindowType
  ): Promise<unknown> {
    const payload: OptimizationExperimentJobData = {
      kind: 'EVALUATE_WINDOW',
      experimentId,
      projectId,
      windowType
    };
    return this.queue.add(
      'evaluate-window',
      payload,
      buildOptimizationExperimentWindowJobOptions(experimentId, windowType)
    );
  }
}
