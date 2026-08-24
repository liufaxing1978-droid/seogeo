import { describe, expect, it } from 'vitest';
import {
  FeedbackObservability,
  type FeedbackObservabilityEvent
} from '../../src/modules/optimization-feedback/feedback.observability.js';

const ALLOWED_KEYS = new Set([
  'event',
  'projectId',
  'experimentId',
  'observationId',
  'feedbackEvidenceId',
  'feedbackProfileId',
  'recommendedActionType',
  'marketCode',
  'locale',
  'sampleCount',
  'historicalRankAdjustment',
  'reasonCode'
]);

describe('P9-E feedback observability', () => {
  it('rebuilds an allowlisted payload and drops unsafe/raw fields', () => {
    const events: FeedbackObservabilityEvent[] = [];
    const observability = new FeedbackObservability((event) => events.push(event));

    observability.emit({
      event: 'optimization.feedback.accepted',
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      feedbackEvidenceId: 'evidence-1',
      feedbackProfileId: 'profile-1',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
      marketCode: 'HK',
      locale: 'zh-Hant',
      sampleCount: 3,
      historicalRankAdjustment: -4,
      reasonCode: 'safe',
      rawMetrics: { ctr: 0.42 },
      prompt: 'secret prompt',
      body: 'secret body',
      providerPayload: { token: 'secret' }
    } as FeedbackObservabilityEvent & Record<string, unknown>);

    expect(events).toHaveLength(1);
    expect(Object.keys(events[0]!).every((key) => ALLOWED_KEYS.has(key))).toBe(true);
    expect(events[0]).toEqual({
      event: 'optimization.feedback.accepted',
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      feedbackEvidenceId: 'evidence-1',
      feedbackProfileId: 'profile-1',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
      marketCode: 'HK',
      locale: 'zh-Hant',
      sampleCount: 3,
      historicalRankAdjustment: -4,
      reasonCode: 'safe'
    });
  });

  it('strips control whitespace and truncates every emitted string to 160 characters', () => {
    const events: FeedbackObservabilityEvent[] = [];
    const observability = new FeedbackObservability((event) => events.push(event));
    const dirty = `${'x'.repeat(170)}\r\n\tend`;

    observability.emit({
      event: 'optimization.feedback.deferred',
      projectId: dirty,
      experimentId: dirty,
      observationId: dirty,
      feedbackEvidenceId: dirty,
      feedbackProfileId: dirty,
      recommendedActionType: dirty,
      marketCode: dirty,
      locale: dirty,
      reasonCode: dirty
    });

    const emitted = events[0]!;
    for (const value of Object.values(emitted)) {
      if (typeof value !== 'string' || value.startsWith('optimization.feedback.')) continue;
      expect(value.length).toBeLessThanOrEqual(160);
      expect(value).not.toMatch(/[\r\n\t]/);
    }
  });

  it('supports only the bounded P9-E event catalog', () => {
    const events: FeedbackObservabilityEvent[] = [];
    const observability = new FeedbackObservability((event) => events.push(event));

    for (const event of [
      'optimization.feedback.accepted',
      'optimization.feedback.deferred',
      'optimization.feedback.profile.created',
      'optimization.feedback.reconciled'
    ] as const) {
      observability.emit({ event, projectId: 'project-1' });
    }

    expect(events.map((item) => item.event)).toEqual([
      'optimization.feedback.accepted',
      'optimization.feedback.deferred',
      'optimization.feedback.profile.created',
      'optimization.feedback.reconciled'
    ]);
  });
});
