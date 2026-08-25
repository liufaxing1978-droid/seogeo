import type { SearchFactRepository } from '../search-facts/search-fact.repository.js';
import type {
  SearchFactMetricSemantic,
  SearchFactMetricView,
  SearchFactView
} from '../search-facts/search-fact.types.js';
import type {
  ExperimentMetricComparison,
  ExperimentWindowResolution,
  ExperimentWindowType,
  SearchExperimentMeasurementScope
} from './experiment.types.js';

type SearchExperimentSource = Pick<SearchFactRepository, 'listCompletedFacts'>;

type WindowAggregate = {
  metrics: ReadonlyMap<SearchFactMetricSemantic, number>;
  sourceRefs: readonly string[];
  inputCutoffAt: Date | null;
  sufficient: boolean;
  reasonCodes: readonly string[];
  explicitZeroMetrics: ReadonlySet<SearchFactMetricSemantic>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(value: Date): Date {
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate()
  ));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function utcDayEnd(value: Date): Date {
  return new Date(utcDayStart(value).getTime() + DAY_MS - 1);
}

function dayKey(value: Date): string {
  return utcDayStart(value).toISOString().slice(0, 10);
}

function sourceRef(fact: SearchFactView): string {
  return `SEARCH_FACT:${fact.snapshotId}:${fact.factKey}`;
}

function metricValue(
  metric: SearchFactMetricView | undefined
): { value: number | null; explicitZero: boolean } {
  if (!metric) return { value: null, explicitZero: false };
  if (metric.evidenceState === 'KNOWN_EMPTY') return { value: 0, explicitZero: true };
  if (
    metric.evidenceState !== 'KNOWN_PRESENT'
    || metric.numericValue === null
    || !Number.isFinite(metric.numericValue)
  ) {
    return { value: null, explicitZero: false };
  }
  return { value: metric.numericValue, explicitZero: metric.numericValue === 0 };
}

function metricOf(
  fact: SearchFactView,
  semantic: SearchFactMetricSemantic
): { value: number | null; explicitZero: boolean } {
  return metricValue(fact.metrics.find((metric) => metric.metricSemantic === semantic));
}

function preferDeterministicFact(left: SearchFactView, right: SearchFactView): SearchFactView {
  const leftCutoff = left.sourceCutoffAt.getTime();
  const rightCutoff = right.sourceCutoffAt.getTime();
  if (leftCutoff !== rightCutoff) return leftCutoff > rightCutoff ? left : right;
  return left.snapshotId.localeCompare(right.snapshotId) <= 0 ? left : right;
}

function dedupeLogicalFacts(facts: readonly SearchFactView[]): SearchFactView[] {
  const selected = new Map<string, SearchFactView>();
  for (const fact of facts) {
    const logicalKey = [dayKey(fact.sourceDate), fact.factKey].join('|');
    const existing = selected.get(logicalKey);
    selected.set(logicalKey, existing ? preferDeterministicFact(existing, fact) : fact);
  }
  return [...selected.values()].sort((left, right) => {
    const dayDelta = left.sourceDate.getTime() - right.sourceDate.getTime();
    if (dayDelta !== 0) return dayDelta;
    return left.factKey.localeCompare(right.factKey);
  });
}

