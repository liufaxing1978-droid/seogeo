import { describe, expect, it } from 'vitest';
import type { GrowthEvidence } from '../../src/modules/growth/growth-evidence.js';
import { known, unknown } from '../../src/modules/growth/growth-score.js';
import {
  detectNormalOpportunityTypes,
  selectPrimaryType
} from '../../src/modules/growth/growth-detectors.js';

function evidence(overrides: Partial<GrowthEvidence> = {}): GrowthEvidence {
  return {
    sourceModule: 'P2_SEO',
    sourceType: 'SEO_RULE_RESULT',
    sourceId: 'e1',
    sourceFactVersion: 'v1',
    ruleKey: 'TITLE_PRESENT',
    rootCauseKey: 'seo:title',
    evidenceState: 'FAIL',
    severity: 'HIGH',
    canonicalPage: 'https://example.com/page',
    numericValue: null,
    textSummary: null,
    fingerprint: 'f1',
    ...overrides
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    position: 12,
    positionPotential: known(85),
    ctrGap: known(0),
    gscTrend: known(0),
    p6Visibility: known(0),
    evidence: [] as GrowthEvidence[],
    ...overrides
  };
}

describe('P7-A normal Query+Page opportunity detectors', () => {
  it.each([
    [4, true], [20, true], [3, false], [21, false]
  ])('uses exact Ranking Upside position boundary %s', (position, expected) => {
    const result = detectNormalOpportunityTypes(input({ position, positionPotential: known(position <= 10 ? 100 : 85) }));
    expect(result.some((row) => row.type === 'RANKING_UPSIDE')).toBe(expected);
  });

  it('triggers CTR underperformance at score 30 and not below it', () => {
    expect(detectNormalOpportunityTypes(input({ ctrGap: known(30) })).some((row) => row.type === 'CTR_UNDERPERFORMANCE')).toBe(true);
    expect(detectNormalOpportunityTypes(input({ ctrGap: known(29) })).some((row) => row.type === 'CTR_UNDERPERFORMANCE')).toBe(false);
  });

  it('requires actionable non-INFO persisted SEO failures', () => {
    const high = detectNormalOpportunityTypes(input({ evidence: [evidence()] }));
    const info = detectNormalOpportunityTypes(input({ evidence: [evidence({ severity: 'INFO' })] }));
    expect(high.some((row) => row.type === 'SEO_GAP')).toBe(true);
    expect(info.some((row) => row.type === 'SEO_GAP')).toBe(false);
  });

  it('maps P3 citability and P5 content failures, but never UNKNOWN, to gap types', () => {
    const result = detectNormalOpportunityTypes(input({
      evidence: [
        evidence({ sourceModule: 'P3_CITABILITY', sourceId: 'p3', fingerprint: 'p3', rootCauseKey: 'p3', severity: 'MEDIUM' }),
        evidence({ sourceModule: 'P5_CONTENT', sourceId: 'p5', fingerprint: 'p5', rootCauseKey: 'p5', severity: 'LOW' }),
        evidence({ sourceModule: 'P5_CONTENT', sourceId: 'u1', fingerprint: 'u1', rootCauseKey: 'u1', evidenceState: 'UNKNOWN', severity: null })
      ]
    }));
    expect(result.some((row) => row.type === 'GEO_CITABILITY_GAP')).toBe(true);
    expect(result.some((row) => row.type === 'CONTENT_GAP')).toBe(true);
    expect(result.filter((row) => row.type === 'CONTENT_GAP')).toHaveLength(1);
  });

  it('triggers Declining Performance at the deterministic >=5% deterioration score boundary', () => {
    expect(detectNormalOpportunityTypes(input({ gscTrend: known(50) })).some((row) => row.type === 'DECLINING_PERFORMANCE')).toBe(true);
    expect(detectNormalOpportunityTypes(input({ gscTrend: known(49) })).some((row) => row.type === 'DECLINING_PERFORMANCE')).toBe(false);
    expect(detectNormalOpportunityTypes(input({ gscTrend: unknown() })).some((row) => row.type === 'DECLINING_PERFORMANCE')).toBe(false);
  });

  it('triggers AI Visibility Gap only for a known adverse signal >=25', () => {
    expect(detectNormalOpportunityTypes(input({ p6Visibility: known(25) })).some((row) => row.type === 'AI_VISIBILITY_GAP')).toBe(true);
    expect(detectNormalOpportunityTypes(input({ p6Visibility: known(24) })).some((row) => row.type === 'AI_VISIBILITY_GAP')).toBe(false);
    expect(detectNormalOpportunityTypes(input({ p6Visibility: unknown() })).some((row) => row.type === 'AI_VISIBILITY_GAP')).toBe(false);
  });

  it('selects greatest weighted contributing signal and uses fixed catalog order for exact ties', () => {
    const signals = detectNormalOpportunityTypes(input({
      position: 8,
      positionPotential: known(100),
      ctrGap: known(100),
      gscTrend: known(100),
      p6Visibility: known(100),
      evidence: [evidence()]
    }));
    expect(selectPrimaryType(signals)).toMatchObject({
      primaryType: 'RANKING_UPSIDE'
    });

    expect(selectPrimaryType([
      { type: 'SEO_GAP', signalScore: 100, weightedContribution: 15 },
      { type: 'CONTENT_GAP', signalScore: 100, weightedContribution: 15 }
    ])).toEqual({ primaryType: 'CONTENT_GAP', secondaryTypes: ['SEO_GAP'] });
  });
});
