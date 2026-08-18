import type { Queue } from 'bullmq';

export interface ContentRefreshJobData {
  projectId: string;
}

export class ContentService {
  constructor(private readonly queue: Queue<ContentRefreshJobData>) {}

  async enqueueRefresh(projectId: string) {
    const jobId = `content-refresh-${projectId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        return { jobId, deduplicated: true };
      }
    }

    await this.queue.add('content-refresh', { projectId }, {
      jobId,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100
    });
    return { jobId, deduplicated: false };
  }
}
