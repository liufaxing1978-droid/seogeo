import { describe, expect, it } from 'vitest';
import { evaluateExperimentEffect } from '../../src/modules/optimization-experiments/experiment.evaluator.js';
import type {
  ExperimentMetricComparison,
  ExperimentWindowResolution
} from '../../src/modules/optimization-experiments/experiment.types.js';

function comparison(overrides: Partial<ExperimentMetricComparison> = {}): ExperimentMetricComparison {
  return {
    family: 'SEARCH',
    metricKey: 'CLICKS',
    role: 'PRIMARY',
    direction: 'HIGHER',
    baselineValue: 100,
    observedValue: 110,
    baselineZeroIsExplicit: false,
    baselineSourceRefs: ['baseline:1'],
    observedSourceRefs: ['observed:1'],
    reasonCodes: [],
    ...overrides
  };
}

function resolution(overrides: Partial<ExperimentWindowResolution> = {}): ExperimentWindowResolution {
  return {
    comparisons: [comparison()],
    baselineSearchSourceRefs: ['baseline:1'],
    observedSearchSourceRefs: ['observed:1'],
    baselineVisibilitySourceRefs: [],
    observedVisibilitySourceRefs: [],
    coverageState: 'SUFFICIENT',
    reasonCodes: [],
    inputCutoffAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides
  };
}

describe('P9-D deterministic experiment evaluator', () => {
  it('is INCONCLUSIVE when coverage is not sufficient', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({ coverageState: 'PARTIAL', reasonCodes: ['SEARCH_WINDOW_INCOMPLETE'] }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('INCONCLUSIVE');
    expect(result.coverageState).toBe('PARTIAL');
    expect(result.reasonCodes).toContain('SEARCH_WINDOW_INCOMPLETE');
  });

  it('is INCONCLUSIVE when the observation is contaminated', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution(),
      contaminationState: 'CONFLICTING_MUTATION',
      contaminationReasonCodes: ['OTHER_DEPLOYMENT_IN_WINDOW']
    });

    expect(result.effectState).toBe('INCONCLUSIVE');
    expect(result.contaminationState).toBe('CONFLICTING_MUTATION');
    expect(result.reasonCodes).toContain('OTHER_DEPLOYMENT_IN_WINDOW');
  });

  it.each([
    ['CLICKS', 100, 101.9],
    ['IMPRESSIONS', 1000, 1019]
  ] as const)('treats sub-2%% relative %s movement as NEUTRAL', (metricKey, baselineValue, observedValue) => {
    const result = evaluateExperimentEffect({
      resolution: resolution({ comparisons: [comparison({ metricKey, baselineValue, observedValue })] }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('NEUTRAL');
  });

  it('treats explicit known zero-to-zero as NEUTRAL', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({ baselineValue: 0, observedValue: 0, baselineZeroIsExplicit: true })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('NEUTRAL');
    expect(result.deltaMetrics[0]).toMatchObject({ absoluteDelta: 0, relativeDelta: 0 });
  });

  it('treats explicit known zero-to-positive as POSITIVE without inventing an infinite relative delta', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({ baselineValue: 0, observedValue: 5, baselineZeroIsExplicit: true })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('POSITIVE');
    expect(result.deltaMetrics[0]).toMatchObject({ absoluteDelta: 5, relativeDelta: null });
  });

  it('does not treat a missing or inferred zero baseline as numeric evidence', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({
          baselineValue: 0,
          observedValue: 5,
          baselineZeroIsExplicit: false,
          reasonCodes: ['BASELINE_ZERO_NOT_EXPLICIT']
        })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('INCONCLUSIVE');
  });

  it('uses a 0.02 absolute threshold for CTR', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({ metricKey: 'CTR', baselineValue: 0.30, observedValue: 0.319 })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('NEUTRAL');
  });

  it('uses a 1.0 absolute threshold for position and treats lower as favorable', () => {
    const neutral = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({
          metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION',
          direction: 'LOWER',
          baselineValue: 10,
          observedValue: 9.1
        })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });
    const positive = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({
          metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION',
          direction: 'LOWER',
          baselineValue: 10,
          observedValue: 8.9
        })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(neutral.effectState).toBe('NEUTRAL');
    expect(positive.effectState).toBe('POSITIVE');
  });

  it('uses a 0.05 absolute threshold for visibility rates', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [comparison({
          family: 'VISIBILITY',
          metricKey: 'CITATION_RATE',
          baselineValue: 0.40,
          observedValue: 0.449
        })]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('NEUTRAL');
  });

  it('reports POSITIVE when the primary metric improves and secondary metrics are not significantly adverse', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [
          comparison({ metricKey: 'CLICKS', role: 'PRIMARY', baselineValue: 100, observedValue: 110 }),
          comparison({ metricKey: 'CTR', role: 'SECONDARY', baselineValue: 0.30, observedValue: 0.291 })
        ]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('POSITIVE');
  });

  it('reports NEGATIVE when the primary metric worsens and secondary metrics are not significantly favorable', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [
          comparison({ metricKey: 'CLICKS', role: 'PRIMARY', baselineValue: 100, observedValue: 90 }),
          comparison({ metricKey: 'CTR', role: 'SECONDARY', baselineValue: 0.30, observedValue: 0.305 })
        ]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('NEGATIVE');
  });

  it('reports INCONCLUSIVE when significant metric directions conflict', () => {
    const result = evaluateExperimentEffect({
      resolution: resolution({
        comparisons: [
          comparison({ metricKey: 'CLICKS', role: 'PRIMARY', baselineValue: 100, observedValue: 110 }),
          comparison({ metricKey: 'CTR', role: 'SECONDARY', baselineValue: 0.30, observedValue: 0.26 })
        ]
      }),
      contaminationState: 'CLEAR',
      contaminationReasonCodes: []
    });

    expect(result.effectState).toBe('INCONCLUSIVE');
  });
});
