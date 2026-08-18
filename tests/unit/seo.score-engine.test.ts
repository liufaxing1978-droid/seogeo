import { describe, expect, it } from 'vitest';
import {
  SEVERITY_MULTIPLIER,
  calculateRulePenalty,
  calculateSeoScore
} from '../../src/modules/seo/score-engine.js';

describe('SEO score formula', () => {
  it('uses the approved severity multipliers', () => {
    expect(SEVERITY_MULTIPLIER).toEqual({
      CRITICAL: 4,
      HIGH: 2.5,
      MEDIUM: 1.5,
      LOW: 0.5
    });
  });

  it('calculates a deterministic page-impact penalty', () => {
    expect(
      calculateRulePenalty({
        weight: 3,
        severity: 'HIGH',
        affectedPages: 1,
        eligiblePages: 2
      })
    ).toEqual({
      affectedPages: 1,
      eligiblePages: 2,
      pageImpactFactor: 0.5,
      severityMultiplier: 2.5,
      weight: 3,
      importanceFactor: 1,
      penalty: 3.75
    });
  });

  it('does not invent impact when no page is eligible', () => {
    expect(
      calculateRulePenalty({
        weight: 4,
        severity: 'CRITICAL',
        affectedPages: 0,
        eligiblePages: 0
      }).penalty
    ).toBe(0);
  });

  it('clamps page impact to one and score to the 0..100 range', () => {
    expect(
      calculateRulePenalty({
        weight: 4,
        severity: 'CRITICAL',
        affectedPages: 10,
        eligiblePages: 2
      }).pageImpactFactor
    ).toBe(1);

    expect(calculateSeoScore([{ penalty: 120 }, { penalty: 30 }])).toBe(0);
    expect(calculateSeoScore([])).toBe(100);
  });
});
