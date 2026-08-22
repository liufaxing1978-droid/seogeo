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
