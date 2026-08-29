import type { CreateAiTaskInput } from '../../src/modules/ai/ai.service.js';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import * as keywordAiModule from '../../src/modules/keywords/keyword-ai.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const keywordAi = keywordAiModule as unknown as {
  buildKeywordExpansionTaskInput(projectId: string, seedKeywordId: string): Promise<CreateAiTaskInput>;
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
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '不相关独立关键词',
        type: 'LONG_TAIL',
      });

      const input = await keywordAi.buildKeywordExpansionTaskInput(fixture.project.id, seed.id);
      const expectedChildren = [childA, childB]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((child) => child.text);

      expect(input).toEqual({
        projectId: fixture.project.id,
        taskType: 'KEYWORD_EXPANSION',
        requestKey: `keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:keyword-expansion-v1`,
        promptVersion: 'keyword-expansion-v1',
        factSnapshot: {
          seedKeyword: {
            id: seed.id,
            text: '符纸',
            type: 'CORE',
            intent: 'INFORMATIONAL',
          },
          existingAcceptedChildren: expectedChildren,
          context: {
            industry: '民间信仰',
            defaultLanguage: 'zh-Hant',
            targetCountry: 'SG',
          },
        },
        sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
      });
    } finally {
      await fixture.cleanup();
    }
  });
});
