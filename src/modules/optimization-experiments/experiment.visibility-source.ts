import type {
  ExperimentWindowResolution,
  ExperimentWindowType,
  VisibilityExperimentMeasurementScope
} from './experiment.types.js';

export type VisibilityExperimentSnapshotStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type VisibilityExperimentMetricStatus =
  | 'CALCULATED'
  | 'NO_SIGNAL'
  | 'UNKNOWN'
  | 'NOT_ELIGIBLE'
  | 'NO_DATA';

export type VisibilityExperimentSnapshotView = {
  snapshotId: string;
  projectId: string;
  status: VisibilityExperimentSnapshotStatus;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  scopeHash: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  row: {
    rowId: string;
    projectId: string;
    metricType: VisibilityExperimentMeasurementScope['metricType'];
    metricStatus: VisibilityExperimentMetricStatus;
    dimensionType: string;
    dimensionKey: string;
    actorType: string;
    actorKey: string;
    numerator: number;
    denominator: number;
    eligibleObservationCount: number;
  };
};

export interface VisibilityExperimentSourcePort {
  listCompatibleSnapshots(input: {
    projectId: string;
    scope: VisibilityExperimentMeasurementScope;
  }): Promise<readonly VisibilityExperimentSnapshotView[]>;
}

const MIN_ELIGIBLE_OBSERVATIONS = 10;

function sourceRef(snapshot: VisibilityExperimentSnapshotView): string {
  return `VISIBILITY_METRIC:${snapshot.snapshotId}:${snapshot.row.rowId}`;
}

function hasFrozenIdentity(input: {
  snapshot: VisibilityExperimentSnapshotView;
  projectId: string;
  scope: VisibilityExperimentMeasurementScope;
}): boolean {
  const { snapshot, projectId, scope } = input;
  return snapshot.projectId === projectId
    && snapshot.status === 'COMPLETED'
    && snapshot.formulaVersion === scope.formulaVersion
    && snapshot.extractorVersion === scope.extractorVersion
    && snapshot.subjectSetHash === scope.subjectSetHash
    && snapshot.scopeHash === scope.scopeHash
    && snapshot.row.projectId === projectId
    && snapshot.row.metricType === scope.metricType
    && snapshot.row.dimensionType === scope.dimensionType
    && snapshot.row.dimensionKey === scope.dimensionKey
    && snapshot.row.actorType === scope.actorType
    && snapshot.row.actorKey === scope.actorKey;
}

function durationMs(snapshot: VisibilityExperimentSnapshotView): number {
  return snapshot.windowEnd.getTime() - snapshot.windowStart.getTime();
}

function validDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function isComparable(snapshot: VisibilityExperimentSnapshotView): boolean {
  if (
    !validDate(snapshot.windowStart)
    || !validDate(snapshot.windowEnd)
    || !validDate(snapshot.inputCutoffAt)
    || durationMs(snapshot) <= 0
    || !Number.isInteger(snapshot.row.numerator)
    || !Number.isInteger(snapshot.row.denominator)
    || !Number.isInteger(snapshot.row.eligibleObservationCount)
    || snapshot.row.numerator < 0
    || snapshot.row.denominator <= 0
    || snapshot.row.numerator > snapshot.row.denominator
    || snapshot.row.eligibleObservationCount < MIN_ELIGIBLE_OBSERVATIONS
  ) {
    return false;
  }

  if (
    snapshot.row.metricStatus === 'UNKNOWN'
    || snapshot.row.metricStatus === 'NO_DATA'
    || snapshot.row.metricStatus === 'NOT_ELIGIBLE'
  ) {
    return false;
  }

  if (snapshot.row.metricStatus === 'NO_SIGNAL' && snapshot.row.numerator !== 0) {
    return false;
  }

  return true;
}

function compareBaseline(
  left: VisibilityExperimentSnapshotView,
  right: VisibilityExperimentSnapshotView
): number {
  const endDelta = right.windowEnd.getTime() - left.windowEnd.getTime();
  if (endDelta !== 0) return endDelta;
  return left.snapshotId.localeCompare(right.snapshotId);
}

function compareObserved(
  left: VisibilityExperimentSnapshotView,
  right: VisibilityExperimentSnapshotView
): number {
  const endDelta = left.windowEnd.getTime() - right.windowEnd.getTime();
  if (endDelta !== 0) return endDelta;
  return left.snapshotId.localeCompare(right.snapshotId);
}

