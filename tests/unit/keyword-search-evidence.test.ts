import type { MarketCode } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { SearchFactView } from '../../src/modules/search-facts/search-fact.types.js';
import * as moduleUnderTest from '../../src/modules/keywords/keyword-search-evidence.js';

const subject = moduleUnderTest as unknown as {
  aggregateKeywordSearchEvidenceLane(input: {
    normalizedKeyword: string;
    lane: {
      provider: string;
      marketCode: string;
      locale: string;
      propertyRef: string;
      propertyType: string;
      sourceCompleteness: string[];
      snapshotIds: string[];
      latestAvailableSourceDate: string | null;
    };
    facts: SearchFactView[];
    dateFrom: string;
    dateTo: string;
  }): any;
  projectProviderPlaceholders(input: {
    providersWithRealLanes: ReadonlySet<string>;
    dateFrom: string;
    dateTo: string;
  }): any[];
};

const marketCode = 'GLOBAL' as MarketCode;

function googleFact(input: {
  snapshotId: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
  query?: string;
  sourceDate?: string;
}): SearchFactView {
  const sourceDate = new Date(`${input.sourceDate ?? '2026-08-28'}T00:00:00.000Z`);
  return {
    snapshotId: input.snapshotId,
    projectId: '00000000-0000-0000-0000-000000000001',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    marketCode,
    locale: 'zh-CN',
    propertyRef: 'sc-domain:example.com',
    propertyType: 'DOMAIN',
    sourceKind: 'GSC_DAILY_SNAPSHOT',
    sourceRef: `gsc:${input.snapshotId}`,
    sourceObservationRef: `row:${input.snapshotId}:${input.page}`,
    sourceCutoffAt: sourceDate,
    sourceCompleteness: 'TOP_ROWS_ONLY',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: `${input.snapshotId}:${input.page}`,
    factKind: 'QUERY_PAGE',
    sourceDate,
    query: input.query ?? '符纸',
    normalizedQuery: input.query ?? '符纸',
    queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
    page: input.page,
    canonicalPage: input.page,
    canonicalizationVersion: 'GSC_PERSISTED_CANONICAL_PAGE_V1',
    metrics: [
      { metricSemantic: 'CLICKS', numericValue: input.clicks, evidenceState: 'KNOWN_PRESENT', sourceField: 'clicks' },
      { metricSemantic: 'IMPRESSIONS', numericValue: input.impressions, evidenceState: 'KNOWN_PRESENT', sourceField: 'impressions' },
      { metricSemantic: 'CTR', numericValue: input.impressions > 0 ? input.clicks / input.impressions : 0, evidenceState: 'KNOWN_PRESENT', sourceField: 'ctr' },
      { metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION', numericValue: input.position, evidenceState: 'KNOWN_PRESENT', sourceField: 'position' },
    ],
  };
}

function bingFact(input: {
  snapshotId: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number;
  query?: string;
  sourceDate?: string;
}): SearchFactView {
  const sourceDate = new Date(`${input.sourceDate ?? '2026-08-28'}T00:00:00.000Z`);
  return {
    snapshotId: input.snapshotId,
    projectId: '00000000-0000-0000-0000-000000000001',
    provider: 'BING_WEBMASTER',
    marketCode,
    locale: 'zh-CN',
    propertyRef: 'https://example.com/',
    propertyType: 'SITE',
    sourceKind: 'PROVIDER_OBSERVATION_BATCH',
    sourceRef: `bing:${input.snapshotId}`,
    sourceObservationRef: `query:${input.snapshotId}`,
    sourceCutoffAt: sourceDate,
    sourceCompleteness: 'PROVIDER_UNSPECIFIED',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: `bing:${input.snapshotId}`,
    factKind: 'QUERY',
    sourceDate,
    query: input.query ?? '符纸',
    normalizedQuery: input.query ?? '符纸',
    queryNormalizationVersion: 'SEARCH_FACT_QUERY_NORMALIZATION_V1',
    page: null,
    canonicalPage: null,
    canonicalizationVersion: null,
    metrics: [
      { metricSemantic: 'CLICKS', numericValue: input.clicks, evidenceState: 'KNOWN_PRESENT', sourceField: 'clicks' },
      { metricSemantic: 'IMPRESSIONS', numericValue: input.impressions, evidenceState: 'KNOWN_PRESENT', sourceField: 'impressions' },
      { metricSemantic: 'BING_AVG_CLICK_POSITION', numericValue: input.avgClickPosition, evidenceState: 'KNOWN_PRESENT', sourceField: 'avgClickPosition' },
      { metricSemantic: 'BING_AVG_IMPRESSION_POSITION', numericValue: null, evidenceState: 'UNKNOWN', sourceField: 'avgImpressionPosition' },
    ],
  };
}

const nullMetrics = {
  clicks: null,
  impressions: null,
  ctr: null,
  searchConsoleAveragePosition: null,
  bingAverageClickPosition: null,
  bingAverageImpressionPosition: null,
};

describe('P11-02A official search evidence aggregation', () => {
  it('aggregates exact Google Query+Page evidence deterministically', () => {
    const lane = {
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'sc-domain:example.com',
      propertyType: 'DOMAIN',
      sourceCompleteness: ['TOP_ROWS_ONLY'],
      snapshotIds: ['g-2', 'g-1'],
      latestAvailableSourceDate: '2026-08-28',
    };

    const result = subject.aggregateKeywordSearchEvidenceLane({
      normalizedKeyword: '符纸',
      lane,
      facts: [
        googleFact({ snapshotId: 'g-2', page: 'https://example.com/a', clicks: 4, impressions: 100, position: 8 }),
        googleFact({ snapshotId: 'g-1', page: 'https://example.com/b', clicks: 2, impressions: 50, position: 4 }),
        googleFact({ snapshotId: 'g-2', page: 'https://example.com/c', clicks: 50, impressions: 500, position: 1, query: '其它词' }),
      ],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
    });

    expect(result).toMatchObject({
      kind: 'LANE',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'OBSERVED',
      snapshotIds: ['g-1', 'g-2'],
    });
    expect(result.metrics.clicks).toBe(6);
    expect(result.metrics.impressions).toBe(150);
    expect(result.metrics.ctr).toBeCloseTo(0.04);
    expect(result.metrics.searchConsoleAveragePosition).toBeCloseTo((8 * 100 + 4 * 50) / 150);
    expect(result.matchedPages.map((item: any) => item.canonicalPage)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('keeps an absent Google query UNKNOWN when evidence is TOP_ROWS_ONLY', () => {
    const result = subject.aggregateKeywordSearchEvidenceLane({
      normalizedKeyword: '符纸',
      lane: {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: 'sc-domain:example.com',
        propertyType: 'DOMAIN',
        sourceCompleteness: ['TOP_ROWS_ONLY'],
        snapshotIds: ['g-1'],
        latestAvailableSourceDate: '2026-08-28',
      },
      facts: [googleFact({ snapshotId: 'g-1', page: 'https://example.com/a', clicks: 1, impressions: 10, position: 3, query: '其它词' })],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
    });

    expect(result.state).toBe('UNKNOWN');
    expect(result.metrics).toEqual(nullMetrics);
  });

  it('keeps a matched Bing query OBSERVED while an unknown position metric stays null', () => {
    const result = subject.aggregateKeywordSearchEvidenceLane({
      normalizedKeyword: '符纸',
      lane: {
        provider: 'BING_WEBMASTER',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: 'https://example.com/',
        propertyType: 'SITE',
        sourceCompleteness: ['PROVIDER_UNSPECIFIED'],
        snapshotIds: ['b-2', 'b-1'],
        latestAvailableSourceDate: '2026-08-28',
      },
      facts: [
        bingFact({ snapshotId: 'b-1', clicks: 4, impressions: 80, avgClickPosition: 3 }),
        bingFact({ snapshotId: 'b-2', clicks: 6, impressions: 120, avgClickPosition: 5 }),
      ],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
    });

    expect(result.state).toBe('OBSERVED');
    expect(result.metrics.clicks).toBe(10);
    expect(result.metrics.impressions).toBe(200);
    expect(result.metrics.bingAverageClickPosition).toBeCloseTo((3 * 4 + 5 * 6) / 10);
    expect(result.metrics.bingAverageImpressionPosition).toBeNull();
  });

  it('uses NOT_OBSERVED only for complete query evidence', () => {
    const result = subject.aggregateKeywordSearchEvidenceLane({
      normalizedKeyword: '符纸',
      lane: {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: 'sc-domain:example.com',
        propertyType: 'DOMAIN',
        sourceCompleteness: ['COMPLETE'],
        snapshotIds: ['g-complete'],
        latestAvailableSourceDate: '2026-08-28',
      },
      facts: [googleFact({ snapshotId: 'g-complete', page: 'https://example.com/a', clicks: 1, impressions: 10, position: 3, query: '其它词' })],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
    });

    expect(result.state).toBe('NOT_OBSERVED');
    expect(result.metrics).toEqual(nullMetrics);
  });

  it('projects provider-level UNKNOWN or UNAVAILABLE from the real capability registry', () => {
    const placeholders = subject.projectProviderPlaceholders({
      providersWithRealLanes: new Set<string>(),
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
    });

    expect(placeholders.find((item) => item.provider === 'GOOGLE_SEARCH_CONSOLE')).toMatchObject({
      kind: 'PROVIDER',
      state: 'UNKNOWN',
      capabilityState: 'SUPPORTED',
      accessMode: 'API',
      marketCode: null,
      propertyRef: null,
    });
    expect(placeholders.find((item) => item.provider === 'BING_WEBMASTER')).toMatchObject({
      kind: 'PROVIDER',
      state: 'UNKNOWN',
      capabilityState: 'SUPPORTED',
      accessMode: 'API',
    });
    expect(placeholders.find((item) => item.provider === 'BAIDU_SEARCH_RESOURCE')).toMatchObject({
      kind: 'PROVIDER',
      state: 'UNAVAILABLE',
      capabilityState: 'NOT_IMPLEMENTED',
      accessMode: 'PLATFORM_ONLY',
    });
    expect(placeholders.find((item) => item.provider === 'QIHOO_360_WEBMASTER')).toMatchObject({
      state: 'UNAVAILABLE',
      capabilityState: 'NOT_SUPPORTED',
      accessMode: 'NONE',
    });
  });
});
