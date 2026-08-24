import type {
  ExperimentContaminationState,
  ExperimentCoverageState,
  ExperimentEffectState,
  ExperimentMetricComparison,
  ExperimentWindowResolution
} from './experiment.types.js';

export const SEARCH_COUNT_RATE_RELATIVE_NEUTRAL_BAND = 0.05;
export const CTR_ABSOLUTE_NEUTRAL_BAND = 0.005;
export const POSITION_ABSOLUTE_NEUTRAL_BAND = 0.5;
export const VISIBILITY_RATE_ABSOLUTE_NEUTRAL_BAND = 0.05;

export type ExperimentEvaluationResult = {
  effectState: ExperimentEffectState;
  coverageState: ExperimentCoverageState;
  contaminationState: ExperimentContaminationState;
  reasonCodes: readonly string[];
  deltaMetrics: readonly {
    metricKey: string;
    absoluteDelta: number | null;
    relativeDelta: number | null;
  }[];
};

type MetricMovement = 'FAVORABLE' | 'ADVERSE' | 'NEUTRAL' | 'INCONCLUSIVE';

function uniqueReasonCodes(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())];
}

function deltaFor(comparison: ExperimentMetricComparison): {
  metricKey: string;
  absoluteDelta: number | null;
  relativeDelta: number | null;
} {
  if (comparison.baselineValue === null || comparison.observedValue === null) {
    return { metricKey: comparison.metricKey, absoluteDelta: null, relativeDelta: null };
  }

  const absoluteDelta = comparison.observedValue - comparison.baselineValue;
  if (comparison.baselineValue === 0) {
    return {
      metricKey: comparison.metricKey,
      absoluteDelta,
      relativeDelta: comparison.baselineZeroIsExplicit && comparison.observedValue === 0 ? 0 : null
    };
  }

  return {
    metricKey: comparison.metricKey,
    absoluteDelta,
    relativeDelta: absoluteDelta / comparison.baselineValue
  };
}

function thresholdKind(comparison: ExperimentMetricComparison):
  | { kind: 'ABSOLUTE'; threshold: number }
  | { kind: 'RELATIVE'; threshold: number }
  | null {
  if (comparison.family === 'VISIBILITY') {
    return { kind: 'ABSOLUTE', threshold: VISIBILITY_RATE_ABSOLUTE_NEUTRAL_BAND };
  }
  if (comparison.metricKey === 'CTR') {
    return { kind: 'ABSOLUTE', threshold: CTR_ABSOLUTE_NEUTRAL_BAND };
  }
  if (comparison.metricKey.includes('POSITION')) {
    return { kind: 'ABSOLUTE', threshold: POSITION_ABSOLUTE_NEUTRAL_BAND };
  }
  if (comparison.metricKey === 'CLICKS' || comparison.metricKey === 'IMPRESSIONS') {
    return { kind: 'RELATIVE', threshold: SEARCH_COUNT_RATE_RELATIVE_NEUTRAL_BAND };
  }
  return null;
}

function movementFor(comparison: ExperimentMetricComparison): MetricMovement {
  if (
    comparison.reasonCodes.length > 0
    || comparison.baselineValue === null
    || comparison.observedValue === null
  ) {
    return 'INCONCLUSIVE';
  }

  if (comparison.baselineValue === 0) {
    if (!comparison.baselineZeroIsExplicit) return 'INCONCLUSIVE';
    if (comparison.observedValue === 0) return 'NEUTRAL';
    const favorable = comparison.direction === 'HIGHER'
      ? comparison.observedValue > 0
      : comparison.observedValue < 0;
    return favorable ? 'FAVORABLE' : 'ADVERSE';
  }

  const threshold = thresholdKind(comparison);
  if (threshold === null) return 'INCONCLUSIVE';

  const absoluteDelta = comparison.observedValue - comparison.baselineValue;
  const magnitude = threshold.kind === 'ABSOLUTE'
    ? Math.abs(absoluteDelta)
    : Math.abs(absoluteDelta / comparison.baselineValue);
  if (magnitude < threshold.threshold) return 'NEUTRAL';

  const favorable = comparison.direction === 'HIGHER'
    ? absoluteDelta > 0
    : absoluteDelta < 0;
  return favorable ? 'FAVORABLE' : 'ADVERSE';
}

