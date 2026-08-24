import { describe, expect, it } from 'vitest';
import {
  resolveVisibilityWindowComparison,
  type VisibilityExperimentSnapshotView,
  type VisibilityExperimentSourcePort
} from '../../src/modules/optimization-experiments/experiment.visibility-source.js';
import type { VisibilityExperimentMeasurementScope } from '../../src/modules/optimization-experiments/experiment.types.js';

const scope: VisibilityExperimentMeasurementScope = {
  kind: 'VISIBILITY',
  metricType: 'CITATION_RATE',
  subjectSetHash: 'subject-set-1',
  scopeHash: 'scope-1',
  formulaVersion: 'VISIBILITY_METRICS_V1',
  extractorVersion: 'VISIBILITY_EXTRACTION_V1',
  dimensionType: 'OVERALL',
  dimensionKey: 'OVERALL',
  actorType: 'OWNED_ROLLUP',
  actorKey: 'OWNED_ROLLUP'
};

function snapshot(input: {
  id: string;
  windowStart: string;
  windowEnd: string;
  inputCutoffAt: string;
  numerator: number;
  denominator?: number;
  eligible?: number;
}): VisibilityExperimentSnapshotView {
  return {
    snapshotId: input.id,
    projectId: 'project-1',
    status: 'COMPLETED',
    formulaVersion: scope.formulaVersion,
    extractorVersion: scope.extractorVersion,
    subjectSetHash: scope.subjectSetHash,
    scopeHash: scope.scopeHash,
    windowStart: new Date(input.windowStart),
    windowEnd: new Date(input.windowEnd),
    inputCutoffAt: new Date(input.inputCutoffAt),
    row: {
      rowId: `row-${input.id}`,
      projectId: 'project-1',
      metricType: scope.metricType,
      metricStatus: input.numerator === 0 ? 'NO_SIGNAL' : 'CALCULATED',
      dimensionType: scope.dimensionType,
      dimensionKey: scope.dimensionKey,
      actorType: scope.actorType,
      actorKey: scope.actorKey,
      numerator: input.numerator,
      denominator: input.denominator ?? 20,
      eligibleObservationCount: input.eligible ?? 20
    }
  };
}

describe('P9-D visibility metric window resolver', () => {
  it('selects the latest compatible baseline and earliest compatible observed snapshot deterministically', async () => {
    const snapshots = [
      snapshot({
        id: 'baseline-older',
        windowStart: '2026-07-30T00:00:00.000Z',
        windowEnd: '2026-08-06T00:00:00.000Z',
        inputCutoffAt: '2026-08-06T01:00:00.000Z',
        numerator: 1
      }),
      snapshot({
        id: 'baseline-selected',
        windowStart: '2026-08-01T00:00:00.000Z',
        windowEnd: '2026-08-08T00:00:00.000Z',
        inputCutoffAt: '2026-08-08T01:00:00.000Z',
        numerator: 2
      }),
      snapshot({
        id: 'observed-selected',
        windowStart: '2026-08-15T00:00:00.000Z',
        windowEnd: '2026-08-22T00:00:00.000Z',
        inputCutoffAt: '2026-08-22T01:00:00.000Z',
        numerator: 4
      }),
      snapshot({
        id: 'observed-later',
        windowStart: '2026-08-16T00:00:00.000Z',
        windowEnd: '2026-08-23T00:00:00.000Z',
        inputCutoffAt: '2026-08-23T01:00:00.000Z',
        numerator: 6
      })
    ];
    let received: { projectId: string; scope: VisibilityExperimentMeasurementScope } | null = null;
    const source: VisibilityExperimentSourcePort = {
      async listCompatibleSnapshots(input) {
        received = input;
        return snapshots;
      }
    };

    const result = await resolveVisibilityWindowComparison({
      projectId: 'project-1',
      scope,
      verifiedAnchorAt: new Date('2026-08-08T12:00:00.000Z'),
      dueAt: new Date('2026-08-22T00:00:00.000Z'),
      windowType: '14D',
      source
    });

    expect(received).toEqual({ projectId: 'project-1', scope });
    expect(result.coverageState).toBe('SUFFICIENT');
    expect(result.reasonCodes).toEqual([]);
    expect(result.comparisons).toEqual([
      expect.objectContaining({
        family: 'VISIBILITY',
        metricKey: 'CITATION_RATE',
        direction: 'HIGHER',
        baselineValue: 0.1,
        observedValue: 0.2,
        baselineZeroIsExplicit: false
      })
    ]);
    expect(result.baselineVisibilitySourceRefs).toEqual([
      'VISIBILITY_METRIC:baseline-selected:row-baseline-selected'
    ]);
    expect(result.observedVisibilitySourceRefs).toEqual([
      'VISIBILITY_METRIC:observed-selected:row-observed-selected'
    ]);
    expect(result.inputCutoffAt.toISOString()).toBe('2026-08-22T01:00:00.000Z');
  });
});
