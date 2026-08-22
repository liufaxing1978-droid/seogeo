import type {
  OptimizationEligibilityReason,
  OptimizationEligibilityState,
  OptimizationMarketScopeMode,
  RecommendedActionType,
} from './optimization.types.js'

const ACTION_BY_GROWTH_TYPE: Readonly<Record<string, RecommendedActionType>> = Object.freeze({
  RANKING_UPSIDE: 'ON_PAGE_OPTIMIZATION',
  CTR_UNDERPERFORMANCE: 'SERP_SNIPPET_OPTIMIZATION',
  CONTENT_GAP: 'CONTENT_CREATION',
  NEW_CONTENT_OPPORTUNITY: 'CONTENT_CREATION',
  SEO_GAP: 'TECHNICAL_SEO_REMEDIATION',
  GEO_CITABILITY_GAP: 'GEO_CITABILITY_IMPROVEMENT',
  AI_VISIBILITY_GAP: 'AI_VISIBILITY_IMPROVEMENT',
  KEYWORD_CANNIBALIZATION: 'CANNIBALIZATION_REMEDIATION',
  DECLINING_PERFORMANCE: 'CONTENT_REFRESH',
})

const TERMINAL_LIFECYCLE = new Set(['DONE', 'DISMISSED', 'RESOLVED'])

const REASON_ORDER: readonly OptimizationEligibilityReason[] = [
  'INVALID_MARKET_PROVENANCE',
  'SOURCE_PROVENANCE_MISSING',
  'GROWTH_NOT_RANKING_ELIGIBLE',
  'GROWTH_SCORE_UNKNOWN',
  'GROWTH_SCORE_MISSING',
  'GROWTH_LIFECYCLE_TERMINAL',
  'UNSUPPORTED_OPPORTUNITY_TYPE',
]

export function recommendedActionForGrowthType(type: string): RecommendedActionType | null {
  return ACTION_BY_GROWTH_TYPE[type] ?? null
}

export function evaluateOptimizationEligibility(input: {
  marketScopeMode: OptimizationMarketScopeMode
  provenanceReasonCodes: readonly OptimizationEligibilityReason[]
  growthRankingEligible: boolean
  growthScoreState: string
  growthScore: number | null
  growthLifecycleStatus: string
  opportunityType: string
}): { state: OptimizationEligibilityState; reasonCodes: OptimizationEligibilityReason[] } {
  const reasons = new Set<OptimizationEligibilityReason>(input.provenanceReasonCodes)

  if (input.marketScopeMode === 'INVALID_PROVENANCE' && reasons.size === 0) {
    reasons.add('INVALID_MARKET_PROVENANCE')
  }
  if (!input.growthRankingEligible) reasons.add('GROWTH_NOT_RANKING_ELIGIBLE')
  if (input.growthScoreState !== 'KNOWN') reasons.add('GROWTH_SCORE_UNKNOWN')
  if (input.growthScore === null || !Number.isFinite(input.growthScore)) reasons.add('GROWTH_SCORE_MISSING')
  if (TERMINAL_LIFECYCLE.has(input.growthLifecycleStatus)) reasons.add('GROWTH_LIFECYCLE_TERMINAL')
  if (recommendedActionForGrowthType(input.opportunityType) === null) reasons.add('UNSUPPORTED_OPPORTUNITY_TYPE')

  const reasonCodes = REASON_ORDER.filter((reason) => reasons.has(reason))
  return {
    state: reasonCodes.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE',
    reasonCodes,
  }
}