export function evaluateExperimentEffect(input: {
  resolution: ExperimentWindowResolution;
  contaminationState: ExperimentContaminationState;
  contaminationReasonCodes: readonly string[];
}): ExperimentEvaluationResult {
  const comparisonReasonCodes = input.resolution.comparisons.flatMap(
    (comparison) => comparison.reasonCodes
  );
  const baseReasonCodes = uniqueReasonCodes(
    input.resolution.reasonCodes,
    comparisonReasonCodes,
    input.contaminationReasonCodes
  );
  const deltaMetrics = input.resolution.comparisons.map(deltaFor);

  if (input.resolution.coverageState !== 'SUFFICIENT') {
    return {
      effectState: 'INCONCLUSIVE',
      coverageState: input.resolution.coverageState,
      contaminationState: input.contaminationState,
      reasonCodes: uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_COVERAGE_INSUFFICIENT']),
      deltaMetrics
    };
  }

  if (input.contaminationState !== 'CLEAR') {
    return {
      effectState: 'INCONCLUSIVE',
      coverageState: input.resolution.coverageState,
      contaminationState: input.contaminationState,
      reasonCodes: uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_CONTAMINATED']),
      deltaMetrics
    };
  }

  const classified = input.resolution.comparisons.map((comparison) => ({
    comparison,
    movement: movementFor(comparison)
  }));
  if (classified.some(({ movement }) => movement === 'INCONCLUSIVE')) {
    return {
      effectState: 'INCONCLUSIVE',
      coverageState: input.resolution.coverageState,
      contaminationState: input.contaminationState,
      reasonCodes: uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_COMPARISON_INSUFFICIENT']),
      deltaMetrics
    };
  }

  const primary = classified.filter(({ comparison }) => comparison.role === 'PRIMARY');
  if (primary.length === 0) {
    return {
      effectState: 'INCONCLUSIVE',
      coverageState: input.resolution.coverageState,
      contaminationState: input.contaminationState,
      reasonCodes: uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_PRIMARY_METRIC_MISSING']),
      deltaMetrics
    };
  }

  const hasFavorable = classified.some(({ movement }) => movement === 'FAVORABLE');
  const hasAdverse = classified.some(({ movement }) => movement === 'ADVERSE');
  if (hasFavorable && hasAdverse) {
    return {
      effectState: 'INCONCLUSIVE',
      coverageState: input.resolution.coverageState,
      contaminationState: input.contaminationState,
      reasonCodes: uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_METRIC_DIRECTION_CONFLICT']),
      deltaMetrics
    };
  }

  const primaryFavorable = primary.some(({ movement }) => movement === 'FAVORABLE');
  const primaryAdverse = primary.some(({ movement }) => movement === 'ADVERSE');
  let effectState: ExperimentEffectState;
  let reasonCodes = baseReasonCodes;

  if (primaryFavorable) {
    effectState = 'POSITIVE';
  } else if (primaryAdverse) {
    effectState = 'NEGATIVE';
  } else if (!hasFavorable && !hasAdverse) {
    effectState = 'NEUTRAL';
  } else {
    effectState = 'INCONCLUSIVE';
    reasonCodes = uniqueReasonCodes(baseReasonCodes, ['EXPERIMENT_PRIMARY_METRIC_NEUTRAL_WITH_SECONDARY_MOVEMENT']);
  }

  return {
    effectState,
    coverageState: input.resolution.coverageState,
    contaminationState: input.contaminationState,
    reasonCodes,
    deltaMetrics
  };
}
