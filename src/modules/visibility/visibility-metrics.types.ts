export const P6C_FORMULA_VERSION = 'VISIBILITY_METRICS_V1' as const;

export type VisibilityMetricProvider =
  | 'OPENAI'
  | 'GEMINI'
  | 'PERPLEXITY'
  | 'ANTHROPIC'
  | 'DEEPSEEK';

export type VisibilityMetricEvidenceStatus =
  | 'EXTRACTED'
  | 'KNOWN_EMPTY'
  | 'UNKNOWN'
  | 'NOT_ELIGIBLE';

export type VisibilityMetricType =
  | 'MENTION_RATE'
  | 'CITATION_RATE'
  | 'MENTION_SHARE_OF_VOICE';

export type VisibilityMetricStatus =
  | 'CALCULATED'
  | 'NO_SIGNAL'
  | 'UNKNOWN'
  | 'NOT_ELIGIBLE'
  | 'NO_DATA';

export type VisibilityMetricDimensionType = 'OVERALL' | 'PROVIDER' | 'PROMPT_SET';

export type VisibilityMetricActorType = 'OWNED_ROLLUP' | 'COMPETITOR';

export interface VisibilityMetricActor {
  actorType: VisibilityMetricActorType;
  actorKey: string;
  actorSubjectId: string | null;
}

export interface VisibilityMetricInputRecord {
  observationId: string;
  provider: VisibilityMetricProvider;
  promptSetId: string;
  promptSetName: string;
  mentionStatus: VisibilityMetricEvidenceStatus;
  citationStatus: VisibilityMetricEvidenceStatus;
  ownedMentioned: boolean;
  competitorMentionedSubjectIds: string[];
  ownedCited: boolean;
  competitorCitedSubjectIds: string[];
}

export interface CalculatedVisibilityMetricRow {
  metricType: VisibilityMetricType;
  metricStatus: VisibilityMetricStatus;
  dimensionType: VisibilityMetricDimensionType;
  dimensionKey: string;
  dimensionLabelSnapshot: string | null;
  actorType: VisibilityMetricActorType;
  actorSubjectId: string | null;
  actorKey: string;
  numerator: number;
  denominator: number;
  candidateObservationCount: number;
  eligibleObservationCount: number;
  notEligibleObservationCount: number;
  unknownObservationCount: number;
}