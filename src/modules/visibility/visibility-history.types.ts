export const P6D_COMPARISON_VERSION = 'VISIBILITY_COMPARISON_V1' as const;

export type VisibilityHistoryMetricType =
  | 'MENTION_RATE'
  | 'CITATION_RATE'
  | 'MENTION_SHARE_OF_VOICE';

export type VisibilityHistoryMetricStatus =
  | 'CALCULATED'
  | 'NO_SIGNAL'
  | 'UNKNOWN'
  | 'NOT_ELIGIBLE'
  | 'NO_DATA';

export type VisibilityHistoryDimensionType = 'OVERALL' | 'PROVIDER' | 'PROMPT_SET';
export type VisibilityHistoryActorType = 'OWNED_ROLLUP' | 'COMPETITOR';

export type VisibilityHistorySnapshotContract = {
  id: string;
  projectId: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  scopeHash: string;
  windowStart: Date;
  windowEnd: Date;
};

export type VisibilityHistoryMetricRowInput = {
  metricType: VisibilityHistoryMetricType;
  metricStatus: VisibilityHistoryMetricStatus;
  dimensionType: VisibilityHistoryDimensionType;
  dimensionKey: string;
  actorType: VisibilityHistoryActorType;
  actorSubjectId: string | null;
  actorKey: string;
  numerator: number;
  denominator: number;
};

export type VisibilityHistoryDeltaRow = {
  metricType: VisibilityHistoryMetricType;
  dimensionType: VisibilityHistoryDimensionType;
  dimensionKey: string;
  actorType: VisibilityHistoryActorType;
  actorSubjectId: string | null;
  actorKey: string;
  previousMetricStatus: VisibilityHistoryMetricStatus;
  currentMetricStatus: VisibilityHistoryMetricStatus;
  previousNumerator: number;
  previousDenominator: number;
  currentNumerator: number;
  currentDenominator: number;
  deltaBasisPoints: number | null;
};

export type VisibilityHistoryErrorCode =
  | 'VISIBILITY_HISTORY_PROJECT_MISMATCH'
  | 'VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND'
  | 'VISIBILITY_HISTORY_SNAPSHOT_NOT_COMPLETED'
  | 'VISIBILITY_HISTORY_NO_COMPATIBLE_PREVIOUS'
  | 'VISIBILITY_HISTORY_FORMULA_MISMATCH'
  | 'VISIBILITY_HISTORY_EXTRACTOR_MISMATCH'
  | 'VISIBILITY_HISTORY_SUBJECT_SET_MISMATCH'
  | 'VISIBILITY_HISTORY_SCOPE_MISMATCH'
  | 'VISIBILITY_HISTORY_WINDOW_MISMATCH'
  | 'VISIBILITY_HISTORY_WINDOW_OVERLAP'
  | 'VISIBILITY_HISTORY_ROW_MISSING'
  | 'VISIBILITY_HISTORY_PERSISTENCE_FAILED';

export class VisibilityHistoryError extends Error {
  readonly code: VisibilityHistoryErrorCode;

  constructor(code: VisibilityHistoryErrorCode, message: string) {
    super(message);
    this.name = 'VisibilityHistoryError';
    this.code = code;
  }
}
