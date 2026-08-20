import { describe, expect, it } from 'vitest';
import { evaluateVisibilityAlertRule, visibilityAlertFingerprint } from '../../src/modules/visibility/visibility-alerts.service.js';

const row = (overrides: Record<string, unknown> = {}) => ({
  metricType: 'MENTION_RATE' as const,
  dimensionType: 'OVERALL' as const,
  dimensionKey: 'OVERALL',
  actorType: 'OWNED_ROLLUP' as const,
  actorSubjectId: null,
  actorKey: 'OWNED_ROLLUP',
  previousMetricStatus: 'CALCULATED' as const,
  currentMetricStatus: 'CALCULATED' as const,
  deltaBasisPoints: -500,
  ...overrides
});

describe('P6-D deterministic alert evaluator', () => {
  it('triggers numeric rules at the exact threshold and never treats null delta as zero', () => {
    expect(evaluateVisibilityAlertRule({ ruleType: 'OWNED_MENTION_RATE_DROP', thresholdBasisPoints: 500, actorSubjectId: null }, row())).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'OWNED_CITATION_RATE_DROP', thresholdBasisPoints: 500, actorSubjectId: null }, row({ metricType: 'CITATION_RATE' }))).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'OWNED_SOV_DROP', thresholdBasisPoints: 500, actorSubjectId: null }, row({ metricType: 'MENTION_SHARE_OF_VOICE' }))).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'OWNED_MENTION_RATE_DROP', thresholdBasisPoints: 500, actorSubjectId: null }, row({ deltaBasisPoints: null }))).toBe(false);
  });

  it('supports any-competitor and targeted competitor SOV rise', () => {
    const competitor = row({ metricType: 'MENTION_SHARE_OF_VOICE', actorType: 'COMPETITOR', actorKey: 'COMPETITOR:1', actorSubjectId: '00000000-0000-0000-0000-000000000001', deltaBasisPoints: 600 });
    expect(evaluateVisibilityAlertRule({ ruleType: 'COMPETITOR_SOV_RISE', thresholdBasisPoints: 500, actorSubjectId: null }, competitor)).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'COMPETITOR_SOV_RISE', thresholdBasisPoints: 500, actorSubjectId: competitor.actorSubjectId }, competitor)).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'COMPETITOR_SOV_RISE', thresholdBasisPoints: 500, actorSubjectId: '00000000-0000-0000-0000-000000000002' }, competitor)).toBe(false);
  });

  it('detects UNKNOWN state transitions without numeric coercion', () => {
    expect(evaluateVisibilityAlertRule({ ruleType: 'METRIC_BECAME_UNKNOWN', thresholdBasisPoints: null, actorSubjectId: null }, row({ previousMetricStatus: 'CALCULATED', currentMetricStatus: 'UNKNOWN', deltaBasisPoints: null }))).toBe(true);
    expect(evaluateVisibilityAlertRule({ ruleType: 'METRIC_BECAME_UNKNOWN', thresholdBasisPoints: null, actorSubjectId: null }, row({ previousMetricStatus: 'NO_DATA', currentMetricStatus: 'NO_DATA', deltaBasisPoints: null }))).toBe(false);
  });

  it('uses a deterministic rule/comparison/actor fingerprint', () => {
    expect(visibilityAlertFingerprint('rule-1', 'comparison-1', 'OWNED_ROLLUP')).toBe(visibilityAlertFingerprint('rule-1', 'comparison-1', 'OWNED_ROLLUP'));
    expect(visibilityAlertFingerprint('rule-1', 'comparison-1', null)).not.toBe(visibilityAlertFingerprint('rule-1', 'comparison-2', null));
  });
});
