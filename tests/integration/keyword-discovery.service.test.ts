import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordDiscoveryRepository } from '../../src/modules/keywords/keyword-discovery.repository.js';
import { KeywordDiscoveryService } from '../../src/modules/keywords/keyword-discovery.service.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

beforeEach(async () => {
  await prisma.keywordDiscoveryCandidate.deleteMany();
  await prisma.keywordAuditEvent.deleteMany();
  await prisma.keywordGroupMembership.deleteMany();
  await prisma.keywordRelation.deleteMany();
  await prisma.keywordSuggestion.deleteMany();
  await prisma.keyword.deleteMany();
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.project.deleteMany();
});

async function createProject(label: string) {
  return prisma.project.create({
    data: {
      name: label,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
      primaryDomain: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.example`,
    },
  });
}

function service() {
  return new KeywordDiscoveryService({
    repository: new KeywordDiscoveryRepository(prisma),
    now: () => NOW,
  });
}

async function persistQuerySnapshot(input: {
  projectId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  sourceDate: string;
  sourceRef: string;
  rows: Array<{
    factKey: string;
    query: string;
    impressions: number;
    clicks: number;
    position?: number | null;
  }>;
}) {
  const repository = new SearchFactRepository(prisma);
  const google = input.provider === 'GOOGLE_SEARCH_CONSOLE';
  return repository.persistCompletedSnapshot(
    {
      projectId: input.projectId,
      provider: input.provider,
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: google ? 'sc-domain:xingshantang.org' : 'https://xingshantang.org/',
      propertyType: google ? 'DOMAIN' : 'SITE',
      sourceKind: google ? 'GSC_DAILY_SNAPSHOT' : 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: input.sourceRef,
      sourceCutoffAt: new Date(`${input.sourceDate}T23:59:59.000Z`),
      sourceCompleteness: google ? 'TOP_ROWS_ONLY' : 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    input.rows.map((row) => ({
      factKey: row.factKey,
      factKind: google ? 'QUERY_PAGE' as const : 'QUERY' as const,
      sourceObservationRef: `${input.sourceRef}:${row.factKey}`,
      sourceDate: new Date(`${input.sourceDate}T00:00:00.000Z`),
      query: row.query,
      normalizedQuery: row.query.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und'),
      queryNormalizationVersion: 'fixture',
      page: google ? `https://xingshantang.org/${row.factKey}` : null,
      canonicalPage: google ? `https://xingshantang.org/${row.factKey}` : null,
      canonicalizationVersion: google ? 'fixture' : null,
      metrics: [
        {
          metricSemantic: 'IMPRESSIONS' as const,
          numericValue: row.impressions,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'impressions',
        },
        {
          metricSemantic: 'CLICKS' as const,
          numericValue: row.clicks,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'clicks',
        },
        ...(google
          ? [{
              metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION' as const,
              numericValue: row.position ?? null,
              evidenceState: row.position === null || row.position === undefined
                ? 'UNKNOWN' as const
                : 'KNOWN_PRESENT' as const,
              sourceField: 'position',
            }]
          : [{
              metricSemantic: 'BING_AVG_CLICK_POSITION' as const,
              numericValue: row.position ?? null,
              evidenceState: row.position === null || row.position === undefined
                ? 'UNKNOWN' as const
                : 'KNOWN_PRESENT' as const,
              sourceField: 'avgClickPosition',
            }, {
              metricSemantic: 'BING_AVG_IMPRESSION_POSITION' as const,
              numericValue: row.position ?? null,
              evidenceState: row.position === null || row.position === undefined
                ? 'UNKNOWN' as const
                : 'KNOWN_PRESENT' as const,
              sourceField: 'avgImpressionPosition',
            }]),
      ],
    })),
    `${input.sourceRef}-hash`,
  );
}

async function persistRunningQuery(projectId: string, sourceDate: string, query: string) {
  const snapshot = await prisma.searchFactSnapshot.create({
    data: {
      projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'https://xingshantang.org/',
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: `running-${sourceDate}-${query}`,
      sourceCutoffAt: new Date(`${sourceDate}T23:59:59.000Z`),
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      inputHash: `running-${sourceDate}-${query}`,
      status: 'RUNNING',
      factCount: 1,
      startedAt: new Date(`${sourceDate}T01:00:00.000Z`),
    },
  });
  await prisma.searchFact.create({
    data: {
      snapshotId: snapshot.id,
      projectId,
      factKey: `running-${query}`,
      factKind: 'QUERY',
      sourceObservationRef: `running:${query}`,
      sourceDate: new Date(`${sourceDate}T00:00:00.000Z`),
      query,
      normalizedQuery: query,
      queryNormalizationVersion: 'fixture',
    },
  });
}

