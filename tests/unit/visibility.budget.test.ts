import { describe, expect, it } from 'vitest';
import { checkVisibilityBudget } from '../../src/modules/visibility/visibility-budget.js';

describe('P6-A visibility budget formula', () => {
  it('allows an observation whose estimated spend lands exactly on the ceiling', () => {
    expect(
      checkVisibilityBudget({
        runCeilingMicros: 100,
        dailyCeilingMicros: null,
        runRecordedSpendMicros: 80,
        dailyRecordedSpendMicros: 0,
        estimatedNextMicros: 20
      })
    ).toEqual({
      allowed: true,
      reason: 'WITHIN_BUDGET',
      runRecordedSpendMicros: 80,
      dailyRecordedSpendMicros: 0,
      estimatedNextMicros: 20
    });
  });

  it('blocks one micro over the run ceiling', () => {
    expect(
      checkVisibilityBudget({
        runCeilingMicros: 100,
        dailyCeilingMicros: null,
        runRecordedSpendMicros: 80,
        dailyRecordedSpendMicros: 0,
        estimatedNextMicros: 21
      })
    ).toMatchObject({
      allowed: false,
      reason: 'RUN_BUDGET_EXCEEDED'
    });
  });

  it('blocks one micro over the daily ceiling even when the run ceiling allows it', () => {
    expect(
      checkVisibilityBudget({
        runCeilingMicros: 500,
        dailyCeilingMicros: 100,
        runRecordedSpendMicros: 10,
        dailyRecordedSpendMicros: 90,
        estimatedNextMicros: 11
      })
    ).toMatchObject({
      allowed: false,
      reason: 'DAILY_BUDGET_EXCEEDED'
    });
  });

  it('fails closed when a finite budget exists but the next provider cost cannot be estimated', () => {
    expect(
      checkVisibilityBudget({
        runCeilingMicros: 100,
        dailyCeilingMicros: null,
        runRecordedSpendMicros: 0,
        dailyRecordedSpendMicros: 0,
        estimatedNextMicros: null
      })
    ).toMatchObject({
      allowed: false,
      reason: 'BUDGET_ESTIMATE_UNAVAILABLE'
    });
  });

  it('allows an unknown estimate when neither run nor daily budget is configured', () => {
    expect(
      checkVisibilityBudget({
        runCeilingMicros: null,
        dailyCeilingMicros: null,
        runRecordedSpendMicros: 0,
        dailyRecordedSpendMicros: 0,
        estimatedNextMicros: null
      })
    ).toMatchObject({
      allowed: true,
      reason: 'WITHIN_BUDGET'
    });
  });
});
