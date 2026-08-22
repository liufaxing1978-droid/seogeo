import { describe, expect, it } from 'vitest';
import {
  GROWTH_SEARCH_PROVENANCE_VERSION,
  adaptGoogleScoringFacts
} from '../../src/modules/growth/growth-search-source.adapter.js';
import type {
  SearchFactEvidenceState,
  SearchFactMetricSemantic,
  SearchFactView
} from '../../src/modules/search-facts/search-fact.types.js';

function metric(
  metricSemantic: SearchFactMetricSemantic,
  numericValue: number | null,
  evidenceState: SearchFactEvidenceState = 'KNOWN_PRESENT'
): SearchFactView['metrics'][number] {
  return {
    metricSemantic,
    numericValue,
    evidenceState,
    sourceField: metricSemantic
  };
}

function googleFact(overrides: Partial<SearchFactView> = {}): SearchFactView {
  return {
    snapshotId: 'normalized-global',
    projectId: 'project-1',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    marketCode: 'GLOBAL',
    locale: 'zh-CN',
    propertyRef: 'sc-domain:example.com',
    propertyType: 'DOMAIN',
    sourceKind: 'GSC_DAILY_SNAPSHOT',
    sourceRef: 'gsc-snapshot-1',
    sourceObservationRef: 'gsc-fact-1',
    sourceCutoffAt: new Date('2026-08-01T00:00:00.000Z'),
    sourceCompleteness: 'TOP_ROWS_ONLY',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: 'q-page-1',
    factKind: 'QUERY_PAGE',
    sourceDate: new Date('2026-07-31T00:00:00.000Z'),
    query: '六壬',
    normalizedQuery: '六壬',
    queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
    page: 'https://example.com/guide',
    canonicalPage: 'https://example.com/guide',
    canonicalizationVersion: 'GSC_PERSISTED_CANONICAL_PAGE_V1',
    metrics: [
      metric('CLICKS', 2),
      metric('IMPRESSIONS', 20),
      metric('CTR', 0.1),
      metric('GOOGLE_SEARCH_CONSOLE_POSITION', 8)
    ],
    ...overrides
  };
}

const selected = new Set(['gsc-snapshot-1']);

describe('P9-0G Growth search scoring authority lane', () => {
  it('locks the provenance contract version', () => {
    expect(GROWTH_SEARCH_PROVENANCE_VERSION).toBe('GROWTH_SEARCH_PROVENANCE_V1');
  });

  it('maps an exact Google QUERY_PAGE fact into the unchanged QueryPageFactLike contract', () => {
    expect(adaptGoogleScoringFacts([googleFact()], selected)).toEqual([
      {
        date: new Date('2026-07-31T00:00:00.000Z'),
        normalizedQuery: '六壬',
        canonicalPage: 'https://example.com/guide',
        clicks: 2,
        impressions: 20,
        ctr: 0.1,
        position: 8
      }
    ]);
  });

  it('rejects a non-Google provider from the Google scoring lane', () => {
    expect(() => adaptGoogleScoringFacts([
      googleFact({ provider: 'BING_WEBMASTER' })
    ], selected)).toThrow('GROWTH_SEARCH_SOURCE_MISMATCH');
  });

  it('fails closed when a required scoring metric is missing', () => {
    expect(() => adaptGoogleScoringFacts([
      googleFact({
        metrics: [
          metric('CLICKS', 2),
          metric('IMPRESSIONS', 20),
          metric('GOOGLE_SEARCH_CONSOLE_POSITION', 8)
        ]
      })
    ], selected)).toThrow('GROWTH_SEARCH_SCORING_METRIC_MISSING');
  });

  it('keeps a non-present Google position unknown instead of converting it to zero', () => {
    expect(() => adaptGoogleScoringFacts([
      googleFact({
        metrics: [
          metric('CLICKS', 2),
          metric('IMPRESSIONS', 20),
          metric('CTR', 0.1),
          metric('GOOGLE_SEARCH_CONSOLE_POSITION', null, 'UNKNOWN')
        ]
      })
    ], selected)).toThrow('GROWTH_SEARCH_SCORING_METRIC_UNKNOWN');
  });

  it('does not substitute a Bing position semantic for missing Google position', () => {
    expect(() => adaptGoogleScoringFacts([
      googleFact({
        metrics: [
          metric('CLICKS', 2),
          metric('IMPRESSIONS', 20),
          metric('CTR', 0.1),
          metric('BING_AVG_IMPRESSION_POSITION', 8)
        ]
      })
    ], selected)).toThrow('GROWTH_SEARCH_SCORING_METRIC_MISSING');
  });

  it('deduplicates identical market projections of the same raw observation', () => {
    const globalProjection = googleFact();
    const hkProjection = googleFact({
      snapshotId: 'normalized-hk',
      marketCode: 'HK',
      locale: 'zh-Hant'
    });

    expect(adaptGoogleScoringFacts([
      hkProjection,
      globalProjection
    ], selected)).toEqual([
      {
        date: new Date('2026-07-31T00:00:00.000Z'),
        normalizedQuery: '六壬',
        canonicalPage: 'https://example.com/guide',
        clicks: 2,
        impressions: 20,
        ctr: 0.1,
        position: 8
      }
    ]);
  });

  it('rejects divergent market projections of the same raw observation', () => {
    const first = googleFact();
    const divergent = googleFact({
      snapshotId: 'normalized-hk',
      marketCode: 'HK',
      locale: 'zh-Hant',
      metrics: [
        metric('CLICKS', 3),
        metric('IMPRESSIONS', 20),
        metric('CTR', 0.15),
        metric('GOOGLE_SEARCH_CONSOLE_POSITION', 8)
      ]
    });

    expect(() => adaptGoogleScoringFacts([
      first,
      divergent
    ], selected)).toThrow('GROWTH_SEARCH_SOURCE_CONFLICT');
  });

  it('rejects Google facts that do not trace to the selected authoritative GSC snapshot set', () => {
    expect(() => adaptGoogleScoringFacts([
      googleFact({ sourceRef: 'gsc-snapshot-not-selected' })
    ], selected)).toThrow('GROWTH_SEARCH_SOURCE_MISMATCH');
  });
});
