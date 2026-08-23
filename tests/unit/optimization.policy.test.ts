import { describe, expect, it } from 'vitest'
import {
  evaluateOptimizationEligibility,
  recommendedActionForGrowthType,
} from '../../src/modules/optimization/optimization.policy.js'

describe('P9-A optimization policy', () => {
  it('maps every P7 V1 opportunity type deterministically', () => {
    expect(recommendedActionForGrowthType('RANKING_UPSIDE')).toBe('ON_PAGE_OPTIMIZATION')
    expect(recommendedActionForGrowthType('CTR_UNDERPERFORMANCE')).toBe('SERP_SNIPPET_OPTIMIZATION')
    expect(recommendedActionForGrowthType('CONTENT_GAP')).toBe('CONTENT_CREATION')
    expect(recommendedActionForGrowthType('NEW_CONTENT_OPPORTUNITY')).toBe('CONTENT_CREATION')
    expect(recommendedActionForGrowthType('SEO_GAP')).toBe('TECHNICAL_SEO_REMEDIATION')
    expect(recommendedActionForGrowthType('GEO_CITABILITY_GAP')).toBe('GEO_CITABILITY_IMPROVEMENT')
    expect(recommendedActionForGrowthType('AI_VISIBILITY_GAP')).toBe('AI_VISIBILITY_IMPROVEMENT')
    expect(recommendedActionForGrowthType('KEYWORD_CANNIBALIZATION')).toBe('CANNIBALIZATION_REMEDIATION')
    expect(recommendedActionForGrowthType('DECLINING_PERFORMANCE')).toBe('CONTENT_REFRESH')
    expect(recommendedActionForGrowthType('FUTURE_UNKNOWN')).toBeNull()
  })

  it('keeps UNKNOWN score ineligible instead of converting it to zero', () => {
    expect(evaluateOptimizationEligibility({
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      provenanceReasonCodes: [],
      growthRankingEligible: true,
      growthScoreState: 'UNKNOWN',
      growthScore: null,
      growthLifecycleStatus: 'NEW',
      opportunityType: 'RANKING_UPSIDE',
    })).toEqual({
      state: 'INELIGIBLE',
      reasonCodes: ['GROWTH_SCORE_UNKNOWN', 'GROWTH_SCORE_MISSING'],
    })
  })

  it.each(['DONE', 'DISMISSED', 'RESOLVED'])('rejects terminal Growth lifecycle %s', (growthLifecycleStatus) => {
    expect(evaluateOptimizationEligibility({
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      provenanceReasonCodes: [],
      growthRankingEligible: true,
      growthScoreState: 'KNOWN',
      growthScore: 75,
      growthLifecycleStatus,
      opportunityType: 'RANKING_UPSIDE',
    })).toEqual({
      state: 'INELIGIBLE',
      reasonCodes: ['GROWTH_LIFECYCLE_TERMINAL'],
    })
  })

  it('forces invalid provenance ineligible before ranking', () => {
    expect(evaluateOptimizationEligibility({
      marketScopeMode: 'INVALID_PROVENANCE',
      provenanceReasonCodes: ['SOURCE_PROVENANCE_MISSING'],
      growthRankingEligible: true,
      growthScoreState: 'KNOWN',
      growthScore: 90,
      growthLifecycleStatus: 'NEW',
      opportunityType: 'RANKING_UPSIDE',
    })).toEqual({
      state: 'INELIGIBLE',
      reasonCodes: ['SOURCE_PROVENANCE_MISSING'],
    })
  })

  it('allows a fully known non-terminal supported candidate', () => {
    expect(evaluateOptimizationEligibility({
      marketScopeMode: 'CONFIGURED_MARKET',
      provenanceReasonCodes: [],
      growthRankingEligible: true,
      growthScoreState: 'KNOWN',
      growthScore: 88,
      growthLifecycleStatus: 'REOPENED',
      opportunityType: 'AI_VISIBILITY_GAP',
    })).toEqual({ state: 'ELIGIBLE', reasonCodes: [] })
  })
})
