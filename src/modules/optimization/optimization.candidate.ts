import { createHash } from 'node:crypto'
import {
  OPTIMIZATION_CANDIDATE_VERSION,
  type OptimizationMarketScopeMode,
} from './optimization.types.js'

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
