import type { MarketCode } from '@prisma/client';
import type {
  SearchFactCompleteness,
  SearchFactKind,
  SearchFactMetricSemantic,
  SearchFactProviderCode,
  SearchFactView
} from '../search-facts/search-fact.types.js';
import type { QueryPageFactLike } from './growth.types.js';

export const GROWTH_SEARCH_PROVENANCE_VERSION =
  'GROWTH_SEARCH_PROVENANCE_V1' as const;

export type GrowthSearchSourceMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY';

export type GrowthSearchMarketProjection = {
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
};

export type GrowthSearchCorroboratingLane = {
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  factKinds: SearchFactKind[];
  snapshotIds: string[];
  sourceCompleteness: SearchFactCompleteness[];
};

export type GrowthSearchConfiguredProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'CONFIGURED_MARKET';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    factKind: 'QUERY_PAGE';
    snapshotIds: string[];
    sourceRefs: string[];
    marketProjections: GrowthSearchMarketProjection[];
  };
  corroboratingLanes: GrowthSearchCorroboratingLane[];
};

export type GrowthSearchLegacyProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'UNCONFIGURED_LEGACY';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    source: 'RAW_GSC_COMPATIBILITY';
    gscSnapshotIds: string[];
  };
  corroboratingLanes: [];
};

export type GrowthSearchProvenanceV1 =
  | GrowthSearchConfiguredProvenance
  | GrowthSearchLegacyProvenance;

export type GrowthSearchSourceInput = {
  projectId: string;
  propertyId: string;
  selectedGscSnapshotIds: readonly string[];
  sourceDateFrom: Date;
  sourceDateTo: Date;
};

export type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};

const REQUIRED_GOOGLE_METRICS = [
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION'
] as const satisfies readonly SearchFactMetricSemantic[];

type RequiredGoogleMetric = (typeof REQUIRED_GOOGLE_METRICS)[number];

type ScoringCandidate = {
  identity: string;
  signature: string;
  row: QueryPageFactLike;
};

function sourceMismatch(): never {
  throw new Error('GROWTH_SEARCH_SOURCE_MISMATCH');
}

function requiredMetric(
  fact: SearchFactView,
  semantic: RequiredGoogleMetric
): number {
  const rows = fact.metrics.filter((metric) => metric.metricSemantic === semantic);
  if (rows.length === 0) {
    throw new Error('GROWTH_SEARCH_SCORING_METRIC_MISSING');
  }
  if (rows.length !== 1) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }

  const metric = rows[0]!;
  if (metric.evidenceState !== 'KNOWN_PRESENT' || metric.numericValue === null) {
    throw new Error('GROWTH_SEARCH_SCORING_METRIC_UNKNOWN');
  }

  const value = metric.numericValue;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }
  if (semantic === 'CTR' && value > 1) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }
  return value;
}

function scoringCandidate(
  fact: SearchFactView,
  selectedGscSnapshotIds: ReadonlySet<string>
): ScoringCandidate {
  if (
    fact.provider !== 'GOOGLE_SEARCH_CONSOLE' ||
    fact.factKind !== 'QUERY_PAGE' ||
    fact.sourceKind !== 'GSC_DAILY_SNAPSHOT' ||
    !selectedGscSnapshotIds.has(fact.sourceRef) ||
    fact.sourceObservationRef.trim().length === 0 ||
    fact.factKey.trim().length === 0 ||
    fact.normalizedQuery === null ||
    fact.normalizedQuery.trim().length === 0 ||
    fact.canonicalPage === null ||
    fact.canonicalPage.trim().length === 0 ||
    fact.queryNormalizationVersion === null ||
    fact.queryNormalizationVersion.trim().length === 0 ||
    fact.canonicalizationVersion === null ||
    fact.canonicalizationVersion.trim().length === 0 ||
    Number.isNaN(fact.sourceDate.getTime())
  ) {
    sourceMismatch();
  }

  const clicks = requiredMetric(fact, 'CLICKS');
  const impressions = requiredMetric(fact, 'IMPRESSIONS');
  const ctr = requiredMetric(fact, 'CTR');
  const position = requiredMetric(fact, 'GOOGLE_SEARCH_CONSOLE_POSITION');

  const metrics = [
    ['CLICKS', clicks],
    ['CTR', ctr],
    ['GOOGLE_SEARCH_CONSOLE_POSITION', position],
    ['IMPRESSIONS', impressions]
  ] as const;

  const identity = JSON.stringify([
    fact.sourceObservationRef,
    fact.sourceDate.toISOString(),
    fact.factKey
  ]);
  const signature = JSON.stringify({
    sourceRef: fact.sourceRef,
    sourceDate: fact.sourceDate.toISOString(),
    factKey: fact.factKey,
    normalizedQuery: fact.normalizedQuery,
    canonicalPage: fact.canonicalPage,
    queryNormalizationVersion: fact.queryNormalizationVersion,
    canonicalizationVersion: fact.canonicalizationVersion,
    metrics
  });

  return {
    identity,
    signature,
    row: {
      date: fact.sourceDate,
      normalizedQuery: fact.normalizedQuery,
      canonicalPage: fact.canonicalPage,
      clicks,
      impressions,
      ctr,
      position
    }
  };
}

export function adaptGoogleScoringFacts(
  facts: readonly SearchFactView[],
  selectedGscSnapshotIds: ReadonlySet<string>
): QueryPageFactLike[] {
  if (selectedGscSnapshotIds.size === 0) {
    throw new Error('GROWTH_SEARCH_SOURCE_MISMATCH');
  }

  const byRawObservation = new Map<string, ScoringCandidate>();
  for (const fact of facts) {
    const candidate = scoringCandidate(fact, selectedGscSnapshotIds);
    const existing = byRawObservation.get(candidate.identity);
    if (existing && existing.signature !== candidate.signature) {
      throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
    }
    if (!existing) byRawObservation.set(candidate.identity, candidate);
  }

  return [...byRawObservation.values()]
    .sort((left, right) =>
      left.row.date instanceof Date && right.row.date instanceof Date
        ? left.row.date.getTime() - right.row.date.getTime() ||
          left.row.normalizedQuery.localeCompare(right.row.normalizedQuery) ||
          left.row.canonicalPage.localeCompare(right.row.canonicalPage) ||
          left.identity.localeCompare(right.identity)
        : left.identity.localeCompare(right.identity)
    )
    .map((candidate) => candidate.row);
}
