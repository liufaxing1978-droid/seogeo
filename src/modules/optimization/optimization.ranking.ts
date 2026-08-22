import type { OptimizationCandidateDraft } from './optimization.candidate.js'

const PRIORITY_ORDER: Readonly<Record<string, number>> = Object.freeze({
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  MONITOR: 4,
  UNKNOWN: 5,
})

export type RankedCandidate = OptimizationCandidateDraft & {
  deterministicRank: number
}

export type BoundedRankSeed = {
  candidateId: string
  candidateKey: string
  deterministicRank: number
}

export type BoundedRankResult = {
  candidateId: string
  deterministicRank: number
  aiRankAdjustment: number
  finalRank: number
}

export function rankEligibleCandidates(
  candidates: readonly OptimizationCandidateDraft[],
): RankedCandidate[] {
  const eligible = candidates
    .filter((candidate) => candidate.eligibilityState === 'ELIGIBLE')
    .map((candidate) => {
      if (candidate.growthScore === null || !Number.isFinite(candidate.growthScore)) {
        throw new Error('Eligible optimization candidate must have a finite P7 growth score')
      }
      return candidate
    })
    .sort((left, right) => {
      const score = right.growthScore! - left.growthScore!
      if (score !== 0) return score

      const priority = (PRIORITY_ORDER[left.growthPriority] ?? Number.MAX_SAFE_INTEGER)
        - (PRIORITY_ORDER[right.growthPriority] ?? Number.MAX_SAFE_INTEGER)
      if (priority !== 0) return priority

      const coverage = right.growthEvidenceCoverage - left.growthEvidenceCoverage
      if (coverage !== 0) return coverage

      return left.candidateKey.localeCompare(right.candidateKey)
    })

  return eligible.map((candidate, index) => ({
    ...candidate,
    deterministicRank: index + 1,
  }))
}

function deterministicZero(ranked: readonly BoundedRankSeed[]): BoundedRankResult[] {
  return ranked.map((item) => ({
    candidateId: item.candidateId,
    deterministicRank: item.deterministicRank,
    aiRankAdjustment: 0,
    finalRank: item.deterministicRank,
  }))
}

export function applyBoundedRankAdjustments(
  ranked: readonly BoundedRankSeed[],
  adjustments: readonly { candidateId: string; adjustment: number }[],
): BoundedRankResult[] {
  const rankedIds = new Set(ranked.map((item) => item.candidateId))
  if (rankedIds.size !== ranked.length) {
    throw new Error('Optimization ranking seeds must have unique candidate ids')
  }

  const adjustmentByCandidate = new Map<string, number>()
  for (const item of adjustments) {
    if (!rankedIds.has(item.candidateId)) {
      throw new Error(`Unknown optimization ranking candidate ${item.candidateId}`)
    }
    if (adjustmentByCandidate.has(item.candidateId)) {
      throw new Error(`Duplicate optimization ranking adjustment ${item.candidateId}`)
    }
    if (!Number.isInteger(item.adjustment) || item.adjustment < -2 || item.adjustment > 2) {
      throw new Error('Optimization ranking adjustment must be an integer from -2 through 2')
    }
    adjustmentByCandidate.set(item.candidateId, item.adjustment)
  }

  const ordered = ranked
    .map((item) => ({
      ...item,
      aiRankAdjustment: adjustmentByCandidate.get(item.candidateId) ?? 0,
      adjustedRankSignal: item.deterministicRank + (adjustmentByCandidate.get(item.candidateId) ?? 0),
    }))
    .sort((left, right) => (
      left.adjustedRankSignal - right.adjustedRankSignal
      || left.deterministicRank - right.deterministicRank
      || left.candidateKey.localeCompare(right.candidateKey)
    ))

  const finalRankByCandidate = new Map(
    ordered.map((item, index) => [item.candidateId, index + 1] as const),
  )

  const result = ranked.map((item) => ({
    candidateId: item.candidateId,
    deterministicRank: item.deterministicRank,
    aiRankAdjustment: adjustmentByCandidate.get(item.candidateId) ?? 0,
    finalRank: finalRankByCandidate.get(item.candidateId)!,
  }))

  if (result.some((item) => Math.abs(item.finalRank - item.deterministicRank) > 2)) {
    return deterministicZero(ranked)
  }

  return result
}
