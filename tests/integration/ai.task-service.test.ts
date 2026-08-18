import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

class FakeQueue implements AiTaskJobQueue {
  calls: Array<{ name: string; data: { taskId: string }; options: { jobId: string; attempts: number } }> = [];
  fail = false;

  async add(name: string, data: { taskId: string }, options: { jobId: string; attempts: number }) {
    if (this.fail) throw new Error('fixture queue failure');
    this.calls.push({ name, data, options });
    return undefined;
  }
}

describe('P4 AI task service', () => {
  it('creates one durable logical task and one deterministic BullMQ job', async () => {
    const project = await prisma.project.create({
      data: { name: 'AI Service', slug: `ai-service-${Date.now()}`, primaryDomain: 'example.com' }
    });
    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const input = {
      projectId: project.id,
      taskType: 'SEO_AUDIT_ANALYSIS' as const,
      requestKey: 'seo-audit:fixture:seo-audit-analysis-v1',
      promptVersion: 'seo-audit-analysis-v1',
      factSnapshot: { score: 78 },
      sourceReferences: [{ type: 'SEO_AUDIT', id: 'fixture-audit' }]
    };

    const first = await service.createAndEnqueue(input);
    const second = await service.createAndEnqueue(input);

    expect(second.id).toBe(first.id);
    expect(await prisma.aiTask.count({ where: { projectId: project.id } })).toBe(1);
    expect(queue.calls).toEqual([
      {
        name: 'ai-task',
        data: { taskId: first.id },
        options: { jobId: `ai-task-${first.id}`, attempts: 1 }
      }
    ]);
  });

  it('marks a newly-created task failed when enqueueing fails', async () => {
    const project = await prisma.project.create({
      data: { name: 'AI Queue Failure', slug: `ai-queue-${Date.now()}`, primaryDomain: 'example.com' }
    });
    const queue = new FakeQueue();
    queue.fail = true;
    const service = new AiTaskService(new AiRepository(), queue);

    await expect(
      service.createAndEnqueue({
        projectId: project.id,
        taskType: 'GEO_READINESS_ANALYSIS',
        requestKey: 'geo-audit:fixture:geo-readiness-analysis-v1',
        promptVersion: 'geo-readiness-analysis-v1',
        factSnapshot: { score: 65 },
        sourceReferences: [{ type: 'GEO_AUDIT', id: 'fixture-geo' }]
      })
    ).rejects.toThrow('fixture queue failure');

    expect(await prisma.aiTask.findFirstOrThrow({ where: { projectId: project.id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'AI_QUEUE_ENQUEUE_FAILED'
    });
  });

  it('queues a failed task for an explicit manual retry using a new deterministic retry job id', async () => {
    const project = await prisma.project.create({
      data: { name: 'AI Retry', slug: `ai-retry-${Date.now()}`, primaryDomain: 'example.com' }
    });
    const task = await prisma.aiTask.create({
      data: {
        projectId: project.id,
        taskType: 'ENTITY_ENRICHMENT',
        status: 'FAILED',
        requestKey: 'entity:fixture:entity-enrichment-v1',
        promptVersion: 'entity-enrichment-v1',
        factSnapshot: { entityIds: [] },
        sourceReferences: []
      }
    });
    await prisma.aiTaskRun.create({
      data: {
        aiTaskId: task.id,
        attemptNo: 1,
        provider: 'DEEPSEEK',
        model: 'deepseek-v4-pro',
        mode: 'REASONING',
        responseFormat: 'JSON',
        status: 'FAILED',
        promptVersion: task.promptVersion,
        requestHash: 'fixture-hash',
        finishedAt: new Date(),
        errorCode: 'UPSTREAM'
      }
    });

    const queue = new FakeQueue();
    const service = new AiTaskService(new AiRepository(), queue);
    const retried = await service.retry(task.id);

    expect(retried.status).toBe('QUEUED');
    expect(queue.calls[0]).toEqual({
      name: 'ai-task',
      data: { taskId: task.id },
      options: { jobId: `ai-task-${task.id}-retry-2`, attempts: 1 }
    });
  });
});
