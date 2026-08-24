import type { MarketCode, Prisma, RecommendedActionType } from '@prisma/client';
import type {
  ExperimentMeasurementScope,
  VisibilityExperimentMeasurementScope
} from './experiment.types.js';

export type ExperimentScopeCandidate = {
  id: string;
  projectId: string;
  growthSnapshotId: string;
  marketScopeMode: string;
  marketCode: MarketCode | null;
  locale: string | null;
  normalizedQuery: string;
  canonicalPage: string | null;
  sourceProvenance: Prisma.JsonValue;
};

export type VisibilityExperimentScopeFact = {
  evidence: {
    snapshotId: string;
    projectId: string;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    sourceFactVersion: string;
    ruleKey: string;
  };
  row: {
    id: string;
    projectId: string;
    visibilityMetricSnapshotId: string;
    metricType: string;
    dimensionType: string;
    dimensionKey: string;
    actorType: string;
    actorKey: string;
  };
  snapshot: {
    id: string;
    projectId: string;
    status: string;
    formulaVersion: string;
    extractorVersion: string;
    subjectSetHash: string;
    scopeHash: string;
  };
};

export interface VisibilityExperimentScopeSourcePort {
  listVisibilityScopeFacts(input: {
    projectId: string;
    growthSnapshotId: string;
  }): Promise<readonly VisibilityExperimentScopeFact[]>;
}

export type ResolveExperimentMeasurementScopeInput = {
  projectId: string;
  interventionType: RecommendedActionType;
  targetUrl: string;
  candidate: ExperimentScopeCandidate;
  visibilitySource?: VisibilityExperimentScopeSourcePort;
};

const QUERY_PAGE_INTERVENTIONS = new Set<RecommendedActionType>([
  'SERP_SNIPPET_OPTIMIZATION',
  'ON_PAGE_OPTIMIZATION',
  'CONTENT_REFRESH'
]);

function jsonObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | null {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return null;
  return value as Record<string, Prisma.JsonValue>;
}

function nonEmptyString(value: Prisma.JsonValue | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

export function normalizeExperimentHttpUrl(value: string): string {
  if (value.length > 2_048) throw new Error('EXPERIMENT_URL_INVALID');
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('EXPERIMENT_URL_INVALID');
    }
    url.hash = '';
    return url.href;
  } catch (error) {
    if (error instanceof Error && error.message === 'EXPERIMENT_URL_INVALID') throw error;
    throw new Error('EXPERIMENT_URL_INVALID');
  }
}

function resolveConfiguredSearchScope(
  input: ResolveExperimentMeasurementScopeInput,
  aggregationScope: 'QUERY_PAGE' | 'QUERY'
): ExperimentMeasurementScope | null {
  const candidate = input.candidate;
  if (
    candidate.projectId !== input.projectId
    || candidate.marketScopeMode !== 'CONFIGURED_MARKET'
    || candidate.marketCode === null
    || candidate.locale === null
    || candidate.locale.trim().length === 0
    || candidate.normalizedQuery.trim().length === 0
  ) {
    return null;
  }

  let normalizedTarget: string;
  try {
    normalizedTarget = normalizeExperimentHttpUrl(input.targetUrl);
  } catch {
    return null;
  }

  if (aggregationScope === 'QUERY_PAGE') {
    if (candidate.canonicalPage === null) return null;
    try {
      if (normalizeExperimentHttpUrl(candidate.canonicalPage) !== normalizedTarget) return null;
    } catch {
      return null;
    }
  }

  const provenance = jsonObject(candidate.sourceProvenance);
  if (
    provenance === null
    || provenance.version !== 'GROWTH_SEARCH_PROVENANCE_V1'
    || provenance.mode !== 'CONFIGURED_MARKET'
  ) {
    return null;
  }

  const scoringLane = jsonObject(provenance.scoringLane);
  if (scoringLane === null || scoringLane.provider !== 'GOOGLE_SEARCH_CONSOLE') return null;

  const projections = scoringLane.marketProjections;
  if (!Array.isArray(projections)) return null;
  const matching = projections.filter((projection) => {
    const row = jsonObject(projection);
    return row?.marketCode === candidate.marketCode && row?.locale === candidate.locale;
  });
  if (matching.length !== 1) return null;

  const projection = jsonObject(matching[0]!);
  const propertyRef = projection ? nonEmptyString(projection.propertyRef) : null;
  if (propertyRef === null) return null;

  return {
    kind: 'SEARCH',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    marketCode: candidate.marketCode,
    locale: candidate.locale,
    propertyRef,
    normalizedQuery: candidate.normalizedQuery.trim(),
    canonicalPage: aggregationScope === 'QUERY_PAGE' ? normalizedTarget : null,
    aggregationScope
  };
}

