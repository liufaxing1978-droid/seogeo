import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import type { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

async function seedPendingSuggestion(
  fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>,
  suggestedText = '六壬符纸',
) {
  const seed = await keywordService.createManual({
    actorUserId: fixture.user.id,
    projectId: fixture.project.id,
    text: `符纸-${randomUUID()}`,
    type: 'CORE',
    intent: 'INFORMATIONAL',
  });
  const task = await prisma.aiTask.create({
    data: {
      projectId: fixture.project.id,
      taskType: 'KEYWORD_EXPANSION',
      requestKey: `keyword-web-suggestion:${randomUUID()}`,
      promptVersion: 'keyword-expansion-v1',
      factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
      sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
    },
  });
  const suggestion = await prisma.keywordSuggestion.create({
    data: {
      projectId: fixture.project.id,
      seedKeywordId: seed.id,
      suggestedText,
      normalizedText: suggestedText.normalize('NFKC').trim().toLocaleLowerCase('und'),
      suggestedType: 'LONG_TAIL',
      suggestedIntent: 'INFORMATIONAL',
      rationale: '更窄的相关主题，只能由人工决定是否加入词库',
      status: 'PENDING',
      provider: 'DEEPSEEK',
      model: 'fixture-model',
      aiTaskId: task.id,
    },
  });
  return { seed, task, suggestion };
}

async function seedOfficialSearchEvidence(
  fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>,
) {
  const repository = new SearchFactRepository(prisma);
  const cutoff = new Date('2026-08-28T00:00:00.000Z');
  const sourceDate = new Date('2026-08-28T00:00:00.000Z');
  const suffix = randomUUID();
  const domain = fixture.project.primaryDomain;

  await repository.persistCompletedSnapshot(
    {
      projectId: fixture.project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: `sc-domain:${domain}`,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `task7-google-observed-${suffix}`,
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [
      {
        factKey: `task7-google-query-page-${suffix}`,
        factKind: 'QUERY_PAGE',
        sourceObservationRef: `task7-google-observation-${suffix}`,
        sourceDate,
        query: '符纸',
        normalizedQuery: 'provider-normalization-must-not-drive-matching',
        queryNormalizationVersion: 'provider-v999',
        page: `https://${domain}/fu-zhi`,
        canonicalPage: `https://${domain}/fu-zhi`,
        canonicalizationVersion: 'task7-test-v1',
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 6,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks',
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 150,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions',
          },
          {
            metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
            numericValue: 5.5,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'position',
          },
        ],
      },
    ],
    `task7-google-observed-input-${suffix}`,
  );

  await repository.persistCompletedSnapshot(
    {
      projectId: fixture.project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: `sc-domain:empty-${domain}`,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `task7-google-empty-${suffix}`,
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [],
    `task7-google-empty-input-${suffix}`,
  );

  await repository.persistCompletedSnapshot(
    {
      projectId: fixture.project.id,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: `https://${domain}/`,
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: `task7-bing-observed-${suffix}`,
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [
      {
        factKey: `task7-bing-query-${suffix}`,
        factKind: 'QUERY',
        sourceObservationRef: `task7-bing-observation-${suffix}`,
        sourceDate,
        query: '符纸',
        normalizedQuery: 'provider-normalization-must-not-drive-matching',
        queryNormalizationVersion: 'provider-v999',
        page: null,
        canonicalPage: null,
        canonicalizationVersion: null,
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 10,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks',
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 200,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions',
          },
          {
            metricSemantic: 'BING_AVG_CLICK_POSITION',
            numericValue: 3.2,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'avgClickPosition',
          },
          {
            metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
            numericValue: null,
            evidenceState: 'UNKNOWN',
            sourceField: 'avgImpressionPosition',
          },
        ],
      },
    ],
    `task7-bing-observed-input-${suffix}`,
  );
}

