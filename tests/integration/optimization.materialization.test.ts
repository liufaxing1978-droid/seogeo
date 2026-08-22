import { describe, expect, it } from 'vitest';
import { buildCandidateDrafts } from '../../src/modules/optimization/optimization.candidate.js';
import type { GrowthPlannerSource } from '../../src/modules/optimization/optimization.repository.js';

function growthSource(overrides: Partial<GrowthPlannerSource> = {}): GrowthPlannerSource {
  return {
    projectId: '11111111-1111-4111-8111-111111111111',
    identityId: '22222222-2222-4222-8222-222222222222',
    snapshotId: '33333333-3333-4333-8333-333333333333',
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: 'p9-a planner',
    canonicalPage: 'https://example.com/p9-a',
    growthScore: 82,
    growthScoreState: 'KNOWN',
    growthPriority: 'HIGH',
    growthEvidenceQuality: 'COMPLETE',
    growthEvidenceCoverage: 1,
    growthRankingEligible: true,
    growthLifecycleStatus: 'NEW',
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' },
      },
    },
    sourceFactReferences: [
      { type: 'GROWTH_OPPORTUNITY_IDENTITY', id: '22222222-2222-4222-8222-222222222222' },
      { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: '33333333-3333-4333-8333-333333333333' },
    ],
    ...overrides,
  };
}

describe('P9-A candidate materialization', () => {
  it('fans configured P9-0G market projections out deterministically and dedupes exact pairs', () => {
    const drafts = buildCandidateDrafts(growthSource({
      sourceProvenance: {
        searchFacts: {
          version: 'GROWTH_SEARCH_PROVENANCE_V1',
          mode: 'CONFIGURED_MARKET',
          scoringLane: {
            provider: 'GOOGLE_SEARCH_CONSOLE',
            marketProjections: [
              { marketCode: 'GLOBAL', locale: 'en', propertyRef: 'gsc:site' },
              { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' },
              { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' },
            ],
          },
        },
      },
    }));

    expect(drafts).toHaveLength(2);
    expect(drafts.map(({ marketScopeMode, marketCode, locale }) => ({
      marketScopeMode,
      marketCode,
      locale,
    }))).toEqual([
      { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'CN', locale: 'zh-CN' },
      { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'GLOBAL', locale: 'en' },
    ]);
    expect(new Set(drafts.map((draft) => draft.candidateKey)).size).toBe(2);
    expect(drafts.every((draft) => draft.eligibilityState === 'ELIGIBLE')).toBe(true);
  });

  it('keeps legacy Growth as one null-market audit candidate without inventing a market', () => {
    const drafts = buildCandidateDrafts(growthSource());

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: [],
    });
  });

  it('persists malformed provenance as one fail-closed audit candidate instead of dropping it', () => {
    const drafts = buildCandidateDrafts(growthSource({ sourceProvenance: {} }));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      marketScopeMode: 'INVALID_PROVENANCE',
      marketCode: null,
      locale: null,
      eligibilityState: 'INELIGIBLE',
      eligibilityReasonCodes: ['SOURCE_PROVENANCE_MISSING'],
    });
  });

  it('still emits terminal and UNKNOWN-score audit candidates as ineligible', () => {
    const terminal = buildCandidateDrafts(growthSource({ growthLifecycleStatus: 'DONE' }));
    const unknown = buildCandidateDrafts(growthSource({
      snapshotId: '44444444-4444-4444-8444-444444444444',
      growthScore: null,
      growthScoreState: 'UNKNOWN',
    }));

    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      eligibilityState: 'INELIGIBLE',
      eligibilityReasonCodes: ['GROWTH_LIFECYCLE_TERMINAL'],
    });
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({
      growthScore: null,
      growthScoreState: 'UNKNOWN',
      eligibilityState: 'INELIGIBLE',
      eligibilityReasonCodes: ['GROWTH_SCORE_UNKNOWN', 'GROWTH_SCORE_MISSING'],
    });
  });

  it('is deterministic for an unchanged source and gives a newer Growth snapshot a new immutable identity', () => {
    const original = growthSource();
    const first = buildCandidateDrafts(original);
    const rerun = buildCandidateDrafts(original);
    const newer = buildCandidateDrafts(growthSource({
      snapshotId: '55555555-5555-4555-8555-555555555555',
      growthScore: 90,
    }));

    expect(rerun).toEqual(first);
    expect(first).toHaveLength(1);
    expect(newer).toHaveLength(1);
    expect(newer[0]?.candidateKey).not.toBe(first[0]?.candidateKey);
    expect(first[0]).toMatchObject({
      growthSnapshotId: '33333333-3333-4333-8333-333333333333',
      growthScore: 82,
    });
    expect(newer[0]).toMatchObject({
      growthSnapshotId: '55555555-5555-4555-8555-555555555555',
      growthScore: 90,
    });
  });
});