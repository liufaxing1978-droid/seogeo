import type { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ContentQualityRepository } from '../../src/modules/content/content-quality.repository.js';
import { ContentQualityObservability } from '../../src/modules/content/content-quality.observability.js';
import {
  ContentQualityService,
  type ContentQualityJobData
} from '../../src/modules/content/content-quality.service.js';

class ManualContentQualityQueue {
  calls: Array<{ name: string; data: ContentQualityJobData; options: Record<string, unknown> }> = [];
  private state: string | null = null;
  private readonly jobs = new Map<string, { name: string; data: ContentQualityJobData; options: Record<string, unknown> }>();

  async getJob() {
    if (!this.state) return undefined;
    return { getState: async () => this.state };
  }

  async add(name: string, data: ContentQualityJobData, options: Record<string, unknown>) {
    const jobId = options.jobId as string;
    if (this.jobs.has(jobId)) return { id: jobId };
    this.calls.push({ name, data, options });
    this.jobs.set(jobId, { name, data, options });
    this.state = 'waiting';
    return { id: jobId };
  }

  complete() { this.state = 'completed'; }
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

  afterEach(async () => {
    await prisma.contentQualityRun.deleteMany({ where: { projectId } });
  });

  it('deduplicates an active manual analysis request', async () => {
    const queue = new ManualContentQualityQueue();
    const events: unknown[] = [];
    const service = new ContentQualityService(
      queue as unknown as Queue<ContentQualityJobData>,
      new ContentQualityRepository(),
      new ContentQualityObservability((event) => events.push(event))
    );

    const first = await service.enqueueRun(projectId, 'user-1');
    const second = await service.enqueueRun(projectId, 'user-1');

    expect(first).toMatchObject({ deduplicated: false });
    expect(first.jobId).toBe(`content-quality-${projectId}-${first.runId}`);
    expect(second).toEqual({
      jobId: first.jobId,
      runId: first.runId,
      deduplicated: true
    });
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]).toMatchObject({
      name: 'content-quality-run',
      data: { projectId, runId: first.runId },
      options: {
        jobId: first.jobId,
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100
      }
    });
    expect(queue.calls[0]?.options).not.toHaveProperty('repeat');
    expect(await prisma.contentQualityRun.count({ where: { projectId, status: 'QUEUED' } })).toBe(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'content.quality.queued', queuedCount: 1 }),
      expect.objectContaining({ event: 'content.quality.deduplicated', deduplicatedCount: 1 })
    ]));
  });

  it('enqueues a durable subsequent run after a retained terminal job', async () => {
    const queue = new ManualContentQualityQueue();
    const service = new ContentQualityService(queue as unknown as Queue<ContentQualityJobData>);
    const first = await service.enqueueRun(projectId, 'user-1');
    const repository = new ContentQualityRepository();
    await repository.startRun(projectId, first.runId);
    await repository.completeRun(projectId, first.runId, 0, 0);
    queue.complete();

    const second = await service.enqueueRun(projectId, 'user-1');

    expect(second).toMatchObject({ deduplicated: false });
    expect(second.runId).not.toBe(first.runId);
    expect(second.jobId).not.toBe(first.jobId);
    expect(queue.calls).toHaveLength(2);
    expect(queue.calls[1]?.data.runId).toBe(second.runId);
  });

  it('enqueues a durable subsequent run after a failed terminal job', async () => {
    const queue = new ManualContentQualityQueue();
    const service = new ContentQualityService(queue as unknown as Queue<ContentQualityJobData>);
    const first = await service.enqueueRun(projectId, 'user-1');
    await new ContentQualityRepository().failRun(projectId, first.runId, 'TEST_FAILURE');
    queue.complete();

    const second = await service.enqueueRun(projectId, 'user-1');

    expect(second).toMatchObject({ deduplicated: false });
    expect(second.runId).not.toBe(first.runId);
    expect(second.jobId).not.toBe(first.jobId);
    expect(queue.calls).toHaveLength(2);
  });

  it('atomically deduplicates concurrent manual requests to one active run', async () => {
    const queue = new ManualContentQualityQueue();
    const service = new ContentQualityService(queue as unknown as Queue<ContentQualityJobData>);

    const results = await Promise.all([
      service.enqueueRun(projectId, 'user-1'),
      service.enqueueRun(projectId, 'user-2')
    ]);

    expect(new Set(results.map((result) => result.runId)).size).toBe(1);
    expect(new Set(results.map((result) => result.jobId)).size).toBe(1);
    expect(results.filter((result) => !result.deduplicated)).toHaveLength(1);
    expect(await prisma.contentQualityRun.count({ where: { projectId, status: { in: ['QUEUED', 'RUNNING'] } } })).toBe(1);
  });
});
