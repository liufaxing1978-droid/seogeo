import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiObservability } from '../../src/modules/ai/ai-observability.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService, type AiTaskJobQueue } from '../../src/modules/ai/ai.service.js';
import { executeAiTask } from '../../src/modules/ai/ai.worker.js';
import type { AiProviderResponse } from '../../src/modules/ai/ai.types.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

class FakeQueue implements AiTaskJobQueue {
  async add() {
    return undefined;
  }
}

describe('P4 AI observability', () => {
  it('emits safe structured lifecycle events without prompts, fact snapshots, output bodies or secrets', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'AI Observability',
        slug: `ai-observability-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const events: Array<Record<string, unknown>> = [];
    const observability = new AiObservability((event) => events.push(event));
    const repository = new AiRepository();
    const service = new AiTaskService(repository, new FakeQueue(), observability);

    const task = await service.createAndEnqueue({
      projectId: project.id,
      taskType: 'SEO_AUDIT_ANALYSIS',
      requestKey: 'seo-audit:observability:seo-audit-analysis-v1',
      promptVersion: 'seo-audit-analysis-v1',
      factSnapshot: {
        auditId: 'audit-observability',
        score: 78,
        privateFixture: 'FACT_SNAPSHOT_MUST_NOT_BE_LOGGED'
      },
      sourceReferences: [{ type: 'SEO_AUDIT', id: 'audit-observability' }]
    });

    const providerResponse: AiProviderResponse = {
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      responseId: 'provider-response-fixture',
      content: JSON.stringify({
        summary: 'OUTPUT_BODY_MUST_NOT_BE_LOGGED',
        priorities: [],
        recommendations: []
      }),
      finishReason: 'stop',
      latencyMs: 42,
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        totalTokens: 120,
        cacheHitTokens: 60,
        cacheMissTokens: 40,
        reasoningTokens: null
      }
    };

    await executeAiTask(task.id, {
      repository,
      observability,
      gateway: { complete: async () => providerResponse }
    });

    expect(events.map((event) => event.event)).toEqual([
      'ai.task.queued',
      'ai.task.started',
      'ai.provider.request.completed',
      'ai.output.validated',
      'ai.task.completed'
    ]);

    for (const event of events) {
      expect(event.taskId).toBe(task.id);
      expect(event.projectId).toBe(project.id);
      expect(event.promptVersion).toBe('seo-audit-analysis-v1');
    }

    const providerEvent = events.find((event) => event.event === 'ai.provider.request.completed');
    expect(providerEvent).toMatchObject({
      provider: 'DEEPSEEK',
      model: 'deepseek-v4-flash',
      latencyMs: 42,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cacheHitTokens: 60,
      cacheMissTokens: 40
    });

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('FACT_SNAPSHOT_MUST_NOT_BE_LOGGED');
    expect(serialized).not.toContain('OUTPUT_BODY_MUST_NOT_BE_LOGGED');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('reasoning_content');
    expect(serialized).not.toContain('DEEPSEEK_API_KEY');
  });
});
