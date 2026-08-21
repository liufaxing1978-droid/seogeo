import type { GrowthEvidenceQuality, GrowthPriority, GrowthScoreState } from '@prisma/client';

export const GROWTH_TOPIC_IDENTITY_VERSION = 'GROWTH_TOPIC_IDENTITY_V1' as const;
export const GROWTH_TOPIC_SNAPSHOT_VERSION = 'GROWTH_TOPIC_SNAPSHOT_V1' as const;

export type TopicAssignmentInput = {
  normalizedQuery: string;
  p3Topic?: {
    entityId?: string | null;
    topicKey?: string | null;
    primaryQuery?: string | null;
  } | null;
  aliasMap?: Readonly<Record<string, string>>;
  primaryQuery?: string | null;
};

export type TopicAssignment = {
  source: 'P3_ENTITY' | 'ALIAS' | 'PRIMARY_QUERY' | 'UNCLUSTERED';
  topicKey: string;
  primaryQuery: string;
  primaryEntityId: string | null;
};

export type TopicOpportunityScoreInput = {
  score: number | null;
  demand: number | null;
};

export type TopicScoreInput = {
  opportunities: readonly TopicOpportunityScoreInput[];
  trendVisibilityScore: number | null;
};

export type TopicScoreResult = {
  score: number | null;
  topOpportunityScore: number | null;
  demandWeightedScore: number | null;
  availableWeight: number;
  evidenceCoverage: number;
  evidenceQuality: GrowthEvidenceQuality;
  rankingEligible: boolean;
  priority: GrowthPriority;
  scoreState: GrowthScoreState;
  trendVisibilityState: 'KNOWN' | 'UNKNOWN';
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveTopicAssignment(input: TopicAssignmentInput): TopicAssignment {
  const entityId = clean(input.p3Topic?.entityId);
  if (entityId) {
    const primaryQuery =
      clean(input.p3Topic?.primaryQuery) ??
      clean(input.p3Topic?.topicKey) ??
      clean(input.primaryQuery) ??
      clean(input.normalizedQuery) ??
      'UNCLUSTERED';
    return {
      source: 'P3_ENTITY',
      topicKey: `entity:${entityId}`,
      primaryQuery,
      primaryEntityId: entityId
    };
  }

  const normalizedQuery = clean(input.normalizedQuery);
  const alias = normalizedQuery ? clean(input.aliasMap?.[normalizedQuery]) : null;
  if (alias) {
    return {
      source: 'ALIAS',
      topicKey: `query:${alias}`,
      primaryQuery: alias,
      primaryEntityId: null
    };
  }

  const primaryQuery = clean(input.primaryQuery) ?? normalizedQuery;
  if (primaryQuery) {
    return {
      source: 'PRIMARY_QUERY',
      topicKey: `query:${primaryQuery}`,
      primaryQuery,
      primaryEntityId: null
    };
  }

  return {
    source: 'UNCLUSTERED',
    topicKey: 'UNCLUSTERED',
    primaryQuery: 'UNCLUSTERED',
    primaryEntityId: null
  };
}

function validScore(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function priorityFor(score: number): GrowthPriority {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 50) return 'MEDIUM';
  if (score >= 25) return 'LOW';
  return 'MONITOR';
}

export function scoreTopicCluster(input: TopicScoreInput): TopicScoreResult {
  const eligible = input.opportunities.filter(
    (row) => validScore(row.score) && validScore(row.demand)
  ) as Array<{ score: number; demand: number }>;

  const topOpportunityScore = eligible.length > 0
    ? Math.max(...eligible.map((row) => row.score))
    : null;
  const demandDenominator = eligible.reduce((sum, row) => sum + row.demand, 0);
  const demandWeightedScore = eligible.length === 0
    ? null
    : demandDenominator > 0
      ? eligible.reduce((sum, row) => sum + row.score * row.demand, 0) / demandDenominator
      : eligible.reduce((sum, row) => sum + row.score, 0) / eligible.length;
  const trendVisibilityScore = input.trendVisibilityScore;
  const trendKnown = validScore(trendVisibilityScore);

  let weighted = 0;
  let availableWeight = 0;
  if (topOpportunityScore !== null) {
    weighted += topOpportunityScore * 50;
    availableWeight += 50;
  }
  if (demandWeightedScore !== null) {
    weighted += demandWeightedScore * 30;
    availableWeight += 30;
  }
  if (trendKnown) {
    weighted += trendVisibilityScore * 20;
    availableWeight += 20;
  }

  const evidenceCoverage = availableWeight / 100;
  if (availableWeight < 50) {
    return {
      score: null,
      topOpportunityScore,
      demandWeightedScore,
      availableWeight,
      evidenceCoverage,
      evidenceQuality: 'UNKNOWN',
      rankingEligible: false,
      priority: 'UNKNOWN',
      scoreState: 'UNKNOWN',
      trendVisibilityState: trendKnown ? 'KNOWN' : 'UNKNOWN'
    };
  }

  const score = Math.round(weighted / availableWeight);
  return {
    score,
    topOpportunityScore,
    demandWeightedScore,
    availableWeight,
    evidenceCoverage,
    evidenceQuality: availableWeight === 100 ? 'COMPLETE' : 'PARTIAL',
    rankingEligible: availableWeight >= 70,
    priority: priorityFor(score),
    scoreState: 'KNOWN',
    trendVisibilityState: trendKnown ? 'KNOWN' : 'UNKNOWN'
  };
}