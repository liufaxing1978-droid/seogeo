import { Queue } from 'bullmq';
import { createRedisConnection } from '../../queue/connection.js';
import { contentQualityObservability, type ContentQualityObservability } from './content-quality.observability.js';
import { contentQualityRepository, type ContentQualityRepository } from './content-quality.repository.js';

export const CONTENT_QUALITY_QUEUE_NAME = 'content-quality';
export interface ContentQualityJobData { projectId: string; runId: string; }

export interface ContentQualityQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined | null>;
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
    const jobId = `content-quality-${projectId}`;
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        const activeRun = await this.repository.findActiveRun(projectId);
        if (!activeRun) throw Object.assign(new Error('Active content-quality job has no active run.'), { code: 'CONTENT_QUALITY_ACTIVE_RUN_MISSING' });
        return { jobId, runId: activeRun.id, deduplicated: true };
      }
    }
    const activeRun = await this.repository.findActiveRun(projectId);
    if (activeRun) return { jobId, runId: activeRun.id, deduplicated: true };

    const run = await this.repository.createRun(projectId, actorId);
    try {
      await this.queue.add('content-quality-run', { projectId, runId: run.id }, {
        jobId,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100
      });
    } catch (error) {
      await this.repository.failRun(projectId, run.id, queueErrorCode());
      this.observability.emit({ event: 'content.quality.failed', projectId, runId: run.id, errorCode: queueErrorCode() });
      throw error;
    }
    this.observability.emit({ event: 'content.quality.queued', projectId, runId: run.id });
    return { jobId, runId: run.id, deduplicated: false };
  }
}

export const contentQualityService = new ContentQualityService(new LazyBullContentQualityQueue());
