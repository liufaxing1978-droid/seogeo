import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  ContentQualityService,
  type ContentQualityJobData
} from '../../src/modules/content/content-quality.service.js';

class ManualContentQualityQueue {
  calls: Array<{ name: string; data: ContentQualityJobData; options: Record<string, unknown> }> = [];
  private state: string | null = null;

  async getJob() {
    if (!this.state) return undefined;
    return { getState: async () => this.state };
  }

  async add(name: string, data: ContentQualityJobData, options: Record<string, unknown>) {
    this.calls.push({ name, data, options });
    this.state = 'waiting';
    return { id: options.jobId };
  }
}

describe('P13-A manual content-quality queue', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId: string;

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `P13A queue ${suffix}`,
        slug: `p13a-queue-${suffix}`,
        primaryDomain: `p13a-queue-${suffix}.example.com`
      }
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  it('deduplicates an active manual analysis request', async () => {
    const queue = new ManualContentQualityQueue();
    const service = new ContentQualityService(queue as unknown as Queue<ContentQualityJobData>);

    const first = await service.enqueueRun(projectId, 'user-1');
    const second = await service.enqueueRun(projectId, 'user-1');

    expect(first).toMatchObject({
      jobId: `content-quality-${projectId}`,
      deduplicated: false
    });
    expect(second).toEqual({
      jobId: `content-quality-${projectId}`,
      runId: first.runId,
      deduplicated: true
    });
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({
      name: 'content-quality-run',
      data: { projectId, runId: first.runId },
      options: {
        jobId: `content-quality-${projectId}`,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100
      }
    });
    expect(queue.calls[0]?.options).not.toHaveProperty('repeat');
    expect(await prisma.contentQualityRun.count({ where: { projectId, status: 'QUEUED' } })).toBe(1);
  });
});
