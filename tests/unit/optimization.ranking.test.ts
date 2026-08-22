import { describe, expect, it } from 'vitest'
import type { OptimizationCandidateDraft } from '../../src/modules/optimization/optimization.candidate.js'
import {
  applyBoundedRankAdjustments,
  rankEligibleCandidates,
} from '../../src/modules/optimization/optimization.ranking.js'

function candidate(overrides: Partial<OptimizationCandidateDraft> = {}): OptimizationCandidateDraft {
  return {
    projectId: '00000000-0000-4000-8000-000000000001',
    growthOpportunityIdentityId: '00000000-0000-4000-8000-000000000002',
    growthSnapshotId: '00000000-0000-4000-8000-000000000003',
    candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
    candidateKey: 'a'.repeat(64),
    marketScopeMode: 'UNCONFIGURED_LEGACY',
    marketCode: null,
    locale: null,
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: 'planner',
    canonicalPage: 'https://example.com/planner',
    growthScore: 80,
    growthScoreState: 'KNOWN',
    growthPriority: 'HIGH',
    growthEvidenceQuality: 'COMPLETE',
    growthEvidenceCoverage: 0.8,
    growthRankingEligible: true,
    growthLifecycleStatus: 'NEW',
    sourceProvenance: { version: 'P9_A_SOURCE_PROVENANCE_V1' },
    eligibilityState: 'ELIGIBLE',
    eligibilityReasonCodes: [],
    sourceFactReferences: [],
    ...overrides,
  }
}

function rankedSeed(rank: number, key: string) {
  return {
    candidateId: `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`,
    candidateKey: key.repeat(64),
    deterministicRank: rank,
  }
}

describe('P9-A deterministic ranking', () => {
  it('sorts by P7 score, priority, evidence coverage, then candidate key', () => {
    const ranked = rankEligibleCandidates([
      candidate({ candidateKey: 'f'.repeat(64), growthScore: 90, growthPriority: 'HIGH', growthEvidenceCoverage: 0.5 }),
      candidate({ candidateKey: 'e'.repeat(64), growthScore: 90, growthPriority: 'CRITICAL', growthEvidenceCoverage: 0.1 }),
      candidate({ candidateKey: 'd'.repeat(64), growthScore: 90, growthPriority: 'HIGH', growthEvidenceCoverage: 0.9 }),
      candidate({ candidateKey: 'b'.repeat(64), growthScore: 80, growthPriority: 'HIGH', growthEvidenceCoverage: 1 }),
      candidate({ candidateKey: 'a'.repeat(64), growthScore: 80, growthPriority: 'HIGH', growthEvidenceCoverage: 1 }),
    ])

    expect(ranked.map(({ candidateKey, deterministicRank }) => ({ candidateKey: candidateKey[0], deterministicRank }))).toEqual([
      { candidateKey: 'e', deterministicRank: 1 },
      { candidateKey: 'd', deterministicRank: 2 },
      { candidateKey: 'f', deterministicRank: 3 },
      { candidateKey: 'a', deterministicRank: 4 },
      { candidateKey: 'b', deterministicRank: 5 },
    ])
  })

  it('excludes ineligible audit candidates without inventing a replacement score', () => {
    const ranked = rankEligibleCandidates([
      candidate({ candidateKey: 'a'.repeat(64), growthScore: 70 }),
      candidate({
        candidateKey: 'z'.repeat(64),
        growthScore: null,
        growthScoreState: 'UNKNOWN',
        eligibilityState: 'INELIGIBLE',
        eligibilityReasonCodes: ['GROWTH_SCORE_UNKNOWN', 'GROWTH_SCORE_MISSING'],
      }),
    ])

    expect(ranked).toHaveLength(1)
    expect(ranked[0]).toMatchObject({ candidateKey: 'a'.repeat(64), growthScore: 70, deterministicRank: 1 })
  })

  it('uses negative adjustments to improve rank and positive adjustments to worsen rank within the two-place bound', () => {
    const first = rankedSeed(1, 'a')
    const second = rankedSeed(2, 'b')
    const third = rankedSeed(3, 'c')

    const adjusted = applyBoundedRankAdjustments(
      [first, second, third],
      [
        { candidateId: first.candidateId, adjustment: 1 },
        { candidateId: second.candidateId, adjustment: -1 },
      ],
    )

    expect(adjusted).toEqual([
      { candidateId: first.candidateId, deterministicRank: 1, aiRankAdjustment: 1, finalRank: 2 },
      { candidateId: second.candidateId, deterministicRank: 2, aiRankAdjustment: -1, finalRank: 1 },
      { candidateId: third.candidateId, deterministicRank: 3, aiRankAdjustment: 0, finalRank: 3 },
    ])
  })

  it('breaks adjusted-signal ties by deterministic rank then candidate key', () => {
    const first = rankedSeed(1, 'b')
    const second = rankedSeed(2, 'a')
    const third = rankedSeed(3, 'c')

    const adjusted = applyBoundedRankAdjustments(
      [first, second, third],
      [
        { candidateId: first.candidateId, adjustment: 1 },
        { candidateId: second.candidateId, adjustment: 0 },
      ],
    )

    expect(adjusted.find((item) => item.candidateId === first.candidateId)?.finalRank).toBe(1)
    expect(adjusted.find((item) => item.candidateId === second.candidateId)?.finalRank).toBe(2)
  })

  it('rejects the whole AI set to deterministic zero when any final displacement exceeds two places', () => {
    const ranked = [
      rankedSeed(1, 'a'),
      rankedSeed(2, 'b'),
      rankedSeed(3, 'c'),
      rankedSeed(4, 'd'),
      rankedSeed(5, 'e'),
      rankedSeed(6, 'f'),
      rankedSeed(7, 'g'),
    ]

    const adjusted = applyBoundedRankAdjustments(
      ranked,
      [
        { candidateId: ranked[0]!.candidateId, adjustment: 2 },
        { candidateId: ranked[1]!.candidateId, adjustment: 2 },
        { candidateId: ranked[2]!.candidateId, adjustment: 2 },
        { candidateId: ranked[3]!.candidateId, adjustment: -2 },
        { candidateId: ranked[4]!.candidateId, adjustment: -2 },
        { candidateId: ranked[5]!.candidateId, adjustment: -2 },
        { candidateId: ranked[6]!.candidateId, adjustment: -2 },
      ],
    )

    expect(adjusted).toEqual(ranked.map((item) => ({
      candidateId: item.candidateId,
      deterministicRank: item.deterministicRank,
      aiRankAdjustment: 0,
      finalRank: item.deterministicRank,
    })))
  })
})
