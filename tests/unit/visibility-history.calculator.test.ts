import { describe, expect, it } from 'vitest';
import {
  assertComparableSnapshots,
  calculateCoverageBasisPoints,
  calculateVisibilityHistoryDeltaRows
} from '../../src/modules/visibility/visibility-history.calculator.js';
import {
  VisibilityHistoryError,
  type VisibilityHistoryMetricRowInput,
  type VisibilityHistorySnapshotContract
} from '../../src/modules/visibility/visibility-history.types.js';

const DAY = 24 * 60 * 60 * 1000;

function snapshot(
  id: string,
  windowStart: string,
  windowEnd: string,
  overrides: Partial<VisibilityHistorySnapshotContract> = {}
): VisibilityHistorySnapshotContract {
  return {
    id,
    projectId: 'project-a',
    formulaVersion: 'VISIBILITY_METRICS_V1',
    extractorVersion: 'VISIBILITY_EXTRACTOR_V1',
    subjectSetHash: 'subject-set-a',
    scopeHash: 'scope-a',
    windowStart: new Date(windowStart),
    windowEnd: new Date(windowEnd),
    ...overrides
  };
}

function metricRow(
  overrides: Partial<VisibilityHistoryMetricRowInput> = {}
): VisibilityHistoryMetricRowInput {
  return {
    metricType: 'MENTION_RATE',
    metricStatus: 'CALCULATED',
    dimensionType: 'OVERALL',
    dimensionKey: 'OVERALL',
    actorType: 'OWNED_ROLLUP',
    actorSubjectId: null,
    actorKey: 'OWNED_ROLLUP',
    numerator: 1,
    denominator: 4,
    ...overrides
  };
}

function expectHistoryError(fn: () => unknown, code: string) {
  try {
    fn();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(VisibilityHistoryError);
    expect((error as VisibilityHistoryError).code).toBe(code);
  }
}

