import { describe, expect, it } from 'vitest';
import {
  buildExperimentKey,
  buildObservationKey
} from '../../src/modules/optimization-experiments/experiment.identity.js';

const anchor = new Date('2026-08-24T06:00:00.000Z');
const dueAt = new Date('2026-09-07T06:00:00.000Z');
const cutoff = new Date('2026-09-08T00:00:00.000Z');

function experimentInput() {
  return {
    projectId: '11111111-1111-4111-8111-111111111111',
    optimizationPlanId: '22222222-2222-4222-8222-222222222222',
    publicationExecutionId: '33333333-3333-4333-8333-333333333333',
    publicationVerificationId: '44444444-4444-4444-8444-444444444444',
    interventionType: 'CONTENT_CREATION',
    targetUrl: 'https://xingshantang.org/culture/liuren-history',
    marketCode: 'US',
    locale: 'zh-CN',
    verifiedAnchorAt: anchor,
    measurementScope: {
      kind: 'SEARCH' as const,
      provider: 'GOOGLE_SEARCH_CONSOLE' as const,
      marketCode: 'US',
      locale: 'zh-CN',
      propertyRef: 'sc-domain:xingshantang.org',
      normalizedQuery: '六壬文化',
      canonicalPage: null,
      aggregationScope: 'QUERY' as const
    },
    observationSchedule: [
      { windowType: '14D' as const, windowDays: 14 as const },
      { windowType: '28D' as const, windowDays: 28 as const },
      { windowType: '56D' as const, windowDays: 56 as const }
    ],
    expectedDirections: { IMPRESSIONS: 'HIGHER' as const, CLICKS: 'HIGHER' as const }
  };
}

function observationInput() {
  return {
    experimentId: '55555555-5555-4555-8555-555555555555',
    windowType: '14D' as const,
    windowDays: 14,
    dueAt,
    inputCutoffAt: cutoff,
    baselineSearchSourceRefs: ['snapshot-b', 'snapshot-a'],
    observedSearchSourceRefs: ['snapshot-d', 'snapshot-c'],
    baselineVisibilitySourceRefs: ['visibility-b', 'visibility-a'],
    observedVisibilitySourceRefs: ['visibility-d', 'visibility-c'],
    evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
  };
}

describe('P9-D experiment identity', () => {
  it('is stable across equivalent object key order', () => {
    const first = experimentInput();
    const reordered = {
      ...first,
      measurementScope: {
        aggregationScope: first.measurementScope.aggregationScope,
        canonicalPage: first.measurementScope.canonicalPage,
        normalizedQuery: first.measurementScope.normalizedQuery,
        propertyRef: first.measurementScope.propertyRef,
        locale: first.measurementScope.locale,
        marketCode: first.measurementScope.marketCode,
        provider: first.measurementScope.provider,
        kind: first.measurementScope.kind
      },
      expectedDirections: { CLICKS: 'HIGHER' as const, IMPRESSIONS: 'HIGHER' as const }
    };

    expect(buildExperimentKey(first)).toBe(buildExperimentKey(reordered));
    expect(buildExperimentKey(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when an immutable execution or verification binding changes', () => {
    const base = experimentInput();

    expect(buildExperimentKey({
      ...base,
      publicationExecutionId: '66666666-6666-4666-8666-666666666666'
    })).not.toBe(buildExperimentKey(base));
    expect(buildExperimentKey({
      ...base,
      publicationVerificationId: '77777777-7777-4777-8777-777777777777'
    })).not.toBe(buildExperimentKey(base));
  });

  it('normalizes observation source refs by trim, dedupe, and sort', () => {
    const first = observationInput();
    const equivalent = {
      ...first,
      baselineSearchSourceRefs: [' snapshot-a ', 'snapshot-b', 'snapshot-a'],
      observedSearchSourceRefs: ['snapshot-c', ' snapshot-d ', 'snapshot-c'],
      baselineVisibilitySourceRefs: ['visibility-a', 'visibility-b', 'visibility-a'],
      observedVisibilitySourceRefs: [' visibility-c ', 'visibility-d']
    };

    expect(buildObservationKey(first)).toBe(buildObservationKey(equivalent));
    expect(buildObservationKey(first)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes when window, cutoff, source identity, or evaluator version changes', () => {
    const base = observationInput();
    const key = buildObservationKey(base);

    expect(buildObservationKey({ ...base, windowType: '28D', windowDays: 28 })).not.toBe(key);
    expect(buildObservationKey({ ...base, inputCutoffAt: new Date('2026-09-09T00:00:00.000Z') })).not.toBe(key);
    expect(buildObservationKey({ ...base, observedSearchSourceRefs: ['snapshot-z'] })).not.toBe(key);
    expect(buildObservationKey({ ...base, evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V2' })).not.toBe(key);
  });

  it('rejects empty source refs instead of hashing ambiguous identity', () => {
    expect(() => buildObservationKey({
      ...observationInput(),
      baselineSearchSourceRefs: ['snapshot-a', '   ']
    })).toThrow(/source ref/i);
  });
});
