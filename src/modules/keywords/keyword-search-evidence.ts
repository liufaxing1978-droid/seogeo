import type { MarketCode } from '@prisma/client';
import {
  listSearchProviderManifests,
} from '../search-providers/search-provider.registry.js';
import type {
  CapabilityState,
  SearchProviderAccessMode,
  SearchProviderCode,
} from '../search-providers/search-provider.types.js';
import type {
  SearchFactCompleteness,
  SearchFactMetricSemantic,
  SearchFactView,
} from '../search-facts/search-fact.types.js';
import { normalizeSearchEvidenceQuery } from './keyword-search-evidence-normalize.js';

export type KeywordSearchEvidenceState =
  | 'OBSERVED'
  | 'NOT_OBSERVED'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export type KeywordSearchEvidenceMetrics = {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  searchConsoleAveragePosition: number | null;
  bingAverageClickPosition: number | null;
  bingAverageImpressionPosition: number | null;
};

export type KeywordSearchEvidenceLaneSource = {
  provider: SearchProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceCompleteness: SearchFactCompleteness[];
  snapshotIds: string[];
  latestAvailableSourceDate: string | null;
};

export type KeywordSearchEvidenceMatchedPage = {
  canonicalPage: string;
  clicks: number;
  impressions: number;
  averagePosition: number | null;
};

export type KeywordSearchEvidenceRealLane = {
  kind: 'LANE';
  provider: SearchProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  state: 'OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN';
  capabilityState: 'SUPPORTED';
  sourceCompleteness: SearchFactCompleteness[];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: string | null;
  latestAvailableSourceDate: string | null;
  snapshotIds: string[];
  metrics: KeywordSearchEvidenceMetrics;
  matchedPages: KeywordSearchEvidenceMatchedPage[];
  reason: string;
};

export type KeywordSearchEvidenceProviderProjection = {
  kind: 'PROVIDER';
  provider: SearchProviderCode;
  marketCode: null;
  locale: null;
  propertyRef: null;
  propertyType: null;
  state: 'UNKNOWN' | 'UNAVAILABLE';
  capabilityState: CapabilityState;
  accessMode: SearchProviderAccessMode;
  sourceCompleteness: [];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: null;
  latestAvailableSourceDate: null;
  snapshotIds: [];
  metrics: KeywordSearchEvidenceMetrics;
  matchedPages: [];
  reason: string;
};

export type KeywordSearchEvidenceItem =
  | KeywordSearchEvidenceRealLane
  | KeywordSearchEvidenceProviderProjection;

const NULL_METRICS: KeywordSearchEvidenceMetrics = Object.freeze({
  clicks: null,
  impressions: null,
  ctr: null,
  searchConsoleAveragePosition: null,
  bingAverageClickPosition: null,
  bingAverageImpressionPosition: null,
});

function metricValue(
  fact: SearchFactView,
  semantic: SearchFactMetricSemantic,
): number | null {
  const metric = fact.metrics.find((item) => item.metricSemantic === semantic);
  return metric?.evidenceState === 'KNOWN_PRESENT' && metric.numericValue !== null
    ? metric.numericValue
    : null;
}

function sumKnown(
  facts: readonly SearchFactView[],
  semantic: SearchFactMetricSemantic,
): number | null {
  let sum = 0;
  let count = 0;
  for (const fact of facts) {
    const value = metricValue(fact, semantic);
    if (value === null) continue;
    sum += value;
    count += 1;
  }
  return count > 0 ? sum : null;
}

