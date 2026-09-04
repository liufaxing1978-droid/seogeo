import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordContentBriefService } from '../../src/modules/keywords/keyword-content-brief.service.js';
import { KeywordContentGapService } from '../../src/modules/keywords/keyword-content-gap.service.js';

const projectIds: string[] = [];
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } }); });

describe('P8 Keyword content brief Worker linkage', () => {
  it('marks the request completed and links its persisted Content Brief', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P8 worker', slug: `p8-worker-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '兴善堂六壬', normalizedText: '兴善堂六壬', type: 'CORE', source: 'MANUAL' });
    const gap = await new KeywordContentGapService().evaluateKeyword(project.id, keyword.id, randomUUID());
    const created = await new KeywordContentBriefService().createFromGap({ projectId: project.id, keywordId: keyword.id, contentGapId: gap.id, actorUserId: randomUUID() });
    const gateway: AiCompletionGateway = { complete: async () => ({ provider: 'DEEPSEEK', responseId: 'p8-brief', finishReason: null, model: 'test-model', latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, cacheHitTokens: 0, cacheMissTokens: 1, reasoningTokens: 0 }, content: JSON.stringify({ objective: 'Cover the gap', audience: 'Readers', primaryTopic: '兴善堂六壬', supportingTopics: [], recommendedOutline: ['Overview'], entitiesToCover: [], questionsToAnswer: [], internalLinkSuggestions: [], evidenceNotes: [], sourceReferences: [`KEYWORD:${keyword.id}`, `KEYWORD_CONTENT_GAP:${gap.id}`] }) }) };

    await executeAiTask(created.task.id, { repository: new AiRepository(), gateway });

    expect(await prisma.keywordContentBriefRequest.findUniqueOrThrow({ where: { id: created.request.id } }))
      .toMatchObject({ status: 'COMPLETED', aiTaskId: created.task.id, contentBriefId: expect.any(String) });
  });

  it('marks the request failed when the provider cannot complete the brief', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P8 worker failure', slug: `p8-worker-failure-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '兴善堂失败测试', normalizedText: '兴善堂失败测试', type: 'CORE', source: 'MANUAL' });
    const gap = await new KeywordContentGapService().evaluateKeyword(project.id, keyword.id, randomUUID());
    const created = await new KeywordContentBriefService().createFromGap({ projectId: project.id, keywordId: keyword.id, contentGapId: gap.id, actorUserId: randomUUID() });
    const gateway: AiCompletionGateway = { complete: async () => { throw new Error('provider unavailable'); } };

    await expect(executeAiTask(created.task.id, { repository: new AiRepository(), gateway })).rejects.toThrow('provider unavailable');

    expect(await prisma.keywordContentBriefRequest.findUniqueOrThrow({ where: { id: created.request.id } }))
      .toMatchObject({ status: 'FAILED', aiTaskId: created.task.id, contentBriefId: null });
  });
});
