import type { NormalizedSearchFactDraft } from '../search-fact.types.js';

export const GSC_PERSISTED_CANONICALIZATION_VERSION =
  'GSC_PERSISTED_CANONICAL_PAGE_V1' as const;

export type GoogleSearchFactSource = {
  id: string;
  date: Date;
  factKey: string;
  query: string;
  normalizedQuery: string;
  normalizationVersion: string;
  page: string;
  canonicalPage: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

const assertFiniteNonNegative = (value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('SEARCH_FACT_INVALID_GOOGLE_METRIC');
  }
};

const assertSourceIdentity = (source: GoogleSearchFactSource): void => {
  if (
    source.id.trim().length === 0 ||
    source.factKey.trim().length === 0 ||
    source.normalizationVersion.trim().length === 0 ||
    source.normalizedQuery.trim().length === 0 ||
    source.page.trim().length === 0 ||
    source.canonicalPage.trim().length === 0 ||
    Number.isNaN(source.date.getTime())
  ) {
    throw new Error('SEARCH_FACT_INVALID_GOOGLE_SOURCE');
  }
};

export const normalizeGoogleSearchFact = (
  source: GoogleSearchFactSource
): NormalizedSearchFactDraft => {
  assertSourceIdentity(source);
  assertFiniteNonNegative(source.clicks);
  assertFiniteNonNegative(source.impressions);
  assertFiniteNonNegative(source.position);
  if (!Number.isFinite(source.ctr) || source.ctr < 0 || source.ctr > 1) {
    throw new Error('SEARCH_FACT_INVALID_GOOGLE_METRIC');
  }

  return {
    factKey: source.factKey,
    factKind: 'QUERY_PAGE',
    sourceObservationRef: source.id,
    sourceDate: source.date,
    query: source.query,
    normalizedQuery: source.normalizedQuery,
    queryNormalizationVersion: source.normalizationVersion,
    page: source.page,
    canonicalPage: source.canonicalPage,
    canonicalizationVersion: GSC_PERSISTED_CANONICALIZATION_VERSION,
    metrics: [
      {
        metricSemantic: 'CLICKS',
        numericValue: source.clicks,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'clicks'
      },
      {
        metricSemantic: 'IMPRESSIONS',
        numericValue: source.impressions,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'impressions'
      },
      {
        metricSemantic: 'CTR',
        numericValue: source.ctr,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'ctr'
      },
      {
        metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
        numericValue: source.position,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'position'
      }
    ]
  };
};
