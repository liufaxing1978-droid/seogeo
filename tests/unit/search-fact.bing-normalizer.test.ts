import { describe, expect, it } from 'vitest';
import {
  SEARCH_FACT_PAGE_CANONICALIZATION_VERSION,
  SEARCH_FACT_QUERY_NORMALIZATION_VERSION,
  normalizeBingSearchObservation
} from '../../src/modules/search-facts/normalizers/bing-search-fact.normalizer.js';

const baseRecord = {
  batchId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  sourceDate: new Date('2026-08-20T00:00:00.000Z'),
  completeness: 'PROVIDER_UNSPECIFIED' as const,
  inputHash: 'hash',
  createdAt: new Date('2026-08-21T00:00:00.000Z')
};

describe('P9-0F Bing search fact normalizer', () => {
  it('maps QUERY_STATS to QUERY and keeps nullable Bing positions UNKNOWN without fabricating CTR', () => {
    const source = {
      ...baseRecord,
      id: '33333333-3333-4333-8333-333333333333',
      observationKind: 'QUERY_STATS',
      observationKey: 'query-key',
      payloadJson: {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        query: '  Ｘｉｎｇ “Shan” — Tang  ',
        clicks: 7,
        impressions: 120,
        avgClickPosition: null,
        avgImpressionPosition: null,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    };

    const result = normalizeBingSearchObservation(source);

    expect(SEARCH_FACT_QUERY_NORMALIZATION_VERSION).toBe(
      'SEARCH_FACT_QUERY_NORMALIZATION_V1'
    );
    expect(result).toMatchObject({
      factKey: 'query-key',
      factKind: 'QUERY',
      sourceObservationRef: source.id,
      sourceDate: baseRecord.sourceDate,
      query: '  Ｘｉｎｇ “Shan” — Tang  ',
      normalizedQuery: 'xing "shan" - tang',
      queryNormalizationVersion: 'SEARCH_FACT_QUERY_NORMALIZATION_V1',
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null
    });
    expect(result.metrics).toEqual([
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
        metricSemantic: 'BING_AVG_CLICK_POSITION',
        numericValue: null,
        evidenceState: 'UNKNOWN',
        sourceField: 'avgClickPosition'
      },
      {
        metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
        numericValue: null,
        evidenceState: 'UNKNOWN',
        sourceField: 'avgImpressionPosition'
      }
    ]);
    expect(result.metrics.some((metric) => metric.metricSemantic === 'CTR')).toBe(false);
    expect(
      result.metrics.some(
        (metric) => metric.metricSemantic === 'GOOGLE_SEARCH_CONSOLE_POSITION'
      )
    ).toBe(false);
  });

  it('maps PAGE_STATS to PAGE and canonicalizes only the supplied page dimension', () => {
    const source = {
      ...baseRecord,
      id: '44444444-4444-4444-8444-444444444444',
      observationKind: 'PAGE_STATS',
      observationKey: 'page-key',
      payloadJson: {
        kind: 'PAGE_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        page: 'https://Example.com/path?q=1#section',
        clicks: 13,
        impressions: 240,
        avgClickPosition: 2.4,
        avgImpressionPosition: 4.8,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    };

    const result = normalizeBingSearchObservation(source);

    expect(SEARCH_FACT_PAGE_CANONICALIZATION_VERSION).toBe(
      'SEARCH_FACT_PAGE_CANONICALIZATION_V1'
    );
    expect(result).toMatchObject({
      factKey: 'page-key',
      factKind: 'PAGE',
      query: null,
      normalizedQuery: null,
      queryNormalizationVersion: null,
      page: 'https://Example.com/path?q=1#section',
      canonicalPage: 'https://example.com/path?q=1',
      canonicalizationVersion: 'SEARCH_FACT_PAGE_CANONICALIZATION_V1'
    });
    expect(result.metrics).toContainEqual({
      metricSemantic: 'BING_AVG_CLICK_POSITION',
      numericValue: 2.4,
      evidenceState: 'KNOWN_PRESENT',
      sourceField: 'avgClickPosition'
    });
    expect(result.metrics).toContainEqual({
      metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
      numericValue: 4.8,
      evidenceState: 'KNOWN_PRESENT',
      sourceField: 'avgImpressionPosition'
    });
  });

  it('maps SITE_TRAFFIC_DAILY to SITE without fabricating query, page, CTR, or position metrics', () => {
    const source = {
      ...baseRecord,
      id: '55555555-5555-4555-8555-555555555555',
      observationKind: 'SITE_TRAFFIC_DAILY',
      observationKey: 'site-key',
      payloadJson: {
        kind: 'SITE_TRAFFIC_DAILY',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        clicks: 31,
        impressions: 901,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    };

    const result = normalizeBingSearchObservation(source);

    expect(result).toMatchObject({
      factKey: 'site-key',
      factKind: 'SITE',
      query: null,
      normalizedQuery: null,
      page: null,
      canonicalPage: null
    });
    expect(result.metrics.map((metric) => metric.metricSemantic)).toEqual([
      'CLICKS',
      'IMPRESSIONS'
    ]);
  });

  it('rejects malformed or credential-bearing persisted payloads instead of normalizing them', () => {
    expect(() =>
      normalizeBingSearchObservation({
        ...baseRecord,
        id: '66666666-6666-4666-8666-666666666666',
        observationKind: 'PAGE_STATS',
        observationKey: 'unsafe-page',
        payloadJson: {
          kind: 'PAGE_STATS',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-20',
          page: 'https://user:password@example.com/',
          clicks: 1,
          impressions: 2,
          avgClickPosition: null,
          avgImpressionPosition: null,
          completeness: 'PROVIDER_UNSPECIFIED'
        }
      })
    ).toThrow('SEARCH_FACT_INVALID_BING_SOURCE');
  });
});