function aggregateWindow(input: {
  facts: readonly SearchFactView[];
  start: Date;
  days: number;
  aggregationScope: SearchExperimentMeasurementScope['aggregationScope'];
}): WindowAggregate {
  const endExclusive = addUtcDays(input.start, input.days);
  const inWindow = dedupeLogicalFacts(input.facts.filter((fact) => {
    const sourceDay = utcDayStart(fact.sourceDate).getTime();
    return sourceDay >= input.start.getTime() && sourceDay < endExclusive.getTime();
  }));

  const requiredDays = new Set(
    Array.from({ length: input.days }, (_, index) => dayKey(addUtcDays(input.start, index)))
  );
  const observedDays = new Set(inWindow.map((fact) => dayKey(fact.sourceDate)));
  const completenessOk = inWindow.every((fact) => {
    if (fact.sourceCompleteness === 'COMPLETE') return true;
    return input.aggregationScope === 'QUERY_PAGE' && fact.sourceCompleteness === 'TOP_ROWS_ONLY';
  });
  const dailyCoverageOk = [...requiredDays].every((day) => observedDays.has(day));

  if (!completenessOk || !dailyCoverageOk || inWindow.length === 0) {
    return {
      metrics: new Map(),
      sourceRefs: inWindow.map(sourceRef),
      inputCutoffAt: inWindow.length > 0
        ? new Date(Math.max(...inWindow.map((fact) => fact.sourceCutoffAt.getTime())))
        : null,
      sufficient: false,
      reasonCodes: [
        !completenessOk ? 'SEARCH_SOURCE_COMPLETENESS_INSUFFICIENT' : null,
        !dailyCoverageOk ? 'SEARCH_SOURCE_DAILY_COVERAGE_INSUFFICIENT' : null
      ].filter((reason): reason is string => reason !== null),
      explicitZeroMetrics: new Set()
    };
  }

  let clicks = 0;
  let impressions = 0;
  let positionWeighted = 0;
  let positionWeight = 0;
  let allClicksKnown = true;
  let allImpressionsKnown = true;
  let allPositionKnown = true;
  let clicksExplicitZero = true;
  let impressionsExplicitZero = true;

  for (const fact of inWindow) {
    const clickMetric = metricOf(fact, 'CLICKS');
    const impressionMetric = metricOf(fact, 'IMPRESSIONS');
    const positionMetric = metricOf(fact, 'GOOGLE_SEARCH_CONSOLE_POSITION');

    if (clickMetric.value === null) {
      allClicksKnown = false;
    } else {
      clicks += clickMetric.value;
      clicksExplicitZero &&= clickMetric.explicitZero;
    }

    if (impressionMetric.value === null) {
      allImpressionsKnown = false;
    } else {
      impressions += impressionMetric.value;
      impressionsExplicitZero &&= impressionMetric.explicitZero;
    }

    if (positionMetric.value === null || impressionMetric.value === null) {
      allPositionKnown = false;
    } else if (impressionMetric.value > 0) {
      positionWeighted += positionMetric.value * impressionMetric.value;
      positionWeight += impressionMetric.value;
    }
  }

  if (!allClicksKnown || !allImpressionsKnown || !allPositionKnown || positionWeight <= 0) {
    return {
      metrics: new Map(),
      sourceRefs: inWindow.map(sourceRef),
      inputCutoffAt: new Date(Math.max(...inWindow.map((fact) => fact.sourceCutoffAt.getTime()))),
      sufficient: false,
      reasonCodes: ['SEARCH_SOURCE_METRIC_INSUFFICIENT'],
      explicitZeroMetrics: new Set()
    };
  }

  const metrics = new Map<SearchFactMetricSemantic, number>();
  metrics.set('CLICKS', clicks);
  metrics.set('IMPRESSIONS', impressions);
  metrics.set('CTR', impressions > 0 ? clicks / impressions : 0);
  metrics.set('GOOGLE_SEARCH_CONSOLE_POSITION', positionWeighted / positionWeight);

  const explicitZeroMetrics = new Set<SearchFactMetricSemantic>();
  if (clicks === 0 && clicksExplicitZero) explicitZeroMetrics.add('CLICKS');
  if (impressions === 0 && impressionsExplicitZero) explicitZeroMetrics.add('IMPRESSIONS');
  if (impressions === 0 && clicks === 0 && clicksExplicitZero && impressionsExplicitZero) {
    explicitZeroMetrics.add('CTR');
  }

  return {
    metrics,
    sourceRefs: inWindow.map(sourceRef),
    inputCutoffAt: new Date(Math.max(...inWindow.map((fact) => fact.sourceCutoffAt.getTime()))),
    sufficient: true,
    reasonCodes: [],
    explicitZeroMetrics
  };
}

function comparison(input: {
  metricKey: SearchFactMetricSemantic;
  baseline: WindowAggregate;
  observed: WindowAggregate;
}): ExperimentMetricComparison {
  const direction = input.metricKey.includes('POSITION') ? 'LOWER' : 'HIGHER';
  return {
    family: 'SEARCH',
    metricKey: input.metricKey,
    role: 'SECONDARY',
    direction,
    baselineValue: input.baseline.metrics.get(input.metricKey) ?? null,
    observedValue: input.observed.metrics.get(input.metricKey) ?? null,
    baselineZeroIsExplicit: input.baseline.explicitZeroMetrics.has(input.metricKey),
    baselineSourceRefs: input.baseline.sourceRefs,
    observedSourceRefs: input.observed.sourceRefs,
    reasonCodes: [...new Set([...input.baseline.reasonCodes, ...input.observed.reasonCodes])]
  };
}

