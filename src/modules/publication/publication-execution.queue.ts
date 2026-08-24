import type { JobsOptions, Queue } from 'bullmq';

export const PUBLICATION_EXECUTION_QUEUE_NAME = 'site-mutation-execution' as const;
export const PUBLICATION_EXECUTION_MAX_ATTEMPTS = 2;

export type PublicationExecutionJobData = {
  executionId: string;
};

export interface PublicationExecutionQueuePort {
  add(
    name: string,
    data: PublicationExecutionJobData,
    options: JobsOptions
  ): Promise<unknown>;
}

function safeExecutionKey(executionKey: string): string {
  const value = executionKey.trim();
  if (!value) throw new Error('Publication execution key is required');
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 160);
}

export function buildPublicationExecutionJobId(executionKey: string): string {
  return `${PUBLICATION_EXECUTION_QUEUE_NAME}-${safeExecutionKey(executionKey)}`;
}

export function buildPublicationExecutionJobOptions(executionKey: string): JobsOptions {
  return {
    jobId: buildPublicationExecutionJobId(executionKey),
    attempts: PUBLICATION_EXECUTION_MAX_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: 5_000
    },
    removeOnComplete: 100,
    removeOnFail: 200
  };
}

export class PublicationExecutionQueue {
  constructor(private readonly queue: PublicationExecutionQueuePort) {}

  enqueue(executionId: string, executionKey: string) {
    if (!executionId.trim()) throw new Error('Publication execution id is required');
    return this.queue.add(
      'execute',
      { executionId },
      buildPublicationExecutionJobOptions(executionKey)
    );
  }
}