describe('KeywordDiscoveryService persistence projection', () => {
  it('reads only completed in-window query-capable facts, marks tracked keywords, and creates one PENDING candidate for an untracked query', async () => {
    const project = await createProject('Discovery Scope');
    const tracked = await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '伏英馆',
        normalizedText: '伏英馆',
        type: 'BRAND',
        priority: 'MEDIUM',
        status: 'ACTIVE',
        source: 'MANUAL',
      },
    });

    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-28',
      sourceRef: 'gsc-discovery-scope',
      rows: [
        { factKey: 'tracked', query: '伏英馆', impressions: 100, clicks: 10, position: 2 },
        { factKey: 'new', query: '符纸 怎么用', impressions: 20, clicks: 2, position: 6 },
      ],
    });
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      sourceDate: '2026-07-01',
      sourceRef: 'bing-outside-window',
      rows: [{ factKey: 'outside', query: '窗口外关键词', impressions: 999, clicks: 99, position: 1 }],
    });
    await persistRunningQuery(project.id, '2026-08-29', '运行中快照关键词');

    const pageSnapshot = await prisma.searchFactSnapshot.findFirstOrThrow({
      where: { projectId: project.id, sourceRef: 'gsc-discovery-scope' },
    });
    await prisma.searchFact.create({
      data: {
        snapshotId: pageSnapshot.id,
        projectId: project.id,
        factKey: 'non-query-page-kind',
        factKind: 'PAGE',
        sourceObservationRef: 'non-query-page-kind',
        sourceDate: new Date('2026-08-28T00:00:00.000Z'),
        query: '不应进入发现',
        normalizedQuery: '不应进入发现',
        queryNormalizationVersion: 'fixture',
        page: 'https://xingshantang.org/ignored',
        canonicalPage: 'https://xingshantang.org/ignored',
        canonicalizationVersion: 'fixture',
      },
    });

    await expect(service().refresh({
      projectId: project.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({ created: 1, updated: 0, preserved: 0 });

    const candidates = await prisma.keywordDiscoveryCandidate.findMany({
      where: { projectId: project.id },
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      normalizedQuery: '符纸 怎么用',
      representativeText: '符纸 怎么用',
      status: 'PENDING',
      acceptedKeywordId: null,
      firstObservedAt: new Date('2026-08-28T00:00:00.000Z'),
      lastObservedAt: new Date('2026-08-28T00:00:00.000Z'),
    });
    expect(Object.keys(candidates[0] ?? {})).not.toEqual(expect.arrayContaining([
      'clicks',
      'impressions',
      'ctr',
      'searchConsoleAveragePosition',
      'bingAverageClickPosition',
      'bingAverageImpressionPosition',
    ]));

    const list = await service().list({
      projectId: project.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    });
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({
        normalizedQuery: '符纸 怎么用',
        status: 'PENDING',
        candidateId: candidates[0]?.id,
        trackedKeywordId: null,
      }),
      expect.objectContaining({
        normalizedQuery: '伏英馆',
        status: 'TRACKED',
        candidateId: null,
        trackedKeywordId: tracked.id,
      }),
    ]));
    expect(list.map((item) => item.normalizedQuery)).not.toContain('窗口外关键词');
    expect(list.map((item) => item.normalizedQuery)).not.toContain('运行中快照关键词');
    expect(list.map((item) => item.normalizedQuery)).not.toContain('不应进入发现');
  });

  it('repeated refresh advances deterministic observation bounds and representative text without duplicating the candidate', async () => {
    const project = await createProject('Discovery Refresh');
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      sourceDate: '2026-08-28',
      sourceRef: 'bing-refresh-first',
      rows: [{ factKey: 'first', query: 'Liuren Guide', impressions: 5, clicks: 1, position: 8 }],
    });

    await expect(service().refresh({
      projectId: project.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({ created: 1, updated: 0, preserved: 0 });

    const first = await prisma.keywordDiscoveryCandidate.findFirstOrThrow({
      where: { projectId: project.id },
    });

    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-29',
      sourceRef: 'gsc-refresh-latest',
      rows: [{ factKey: 'latest', query: 'LIUREN   GUIDE', impressions: 30, clicks: 3, position: 4 }],
    });

    await expect(service().refresh({
      projectId: project.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({ created: 0, updated: 1, preserved: 0 });

    const second = await prisma.keywordDiscoveryCandidate.findFirstOrThrow({
      where: { projectId: project.id },
    });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      normalizedQuery: 'liuren guide',
      representativeText: 'LIUREN   GUIDE',
      firstObservedAt: new Date('2026-08-28T00:00:00.000Z'),
      lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      status: 'PENDING',
    });
    expect(await prisma.keywordDiscoveryCandidate.count({ where: { projectId: project.id } }))
      .toBe(1);

    await expect(service().refresh({
      projectId: project.id,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({ created: 0, updated: 0, preserved: 1 });
  });

  it('preserves REJECTED and ACCEPTED decisions and accepted keyword links when provider evidence is observed again', async () => {
    const project = await createProject('Discovery Decisions');
    const acceptedKeyword = await prisma.keyword.create({
      data: {
        projectId: project.id,
        text: '六壬符纸',
        normalizedText: '六壬符纸',
        type: 'LONG_TAIL',
        priority: 'MEDIUM',
        status: 'ACTIVE',
        source: 'SEARCH_DISCOVERY_ACCEPTED',
      },
    });
    await prisma.keywordDiscoveryCandidate.createMany({
      data: [
        {
          projectId: project.id,
          normalizedQuery: '已拒绝词',
          representativeText: '已拒绝词',
          status: 'REJECTED',
          firstObservedAt: new Date('2026-08-20T00:00:00.000Z'),
          lastObservedAt: new Date('2026-08-20T00:00:00.000Z'),
          decidedAt: new Date('2026-08-21T00:00:00.000Z'),
        },
        {
          projectId: project.id,
          normalizedQuery: '六壬符纸',
          representativeText: '六壬符纸',
          status: 'ACCEPTED',
          acceptedKeywordId: acceptedKeyword.id,
          firstObservedAt: new Date('2026-08-20T00:00:00.000Z'),
          lastObservedAt: new Date('2026-08-20T00:00:00.000Z'),
          decidedAt: new Date('2026-08-21T00:00:00.000Z'),
        },
      ],
    });
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      sourceDate: '2026-08-29',
      sourceRef: 'bing-decisions-latest',
      rows: [
        { factKey: 'rejected', query: '已拒绝词', impressions: 20, clicks: 2, position: 7 },
        { factKey: 'accepted', query: '六壬符纸', impressions: 40, clicks: 4, position: 4 },
      ],
    });

    await service().refresh({
      projectId: project.id,
      dateFrom: '2026-08-20',
      dateTo: '2026-08-29',
    });

    const candidates = await prisma.keywordDiscoveryCandidate.findMany({
      where: { projectId: project.id },
      orderBy: { normalizedQuery: 'asc' },
    });
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        normalizedQuery: '已拒绝词',
        status: 'REJECTED',
        acceptedKeywordId: null,
        lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      }),
      expect.objectContaining({
        normalizedQuery: '六壬符纸',
        status: 'ACCEPTED',
        acceptedKeywordId: acceptedKeyword.id,
        lastObservedAt: new Date('2026-08-29T00:00:00.000Z'),
      }),
    ]));
  });

  it('list is read-only, bounded to at most 93 days, and never performs provider/network work', async () => {
    const project = await createProject('Discovery Read Only');
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-29',
      sourceRef: 'gsc-read-only',
      rows: [{ factKey: 'safe', query: '符纸', impressions: 10, clicks: 1, position: 5 }],
    });

    const beforeCandidates = await prisma.keywordDiscoveryCandidate.count({
      where: { projectId: project.id },
    });
    const beforeFacts = await prisma.searchFact.count({ where: { projectId: project.id } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('network work is forbidden in keyword discovery list');
    });

    try {
      const result = await service().list({
        projectId: project.id,
        dateFrom: '2026-08-29',
        dateTo: '2026-08-29',
      });
      expect(result).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await prisma.keywordDiscoveryCandidate.count({ where: { projectId: project.id } }))
        .toBe(beforeCandidates);
      expect(await prisma.searchFact.count({ where: { projectId: project.id } })).toBe(beforeFacts);

      await expect(service().list({
        projectId: project.id,
        dateFrom: '2026-05-01',
        dateTo: '2026-08-29',
      })).rejects.toBeDefined();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('defaults to the trailing 28 completed UTC days ending yesterday', async () => {
    const project = await createProject('Discovery Default Window');
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-29',
      sourceRef: 'gsc-default-in',
      rows: [{ factKey: 'in', query: '默认窗口内', impressions: 10, clicks: 1, position: 5 }],
    });
    await persistQuerySnapshot({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-01',
      sourceRef: 'gsc-default-out',
      rows: [{ factKey: 'out', query: '默认窗口外', impressions: 10, clicks: 1, position: 5 }],
    });

    const result = await service().list({ projectId: project.id });
    expect(result.map((item) => item.normalizedQuery)).toContain('默认窗口内');
    expect(result.map((item) => item.normalizedQuery)).not.toContain('默认窗口外');
    expect(result[0]).toMatchObject({
      firstObservedAt: '2026-08-29',
      lastObservedAt: '2026-08-29',
    });
  });
});
