import { createHash } from 'node:crypto'
import {
  OPTIMIZATION_CANDIDATE_VERSION,
  type OptimizationMarketScopeMode,
} from './optimization.types.js'
import { evaluateOptimizationEligibility } from './optimization.policy.js'
import { projectGrowthMarketScopes } from './optimization.provenance.js'
import type {
  CreateOptimizationCandidateInput,
  GrowthPlannerSource,
} from './optimization.repository.js'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

export function buildOptimizationCandidateKey(input: {
  projectId: string
  growthOpportunityIdentityId: string
  growthSnapshotId: string
  marketScopeMode: OptimizationMarketScopeMode
  marketCode: string | null
  locale: string | null
}): string {
  const payload = {
    candidateVersion: OPTIMIZATION_CANDIDATE_VERSION,
    projectId: input.projectId,
    growthOpportunityIdentityId: input.growthOpportunityIdentityId,
    growthSnapshotId: input.growthSnapshotId,
    marketScopeMode: input.marketScopeMode,
    marketCode: input.marketCode,
    locale: input.locale,
  }

  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
}

export type OptimizationCandidateDraft = CreateOptimizationCandidateInput & {
  sourceFactReferences: GrowthPlannerSource['sourceFactReferences']
}

export function buildCandidateDrafts(source: GrowthPlannerSource): OptimizationCandidateDraft[] {
  const marketProjection = projectGrowthMarketScopes(source.sourceProvenance)

  return marketProjection.scopes.map((scope) => {
    const eligibility = evaluateOptimizationEligibility({
      marketScopeMode: scope.marketScopeMode,
      provenanceReasonCodes: marketProjection.provenanceReasonCodes,
      growthRankingEligible: source.growthRankingEligible,
      growthScoreState: source.growthScoreState,
      growthScore: source.growthScore,
      growthLifecycleStatus: source.growthLifecycleStatus,
      opportunityType: source.opportunityType,
    })

    const candidateKey = buildOptimizationCandidateKey({
      projectId: source.projectId,
      growthOpportunityIdentityId: source.identityId,
      growthSnapshotId: source.snapshotId,
      marketScopeMode: scope.marketScopeMode,
      marketCode: scope.marketCode,
      locale: scope.locale,
    })

    return {
      projectId: source.projectId,
      growthOpportunityIdentityId: source.identityId,
      growthSnapshotId: source.snapshotId,
      candidateVersion: OPTIMIZATION_CANDIDATE_VERSION,
      candidateKey,
      marketScopeMode: scope.marketScopeMode,
      marketCode: scope.marketCode as CreateOptimizationCandidateInput['marketCode'],
      locale: scope.locale,
      opportunityType: source.opportunityType,
      normalizedQuery: source.normalizedQuery,
      canonicalPage: source.canonicalPage,
      growthScore: source.growthScore,
      growthScoreState: source.growthScoreState,
      growthPriority: source.growthPriority,
      growthEvidenceQuality: source.growthEvidenceQuality,
      growthEvidenceCoverage: source.growthEvidenceCoverage,
      growthRankingEligible: source.growthRankingEligible,
      growthLifecycleStatus: source.growthLifecycleStatus,
      sourceProvenance: {
        version: 'P9_A_SOURCE_PROVENANCE_V1',
        growthSnapshotVersion: source.snapshotVersion,
        growthFormulaVersion: source.formulaVersion,
        sourceFactReferences: source.sourceFactReferences.map((reference) => ({ ...reference })),
      },
      eligibilityState: eligibility.state,
      eligibilityReasonCodes: eligibility.reasonCodes,
      sourceFactReferences: source.sourceFactReferences.map((reference) => ({ ...reference })),
    }
  })
}