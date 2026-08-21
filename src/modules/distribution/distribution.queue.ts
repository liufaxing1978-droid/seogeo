import type { JobsOptions, Queue } from 'bullmq';

export const DISTRIBUTION_PREPARATION_QUEUE_NAME = 'distribution-preparation' as const;
export const DISTRIBUTION_PREPARATION_WORKER_CONCURRENCY = 2;
export const DISTRIBUTION_PREPARATION_MAX_ATTEMPTS = 2;

export type DistributionPreparationJobData = {
  targetId: string;
  sourceContentVersion: number;
};

type DistributionPreparationQueuePort = Pick<
  Queue<DistributionPreparationJobData>,
  'add'
>;

function boundedJobPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120);
}

export function buildDistributionPreparationJobId(
  targetId: string,
  sourceContentVersion: number
): string {
  if (!targetId.trim()) throw new Error('targetId is required for distribution preparation');
  if (!Number.isInteger(sourceContentVersion) || sourceContentVersion < 1) {
    throw new Error('sourceContentVersion must be a positive integer');
  }
  return `distribution-preparation-${boundedJobPart(targetId)}-v${sourceContentVersion}`;
}

export function buildDistributionPreparationJobOptions(
  targetId: string,
  sourceContentVersion: number
): JobsOptions {
  return {
    jobId: buildDistributionPreparationJobId(targetId, sourceContentVersion),
    attempts: DISTRIBUTION_PREPARATION_MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200
  };
}

export class DistributionPreparationQueue {
  constructor(private readonly queue: DistributionPreparationQueuePort) {}

  enqueue(targetId: string, sourceContentVersion: number) {
    return this.queue.add(
      'prepare',
      { targetId, sourceContentVersion },
      buildDistributionPreparationJobOptions(targetId, sourceContentVersion)
    );
  }
}
