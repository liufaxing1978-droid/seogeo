import type { MarketCode } from '@prisma/client';
import type { SearchProviderCode } from '../search-providers/search-provider.types.js';

export const SEARCH_FACT_NORMALIZATION_VERSION = 'SEARCH_FACT_NORMALIZATION_V1' as const;

export const SEARCH_FACT_KINDS = Object.freeze([
  'QUERY_PAGE',
  'QUERY',
  'PAGE',
  'SITE'
] as const);

export const SEARCH_FACT_SOURCE_KINDS = Object.freeze([
  'GSC_DAILY_SNAPSHOT',
  'PROVIDER_OBSERVATION_BATCH'
] as const);

export const SEARCH_FACT_METRIC_SEMANTICS = Object.freeze([
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION',
  'BING_AVG_CLICK_POSITION',
  'BING_AVG_IMPRESSION_POSITION'
] as const);

export const SEARCH_FACT_EVIDENCE_STATES = Object.freeze([
  'KNOWN_PRESENT',
  'KNOWN_EMPTY',
  'UNKNOWN',
  'NOT_SUPPORTED'
] as const);

export const SEARCH_FACT_COMPLETENESS = Object.freeze([
  'COMPLETE',
  'TOP_ROWS_ONLY',
  'PROVIDER_UNSPECIFIED',
  'UNKNOWN'
] as const);

export type SearchFactProviderCode = SearchProviderCode;
export type SearchFactKind = (typeof SEARCH_FACT_KINDS)[number];
export type SearchFactSourceKind = (typeof SEARCH_FACT_SOURCE_KINDS)[number];
export type SearchFactMetricSemantic = (typeof SEARCH_FACT_METRIC_SEMANTICS)[number];
export type SearchFactEvidenceState = (typeof SEARCH_FACT_EVIDENCE_STATES)[number];
export type SearchFactCompleteness = (typeof SEARCH_FACT_COMPLETENESS)[number];

export type NormalizedSearchMetricDraft = {
  metricSemantic: SearchFactMetricSemantic;
  numericValue: number | null;
  evidenceState: SearchFactEvidenceState;
  sourceField: string;
};

export type NormalizedSearchFactDraft = {
  factKey: string;
  factKind: SearchFactKind;
  sourceObservationRef: string;
  sourceDate: Date;
  query: string | null;
  normalizedQuery: string | null;
  queryNormalizationVersion: string | null;
  page: string | null;
  canonicalPage: string | null;
  canonicalizationVersion: string | null;
  metrics: readonly NormalizedSearchMetricDraft[];
};

export type SearchFactMaterializeIdentity = {
  projectId: string;
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceKind: SearchFactSourceKind;
  sourceRef: string;
  sourceCutoffAt: Date;
  sourceCompleteness: SearchFactCompleteness;
  normalizationVersion: string;
};

export type SearchFactReadFilter = {
  projectId: string;
  provider?: SearchFactProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
  factKind?: SearchFactKind;
  metricSemantic?: SearchFactMetricSemantic;
  canonicalPage?: string;
  normalizedQuery?: string;
  sourceDateFrom?: Date;
  sourceDateTo?: Date;
};

export type SearchFactSnapshotReadFilter = {
  projectId: string;
  provider?: SearchFactProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
  sourceCutoffFrom?: Date;
  sourceCutoffTo?: Date;
};

export type SearchFactSnapshotView = {
  snapshotId: string;
  projectId: string;
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceKind: SearchFactSourceKind;
  sourceRef: string;
  sourceCutoffAt: Date;
  sourceCompleteness: SearchFactCompleteness;
  normalizationVersion: string;
  factCount: number;
  completedAt: Date;
};

export type SearchFactMetricView = {
  metricSemantic: SearchFactMetricSemantic;
  numericValue: number | null;
  evidenceState: SearchFactEvidenceState;
  sourceField: string;
};

export type SearchFactView = {
  snapshotId: string;
  projectId: string;
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceKind: SearchFactSourceKind;
  sourceRef: string;
  sourceObservationRef: string;
  sourceCutoffAt: Date;
  sourceCompleteness: SearchFactCompleteness;
  normalizationVersion: string;
  factKey: string;
  factKind: SearchFactKind;
  sourceDate: Date;
  query: string | null;
  normalizedQuery: string | null;
  queryNormalizationVersion: string | null;
  page: string | null;
  canonicalPage: string | null;
  canonicalizationVersion: string | null;
  metrics: SearchFactMetricView[];
};