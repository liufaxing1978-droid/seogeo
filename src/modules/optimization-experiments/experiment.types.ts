export const OPTIMIZATION_EXPERIMENT_VERSION = 'OPTIMIZATION_EXPERIMENT_V1' as const;
export const OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION = 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1' as const;
export const OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION = 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1' as const;

export type ExperimentWindowType = '7D' | '14D' | '28D' | '56D';
export type ExperimentMetricDirection = 'HIGHER' | 'LOWER';
export type ExperimentMetricRole = 'PRIMARY' | 'SECONDARY';
export type ExperimentCoverageState = 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
export type ExperimentContaminationState =
  | 'CLEAR'
  | 'CONFLICTING_MUTATION'
  | 'TARGET_REVISION_CHANGED'
  | 'VERIFICATION_INVALIDATED'
  | 'SOURCE_IDENTITY_CHANGED'
  | 'UNKNOWN';
export type ExperimentEffectState = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';

export type SearchExperimentMeasurementScope = {
  kind: 'SEARCH';
  provider: 'GOOGLE_SEARCH_CONSOLE';
  marketCode: string;
  locale: string;
  propertyRef: string;
  normalizedQuery: string;
  canonicalPage: string | null;
  aggregationScope: 'QUERY_PAGE' | 'QUERY';
};

export type VisibilityExperimentMeasurementScope = {
  kind: 'VISIBILITY';
  metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE';
  subjectSetHash: string;
  scopeHash: string;
  formulaVersion: string;
  extractorVersion: string;
  dimensionType: string;
  dimensionKey: string;
  actorType: string;
  actorKey: string;
};

export type ExperimentMeasurementScope =
  | SearchExperimentMeasurementScope
  | VisibilityExperimentMeasurementScope;

export type ExperimentMetricComparison = {
  family: 'SEARCH' | 'VISIBILITY';
  metricKey: string;
  role: ExperimentMetricRole;
  direction: ExperimentMetricDirection;
  baselineValue: number | null;
  observedValue: number | null;
  baselineZeroIsExplicit: boolean;
  baselineNumerator?: number;
  baselineDenominator?: number;
  observedNumerator?: number;
  observedDenominator?: number;
  baselineSourceRefs: readonly string[];
  observedSourceRefs: readonly string[];
  reasonCodes: readonly string[];
};

export type ExperimentWindowResolution = {
  comparisons: readonly ExperimentMetricComparison[];
  baselineSearchSourceRefs: readonly string[];
  observedSearchSourceRefs: readonly string[];
  baselineVisibilitySourceRefs: readonly string[];
  observedVisibilitySourceRefs: readonly string[];
  coverageState: ExperimentCoverageState;
  reasonCodes: readonly string[];
  inputCutoffAt: Date;
};
