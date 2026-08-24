import type { MarketCode, Prisma, RecommendedActionType } from '@prisma/client';
import type { ExperimentMeasurementScope } from './experiment.types.js';

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

export type ResolveExperimentMeasurementScopeInput = {
  projectId: string;
  interventionType: RecommendedActionType;
  targetUrl: string;
  candidate: ExperimentScopeCandidate;
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

export async function resolveExperimentMeasurementScope(
  input: ResolveExperimentMeasurementScopeInput
): Promise<ExperimentMeasurementScope | null> {
  if (QUERY_PAGE_INTERVENTIONS.has(input.interventionType)) {
    return resolveConfiguredSearchScope(input, 'QUERY_PAGE');
  }
  if (input.interventionType === 'CONTENT_CREATION') {
    return resolveConfiguredSearchScope(input, 'QUERY');
  }
  return null;
}
