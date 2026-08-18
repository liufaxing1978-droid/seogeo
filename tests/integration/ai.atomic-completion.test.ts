import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import type { AiProviderResponse } from '../../src/modules/ai/ai.types.js';

describe('AI completion transaction boundary', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('rolls back provider/result completion when derived-result materialization fails, then records one clean failure', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'AI Atomic Completion', slug: `ai-atomic-${suffix}`, primaryDomain: `ai-atomic-${suffix}.example.com` } });
    projects.push(project.id);
    const repository = new AiRepository();
    const task = await repository.createTask({
      projectId: project.id,
      taskType: 'CONTENT_BRIEF',
      requestKey: `content-brief:atomic-${suffix}`,
      promptVersion: 'content-brief-v1',
      factSnapshot: { document: { sourceRef: 'CONTENT_DOCUMENT:00000000-0000-0000-0000-000000000000', contentHash: 'hash' } },
      sourceReferences: [{ type: 'CONTENT_DOCUMENT', id: '00000000-0000-0000-0000-000000000000' }]
    });
    expect(await repository.claimQueuedTask(task.id)).toBe(true);
    const run = await repository.createRun({
      aiTaskId: task.id,
      attemptNo: 1,
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-pro',
      mode: 'REASONING',
      responseFormat: 'JSON',
      promptVersion: 'content-brief-v1',
      requestHash: `request-${suffix}`
    });
    const response: AiProviderResponse = {
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-pro',
      responseId: `response-${suffix}`,
      content: '{}',
      finishReason: 'stop',
      latencyMs: 10,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheHitTokens: 0, cacheMissTokens: 10, reasoningTokens: 1 }
    };

    await expect(repository.completeRun(
      task,
      run.id,
      response,
      { objective: 'fixture' },
      'fixture summary',
      async () => { throw new Error('derived materialization failed'); }
    )).rejects.toThrow(/derived materialization failed/);

    expect(await prisma.aiProviderCall.count({ where: { aiTaskRunId: run.id } })).toBe(0);
    expect(await prisma.aiAnalysisResult.count({ where: { aiTaskRunId: run.id } })).toBe(0);
    expect((await prisma.aiTaskRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('RUNNING');
    expect((await prisma.aiTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('RUNNING');

    await repository.failRun(task.id, run.id, { errorCode: 'DERIVED_RESULT_FAILED', errorMessage: 'Derived result failed' });
    expect(await prisma.aiProviderCall.count({ where: { aiTaskRunId: run.id } })).toBe(1);
    expect((await prisma.aiTaskRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('FAILED');
    expect((await prisma.aiTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('FAILED');
  });
});