function weightedMean(
  facts: readonly SearchFactView[],
  valueSemantic: SearchFactMetricSemantic,
  weightSemantic: SearchFactMetricSemantic,
): number | null {
  let weighted = 0;
  let weightTotal = 0;
  for (const fact of facts) {
    const value = metricValue(fact, valueSemantic);
    const weight = metricValue(fact, weightSemantic);
    if (value === null || weight === null || weight <= 0) continue;
    weighted += value * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weighted / weightTotal : null;
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function latestMatchingSourceDate(facts: readonly SearchFactView[]): string | null {
  if (facts.length === 0) return null;
  return facts
    .map((fact) => isoDay(fact.sourceDate))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function stateWithoutMatch(
  sourceCompleteness: readonly SearchFactCompleteness[],
): 'NOT_OBSERVED' | 'UNKNOWN' {
  return sourceCompleteness.length > 0
    && sourceCompleteness.every((value) => value === 'COMPLETE')
    ? 'NOT_OBSERVED'
    : 'UNKNOWN';
}

function emptyReason(state: 'NOT_OBSERVED' | 'UNKNOWN'): string {
  return state === 'NOT_OBSERVED'
    ? 'COMPLETE_QUERY_EVIDENCE_NO_MATCH'
    : 'INCOMPLETE_QUERY_EVIDENCE_NO_MATCH';
}

function aggregateGooglePages(
  facts: readonly SearchFactView[],
): KeywordSearchEvidenceMatchedPage[] {
  const grouped = new Map<string, SearchFactView[]>();
  for (const fact of facts) {
    if (!fact.canonicalPage) continue;
    const rows = grouped.get(fact.canonicalPage) ?? [];
    rows.push(fact);
    grouped.set(fact.canonicalPage, rows);
  }

  return [...grouped.entries()]
    .map(([canonicalPage, rows]) => ({
      canonicalPage,
      clicks: sumKnown(rows, 'CLICKS') ?? 0,
      impressions: sumKnown(rows, 'IMPRESSIONS') ?? 0,
      averagePosition: weightedMean(
        rows,
        'GOOGLE_SEARCH_CONSOLE_POSITION',
        'IMPRESSIONS',
      ),
    }))
    .sort((left, right) =>
      right.impressions - left.impressions
      || right.clicks - left.clicks
      || left.canonicalPage.localeCompare(right.canonicalPage));
}

function googleMetrics(
  facts: readonly SearchFactView[],
): KeywordSearchEvidenceMetrics {
  const clicks = sumKnown(facts, 'CLICKS');
  const impressions = sumKnown(facts, 'IMPRESSIONS');
  return {
    clicks,
    impressions,
    ctr: clicks !== null && impressions !== null && impressions > 0
      ? clicks / impressions
      : null,
    searchConsoleAveragePosition: weightedMean(
      facts,
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'IMPRESSIONS',
    ),
    bingAverageClickPosition: null,
    bingAverageImpressionPosition: null,
  };
}

function bingMetrics(
  facts: readonly SearchFactView[],
): KeywordSearchEvidenceMetrics {
  return {
    clicks: sumKnown(facts, 'CLICKS'),
    impressions: sumKnown(facts, 'IMPRESSIONS'),
    ctr: null,
    searchConsoleAveragePosition: null,
    bingAverageClickPosition: weightedMean(
      facts,
      'BING_AVG_CLICK_POSITION',
      'CLICKS',
    ),
    bingAverageImpressionPosition: weightedMean(
      facts,
      'BING_AVG_IMPRESSION_POSITION',
      'IMPRESSIONS',
    ),
  };
}

function isQueryFactForProvider(
  provider: SearchProviderCode,
  fact: SearchFactView,
): boolean {
  if (provider === 'GOOGLE_SEARCH_CONSOLE') return fact.factKind === 'QUERY_PAGE';
  if (provider === 'BING_WEBMASTER') return fact.factKind === 'QUERY';
  return false;
}

export function aggregateKeywordSearchEvidenceLane(input: {
  normalizedKeyword: string;
  lane: KeywordSearchEvidenceLaneSource;
  facts: SearchFactView[];
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceRealLane {
  const matchingFacts = input.facts.filter((fact) =>
    fact.provider === input.lane.provider
    && fact.marketCode === input.lane.marketCode
    && fact.locale === input.lane.locale
    && fact.propertyRef === input.lane.propertyRef
    && isQueryFactForProvider(input.lane.provider, fact)
    && fact.query !== null
    && normalizeSearchEvidenceQuery(fact.query) === input.normalizedKeyword);

  const state = matchingFacts.length > 0
    ? 'OBSERVED'
    : stateWithoutMatch(input.lane.sourceCompleteness);

  const metrics = state === 'OBSERVED'
    ? input.lane.provider === 'GOOGLE_SEARCH_CONSOLE'
      ? googleMetrics(matchingFacts)
      : input.lane.provider === 'BING_WEBMASTER'
        ? bingMetrics(matchingFacts)
        : { ...NULL_METRICS }
    : { ...NULL_METRICS };

  return {
    kind: 'LANE',
    provider: input.lane.provider,
    marketCode: input.lane.marketCode,
    locale: input.lane.locale,
    propertyRef: input.lane.propertyRef,
    propertyType: input.lane.propertyType,
    state,
    capabilityState: 'SUPPORTED',
    sourceCompleteness: [...new Set(input.lane.sourceCompleteness)].sort(),
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    latestSourceDate: latestMatchingSourceDate(matchingFacts),
    latestAvailableSourceDate: input.lane.latestAvailableSourceDate,
    snapshotIds: [...new Set(input.lane.snapshotIds)].sort(),
    metrics,
    matchedPages: state === 'OBSERVED'
      && input.lane.provider === 'GOOGLE_SEARCH_CONSOLE'
      ? aggregateGooglePages(matchingFacts)
      : [],
    reason: state === 'OBSERVED'
      ? 'MATCHING_QUERY_EVIDENCE'
      : emptyReason(state),
  };
}

function queryCapabilityFor(provider: SearchProviderCode) {
  const manifest = listSearchProviderManifests()
    .find((item) => item.provider === provider);
  if (!manifest) return null;
  const descriptor = provider === 'GOOGLE_SEARCH_CONSOLE'
    ? manifest.capabilities.QUERY_PAGE_DAILY
    : manifest.capabilities.QUERY_STATS;
  return { manifest, descriptor };
}

export function projectProviderPlaceholders(input: {
  providersWithRealLanes: ReadonlySet<SearchProviderCode>;
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceProviderProjection[] {
  return listSearchProviderManifests()
    .filter((manifest) => !input.providersWithRealLanes.has(manifest.provider))
    .map((manifest) => {
      const capability = queryCapabilityFor(manifest.provider)!;
      const state = capability.descriptor.state === 'SUPPORTED'
        ? 'UNKNOWN'
        : 'UNAVAILABLE';
      return {
        kind: 'PROVIDER' as const,
        provider: manifest.provider,
        marketCode: null,
        locale: null,
        propertyRef: null,
        propertyType: null,
        state,
        capabilityState: capability.descriptor.state,
        accessMode: capability.descriptor.accessMode,
        sourceCompleteness: [] as [],
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        latestSourceDate: null,
        latestAvailableSourceDate: null,
        snapshotIds: [] as [],
        metrics: { ...NULL_METRICS },
        matchedPages: [] as [],
        reason: state === 'UNKNOWN'
          ? 'NO_PERSISTED_QUERY_LANE'
          : `QUERY_CAPABILITY_${capability.descriptor.state}`,
      };
    });
}
