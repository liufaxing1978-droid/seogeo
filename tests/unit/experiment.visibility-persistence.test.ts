import { describe, expect, it } from 'vitest';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function frozenVisibilityExperiment(verifiedAnchorAt: Date) {
  return {
    id: 'visibility-experiment-1',
    projectId: 'project-1',
    publicationExecutionId: 'execution-1',
    interventionType: 'GEO_CITABILITY_IMPROVEMENT',
    targetUrl: 'https://example.com/page',
    verifiedAnchorAt,
    measurementScopeJson: {
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
    },
    observationScheduleJson: [{ windowType: '14D', windowDays: 14 }],
    expectedDirectionJson: { CITATION_RATE: 'HIGHER' }
  };
}

function visibilitySnapshot(input: {
  id: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  numerator: number;
  denominator: number;
}) {
  return {
    snapshotId: input.id,
    projectId: 'project-1',
    status: 'COMPLETED' as const,
    formulaVersion: 'VISIBILITY_METRICS_V1',
    extractorVersion: 'VISIBILITY_EXTRACTION_V1',
    subjectSetHash: 'subject-set-1',
    scopeHash: 'scope-1',
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    inputCutoffAt: input.inputCutoffAt,
    row: {
      rowId: `row-${input.id}`,
      projectId: 'project-1',
      metricType: 'CITATION_RATE' as const,
      metricStatus: 'CALCULATED' as const,
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'OWNED_ROLLUP',
      numerator: input.numerator,
      denominator: input.denominator,
      eligibleObservationCount: input.denominator
    }
  };
}

describe('P9-D visibility observation persistence', () => {
  it('persists numerator and denominator beside baseline/observed visibility rates', async () => {
    const verifiedAnchorAt = new Date('2026-08-08T12:00:00.000Z');
    const dueAt = new Date(verifiedAnchorAt.getTime() + 14 * DAY_MS);
    const captured: { persistedInput?: Record<string, unknown> } = {};

    const repository = {
      findExperimentForEvaluation: async () => frozenVisibilityExperiment(verifiedAnchorAt),
      listPublicationEvents: async () => [],
      listCompatibleSnapshots: async () => [
        visibilitySnapshot({
          id: 'baseline',
          windowStart: new Date(verifiedAnchorAt.getTime() - 14 * DAY_MS),
          windowEnd: verifiedAnchorAt,
          inputCutoffAt: new Date('2026-08-08T13:00:00.000Z'),
          numerator: 2,
          denominator: 20
        }),
        visibilitySnapshot({
          id: 'observed',
          windowStart: verifiedAnchorAt,
          windowEnd: dueAt,
          inputCutoffAt: new Date('2026-08-22T13:00:00.000Z'),
          numerator: 4,
          denominator: 20
        })
      ],
      createOrGetObservation: async (input: Record<string, unknown>) => {
        captured.persistedInput = input;
        return {
          id: 'visibility-observation-1',
          createdAt: new Date('2026-08-22T13:01:00.000Z'),
          ...input
        };
      }
    };

    const service = new OptimizationExperimentService(repository as never);
    (service as unknown as { now: () => Date }).now = () => new Date('2026-08-23T00:00:00.000Z');

    await (service as unknown as {
      evaluateWindow(input: {
        projectId: string;
        experimentId: string;
        windowType: '14D';
      }): Promise<Record<string, unknown> | null>;
    }).evaluateWindow({
      projectId: 'project-1',
      experimentId: 'visibility-experiment-1',
      windowType: '14D'
    });

    const persistedInput = captured.persistedInput;
    expect(persistedInput).toBeDefined();
    if (!persistedInput) {
      throw new Error('EXPECTED_VISIBILITY_OBSERVATION_PERSISTENCE');
    }
    expect(persistedInput).toMatchObject({
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      effectState: 'POSITIVE'
    });
    expect(persistedInput).toHaveProperty('baselineMetricsJson');
    expect(persistedInput).toHaveProperty('observedMetricsJson');
    expect(persistedInput.baselineMetricsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'VISIBILITY',
        metricKey: 'CITATION_RATE',
        value: 0.1,
        numerator: 2,
        denominator: 20
      })
    ]));
    expect(persistedInput.observedMetricsJson).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'VISIBILITY',
        metricKey: 'CITATION_RATE',
        value: 0.2,
        numerator: 4,
        denominator: 20
      })
    ]));
  });
});
