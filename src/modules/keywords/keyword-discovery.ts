import type {
  SearchFactMetricSemantic,
  SearchFactView,
} from '../search-facts/search-fact.types.js';
import { normalizeSearchEvidenceQuery } from './keyword-search-evidence-normalize.js';
import type {
  KeywordDiscoveryEvidenceProjection,
  KeywordDiscoveryProvider,
  KeywordDiscoveryProviderEvidence,
} from './keyword-discovery.types.js';

const PROVIDER_PRECEDENCE: readonly KeywordDiscoveryProvider[] = [
  'GOOGLE_SEARCH_CONSOLE',
  'BING_WEBMASTER',
];

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

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
  let total = 0;
  let count = 0;
  for (const fact of facts) {
    const value = metricValue(fact, semantic);
    if (value === null) continue;
    total += value;
    count += 1;
  }
  return count > 0 ? total : null;
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

function isQueryCapableFact(fact: SearchFactView): boolean {
  return (
    fact.provider === 'GOOGLE_SEARCH_CONSOLE'
    && fact.factKind === 'QUERY_PAGE'
  ) || (
    fact.provider === 'BING_WEBMASTER'
    && fact.factKind === 'QUERY'
  );
}

function providerEvidence(
  provider: KeywordDiscoveryProvider,
  facts: readonly SearchFactView[],
): KeywordDiscoveryProviderEvidence {
  const latestSourceDate = facts
    .map((fact) => isoDay(fact.sourceDate))
    .sort((left, right) => right.localeCompare(left))[0]!;

  if (provider === 'GOOGLE_SEARCH_CONSOLE') {
    return {
      provider,
      impressions: sumKnown(facts, 'IMPRESSIONS'),
      clicks: sumKnown(facts, 'CLICKS'),
      searchConsoleAveragePosition: weightedMean(
        facts,
        'GOOGLE_SEARCH_CONSOLE_POSITION',
        'IMPRESSIONS',
      ),
      bingAverageClickPosition: null,
      bingAverageImpressionPosition: null,
      latestSourceDate,
    };
  }

  return {
    provider,
    impressions: sumKnown(facts, 'IMPRESSIONS'),
    clicks: sumKnown(facts, 'CLICKS'),
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
    latestSourceDate,
  };
}

function compareProjection(
  left: KeywordDiscoveryEvidenceProjection,
  right: KeywordDiscoveryEvidenceProjection,
): number {
  const leftTracked = left.trackedKeywordId !== null;
  const rightTracked = right.trackedKeywordId !== null;
  if (leftTracked !== rightTracked) return leftTracked ? 1 : -1;

  const leftProvider = left.providers[0]!;
  const rightProvider = right.providers[0]!;
  const leftProviderIndex = PROVIDER_PRECEDENCE.indexOf(leftProvider.provider);
  const rightProviderIndex = PROVIDER_PRECEDENCE.indexOf(rightProvider.provider);

  return leftProviderIndex - rightProviderIndex
    || (rightProvider.impressions ?? -1) - (leftProvider.impressions ?? -1)
    || (rightProvider.clicks ?? -1) - (leftProvider.clicks ?? -1)
    || rightProvider.latestSourceDate.localeCompare(leftProvider.latestSourceDate)
    || left.normalizedQuery.localeCompare(right.normalizedQuery);
}

export function projectKeywordDiscoveryEvidence(input: {
  facts: readonly SearchFactView[];
  trackedKeywords: readonly { id: string; normalizedText: string }[];
}): KeywordDiscoveryEvidenceProjection[] {
  const grouped = new Map<string, SearchFactView[]>();

  for (const fact of input.facts) {
    if (!fact.query || !isQueryCapableFact(fact)) continue;
    const normalizedQuery = normalizeSearchEvidenceQuery(fact.query);
    if (!normalizedQuery) continue;
    const rows = grouped.get(normalizedQuery) ?? [];
    rows.push(fact);
    grouped.set(normalizedQuery, rows);
  }

  const tracked = new Map(
    input.trackedKeywords.map((keyword) => [keyword.normalizedText, keyword.id]),
  );

  const result = [...grouped.entries()].map(([normalizedQuery, facts]) => {
    const dates = facts.map((fact) => isoDay(fact.sourceDate)).sort();
    const firstObservedAt = dates[0]!;
    const lastObservedAt = dates.at(-1)!;
    const representativeText = facts
      .filter((fact) => isoDay(fact.sourceDate) === lastObservedAt)
      .map((fact) => fact.query!)
      .sort((left, right) => left.localeCompare(right))[0]!;

    const providers = PROVIDER_PRECEDENCE
      .map((provider) => {
        const providerFacts = facts.filter((fact) => fact.provider === provider);
        return providerFacts.length > 0
          ? providerEvidence(provider, providerFacts)
          : null;
      })
      .filter((item): item is KeywordDiscoveryProviderEvidence => item !== null);

    return {
      normalizedQuery,
      representativeText,
      trackedKeywordId: tracked.get(normalizedQuery) ?? null,
      firstObservedAt,
      lastObservedAt,
      providers,
    } satisfies KeywordDiscoveryEvidenceProjection;
  });

  return result.sort(compareProjection);
}
