import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

async function seedDiscoveryEvidence(input: {
  projectId: string;
  primaryDomain: string;
  query?: string;
}) {
  const query = input.query ?? '六壬符纸怎么用';
  const repository = new SearchFactRepository(prisma);
  const sourceDate = new Date('2026-08-29T00:00:00.000Z');
  const sourceCutoffAt = new Date('2026-08-29T23:59:59.000Z');
  const suffix = randomUUID();

  await repository.persistCompletedSnapshot(
    {
      projectId: input.projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: `sc-domain:${input.primaryDomain}`,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `task8-gsc-${suffix}`,
      sourceCutoffAt,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [{
      factKey: `task8-gsc-query-page-${suffix}`,
      factKind: 'QUERY_PAGE',
      sourceObservationRef: `task8-gsc-observation-${suffix}`,
      sourceDate,
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'fixture',
      page: `https://${input.primaryDomain}/liuren-fuzhi-guide`,
      canonicalPage: `https://${input.primaryDomain}/liuren-fuzhi-guide`,
      canonicalizationVersion: 'fixture',
      metrics: [
        {
          metricSemantic: 'IMPRESSIONS',
          numericValue: 80,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'impressions',
        },
        {
          metricSemantic: 'CLICKS',
          numericValue: 8,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'clicks',
        },
        {
          metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
          numericValue: 4.25,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'position',
        },
      ],
    }],
    `task8-gsc-input-${suffix}`,
  );

  await repository.persistCompletedSnapshot(
    {
      projectId: input.projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: `https://${input.primaryDomain}/`,
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: `task8-bing-${suffix}`,
      sourceCutoffAt,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [{
      factKey: `task8-bing-query-${suffix}`,
      factKind: 'QUERY',
      sourceObservationRef: `task8-bing-observation-${suffix}`,
      sourceDate,
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'fixture',
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null,
      metrics: [
        {
          metricSemantic: 'IMPRESSIONS',
          numericValue: 30,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'impressions',
        },
        {
          metricSemantic: 'CLICKS',
          numericValue: 3,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'clicks',
        },
        {
          metricSemantic: 'BING_AVG_CLICK_POSITION',
          numericValue: 6.5,
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
    }],
    `task8-bing-input-${suffix}`,
  );

  return prisma.keywordDiscoveryCandidate.create({
    data: {
      projectId: input.projectId,
      normalizedQuery: query,
      representativeText: query,
      status: 'PENDING',
      firstObservedAt: sourceDate,
      lastObservedAt: sourceDate,
    },
  });
}

async function cleanupDiscovery(projectId: string) {
  await prisma.keywordDiscoveryCandidate.deleteMany({ where: { projectId } });
  await prisma.searchFactSnapshot.deleteMany({ where: { projectId } });
}

describe('P11-02B Keyword Center real search query discoveries', () => {
  it('renders persisted official query discoveries with truthful provider-qualified metrics and human review controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const candidate = await seedDiscoveryEvidence({
        projectId: fixture.project.id,
        primaryDomain: fixture.project.primaryDomain,
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-discovery"');
      expect(response.text).toContain('data-ui="keyword-discovery-row"');
      expect(response.text).toContain(`data-candidate-id="${candidate.id}"`);
      expect(response.text).toContain('真实搜索词');
      expect(response.text).toContain('本站官方搜索平台已观察');
      expect(response.text).toContain('Priority is based on official search-platform evidence observed for this site; it is not global keyword search volume.');
      expect(response.text).toContain('六壬符纸怎么用');
      expect(response.text).toContain('Google Search Console');
      expect(response.text).toContain('Search Console 平均位置');
      expect(response.text).toContain('4.25');
      expect(response.text).toContain('Bing Webmaster Tools');
      expect(response.text).toContain('Bing 平均展示位置');
      expect(response.text).toMatch(/Bing 平均展示位置[\s\S]{0,160}—/);
      expect(response.text).toContain('加入关键词库');
      expect(response.text).toContain('忽略');
      expect(response.text).toContain('data-ui="keyword-discovery-accept"');
      expect(response.text).toContain('data-ui="keyword-discovery-reject"');
      expect(response.text).toContain('name="type"');
      expect(response.text).toContain('value="LONG_TAIL"');

      expect(response.text).not.toContain('Google 当前排名');
      expect(response.text).not.toContain('Bing 当前排名');
      expect(response.text).not.toContain('排名 0');
      expect(response.text).not.toContain('全网搜索量');
      expect(response.text).not.toContain('月搜索量');
    } finally {
      await cleanupDiscovery(fixture.project.id);
      await fixture.cleanup();
    }
  });

  it('shows persisted discoveries to VIEWER but never renders accept/reject controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await seedDiscoveryEvidence({
        projectId: fixture.project.id,
        primaryDomain: fixture.project.primaryDomain,
        query: '符纸怎么保存',
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('data-ui="keyword-discovery"');
      expect(response.text).toContain('符纸怎么保存');
      expect(response.text).not.toContain('data-ui="keyword-discovery-accept"');
      expect(response.text).not.toContain('data-ui="keyword-discovery-reject"');
    } finally {
      await cleanupDiscovery(fixture.project.id);
      await fixture.cleanup();
    }
  });

  it('uses only the read-only discovery list port during Keyword Center GET', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const list = vi.fn().mockResolvedValue([{
      candidateId: '11111111-1111-4111-8111-111111111111',
      normalizedQuery: 'injected discovery',
      representativeText: 'Injected Discovery',
      trackedKeywordId: null,
      status: 'PENDING',
      firstObservedAt: '2026-08-29',
      lastObservedAt: '2026-08-29',
      providers: [{
        provider: 'GOOGLE_SEARCH_CONSOLE',
        impressions: 12,
        clicks: 2,
        searchConsoleAveragePosition: 7,
        bingAverageClickPosition: null,
        bingAverageImpressionPosition: null,
        latestSourceDate: '2026-08-29',
      }],
    }]);
    const refresh = vi.fn();
    const accept = vi.fn();
    const reject = vi.fn();

    try {
      const response = await request(createApp({
        keywordDiscoveryService: { list, refresh, accept, reject } as never,
      }))
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('Injected Discovery');
      expect(list).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledWith({ projectId: fixture.project.id });
      expect(refresh).not.toHaveBeenCalled();
      expect(accept).not.toHaveBeenCalled();
      expect(reject).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});