export async function resolveSearchWindowComparison(input: {
  projectId: string;
  scope: SearchExperimentMeasurementScope;
  verifiedAnchorAt: Date;
  windowType: ExperimentWindowType;
  windowDays: number;
  source: SearchExperimentSource;
}): Promise<ExperimentWindowResolution> {
  if (input.projectId.trim().length === 0 || input.windowDays <= 0 || !Number.isInteger(input.windowDays)) {
    throw new Error('EXPERIMENT_SEARCH_SOURCE_INVALID_INPUT');
  }

  const anchorDay = utcDayStart(input.verifiedAnchorAt);
  const baselineStart = addUtcDays(anchorDay, -input.windowDays);
  const observedEnd = addUtcDays(anchorDay, input.windowDays - 1);
  const dueAt = new Date(input.verifiedAnchorAt.getTime() + input.windowDays * DAY_MS);
  const expectedFactKind = input.scope.aggregationScope === 'QUERY_PAGE' ? 'QUERY_PAGE' : 'QUERY';

  const facts = await input.source.listCompletedFacts({
    projectId: input.projectId,
    provider: input.scope.provider,
    marketCode: input.scope.marketCode as never,
    locale: input.scope.locale,
    propertyRef: input.scope.propertyRef,
    factKind: expectedFactKind,
    normalizedQuery: input.scope.normalizedQuery,
    ...(input.scope.aggregationScope === 'QUERY_PAGE' && input.scope.canonicalPage
      ? { canonicalPage: input.scope.canonicalPage }
      : {}),
    sourceDateFrom: baselineStart,
    sourceDateTo: utcDayEnd(observedEnd)
  });

  const exactFacts = facts.filter((fact) => (
    fact.projectId === input.projectId
    && fact.provider === input.scope.provider
    && fact.marketCode === input.scope.marketCode
    && fact.locale === input.scope.locale
    && fact.propertyRef === input.scope.propertyRef
    && fact.factKind === expectedFactKind
    && fact.normalizedQuery === input.scope.normalizedQuery
    && (input.scope.aggregationScope === 'QUERY'
      || fact.canonicalPage === input.scope.canonicalPage)
  ));

  const baseline = aggregateWindow({
    facts: exactFacts,
    start: baselineStart,
    days: input.windowDays,
    aggregationScope: input.scope.aggregationScope
  });
  const observed = aggregateWindow({
    facts: exactFacts,
    start: anchorDay,
    days: input.windowDays,
    aggregationScope: input.scope.aggregationScope
  });

  const metricKeys: readonly SearchFactMetricSemantic[] = [
    'CLICKS',
    'IMPRESSIONS',
    'CTR',
    'GOOGLE_SEARCH_CONSOLE_POSITION'
  ];
  const reasonCodes = [...new Set([
    ...baseline.reasonCodes,
    ...observed.reasonCodes,
    ...(input.scope.aggregationScope === 'QUERY' && !baseline.sufficient
      ? ['NO_COMPARABLE_BASELINE']
      : [])
  ])];
  const cutoffs = [baseline.inputCutoffAt, observed.inputCutoffAt]
    .filter((value): value is Date => value !== null)
    .map((value) => value.getTime());

  return {
    comparisons: metricKeys.map((metricKey) => comparison({ metricKey, baseline, observed })),
    baselineSearchSourceRefs: baseline.sourceRefs,
    observedSearchSourceRefs: observed.sourceRefs,
    baselineVisibilitySourceRefs: [],
    observedVisibilitySourceRefs: [],
    coverageState: baseline.sufficient && observed.sufficient ? 'SUFFICIENT' : 'INSUFFICIENT',
    reasonCodes,
    inputCutoffAt: cutoffs.length > 0 ? new Date(Math.max(...cutoffs)) : dueAt
  };
}