describe('P11-01 keyword center web UI', () => {
  it('renders an inherited Cluster Target URL instead of leaving a mapped member unmapped', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: 'Cluster 法事', type: 'CORE' });
      const group = await prisma.keywordGroup.create({ data: { projectId: fixture.project.id, name: 'Inherited target' } });
      await prisma.keywordGroupMembership.create({ data: { projectId: fixture.project.id, groupId: group.id, keywordId: keyword.id } });
      const url = `https://${fixture.project.primaryDomain}/cluster-guide`;
      await prisma.keywordTargetMapping.create({ data: { projectId: fixture.project.id, groupId: group.id, targetUrl: url, normalizedUrl: url } });
      const response = await request(createApp()).get(`/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).expect(200);
      expect(response.text).toContain(url);
      expect(response.text).toContain('继承');
    } finally { await fixture.cleanup(); }
  });
  it('renders persisted P4 Target URL and latest cannibalization snapshot without inventing evidence', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '法事', type: 'CORE' });
      const url = `https://${fixture.project.primaryDomain}/guide`;
      await prisma.keywordTargetMapping.create({ data: { projectId: fixture.project.id, keywordId: keyword.id, targetUrl: url, normalizedUrl: url } });
      await prisma.keywordCannibalizationSnapshot.create({ data: { projectId: fixture.project.id, keywordId: keyword.id, risk: 'MEDIUM', recommendedAction: 'REPOSITION', urls: [url], reasons: ['TARGET_MAPPING_CONFLICT'], sourceProvenance: { growthSnapshotId: null }, confidence: 0.7, formulaVersion: 'keyword-cannibalization-v1' } });
      const response = await request(createApp()).get(`/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).expect(200);
      expect(response.text).toContain(url);
      expect(response.text).toContain('REPOSITION');
    } finally { await fixture.cleanup(); }
  });
  it('renders persisted Keyword Cluster primary and management controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const keyword = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
      });
      const group = await keywordService.createGroup({
        projectId: fixture.project.id,
        name: '符纸专题',
      });
      await keywordService.setGroupPrimaryKeyword({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        groupId: group.id,
        primaryKeywordId: keyword.id,
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-cluster-panel"');
      expect(response.text).toContain('关键词 Cluster');
      expect(response.text).toContain('符纸专题');
      expect(response.text).toContain('主词：符纸');
      expect(response.text).toContain(`/keyword-groups/${group.id}/rename`);
      expect(response.text).toContain(`/keyword-groups/${group.id}/primary-keyword`);
      expect(response.text).toContain(`/keyword-groups/${group.id}/keywords`);
      expect(response.text).toContain('批量加入成员词');
    } finally {
      await fixture.cleanup();
    }
  });

  it('renders persisted opportunity score confidence and explainable unknown dimensions', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const keyword = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸怎么用',
        type: 'QUESTION',
        intent: 'INFORMATIONAL',
      });
      await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${keyword.id}/opportunity-score`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(303);

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-opportunity-score"');
      expect(response.text).toContain('N/A');
      expect(response.text).toContain('置信度 15%');
      expect(response.text).toContain('评分依据');
      expect(response.text).toContain('项目相关度');
      expect(response.text).toContain('证据不足');
      expect(response.text).toContain(`/keywords/${keyword.id}/opportunity-score`);
    } finally {
      await fixture.cleanup();
    }
  });

  it('renders keyword facts without fabricated ranking', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        priority: 'HIGH',
        locked: true,
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('关键词中心');
      expect(response.text).toContain('符纸');
      expect(response.text).toContain('站内内容覆盖');
      expect(response.text).toContain('排名数据：未接入');
      expect(response.text).not.toContain('Google 排名：1');
      expect(response.text).toContain('data-ui="keyword-center"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('renders persisted official search evidence with truthful provider semantics', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        priority: 'HIGH',
      });
      await seedOfficialSearchEvidence(fixture);

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('搜索证据');
      expect(response.text).toContain('data-ui="keyword-search-evidence"');
      expect(response.text).toContain('data-provider="GOOGLE_SEARCH_CONSOLE"');
      expect(response.text).toContain('data-provider="BING_WEBMASTER"');
      expect(response.text).toContain('Google Search Console');
      expect(response.text).toContain('Search Console 平均位置');
      expect(response.text).toContain('当前持久化数据不完整，未观察到该关键词不能解释为 0 搜索量或无排名。');
      expect(response.text).toContain('官方平台能力尚未接入 / 当前接口不支持查询级证据');
      expect(response.text).not.toContain('Google 当前排名');
      expect(response.text).not.toContain('排名 0');
    } finally {
      await prisma.searchFactSnapshot.deleteMany({ where: { projectId: fixture.project.id } });
      await fixture.cleanup();
    }
  });

  it('renders the advisory review panel and explicitly denies AI authority', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-advisory-panel"');
      expect(response.text).toContain('AI 长尾建议');
      expect(response.text).toContain('Advisory');
      expect(response.text).toContain('不会自动写入关键词库');
      expect(response.text).toContain(suggestion.suggestedText);
      expect(response.text).toContain('更窄的相关主题，只能由人工决定是否加入词库');
      expect(response.text).toContain('data-ui="keyword-suggestion-generate"');
      expect(response.text).toContain('data-ui="keyword-suggestion-accept"');
      expect(response.text).toContain('data-ui="keyword-suggestion-reject"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires authentication', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .expect(401);
    } finally {
      await fixture.cleanup();
    }
  });

  it('hides project existence from a non-member', async () => {
    const member = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const foreign = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${foreign.project.id}/keywords`)
        .set('Cookie', member.sessionCookie)
        .expect(404);
    } finally {
      await member.cleanup();
      await foreign.cleanup();
    }
  });

  it('allows VIEWER read access but does not render mutation or AI-run controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain(suggestion.suggestedText);
      expect(response.text).not.toContain('data-ui="keyword-create-form"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-generate"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-accept"');
      expect(response.text).not.toContain('data-ui="keyword-suggestion-reject"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('denies VIEWER mutation even with a valid CSRF token', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({
          _csrf: csrfFor(fixture),
          text: '符纸文化',
          type: 'CORE',
        })
        .expect(403);
    } finally {
      await fixture.cleanup();
    }
  });

  it('denies VIEWER advisory generation even with valid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects keyword mutations with invalid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: 'invalid-token', text: '符纸文化', type: 'CORE' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects advisory generation with invalid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { seed } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: 'invalid-token' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('queues advisory generation through the injected AI task service then redirects', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
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
      const createAndEnqueue = vi.fn(async () => ({ id: randomUUID() }));
      const aiTaskService = { createAndEnqueue } as unknown as AiTaskService;
      const response = await request(createApp({ aiTaskService }))
        .post(`/projects/${fixture.project.id}/keywords/${seed.id}/suggestions/generate`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(createAndEnqueue).toHaveBeenCalledTimes(1);
      expect(createAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
        projectId: fixture.project.id,
        taskType: 'KEYWORD_EXPANSION',
        promptVersion: 'keyword-expansion-v1',
      }));
    } finally {
      await fixture.cleanup();
    }
  });

  it('accepts a pending suggestion through the web form and redirects', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture);
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/accept`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture), editedText: '六壬符纸专题' })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
        .toMatchObject({ status: 'ACCEPTED' });
      expect(await prisma.keyword.findUnique({
        where: {
          projectId_normalizedText: {
            projectId: fixture.project.id,
            normalizedText: '六壬符纸专题',
          },
        },
      })).toMatchObject({ source: 'AI_ACCEPTED', text: '六壬符纸专题' });
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a pending suggestion through the web form and redirects without creating a keyword', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const { suggestion } = await seedPendingSuggestion(fixture, '符纸怎么用');
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keyword-suggestions/${suggestion.id}/reject`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture) })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(await prisma.keywordSuggestion.findUnique({ where: { id: suggestion.id } }))
        .toMatchObject({ status: 'REJECTED', acceptedKeywordId: null });
      expect(await prisma.keyword.count({
        where: { projectId: fixture.project.id, source: 'AI_ACCEPTED' },
      })).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
