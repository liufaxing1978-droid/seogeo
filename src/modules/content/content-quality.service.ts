import { Queue } from 'bullmq';
import { createRedisConnection } from '../../queue/connection.js';
import { contentQualityObservability, type ContentQualityObservability } from './content-quality.observability.js';
import { contentQualityRepository, type ContentQualityRepository } from './content-quality.repository.js';

export const CONTENT_QUALITY_QUEUE_NAME = 'content-quality';
export interface ContentQualityJobData { projectId: string; runId: string; }

export function buildContentQualityJobId(projectId: string, _runId: string): string {
  return `content-quality-${projectId}`;
}

export interface ContentQualityQueue {
  getJob(jobId: string): Promise<{
    data: ContentQualityJobData;
    getState(): Promise<string>;
    remove(): Promise<void>;
  } | undefined | null>;
  add(
    name: string,
    data: ContentQualityJobData,
    options: { jobId: string; attempts: number; removeOnComplete: number; removeOnFail: number }
  ): Promise<unknown>;
}

class LazyBullContentQualityQueue implements ContentQualityQueue {
  private queue: Queue<ContentQualityJobData> | null = null;

  private getQueue() {
    if (!this.queue) this.queue = new Queue<ContentQualityJobData>(CONTENT_QUALITY_QUEUE_NAME, { connection: createRedisConnection() });
    return this.queue;
  }

  getJob(jobId: string) { return this.getQueue().getJob(jobId); }
  add(name: string, data: ContentQualityJobData, options: { jobId: string; attempts: number; removeOnComplete: number; removeOnFail: number }) {
    return this.getQueue().add(name, data, options);
  }
}

function queueErrorCode(): string {
  return 'CONTENT_QUALITY_QUEUE_ENQUEUE_FAILED';
}

export class ContentQualityService {
  constructor(
    private readonly queue: ContentQualityQueue,
    private readonly repository: ContentQualityRepository = contentQualityRepository,
    private readonly observability: ContentQualityObservability = contentQualityObservability
  ) {}

  async enqueueRun(projectId: string, actorId: string) {
    const jobId = buildContentQualityJobId(projectId, '');
    await this.reconcileTerminalRunJob(projectId, jobId);
    const claim = await this.repository.claimActiveRun(projectId, actorId);
    const run = claim.run;
    if (!claim.claimed) {
      this.observability.emit({ event: 'content.quality.deduplicated', projectId, runId: run.id, deduplicatedCount: 1 });
      return { jobId, runId: run.id, deduplicated: true };
    }
    try {
      await this.reconcileTerminalRunJob(projectId, jobId);
      await this.queue.add('content-quality-run', { projectId, runId: run.id }, {
        jobId,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100
      });
    } catch (error) {
      await this.repository.failRun(projectId, run.id, queueErrorCode());
      this.observability.emit({ event: 'content.quality.failed', projectId, runId: run.id, failedCount: 1, errorCode: queueErrorCode() });
      throw error;
    }
    this.observability.emit({ event: 'content.quality.queued', projectId, runId: run.id, queuedCount: 1 });
    return { jobId, runId: run.id, deduplicated: false };
  }

  private async reconcileTerminalRunJob(projectId: string, jobId: string): Promise<void> {
    const existing = await this.queue.getJob(jobId);
    if (!existing) return;
    const state = await existing.getState();
    if (state === 'completed' || state === 'failed') {
      await existing.remove();
      return;
    }
    const persistedRun = await this.repository.getRun(projectId, existing.data.runId);
    if (persistedRun?.status === 'COMPLETED' || persistedRun?.status === 'FAILED') {
      await existing.remove();
    }
  }
}

export const contentQualityService = new ContentQualityService(new LazyBullContentQualityQueue());
