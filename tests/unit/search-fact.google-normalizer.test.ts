import { describe, expect, it } from 'vitest';
import {
  GSC_PERSISTED_CANONICALIZATION_VERSION,
  normalizeGoogleSearchFact
} from '../../src/modules/search-facts/normalizers/google-search-fact.normalizer.js';

describe('P9-0F Google search fact normalizer', () => {
  it('preserves persisted GSC query/page normalization and maps explicit metrics without reinterpretation', () => {
    const source = {
      id: '11111111-1111-4111-8111-111111111111',
      date: new Date('2026-08-20T00:00:00.000Z'),
      factKey: 'source-fact-key',
      query: '  兴善堂  ',
      normalizedQuery: 'persisted-normalized-query',
      normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://example.com/liuren?ref=source',
      canonicalPage: 'https://example.com/persisted-canonical',
      clicks: 7,
      impressions: 100,
      ctr: 0.07,
      position: 4.2
    };

    const result = normalizeGoogleSearchFact(source);

    expect(GSC_PERSISTED_CANONICALIZATION_VERSION).toBe(
      'GSC_PERSISTED_CANONICAL_PAGE_V1'
    );
    expect(result).toMatchObject({
      factKey: 'source-fact-key',
      factKind: 'QUERY_PAGE',
      sourceObservationRef: source.id,
      sourceDate: source.date,
      query: '  兴善堂  ',
      normalizedQuery: 'persisted-normalized-query',
      queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://example.com/liuren?ref=source',
      canonicalPage: 'https://example.com/persisted-canonical',
      canonicalizationVersion: 'GSC_PERSISTED_CANONICAL_PAGE_V1'
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
        numericValue: 100,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'impressions'
      },
      {
        metricSemantic: 'CTR',
        numericValue: 0.07,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'ctr'
      },
      {
        metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
        numericValue: 4.2,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'position'
      }
    ]);
  });

  it('rejects malformed provider metrics instead of fabricating normalized values', () => {
    expect(() =>
      normalizeGoogleSearchFact({
        id: '22222222-2222-4222-8222-222222222222',
        date: new Date('2026-08-20T00:00:00.000Z'),
        factKey: 'invalid-metric',
        query: 'query',
        normalizedQuery: 'query',
        normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
        page: 'https://example.com/',
        canonicalPage: 'https://example.com/',
        clicks: 1,
        impressions: 10,
        ctr: 1.5,
        position: 2
      })
    ).toThrow('SEARCH_FACT_INVALID_GOOGLE_METRIC');
  });
});