describe('P6-D visibility history comparison calculator', () => {
  it('accepts equal non-overlapping measurement windows and records an explicit gap', () => {
    const previous = snapshot(
      'previous',
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z'
    );
    const current = snapshot(
      'current',
      '2026-07-10T00:00:00.000Z',
      '2026-07-17T00:00:00.000Z'
    );

    expect(assertComparableSnapshots(current, previous)).toEqual({
      windowDurationMs: 7 * DAY,
      gapDurationMs: 2 * DAY
    });
  });

  it('rejects cross-project comparisons', () => {
    const previous = snapshot('previous', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = snapshot('current', '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', {
      projectId: 'project-b'
    });

    expectHistoryError(
      () => assertComparableSnapshots(current, previous),
      'VISIBILITY_HISTORY_PROJECT_MISMATCH'
    );
  });

  it.each([
    ['formulaVersion', 'VISIBILITY_METRICS_V2', 'VISIBILITY_HISTORY_FORMULA_MISMATCH'],
    ['extractorVersion', 'VISIBILITY_EXTRACTOR_V2', 'VISIBILITY_HISTORY_EXTRACTOR_MISMATCH'],
    ['subjectSetHash', 'subject-set-b', 'VISIBILITY_HISTORY_SUBJECT_SET_MISMATCH'],
    ['scopeHash', 'scope-b', 'VISIBILITY_HISTORY_SCOPE_MISMATCH']
  ] as const)('rejects incompatible %s contracts', (field, value, code) => {
    const previous = snapshot('previous', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = snapshot('current', '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', {
      [field]: value
    });

    expectHistoryError(() => assertComparableSnapshots(current, previous), code);
  });

  it('rejects unequal measurement window durations', () => {
    const previous = snapshot('previous', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = snapshot('current', '2026-07-08T00:00:00.000Z', '2026-07-18T00:00:00.000Z');

    expectHistoryError(
      () => assertComparableSnapshots(current, previous),
      'VISIBILITY_HISTORY_WINDOW_MISMATCH'
    );
  });

  it('rejects overlapping measurement windows', () => {
    const previous = snapshot('previous', '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = snapshot('current', '2026-07-07T00:00:00.000Z', '2026-07-14T00:00:00.000Z');

    expectHistoryError(
      () => assertComparableSnapshots(current, previous),
      'VISIBILITY_HISTORY_WINDOW_OVERLAP'
    );
  });

  it('calculates absolute percentage-point change in basis points', () => {
    const rows = calculateVisibilityHistoryDeltaRows({
      previousRows: [metricRow({ numerator: 1, denominator: 5 })],
      currentRows: [metricRow({ numerator: 1, denominator: 4 })]
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      previousMetricStatus: 'CALCULATED',
      currentMetricStatus: 'CALCULATED',
      previousNumerator: 1,
      previousDenominator: 5,
      currentNumerator: 1,
      currentDenominator: 4,
      deltaBasisPoints: 500
    });
  });

  it('preserves legitimate calculated zero when comparing 0% to 10%', () => {
    const rows = calculateVisibilityHistoryDeltaRows({
      previousRows: [metricRow({ numerator: 0, denominator: 10 })],
      currentRows: [metricRow({ numerator: 1, denominator: 10 })]
    });

    expect(rows[0]?.deltaBasisPoints).toBe(1000);
  });

  it('never coerces UNKNOWN or another non-calculated state into a numeric delta', () => {
    const rows = calculateVisibilityHistoryDeltaRows({
      previousRows: [metricRow({ numerator: 2, denominator: 4 })],
      currentRows: [metricRow({ metricStatus: 'UNKNOWN', numerator: 0, denominator: 0 })]
    });

    expect(rows[0]).toMatchObject({
      previousMetricStatus: 'CALCULATED',
      currentMetricStatus: 'UNKNOWN',
      deltaBasisPoints: null
    });
  });

  it('requires denominator greater than zero on both calculated sides before emitting a numeric delta', () => {
    const rows = calculateVisibilityHistoryDeltaRows({
      previousRows: [metricRow({ numerator: 0, denominator: 0 })],
      currentRows: [metricRow({ numerator: 1, denominator: 4 })]
    });

    expect(rows[0]?.deltaBasisPoints).toBeNull();
  });

  it('matches rows by metric, dimension, dimension key and actor key, independent of source ordering', () => {
    const previousRows = [
      metricRow({ metricType: 'CITATION_RATE', actorKey: 'OWNED_ROLLUP', numerator: 1, denominator: 2 }),
      metricRow({
        metricType: 'MENTION_SHARE_OF_VOICE',
        actorType: 'COMPETITOR',
        actorSubjectId: 'competitor-a',
        actorKey: 'COMPETITOR:competitor-a',
        numerator: 2,
        denominator: 5
      })
    ];
    const currentRows = [
      metricRow({
        metricType: 'MENTION_SHARE_OF_VOICE',
        actorType: 'COMPETITOR',
        actorSubjectId: 'competitor-a',
        actorKey: 'COMPETITOR:competitor-a',
        numerator: 3,
        denominator: 5
      }),
      metricRow({ metricType: 'CITATION_RATE', actorKey: 'OWNED_ROLLUP', numerator: 3, denominator: 4 })
    ];

    const rows = calculateVisibilityHistoryDeltaRows({ currentRows, previousRows });

    expect(rows.map((row) => [row.metricType, row.actorKey, row.deltaBasisPoints])).toEqual([
      ['CITATION_RATE', 'OWNED_ROLLUP', 2500],
      ['MENTION_SHARE_OF_VOICE', 'COMPETITOR:competitor-a', 2000]
    ]);
  });

  it('fails closed when one comparison side is missing an expected row identity', () => {
    expectHistoryError(
      () => calculateVisibilityHistoryDeltaRows({
        previousRows: [metricRow()],
        currentRows: [metricRow({ metricType: 'CITATION_RATE' })]
      }),
      'VISIBILITY_HISTORY_ROW_MISSING'
    );
  });

  it('calculates Evidence Coverage as an operational ratio and preserves no-data as null', () => {
    expect(calculateCoverageBasisPoints({
      previousCandidateCount: 100,
      previousCompletedCount: 80,
      currentCandidateCount: 100,
      currentCompletedCount: 60
    })).toEqual({
      previousBasisPoints: 8000,
      currentBasisPoints: 6000,
      deltaBasisPoints: -2000
    });

    expect(calculateCoverageBasisPoints({
      previousCandidateCount: 0,
      previousCompletedCount: 0,
      currentCandidateCount: 100,
      currentCompletedCount: 100
    })).toEqual({
      previousBasisPoints: null,
      currentBasisPoints: 10000,
      deltaBasisPoints: null
    });
  });
});
