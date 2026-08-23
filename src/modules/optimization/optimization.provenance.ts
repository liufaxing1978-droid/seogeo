import { MARKET_CODES } from '../market/market.types.js'
import type {
  OptimizationEligibilityReason,
  OptimizationMarketScope,
} from './optimization.types.js'

type UnknownRecord = Record<string, unknown>

const VALID_MARKET_CODES: ReadonlySet<string> = new Set(MARKET_CODES)

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function invalid(reason: OptimizationEligibilityReason): {
  scopes: OptimizationMarketScope[]
  provenanceReasonCodes: OptimizationEligibilityReason[]
} {
  return {
    scopes: [{ marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }],
    provenanceReasonCodes: [reason],
  }
}

export function projectGrowthMarketScopes(sourceProvenance: unknown): {
  scopes: OptimizationMarketScope[]
  provenanceReasonCodes: OptimizationEligibilityReason[]
} {
  const root = asRecord(sourceProvenance)
  const searchFacts = root ? asRecord(root.searchFacts) : null
  if (!searchFacts) return invalid('SOURCE_PROVENANCE_MISSING')

  if (searchFacts.version !== 'GROWTH_SEARCH_PROVENANCE_V1') {
    return invalid('INVALID_MARKET_PROVENANCE')
  }

  if (searchFacts.mode === 'UNCONFIGURED_LEGACY') {
    return {
      scopes: [{ marketScopeMode: 'UNCONFIGURED_LEGACY', marketCode: null, locale: null }],
      provenanceReasonCodes: [],
    }
  }

  if (searchFacts.mode !== 'CONFIGURED_MARKET') {
    return invalid('INVALID_MARKET_PROVENANCE')
  }

  const scoringLane = asRecord(searchFacts.scoringLane)
  const marketProjections = scoringLane?.marketProjections
  if (!Array.isArray(marketProjections) || marketProjections.length === 0) {
    return invalid('INVALID_MARKET_PROVENANCE')
  }

  const unique = new Map<string, OptimizationMarketScope>()
  for (const rawProjection of marketProjections) {
    const projection = asRecord(rawProjection)
    const marketCode = typeof projection?.marketCode === 'string' ? projection.marketCode.trim() : ''
    const locale = typeof projection?.locale === 'string' ? projection.locale.trim() : ''
    if (!marketCode || !VALID_MARKET_CODES.has(marketCode) || !locale) {
      return invalid('INVALID_MARKET_PROVENANCE')
    }
    const key = `${marketCode}\u0000${locale}`
    unique.set(key, { marketScopeMode: 'CONFIGURED_MARKET', marketCode, locale })
  }

  const scopes = [...unique.values()].sort(
    (left, right) => left.marketCode!.localeCompare(right.marketCode!) || left.locale!.localeCompare(right.locale!),
  )

  return { scopes, provenanceReasonCodes: [] }
}
