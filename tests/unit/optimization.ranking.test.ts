import { describe, expect, it } from 'vitest'
import type { OptimizationCandidateDraft } from '../../src/modules/optimization/optimization.candidate.js'
import { rankEligibleCandidates } from '../../src/modules/optimization/optimization.ranking.js'

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
})
