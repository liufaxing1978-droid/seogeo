import { describe, expect, it } from 'vitest';
import type {
  SearchFactMetricSemantic,
  SearchFactView,
} from '../../src/modules/search-facts/search-fact.types.js';
import {
  projectKeywordDiscoveryEvidence,
} from '../../src/modules/keywords/keyword-discovery.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function metric(
  metricSemantic: SearchFactMetricSemantic,
  numericValue: number | null,
  evidenceState: 'KNOWN_PRESENT' | 'UNKNOWN' = numericValue === null
    ? 'UNKNOWN'
    : 'KNOWN_PRESENT',
) {
  return {
    metricSemantic,
    numericValue,
    evidenceState,
    sourceField: metricSemantic.toLowerCase(),
  } as const;
}

function searchFact(input: {
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  query: string;
  sourceDate: string;
  factKey: string;
  impressions?: number | null;
  clicks?: number | null;
  searchConsolePosition?: number | null;
  bingClickPosition?: number | null;
  bingImpressionPosition?: number | null;
}): SearchFactView {
  const isGoogle = input.provider === 'GOOGLE_SEARCH_CONSOLE';
  const metrics = [
    metric('IMPRESSIONS', input.impressions ?? null),
    metric('CLICKS', input.clicks ?? null),
    ...(isGoogle
      ? [metric('GOOGLE_SEARCH_CONSOLE_POSITION', input.searchConsolePosition ?? null)]
      : [
          metric('BING_AVG_CLICK_POSITION', input.bingClickPosition ?? null),
          metric('BING_AVG_IMPRESSION_POSITION', input.bingImpressionPosition ?? null),
        ]),
  ];

  return {
    snapshotId: `${input.provider}-${input.sourceDate}`,
    projectId: PROJECT_ID,
    provider: input.provider,
    marketCode: 'HK',
    locale: 'zh-Hant',
    propertyRef: isGoogle ? 'sc-domain:xingshantang.org' : 'https://xingshantang.org/',
    propertyType: isGoogle ? 'DOMAIN' : 'SITE',
    sourceKind: isGoogle ? 'GSC_DAILY_SNAPSHOT' : 'PROVIDER_OBSERVATION_BATCH',
    sourceRef: `${input.provider}-${input.sourceDate}`,
    sourceObservationRef: input.factKey,
    sourceCutoffAt: new Date(`${input.sourceDate}T00:00:00.000Z`),
    sourceCompleteness: isGoogle ? 'TOP_ROWS_ONLY' : 'PROVIDER_UNSPECIFIED',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: input.factKey,
    factKind: isGoogle ? 'QUERY_PAGE' : 'QUERY',
    sourceDate: new Date(`${input.sourceDate}T00:00:00.000Z`),
    query: input.query,
    normalizedQuery: input.query,
    queryNormalizationVersion: 'fixture',
    page: isGoogle ? `https://xingshantang.org/${input.factKey}` : null,
    canonicalPage: isGoogle ? `https://xingshantang.org/${input.factKey}` : null,
    canonicalizationVersion: isGoogle ? 'fixture' : null,
    metrics,
  };
}