function isExactVisibilityFact(
  fact: VisibilityExperimentScopeFact,
  input: ResolveExperimentMeasurementScopeInput
): boolean {
  const { evidence, row, snapshot } = fact;
  if (
    input.candidate.projectId !== input.projectId
    || !hasText(input.candidate.growthSnapshotId)
    || evidence.snapshotId !== input.candidate.growthSnapshotId
    || evidence.projectId !== input.projectId
    || evidence.sourceModule !== 'P6_VISIBILITY'
    || evidence.sourceType !== 'VISIBILITY_METRIC_ROW'
    || evidence.sourceId !== row.id
    || row.projectId !== input.projectId
    || snapshot.projectId !== input.projectId
    || row.visibilityMetricSnapshotId !== snapshot.id
    || snapshot.status !== 'COMPLETED'
    || evidence.sourceFactVersion !== `${snapshot.formulaVersion}:${snapshot.id}`
    || row.dimensionType !== 'OVERALL'
    || row.actorType !== 'OWNED_ROLLUP'
    || !hasText(snapshot.formulaVersion)
    || !hasText(snapshot.extractorVersion)
    || !hasText(snapshot.subjectSetHash)
    || !hasText(snapshot.scopeHash)
    || !hasText(row.dimensionKey)
    || !hasText(row.actorKey)
  ) {
    return false;
  }

  if (row.metricType === 'MENTION_RATE') {
    return evidence.ruleKey === 'P6_MENTION_RATE';
  }
  if (row.metricType === 'CITATION_RATE') {
    return evidence.ruleKey === 'P6_CITATION_RATE';
  }
  return false;
}

function freezeVisibilityScope(
  fact: VisibilityExperimentScopeFact
): VisibilityExperimentMeasurementScope | null {
  if (fact.row.metricType !== 'MENTION_RATE' && fact.row.metricType !== 'CITATION_RATE') {
    return null;
  }
  return {
    kind: 'VISIBILITY',
    metricType: fact.row.metricType,
    subjectSetHash: fact.snapshot.subjectSetHash,
    scopeHash: fact.snapshot.scopeHash,
    formulaVersion: fact.snapshot.formulaVersion,
    extractorVersion: fact.snapshot.extractorVersion,
    dimensionType: fact.row.dimensionType,
    dimensionKey: fact.row.dimensionKey,
    actorType: fact.row.actorType,
    actorKey: fact.row.actorKey
  };
}

async function resolveVisibilityScope(
  input: ResolveExperimentMeasurementScopeInput
): Promise<VisibilityExperimentMeasurementScope | null> {
  if (
    input.visibilitySource === undefined
    || input.candidate.projectId !== input.projectId
    || !hasText(input.candidate.growthSnapshotId)
  ) {
    return null;
  }

  const facts = await input.visibilitySource.listVisibilityScopeFacts({
    projectId: input.projectId,
    growthSnapshotId: input.candidate.growthSnapshotId
  });
  const exactFacts = facts.filter((fact) => isExactVisibilityFact(fact, input));

  if (input.interventionType === 'GEO_CITABILITY_IMPROVEMENT') {
    const citations = exactFacts.filter((fact) => fact.row.metricType === 'CITATION_RATE');
    return citations.length === 1 ? freezeVisibilityScope(citations[0]!) : null;
  }

  if (input.interventionType === 'AI_VISIBILITY_IMPROVEMENT') {
    const mentions = exactFacts.filter((fact) => fact.row.metricType === 'MENTION_RATE');
    if (mentions.length > 1) return null;
    if (mentions.length === 1) return freezeVisibilityScope(mentions[0]!);

    const citations = exactFacts.filter((fact) => fact.row.metricType === 'CITATION_RATE');
    return citations.length === 1 ? freezeVisibilityScope(citations[0]!) : null;
  }

  return null;
}

export async function resolveExperimentMeasurementScope(
  input: ResolveExperimentMeasurementScopeInput
): Promise<ExperimentMeasurementScope | null> {
  if (QUERY_PAGE_INTERVENTIONS.has(input.interventionType)) {
    return resolveConfiguredSearchScope(input, 'QUERY_PAGE');
  }
  if (input.interventionType === 'CONTENT_CREATION') {
    return resolveConfiguredSearchScope(input, 'QUERY');
  }
  if (
    input.interventionType === 'GEO_CITABILITY_IMPROVEMENT'
    || input.interventionType === 'AI_VISIBILITY_IMPROVEMENT'
  ) {
    return resolveVisibilityScope(input);
  }
  return null;
}