function insufficient(input: {
  scope: VisibilityExperimentMeasurementScope;
  dueAt: Date;
  baseline?: VisibilityExperimentSnapshotView;
  observed?: VisibilityExperimentSnapshotView;
  reasonCodes: readonly string[];
}): ExperimentWindowResolution {
  const baselineRef = input.baseline ? [sourceRef(input.baseline)] : [];
  const observedRef = input.observed ? [sourceRef(input.observed)] : [];
  const cutoffs = [input.baseline?.inputCutoffAt, input.observed?.inputCutoffAt]
    .filter((value): value is Date => value instanceof Date && validDate(value))
    .map((value) => value.getTime());

  return {
    comparisons: [{
      family: 'VISIBILITY',
      metricKey: input.scope.metricType,
      role: 'PRIMARY',
      direction: 'HIGHER',
      baselineValue: null,
      observedValue: null,
      baselineZeroIsExplicit: false,
      baselineSourceRefs: baselineRef,
      observedSourceRefs: observedRef,
      reasonCodes: input.reasonCodes
    }],
    baselineSearchSourceRefs: [],
    observedSearchSourceRefs: [],
    baselineVisibilitySourceRefs: baselineRef,
    observedVisibilitySourceRefs: observedRef,
    coverageState: 'INSUFFICIENT',
    reasonCodes: input.reasonCodes,
    inputCutoffAt: cutoffs.length > 0 ? new Date(Math.max(...cutoffs)) : input.dueAt
  };
}

export async function resolveVisibilityWindowComparison(input: {
  projectId: string;
  scope: VisibilityExperimentMeasurementScope;
  verifiedAnchorAt: Date;
  dueAt: Date;
  windowType: ExperimentWindowType;
  source: VisibilityExperimentSourcePort;
}): Promise<ExperimentWindowResolution> {
  if (
    input.projectId.trim().length === 0
    || !validDate(input.verifiedAnchorAt)
    || !validDate(input.dueAt)
  ) {
    throw new Error('EXPERIMENT_VISIBILITY_SOURCE_INVALID_INPUT');
  }

  const returned = await input.source.listCompatibleSnapshots({
    projectId: input.projectId,
    scope: input.scope
  });
  const compatible = returned.filter((snapshot) => hasFrozenIdentity({
    snapshot,
    projectId: input.projectId,
    scope: input.scope
  }));

  const baselineCandidates = compatible
    .filter((snapshot) => snapshot.windowEnd.getTime() <= input.verifiedAnchorAt.getTime())
    .sort(compareBaseline);
  const observedCandidates = compatible
    .filter((snapshot) => snapshot.windowEnd.getTime() >= input.dueAt.getTime())
    .sort(compareObserved);

  const baseline = baselineCandidates[0];
  const observed = observedCandidates[0];
  if (!baseline || !observed) {
    return insufficient({
      scope: input.scope,
      dueAt: input.dueAt,
      baseline,
      observed,
      reasonCodes: ['VISIBILITY_SOURCE_WINDOW_MISSING']
    });
  }

  if (durationMs(baseline) !== durationMs(observed)) {
    return insufficient({
      scope: input.scope,
      dueAt: input.dueAt,
      baseline,
      observed,
      reasonCodes: ['VISIBILITY_SOURCE_DURATION_MISMATCH']
    });
  }

  if (!isComparable(baseline) || !isComparable(observed)) {
    return insufficient({
      scope: input.scope,
      dueAt: input.dueAt,
      baseline,
      observed,
      reasonCodes: ['VISIBILITY_SOURCE_METRIC_INSUFFICIENT']
    });
  }

  const baselineValue = baseline.row.numerator / baseline.row.denominator;
  const observedValue = observed.row.numerator / observed.row.denominator;
  const baselineRef = sourceRef(baseline);
  const observedRef = sourceRef(observed);

  return {
    comparisons: [{
      family: 'VISIBILITY',
      metricKey: input.scope.metricType,
      role: 'PRIMARY',
      direction: 'HIGHER',
      baselineValue,
      observedValue,
      baselineZeroIsExplicit: baseline.row.numerator === 0,
      baselineSourceRefs: [baselineRef],
      observedSourceRefs: [observedRef],
      reasonCodes: []
    }],
    baselineSearchSourceRefs: [],
    observedSearchSourceRefs: [],
    baselineVisibilitySourceRefs: [baselineRef],
    observedVisibilitySourceRefs: [observedRef],
    coverageState: 'SUFFICIENT',
    reasonCodes: [],
    inputCutoffAt: new Date(Math.max(
      baseline.inputCutoffAt.getTime(),
      observed.inputCutoffAt.getTime()
    ))
  };
}