describe('keyword discovery deterministic projection', () => {
  it('groups Google QUERY_PAGE and Bing QUERY facts with the bridge normalizer while preserving Traditional/Simplified identity', () => {
    const result = projectKeywordDiscoveryEvidence({
      facts: [
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: '  六壬   符紙  ',
          sourceDate: '2026-08-28',
          factKey: 'g-1',
          impressions: 10,
          clicks: 1,
          searchConsolePosition: 8,
        }),
        searchFact({
          provider: 'BING_WEBMASTER',
          query: '六壬 符紙',
          sourceDate: '2026-08-29',
          factKey: 'b-1',
          impressions: 20,
          clicks: 2,
          bingClickPosition: 4,
          bingImpressionPosition: 6,
        }),
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: '六壬 符纸',
          sourceDate: '2026-08-29',
          factKey: 'g-2',
          impressions: 30,
          clicks: 3,
          searchConsolePosition: 3,
        }),
      ],
      trackedKeywords: [],
    });

    expect(result.map((item) => item.normalizedQuery).sort()).toEqual([
      '六壬 符紙',
      '六壬 符纸',
    ].sort());

    const traditional = result.find((item) => item.normalizedQuery === '六壬 符紙');
    expect(traditional?.providers.map((item) => item.provider)).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER',
    ]);
    expect(traditional?.providers[0]).toMatchObject({ impressions: 10, clicks: 1 });
    expect(traditional?.providers[1]).toMatchObject({ impressions: 20, clicks: 2 });
  });

  it('selects representative text from the latest source date with deterministic raw-text tie breaking', () => {
    const latestRawForms = ['Query  Name', 'Query Name'];
    const expectedRepresentative = [...latestRawForms].sort((left, right) =>
      left.localeCompare(right),
    )[0];

    const [projection] = projectKeywordDiscoveryEvidence({
      facts: [
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: 'query name',
          sourceDate: '2026-08-28',
          factKey: 'old',
          impressions: 1,
          clicks: 0,
          searchConsolePosition: 9,
        }),
        ...latestRawForms.map((query, index) => searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query,
          sourceDate: '2026-08-29',
          factKey: `latest-${index}`,
          impressions: 1,
          clicks: 0,
          searchConsolePosition: 8,
        })),
      ],
      trackedKeywords: [],
    });

    expect(projection).toMatchObject({
      normalizedQuery: 'query name',
      representativeText: expectedRepresentative,
      firstObservedAt: '2026-08-28',
      lastObservedAt: '2026-08-29',
    });
  });

  it('keeps provider-qualified metrics separate and uses only known positive weights for Google average position', () => {
    const [projection] = projectKeywordDiscoveryEvidence({
      facts: [
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: '符纸 怎么用',
          sourceDate: '2026-08-27',
          factKey: 'g-1',
          impressions: 10,
          clicks: 2,
          searchConsolePosition: 10,
        }),
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: '符纸   怎么用',
          sourceDate: '2026-08-28',
          factKey: 'g-2',
          impressions: 30,
          clicks: 3,
          searchConsolePosition: 2,
        }),
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: '符纸 怎么用',
          sourceDate: '2026-08-29',
          factKey: 'g-zero-weight',
          impressions: 0,
          clicks: 0,
          searchConsolePosition: 100,
        }),
        searchFact({
          provider: 'BING_WEBMASTER',
          query: '符纸 怎么用',
          sourceDate: '2026-08-29',
          factKey: 'b-1',
          impressions: 20,
          clicks: 2,
          bingClickPosition: 4,
          bingImpressionPosition: 6,
        }),
      ],
      trackedKeywords: [],
    });

    expect(projection.providers).toEqual([
      {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        impressions: 40,
        clicks: 5,
        searchConsoleAveragePosition: 4,
        bingAverageClickPosition: null,
        bingAverageImpressionPosition: null,
        latestSourceDate: '2026-08-29',
      },
      {
        provider: 'BING_WEBMASTER',
        impressions: 20,
        clicks: 2,
        searchConsoleAveragePosition: null,
        bingAverageClickPosition: 4,
        bingAverageImpressionPosition: 6,
        latestSourceDate: '2026-08-29',
      },
    ]);

    expect(projection).not.toHaveProperty('impressions');
    expect(projection).not.toHaveProperty('clicks');
  });

  it('weights Bing click/impression positions independently and preserves unknown position metrics as null', () => {
    const result = projectKeywordDiscoveryEvidence({
      facts: [
        searchFact({
          provider: 'BING_WEBMASTER',
          query: '六壬 教学',
          sourceDate: '2026-08-28',
          factKey: 'known',
          impressions: 20,
          clicks: 2,
          bingClickPosition: 5,
          bingImpressionPosition: 8,
        }),
        searchFact({
          provider: 'BING_WEBMASTER',
          query: '六壬   教学',
          sourceDate: '2026-08-29',
          factKey: 'unknown-position',
          impressions: 30,
          clicks: 3,
          bingClickPosition: null,
          bingImpressionPosition: null,
        }),
        searchFact({
          provider: 'BING_WEBMASTER',
          query: '完全未知位置',
          sourceDate: '2026-08-29',
          factKey: 'all-unknown',
          impressions: 12,
          clicks: 1,
          bingClickPosition: null,
          bingImpressionPosition: null,
        }),
      ],
      trackedKeywords: [],
    });

    const known = result.find((item) => item.normalizedQuery === '六壬 教学');
    expect(known?.providers[0]).toMatchObject({
      impressions: 50,
      clicks: 5,
      bingAverageClickPosition: 5,
      bingAverageImpressionPosition: 8,
    });

    const unknown = result.find((item) => item.normalizedQuery === '完全未知位置');
    expect(unknown?.providers[0]).toMatchObject({
      bingAverageClickPosition: null,
      bingAverageImpressionPosition: null,
    });
  });

  it('orders untracked discoveries first, then by deterministic provider precedence and provider-local evidence', () => {
    const result = projectKeywordDiscoveryEvidence({
      facts: [
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: 'tracked huge',
          sourceDate: '2026-08-29',
          factKey: 'tracked',
          impressions: 999,
          clicks: 99,
          searchConsolePosition: 1,
        }),
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: 'google lower',
          sourceDate: '2026-08-29',
          factKey: 'g-low',
          impressions: 20,
          clicks: 2,
          searchConsolePosition: 5,
        }),
        searchFact({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          query: 'google higher',
          sourceDate: '2026-08-28',
          factKey: 'g-high',
          impressions: 40,
          clicks: 1,
          searchConsolePosition: 6,
        }),
        searchFact({
          provider: 'BING_WEBMASTER',
          query: 'bing huge',
          sourceDate: '2026-08-29',
          factKey: 'b-huge',
          impressions: 500,
          clicks: 50,
          bingClickPosition: 2,
          bingImpressionPosition: 3,
        }),
      ],
      trackedKeywords: [{ id: 'keyword-tracked', normalizedText: 'tracked huge' }],
    });

    expect(result.map((item) => item.normalizedQuery)).toEqual([
      'google higher',
      'google lower',
      'bing huge',
      'tracked huge',
    ]);
    expect(result.at(-1)?.trackedKeywordId).toBe('keyword-tracked');
  });

  it('does not expose fabricated search-volume or current-rank fields', () => {
    const [projection] = projectKeywordDiscoveryEvidence({
      facts: [searchFact({
        provider: 'GOOGLE_SEARCH_CONSOLE',
        query: '符纸',
        sourceDate: '2026-08-29',
        factKey: 'safe-copy',
        impressions: 10,
        clicks: 1,
        searchConsolePosition: 4,
      })],
      trackedKeywords: [],
    });

    expect(Object.keys(projection)).not.toContain('searchVolume');
    expect(Object.keys(projection)).not.toContain('currentRank');
    expect(Object.keys(projection)).not.toContain('rank');
    expect(JSON.stringify(projection)).not.toMatch(/searchVolume|currentRank|"rank"/i);
  });
});
