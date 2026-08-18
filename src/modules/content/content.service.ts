import { Queue } from 'bullmq';
import { createRedisConnection } from '../../queue/connection.js';

export interface ContentRefreshJobData { projectId: string; }

export interface ContentQueue {
  getJob(jobId: string): Promise<{ getState(): Promise<string> } | undefined | null>;
  add(name: string, data: ContentRefreshJobData, options: { jobId: string; attempts: number; removeOnComplete?: number; removeOnFail?: number }): Promise<unknown>;
}

class LazyBullContentQueue implements ContentQueue {
  private queue: Queue<ContentRefreshJobData> | null = null;
  private getQueue() {
    if (!this.queue) this.queue = new Queue<ContentRefreshJobData>('content', { connection: createRedisConnection() });
    return this.queue;
  }
  getJob(jobId: string) { return this.getQueue().getJob(jobId); }
  add(name: string, data: ContentRefreshJobData, options: { jobId: string; attempts: number; removeOnComplete?: number; removeOnFail?: number }) {
    return this.getQueue().add(name, data, options);
  }
}

export class ContentService {
  constructor(private readonly queue: ContentQueue) {}

  async enqueueRefresh(projectId: string) {
    const jobId = `content-refresh-${projectId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') return { jobId, deduplicated: true };
    }
    await this.queue.add('content-refresh', { projectId }, { jobId, attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
    return { jobId, deduplicated: false };
  }
}

export const contentService = new ContentService(new LazyBullContentQueue());
