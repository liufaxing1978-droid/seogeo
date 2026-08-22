import type {
  NormalizedSearchFactDraft,
  NormalizedSearchMetricDraft
} from '../search-fact.types.js';

export const SEARCH_FACT_QUERY_NORMALIZATION_VERSION =
  'SEARCH_FACT_QUERY_NORMALIZATION_V1' as const;
export const SEARCH_FACT_PAGE_CANONICALIZATION_VERSION =
  'SEARCH_FACT_PAGE_CANONICALIZATION_V1' as const;

type BingSearchObservationSource = {
  id: string;
  sourceDate: Date;
  observationKind: string;
  observationKey: string;
  completeness: string;
  payloadJson: unknown;
};

type JsonRecord = Record<string, unknown>;

const INVALID_SOURCE = 'SEARCH_FACT_INVALID_BING_SOURCE';
const INVALID_METRIC = 'SEARCH_FACT_INVALID_BING_METRIC';

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (record: JsonRecord, allowedKeys: readonly string[]): void => {
  const allowed = new Set(allowedKeys);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error(INVALID_SOURCE);
  }
};

const assertFiniteNonNegative = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(INVALID_METRIC);
  }
  return value;
};

const normalizeOptionalPosition = (
  value: unknown,
  metricSemantic: 'BING_AVG_CLICK_POSITION' | 'BING_AVG_IMPRESSION_POSITION',
  sourceField: 'avgClickPosition' | 'avgImpressionPosition'
): NormalizedSearchMetricDraft => {
  if (value === null) {
    return {
      metricSemantic,
      numericValue: null,
      evidenceState: 'UNKNOWN',
      sourceField
    };
  }

  return {
    metricSemantic,
    numericValue: assertFiniteNonNegative(value),
    evidenceState: 'KNOWN_PRESENT',
    sourceField
  };
};

const normalizeQuery = (query: string): string => {
  const normalized = query
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (normalized.length === 0) {
    throw new Error(INVALID_SOURCE);
  }
  return normalized;
};

const canonicalizePage = (page: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(page);
  } catch {
    throw new Error(INVALID_SOURCE);
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw new Error(INVALID_SOURCE);
  }

  parsed.hash = '';
  return parsed.toString();
};

const assertSourceEnvelope = (source: BingSearchObservationSource): JsonRecord => {
  if (
    typeof source.id !== 'string' ||
    source.id.trim().length === 0 ||
    typeof source.observationKey !== 'string' ||
    source.observationKey.trim().length === 0 ||
    !(source.sourceDate instanceof Date) ||
    Number.isNaN(source.sourceDate.getTime()) ||
    source.completeness !== 'PROVIDER_UNSPECIFIED' ||
    !isRecord(source.payloadJson)
  ) {
    throw new Error(INVALID_SOURCE);
  }

  const payload = source.payloadJson;
  if (
    payload.provider !== 'BING_WEBMASTER' ||
    payload.kind !== source.observationKind ||
    payload.completeness !== 'PROVIDER_UNSPECIFIED' ||
    typeof payload.sourceDate !== 'string' ||
    payload.sourceDate !== source.sourceDate.toISOString().slice(0, 10)
  ) {
    throw new Error(INVALID_SOURCE);
  }

  return payload;
};

const baseMetrics = (payload: JsonRecord): NormalizedSearchMetricDraft[] => [
  {
    metricSemantic: 'CLICKS',
    numericValue: assertFiniteNonNegative(payload.clicks),
    evidenceState: 'KNOWN_PRESENT',
    sourceField: 'clicks'
  },
  {
    metricSemantic: 'IMPRESSIONS',
    numericValue: assertFiniteNonNegative(payload.impressions),
    evidenceState: 'KNOWN_PRESENT',
    sourceField: 'impressions'
  }
];

export const normalizeBingSearchObservation = (
  source: BingSearchObservationSource
): NormalizedSearchFactDraft => {
  const payload = assertSourceEnvelope(source);

  if (source.observationKind === 'QUERY_STATS') {
    assertExactKeys(payload, [
      'kind',
      'provider',
      'sourceDate',
      'query',
      'clicks',
      'impressions',
      'avgClickPosition',
      'avgImpressionPosition',
      'completeness'
    ]);
    if (typeof payload.query !== 'string' || payload.query.length === 0) {
      throw new Error(INVALID_SOURCE);
    }

    return {
      factKey: source.observationKey,
      factKind: 'QUERY',
      sourceObservationRef: source.id,
      sourceDate: source.sourceDate,
      query: payload.query,
      normalizedQuery: normalizeQuery(payload.query),
      queryNormalizationVersion: SEARCH_FACT_QUERY_NORMALIZATION_VERSION,
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null,
      metrics: [
        ...baseMetrics(payload),
        normalizeOptionalPosition(
          payload.avgClickPosition,
          'BING_AVG_CLICK_POSITION',
          'avgClickPosition'
        ),
        normalizeOptionalPosition(
          payload.avgImpressionPosition,
          'BING_AVG_IMPRESSION_POSITION',
          'avgImpressionPosition'
        )
      ]
    };
  }

  if (source.observationKind === 'PAGE_STATS') {
    assertExactKeys(payload, [
      'kind',
      'provider',
      'sourceDate',
      'page',
      'clicks',
      'impressions',
      'avgClickPosition',
      'avgImpressionPosition',
      'completeness'
    ]);
    if (typeof payload.page !== 'string' || payload.page.length === 0) {
      throw new Error(INVALID_SOURCE);
    }

    return {
      factKey: source.observationKey,
      factKind: 'PAGE',
      sourceObservationRef: source.id,
      sourceDate: source.sourceDate,
      query: null,
      normalizedQuery: null,
      queryNormalizationVersion: null,
      page: payload.page,
      canonicalPage: canonicalizePage(payload.page),
      canonicalizationVersion: SEARCH_FACT_PAGE_CANONICALIZATION_VERSION,
      metrics: [
        ...baseMetrics(payload),
        normalizeOptionalPosition(
          payload.avgClickPosition,
          'BING_AVG_CLICK_POSITION',
          'avgClickPosition'
        ),
        normalizeOptionalPosition(
          payload.avgImpressionPosition,
          'BING_AVG_IMPRESSION_POSITION',
          'avgImpressionPosition'
        )
      ]
    };
  }

  if (source.observationKind === 'SITE_TRAFFIC_DAILY') {
    assertExactKeys(payload, [
      'kind',
      'provider',
      'sourceDate',
      'clicks',
      'impressions',
      'completeness'
    ]);

    return {
      factKey: source.observationKey,
      factKind: 'SITE',
      sourceObservationRef: source.id,
      sourceDate: source.sourceDate,
      query: null,
      normalizedQuery: null,
      queryNormalizationVersion: null,
      page: null,
      canonicalPage: null,
      canonicalizationVersion: null,
      metrics: baseMetrics(payload)
    };
  }

  throw new Error(INVALID_SOURCE);
};
