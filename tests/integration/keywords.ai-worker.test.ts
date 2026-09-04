import type { CreateAiTaskInput } from '../../src/modules/ai/ai.service.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import * as keywordAiModule from '../../src/modules/keywords/keyword-ai.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const keywordAi = keywordAiModule as unknown as {
  buildKeywordExpansionTaskInput(projectId: string, seedKeywordId: string): Promise<CreateAiTaskInput>;
  createKeywordExpansionTask(
    projectId: string,
    seedKeywordId: string,
    service: { createAndEnqueue(input: CreateAiTaskInput): Promise<unknown> },
  ): Promise<unknown>;
};

describe('P11-01 keyword AI task authority', () => {
  it('builds task facts only from the project seed and authoritative child relations', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await prisma.project.update({
        where: { id: fixture.project.id },
        data: {
          industry: '民间信仰',
          defaultLanguage: 'zh-Hant',
          targetCountry: 'SG',
        },
      });

      const seed = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
        priority: 'HIGH',
      });
      const childA = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '六壬符纸',
        type: 'LONG_TAIL',
        intent: 'INFORMATIONAL',
        parentKeywordId: seed.id,
      });
      const childB = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸怎么用',
        type: 'QUESTION',
        intent: 'INFORMATIONAL',
        parentKeywordId: seed.id,
      });
      const unrelated = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '不相关独立关键词',
        type: 'LONG_TAIL',
      });

      const input = await keywordAi.buildKeywordExpansionTaskInput(fixture.project.id, seed.id);
      const expectedChildren = [childA, childB]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((child) => child.text);
      const expectedProjectKeywords = [seed, childA, childB, unrelated]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((keyword) => keyword.text);

      expect(input).toMatchObject({
        projectId: fixture.project.id,
        taskType: 'KEYWORD_EXPANSION',
        promptVersion: 'keyword-expansion-v1',
        factSnapshot: {
          seedKeyword: {
            id: seed.id,
            text: '符纸',
            type: 'CORE',
            intent: 'INFORMATIONAL',
          },
          existingAcceptedChildren: expectedChildren,
          existingProjectKeywords: expectedProjectKeywords,
          context: {
            industry: '民间信仰',
            defaultLanguage: 'zh-Hant',
            targetCountry: 'SG',
          },
        },
        sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
      });
      expect(input.requestKey).toMatch(
        new RegExp(`^keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:`),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('delegates creation and enqueueing to the existing AI task service boundary', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const seed = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
      });
      const expectedInput = await keywordAi.buildKeywordExpansionTaskInput(fixture.project.id, seed.id);
      const returnedTask = { id: 'fixture-keyword-expansion-task' };
      const service = {
        createAndEnqueue: vi.fn(async (_input: CreateAiTaskInput) => returnedTask),
      };

      const result = await keywordAi.createKeywordExpansionTask(
        fixture.project.id,
        seed.id,
        service,
      );

      expect(service.createAndEnqueue).toHaveBeenCalledTimes(1);
      expect(service.createAndEnqueue).toHaveBeenCalledWith(expectedInput);
      expect(result).toBe(returnedTask);
    } finally {
      await fixture.cleanup();
    }
  });

  it('materializes only pending suggestions and never creates authoritative AI_ACCEPTED keywords', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const seed = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        intent: 'INFORMATIONAL',
      });
      const input = await keywordAi.buildKeywordExpansionTaskInput(fixture.project.id, seed.id);
      const task = await prisma.aiTask.create({ data: input });
      const gateway: AiCompletionGateway = {
        complete: vi.fn(async () => ({
          provider: 'DEEPSEEK' as const,
          model: 'deepseek-v4-flash',
          responseId: 'keyword-expansion-response',
          content: JSON.stringify({
            suggestions: [
              {
                text: '六壬符纸',
                type: 'LONG_TAIL',
                intent: 'INFORMATIONAL',
                rationale: '更窄的相关主题',
              },
              {
                text: '符纸怎么用',
                type: 'QUESTION',
                intent: 'INFORMATIONAL',
                rationale: '用户常见问题',
              },
            ],
          }),
          finishReason: 'stop',
          latencyMs: 120,
          usage: {
            promptTokens: 80,
            completionTokens: 40,
            totalTokens: 120,
            cacheHitTokens: 0,
            cacheMissTokens: 80,
            reasoningTokens: null,
          },
        })),
      };

      await executeAiTask(task.id, { repository: new AiRepository(), gateway });

      const suggestions = await prisma.keywordSuggestion.findMany({
        where: { aiTaskId: task.id },
        orderBy: { suggestedText: 'asc' },
      });
      expect(suggestions).toHaveLength(2);
      expect(suggestions.every((item) => item.status === 'PENDING')).toBe(true);
      expect(suggestions.map((item) => item.provider)).toEqual(['DEEPSEEK', 'DEEPSEEK']);
      expect(suggestions.map((item) => item.model)).toEqual(['deepseek-v4-flash', 'deepseek-v4-flash']);
      expect(suggestions.map((item) => item.responseId)).toEqual([
        'keyword-expansion-response',
        'keyword-expansion-response',
      ]);
      expect(await prisma.keyword.count({
        where: { projectId: fixture.project.id, source: 'AI_ACCEPTED' },
      })).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not materialize a suggestion whose normalized keyword already exists in the project', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const seed = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
      });
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '传统符纸',
        type: 'LONG_TAIL',
      });
      const task = await prisma.aiTask.create({
        data: await keywordAi.buildKeywordExpansionTaskInput(fixture.project.id, seed.id),
      });
      const gateway: AiCompletionGateway = {
        complete: vi.fn(async () => ({
          provider: 'DEEPSEEK' as const,
          model: 'deepseek-v4-flash',
          responseId: 'dedupe-response',
          content: JSON.stringify({
            suggestions: [
              { text: '传统符纸', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '已存在的候选' },
              { text: '符纸怎么保存', type: 'QUESTION', intent: 'INFORMATIONAL', rationale: '新的问题候选' },
            ],
          }),
          finishReason: 'stop',
          latencyMs: 120,
          usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120, cacheHitTokens: 0, cacheMissTokens: 80, reasoningTokens: null },
        })),
      };

      await executeAiTask(task.id, { repository: new AiRepository(), gateway });

      expect(await prisma.keywordSuggestion.findMany({
        where: { aiTaskId: task.id },
        select: { suggestedText: true },
      })).toEqual([{ suggestedText: '符纸怎么保存' }]);
    } finally {
      await fixture.cleanup();
    }
  });
});
