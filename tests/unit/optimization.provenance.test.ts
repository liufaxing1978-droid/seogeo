import { describe, expect, it } from 'vitest'
import { buildOptimizationCandidateKey } from '../../src/modules/optimization/optimization.candidate.js'
import { projectGrowthMarketScopes } from '../../src/modules/optimization/optimization.provenance.js'

describe('P9-A Growth market provenance projection', () => {
  it('projects configured market scopes from P9-0G scoring-lane provenance in deterministic order', () => {
    const result = projectGrowthMarketScopes({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: {
          marketProjections: [
            { marketCode: 'GLOBAL', locale: 'en', propertyRef: 'gsc:site' },
            { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' },
            { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' },
          ],
        },
      },
    })

    expect(result).toEqual({
      scopes: [
        { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'CN', locale: 'zh-CN' },
        { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'GLOBAL', locale: 'en' },
      ],
      provenanceReasonCodes: [],
    })
  })

  it('projects legacy Growth provenance without inventing market or locale', () => {
    expect(projectGrowthMarketScopes({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          source: 'RAW_GSC_COMPATIBILITY',
          gscSnapshotIds: ['snapshot-1'],
        },
      },
    })).toEqual({
      scopes: [{ marketScopeMode: 'UNCONFIGURED_LEGACY', marketCode: null, locale: null }],
      provenanceReasonCodes: [],
    })
  })

  it('creates one auditable invalid-provenance scope when source provenance is missing', () => {
    expect(projectGrowthMarketScopes({})).toEqual({
      scopes: [{ marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }],
      provenanceReasonCodes: ['SOURCE_PROVENANCE_MISSING'],
    })
  })

  it('creates one auditable invalid-provenance scope for malformed configured projections', () => {
    expect(projectGrowthMarketScopes({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: { marketProjections: [{ marketCode: 'CN', locale: '' }] },
      },
    })).toEqual({
      scopes: [{ marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }],
      provenanceReasonCodes: ['INVALID_MARKET_PROVENANCE'],
    })
  })

  it('creates one auditable invalid-provenance scope for an unsupported market code', () => {
    expect(projectGrowthMarketScopes({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: { marketProjections: [{ marketCode: 'MARS', locale: 'en' }] },
      },
    })).toEqual({
      scopes: [{ marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }],
      provenanceReasonCodes: ['INVALID_MARKET_PROVENANCE'],
    })
  })

  it('builds the same candidate key for the same stable identity regardless of object construction order', () => {
    const first = buildOptimizationCandidateKey({
      projectId: '11111111-1111-4111-8111-111111111111',
      growthOpportunityIdentityId: '22222222-2222-4222-8222-222222222222',
      growthSnapshotId: '33333333-3333-4333-8333-333333333333',
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'CN',
      locale: 'zh-CN',
    })
    const second = buildOptimizationCandidateKey({
      locale: 'zh-CN',
      marketCode: 'CN',
      marketScopeMode: 'CONFIGURED_MARKET',
      growthSnapshotId: '33333333-3333-4333-8333-333333333333',
      growthOpportunityIdentityId: '22222222-2222-4222-8222-222222222222',
      projectId: '11111111-1111-4111-8111-111111111111',
    })

    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes candidate identity when the Growth snapshot changes', () => {
    const base = {
      projectId: '11111111-1111-4111-8111-111111111111',
      growthOpportunityIdentityId: '22222222-2222-4222-8222-222222222222',
      marketScopeMode: 'UNCONFIGURED_LEGACY' as const,
      marketCode: null,
      locale: null,
    }
    expect(buildOptimizationCandidateKey({ ...base, growthSnapshotId: '33333333-3333-4333-8333-333333333333' }))
      .not.toBe(buildOptimizationCandidateKey({ ...base, growthSnapshotId: '44444444-4444-4444-8444-444444444444' }))
  })
})
