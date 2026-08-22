import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';

beforeEach(async () => {
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.project.deleteMany();
});

const createProject = (name: string, slug: string) =>
  prisma.project.create({
    data: {
      name,
      slug,
      primaryDomain: `${slug}.example`
    }
  });

const persistFixtureFacts = async (repository: SearchFactRepository, projectId: string) => {
  const gsc = await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'URL_PREFIX',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: 'gsc-snapshot-2026-08-20',
      sourceCutoffAt: new Date('2026-08-21T06:00:00.000Z'),
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
    },
    [
      {
        factKey: 'gsc-query-page-1',
        factKind: 'QUERY_PAGE',
        sourceObservationRef: 'gsc-observation-1',
        sourceDate: new Date('2026-08-20T00:00:00.000Z'),
        query: '兴善堂',
        normalizedQuery: '兴善堂',
        queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
        page: 'https://example.com/liuren#section',
        canonicalPage: 'https://example.com/liuren',
        canonicalizationVersion: 'GSC_PAGE_CANONICALIZATION_V1',
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 7,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks'
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 120,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions'
          },
          {
            metricSemantic: 'CTR',
            numericValue: 7 / 120,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'ctr'
          },
          {
            metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
            numericValue: 2.8,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'position'
          }
        ]
      }
    ],
    'gsc-read-fixture-hash'
  );

  const bing = await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: 'bing-batch-2026-08-20',
      sourceCutoffAt: new Date('2026-08-21T00:00:00.000Z'),
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
    },
    [
      {
        factKey: 'bing-query-1',
        factKind: 'QUERY',
        sourceObservationRef: 'bing-observation-query-1',
        sourceDate: new Date('2026-08-20T00:00:00.000Z'),
        query: '兴善堂',
        normalizedQuery: '兴善堂',
        queryNormalizationVersion: 'SEARCH_FACT_QUERY_NORMALIZATION_V1',
        page: null,
        canonicalPage: null,
        canonicalizationVersion: null,
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 5,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks'
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 99,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions'
          },
          {
            metricSemantic: 'BING_AVG_CLICK_POSITION',
            numericValue: null,
            evidenceState: 'UNKNOWN',
            sourceField: 'avgClickPosition'
          },
          {
            metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
            numericValue: 4.8,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'avgImpressionPosition'
          }
        ]
      },
      {
        factKey: 'bing-page-1',
        factKind: 'PAGE',
        sourceObservationRef: 'bing-observation-page-1',
        sourceDate: new Date('2026-08-19T00:00:00.000Z'),
        query: null,
        normalizedQuery: null,
        queryNormalizationVersion: null,
        page: 'https://example.com/liuren#old',
        canonicalPage: 'https://example.com/liuren',
        canonicalizationVersion: 'SEARCH_FACT_PAGE_CANONICALIZATION_V1',
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 3,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks'
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 81,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions'
          },
          {
            metricSemantic: 'BING_AVG_CLICK_POSITION',
            numericValue: 3.7,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'avgClickPosition'
          },
          {
            metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
            numericValue: 5.1,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'avgImpressionPosition'
          }
        ]
      }
    ],
    'bing-read-fixture-hash'
  );

  return { gsc, bing };
};

