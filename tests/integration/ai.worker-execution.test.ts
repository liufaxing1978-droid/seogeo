import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createTask() {
  const project = await prisma.project.create({
    data: { name: 'AI Worker', slug: `ai-worker-${Date.now()}-${Math.random()}`, primaryDomain: 'example.com' }
  });
  return prisma.aiTask.create({
    data: {
      projectId: project.id,
      taskType: 'SEO_AUDIT_ANALYSIS',
      requestKey: `seo-audit:${Date.now()}:seo-audit-analysis-v1`,
      promptVersion: 'seo-audit-analysis-v1',
      factSnapshot: { auditId: 'fixture-audit', score: 78 },
      sourceReferences: [{ type: 'SEO_AUDIT', id: 'fixture-audit' }]
    }
  });
}

describe('P4 durable AI worker execution', () => {
  it('claims a queued task, calls the gateway once, validates JSON and persists usage/result', async () => {
    const task = await createTask();
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-v4-flash',
        responseId: 'fixture-response',
        content: '{"summary":"Use deterministic facts.","priorities":[]}',
        finishReason: 'stop',
        latencyMs: 321,
        usage: {
          promptTokens: 100,
          completionTokens: 20,
          totalTokens: 120,
          cacheHitTokens: 60,
          cacheMissTokens: 40,
          reasoningTokens: null
        }
      }))
    };

    await executeAiTask(task.id, { repository: new AiRepository(), gateway });

    const stored = await prisma.aiTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { include: { calls: true, result: true } } }
    });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.runs).toHaveLength(1);
    expect(stored.runs[0]).toMatchObject({
      attemptNo: 1,
      status: 'COMPLETED',
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      mode: 'FAST',
      responseFormat: 'JSON',
      promptVersion: 'seo-audit-analysis-v1'
    });
    expect(stored.runs[0]?.calls[0]).toMatchObject({
      providerResponseId: 'fixture-response',
      latencyMs: 321,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 60,
      cacheMissTokens: 40
    });
    expect(stored.runs[0]?.result).toMatchObject({
      resultType: 'SEO_AUDIT_ANALYSIS',
      summary: 'Use deterministic facts.',
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      promptVersion: 'seo-audit-analysis-v1'
    });
    expect(gateway.complete).toHaveBeenCalledTimes(1);

    await executeAiTask(task.id, { repository: new AiRepository(), gateway });
    expect(gateway.complete).toHaveBeenCalledTimes(1);
    expect(await prisma.aiTaskRun.count({ where: { aiTaskId: task.id } })).toBe(1);
  });

  it('persists a failed run and sanitized task failure without creating a result', async () => {
    const task = await createTask();
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => {
        throw new Error('fixture provider failure with details');
      })
    };

    await expect(executeAiTask(task.id, { repository: new AiRepository(), gateway })).rejects.toThrow(
      'fixture provider failure with details'
    );

    const stored = await prisma.aiTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { runs: { include: { result: true } } }
    });
    expect(stored.status).toBe('FAILED');
    expect(stored.errorCode).toBe('AI_EXECUTION_FAILED');
    expect(stored.runs[0]).toMatchObject({ status: 'FAILED', attemptNo: 1 });
    expect(stored.runs[0]?.result).toBeNull();
  });
});
