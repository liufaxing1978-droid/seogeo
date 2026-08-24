import { describe, expect, it } from 'vitest';
import { buildFeedbackProfileIdentity } from '../../src/modules/optimization-feedback/feedback.identity.js';
import { calculateFeedbackProfile } from '../../src/modules/optimization-feedback/feedback.profile.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_CUTOFF = new Date('2026-01-01T00:00:00.000Z');

type Evidence = {
  id: string;
  observationId: string;
  effectState: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  inputCutoffAt: Date;
};

function evidence(
  id: string,
  effectState: Evidence['effectState'],
  day: number,
  observationId = `observation-${id}`
): Evidence {
  return {
    id,
    observationId,
    effectState,
    inputCutoffAt: new Date(BASE_CUTOFF.getTime() + day * DAY_MS)
  };
}

describe('P9-E rolling feedback profile', () => {
  it.each([
    [1, [evidence('e1', 'POSITIVE', 1)]],
    [2, [evidence('e1', 'POSITIVE', 1), evidence('e2', 'NEGATIVE', 2)]]
  ] as const)('keeps %i sample(s) at zero balance and zero adjustment', (_count, rows) => {
    const result = calculateFeedbackProfile(rows);

    expect(result.sampleCount).toBe(rows.length);
    expect(result.rollingEffectBalance).toBe(0);
    expect(result.historicalRankAdjustment).toBe(0);
  });

  it.each([
    [3, -4],
    [5, -5],
    [10, -7],
    [20, -8]
  ])('maps %i positive samples to the exact bounded adjustment %i', (count, expected) => {
    const rows = Array.from({ length: count }, (_, index) =>
      evidence(`positive-${index}`, 'POSITIVE', index)
    );

    const result = calculateFeedbackProfile(rows);

    expect(result.positiveCount).toBe(count);
    expect(result.neutralCount).toBe(0);
    expect(result.negativeCount).toBe(0);
    expect(result.rollingEffectBalance).toBe(1);
    expect(result.historicalRankAdjustment).toBe(expected);
  });

  it('produces the symmetric positive adjustment for negative history', () => {
    const result = calculateFeedbackProfile([
      evidence('n1', 'NEGATIVE', 1),
      evidence('n2', 'NEGATIVE', 2),
      evidence('n3', 'NEGATIVE', 3)
    ]);

    expect(result.rollingEffectBalance).toBe(-1);
    expect(result.historicalRankAdjustment).toBe(4);
  });

  it('returns zero for equal positive and negative history', () => {
    const result = calculateFeedbackProfile([
      evidence('p1', 'POSITIVE', 1),
      evidence('p2', 'POSITIVE', 2),
      evidence('n1', 'NEGATIVE', 3),
      evidence('n2', 'NEGATIVE', 4)
    ]);

    expect(result.positiveCount).toBe(2);
    expect(result.negativeCount).toBe(2);
    expect(result.rollingEffectBalance).toBe(0);
    expect(result.historicalRankAdjustment).toBe(0);
  });

  it('counts neutral evidence in sample size and shrinkage without adding to the numerator', () => {
    const result = calculateFeedbackProfile([
      evidence('p1', 'POSITIVE', 1),
      evidence('p2', 'POSITIVE', 2),
      evidence('u1', 'NEUTRAL', 3)
    ]);

    expect(result.sampleCount).toBe(3);
    expect(result.positiveCount).toBe(2);
    expect(result.neutralCount).toBe(1);
    expect(result.negativeCount).toBe(0);
    expect(result.rollingEffectBalance).toBeCloseTo(2 / 3, 12);
    expect(result.historicalRankAdjustment).toBe(-2);
  });

  it('retains exactly the latest 20 rows after cutoff then observation-id chronology', () => {
    const rows: Evidence[] = [
      evidence('same-cutoff-z', 'NEGATIVE', 0, 'observation-z'),
      evidence('same-cutoff-a', 'NEGATIVE', 0, 'observation-a'),
      ...Array.from({ length: 20 }, (_, index) =>
        evidence(`later-${index}`, 'POSITIVE', index + 1, `observation-later-${index}`)
      )
    ].reverse();

    const result = calculateFeedbackProfile(rows);

    expect(result.sampleCount).toBe(20);
    expect(result.orderedEvidenceIds).toEqual(
      Array.from({ length: 20 }, (_, index) => `later-${index}`)
    );
    expect(result.positiveCount).toBe(20);
    expect(result.negativeCount).toBe(0);
    expect(result.oldestEvidenceCutoffAt).toEqual(
      new Date(BASE_CUTOFF.getTime() + DAY_MS)
    );
    expect(result.newestEvidenceCutoffAt).toEqual(
      new Date(BASE_CUTOFF.getTime() + 20 * DAY_MS)
    );
  });

  it('uses observation id as the deterministic tie-breaker before applying the rolling limit', () => {
    const tied = Array.from({ length: 21 }, (_, index) => {
      const suffix = String(index).padStart(2, '0');
      return evidence(`e-${suffix}`, 'POSITIVE', 1, `observation-${suffix}`);
    }).reverse();

    const result = calculateFeedbackProfile(tied);

    expect(result.orderedEvidenceIds).toEqual(
      Array.from({ length: 20 }, (_, index) => `e-${String(index + 1).padStart(2, '0')}`)
    );
  });

  it('fails closed on duplicate evidence ids', () => {
    expect(() => calculateFeedbackProfile([
      evidence('duplicate', 'POSITIVE', 1, 'observation-1'),
      evidence('duplicate', 'NEGATIVE', 2, 'observation-2'),
      evidence('third', 'NEUTRAL', 3, 'observation-3')
    ])).toThrow();
  });

  it('fails closed on duplicate observation ids', () => {
    expect(() => calculateFeedbackProfile([
      evidence('first', 'POSITIVE', 1, 'same-observation'),
      evidence('second', 'NEGATIVE', 2, 'same-observation'),
      evidence('third', 'NEUTRAL', 3, 'observation-3')
    ])).toThrow();
  });

  it('always returns an integer adjustment within [-10,+10]', () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      evidence(`bounded-${index}`, index % 3 === 0 ? 'NEGATIVE' : 'POSITIVE', index)
    );

    const result = calculateFeedbackProfile(rows);

    expect(Number.isInteger(result.historicalRankAdjustment)).toBe(true);
    expect(result.historicalRankAdjustment).toBeGreaterThanOrEqual(-10);
    expect(result.historicalRankAdjustment).toBeLessThanOrEqual(10);
  });

  it('returns the exact chronological rolling evidence order consumed by profile identity', () => {
    const rows = [
      evidence('third', 'POSITIVE', 3, 'observation-3'),
      evidence('first', 'POSITIVE', 1, 'observation-1'),
      evidence('second', 'NEUTRAL', 2, 'observation-2')
    ];

    const result = calculateFeedbackProfile(rows);
    const identity = buildFeedbackProfileIdentity({
      projectId: '11111111-1111-4111-8111-111111111111',
      scopeKey: 'f'.repeat(64),
      orderedEvidenceIds: result.orderedEvidenceIds
    });
    const expected = buildFeedbackProfileIdentity({
      projectId: '11111111-1111-4111-8111-111111111111',
      scopeKey: 'f'.repeat(64),
      orderedEvidenceIds: ['first', 'second', 'third']
    });

    expect(result.orderedEvidenceIds).toEqual(['first', 'second', 'third']);
    expect(identity).toEqual(expected);
  });
});
