export const OPTIMIZATION_CANDIDATE_VERSION = 'OPTIMIZATION_CANDIDATE_V1' as const
export const OPTIMIZATION_PLAN_VERSION = 'OPTIMIZATION_PLAN_V1' as const
export const OPTIMIZATION_PLAN_V2 = 'OPTIMIZATION_PLAN_V2' as const
export const OPTIMIZATION_ACTION_MAP_VERSION = 'OPTIMIZATION_ACTION_MAP_V1' as const

export type OptimizationPlanVersion =
  | typeof OPTIMIZATION_PLAN_VERSION
  | typeof OPTIMIZATION_PLAN_V2

export type OptimizationMarketScopeMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY'
  | 'INVALID_PROVENANCE'

export type OptimizationEligibilityState = 'ELIGIBLE' | 'INELIGIBLE'

export type OptimizationEligibilityReason =
  | 'INVALID_MARKET_PROVENANCE'
  | 'SOURCE_PROVENANCE_MISSING'
  | 'GROWTH_NOT_RANKING_ELIGIBLE'
  | 'GROWTH_SCORE_UNKNOWN'
  | 'GROWTH_SCORE_MISSING'
  | 'GROWTH_LIFECYCLE_TERMINAL'
  | 'UNSUPPORTED_OPPORTUNITY_TYPE'

export type RecommendedActionType =
  | 'ON_PAGE_OPTIMIZATION'
  | 'SERP_SNIPPET_OPTIMIZATION'
  | 'CONTENT_CREATION'
  | 'TECHNICAL_SEO_REMEDIATION'
  | 'GEO_CITABILITY_IMPROVEMENT'
  | 'AI_VISIBILITY_IMPROVEMENT'
  | 'CANNIBALIZATION_REMEDIATION'
  | 'CONTENT_REFRESH'

export type OptimizationMarketScope = {
  marketScopeMode: OptimizationMarketScopeMode
  marketCode: string | null
  locale: string | null
}
