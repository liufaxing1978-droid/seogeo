import type { JobsOptions } from 'bullmq';

export const INDEXNOW_SUBMISSION_QUEUE_NAME = 'indexnow-submission' as const;
export const INDEXNOW_QUEUE_ATTEMPTS = 3;
export const INDEXNOW_WORKER_CONCURRENCY = 2;

export type IndexNowSubmissionJobData = {
  batchId: string;
};

export interface IndexNowQueuePort {
  add(name: string, data: IndexNowSubmissionJobData, options: JobsOptions): Promise<unknown>;
}

export function buildIndexNowJobOptions(batchId: string): JobsOptions {
  return {
    jobId: `indexnow-${batchId}`,
    attempts: INDEXNOW_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 200
  };
}

export class IndexNowSubmissionQueue {
  constructor(private readonly queue: IndexNowQueuePort) {}

  async enqueue(batchId: string): Promise<void> {
    await this.queue.add(
      'submit-batch',
      { batchId } satisfies IndexNowSubmissionJobData,
      buildIndexNowJobOptions(batchId)
    );
  }
}