describe('P9-0F provider-aware search fact read contract', () => {
  it('filters completed facts across every P9-0G dimension while retaining full provenance and the full metric set', async () => {
    const project = await createProject('Search facts read fixture', `search-facts-read-${Date.now()}`);
    const repository = new SearchFactRepository(prisma);
    const { gsc } = await persistFixtureFacts(repository, project.id);

    const views = await repository.listCompletedFacts({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      factKind: 'QUERY_PAGE',
      metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
      canonicalPage: 'https://example.com/liuren',
      normalizedQuery: '兴善堂',
      sourceDateFrom: new Date('2026-08-20T00:00:00.000Z'),
      sourceDateTo: new Date('2026-08-20T23:59:59.999Z')
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      snapshotId: gsc.id,
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'URL_PREFIX',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: 'gsc-snapshot-2026-08-20',
      sourceObservationRef: 'gsc-observation-1',
      sourceCutoffAt: new Date('2026-08-21T06:00:00.000Z'),
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      factKey: 'gsc-query-page-1',
      factKind: 'QUERY_PAGE',
      sourceDate: new Date('2026-08-20T00:00:00.000Z'),
      query: '兴善堂',
      normalizedQuery: '兴善堂',
      page: 'https://example.com/liuren#section',
      canonicalPage: 'https://example.com/liuren'
    });
    expect(views[0]?.metrics).toHaveLength(4);
    expect(views[0]?.metrics.map((metric) => metric.metricSemantic).sort()).toEqual([
      'CLICKS',
      'CTR',
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'IMPRESSIONS'
    ]);
  });

  it('keeps provider-specific metric semantics separate and metric filtering does not prune the returned metric set', async () => {
    const project = await createProject('Provider semantic fixture', `provider-semantic-${Date.now()}`);
    const repository = new SearchFactRepository(prisma);
    const { bing } = await persistFixtureFacts(repository, project.id);

    const bingViews = await repository.listCompletedFacts({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      factKind: 'QUERY',
      metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
      normalizedQuery: '兴善堂',
      sourceDateFrom: new Date('2026-08-20T00:00:00.000Z'),
      sourceDateTo: new Date('2026-08-20T23:59:59.999Z')
    });

    expect(bingViews).toHaveLength(1);
    expect(bingViews[0]).toMatchObject({
      snapshotId: bing.id,
      provider: 'BING_WEBMASTER',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: 'bing-batch-2026-08-20',
      sourceObservationRef: 'bing-observation-query-1',
      factKind: 'QUERY',
      normalizedQuery: '兴善堂'
    });
    expect(bingViews[0]?.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricSemantic: 'BING_AVG_CLICK_POSITION',
          numericValue: null,
          evidenceState: 'UNKNOWN',
          sourceField: 'avgClickPosition'
        }),
        expect.objectContaining({
          metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
          numericValue: 4.8,
          evidenceState: 'KNOWN_PRESENT',
          sourceField: 'avgImpressionPosition'
        }),
        expect.objectContaining({ metricSemantic: 'CLICKS' }),
        expect.objectContaining({ metricSemantic: 'IMPRESSIONS' })
      ])
    );

    const noGenericAlias = await repository.listCompletedFacts({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION'
    });
    expect(noGenericAlias).toEqual([]);
  });

  it('filters by canonical page and inclusive source date range and never leaks another project or a RUNNING snapshot', async () => {
    const project = await createProject('Scoped read fixture', `scoped-read-${Date.now()}`);
    const otherProject = await createProject('Other scoped fixture', `other-scoped-${Date.now()}`);
    const repository = new SearchFactRepository(prisma);
    await persistFixtureFacts(repository, project.id);
    await persistFixtureFacts(repository, otherProject.id);

    const running = await prisma.searchFactSnapshot.create({
      data: {
        projectId: project.id,
        provider: 'BING_WEBMASTER',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: 'https://example.com/',
        propertyType: 'SITE',
        sourceKind: 'PROVIDER_OBSERVATION_BATCH',
        sourceRef: 'running-batch',
        sourceCutoffAt: new Date('2026-08-21T00:00:00.000Z'),
        sourceCompleteness: 'PROVIDER_UNSPECIFIED',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
        inputHash: 'running-hash',
        status: 'RUNNING',
        factCount: 1,
        startedAt: new Date('2026-08-21T01:00:00.000Z')
      }
    });
    await prisma.searchFact.create({
      data: {
        snapshotId: running.id,
        projectId: project.id,
        factKey: 'running-page',
        factKind: 'PAGE',
        sourceObservationRef: 'running-observation',
        sourceDate: new Date('2026-08-19T00:00:00.000Z'),
        page: 'https://example.com/liuren#running',
        canonicalPage: 'https://example.com/liuren',
        canonicalizationVersion: 'SEARCH_FACT_PAGE_CANONICALIZATION_V1'
      }
    });

    const views = await repository.listCompletedFacts({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      factKind: 'PAGE',
      canonicalPage: 'https://example.com/liuren',
      sourceDateFrom: new Date('2026-08-19T00:00:00.000Z'),
      sourceDateTo: new Date('2026-08-19T23:59:59.999Z')
    });

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      projectId: project.id,
      factKey: 'bing-page-1',
      sourceObservationRef: 'bing-observation-page-1',
      canonicalPage: 'https://example.com/liuren',
      sourceDate: new Date('2026-08-19T00:00:00.000Z')
    });
  });
});
