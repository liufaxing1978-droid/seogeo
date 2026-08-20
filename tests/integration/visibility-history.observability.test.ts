import { describe, expect, it, vi } from 'vitest';
import {
  P6D_OBSERVABILITY_EVENTS,
  VisibilityHistoryObservability
} from '../../src/modules/visibility/visibility-history.observability.js';

describe('P6-D safe observability', () => {
  it('exposes only the approved lifecycle event names', () => {
    expect(P6D_OBSERVABILITY_EVENTS).toEqual([
      'visibility.history.comparison.completed',
      'visibility.history.comparison.incomparable',
      'visibility.history.comparison.failed',
      'visibility.alert.triggered',
      'visibility.alert.acknowledged',
      'visibility.alert.resolved',
      'visibility.monitoring.reconcile.completed',
      'report.v2.generated'
    ]);
  });

  it('emits only bounded allowlisted metadata and strips private payloads', () => {
    const sink = vi.fn();
    const observability = new VisibilityHistoryObservability(sink);

    observability.emit({
      event: 'visibility.alert.triggered',
      projectId: 'project\nprivate',
      comparisonId: 'comparison-1',
      ruleId: 'rule-1',
      alertId: 'alert-1',
      metricType: 'MENTION_RATE',
      actorKey: 'COMPETITOR:abc',
      status: 'OPEN',
      reasonCode: 'OWNED_MENTION_RATE_DROP',
      deltaBasisPoints: -500,
      alertCount: 1,
      durationMs: 12,
      promptText: 'secret prompt',
      answerText: 'secret answer',
      providerBody: { secret: true },
      authorization: 'Bearer secret',
      aliases: ['private-alias'],
      canonicalValue: 'private-canonical',
      citationUrl: 'https://private.example/path',
      reasoning: 'private reasoning',
      subjectSnapshotJson: { prompt: 'private' },
      metricRows: [{ private: true }],
      reportJson: { private: true }
    });

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      event: 'visibility.alert.triggered',
      projectId: 'project private',
      comparisonId: 'comparison-1',
      ruleId: 'rule-1',
      alertId: 'alert-1',
      metricType: 'MENTION_RATE',
      actorKey: 'COMPETITOR:abc',
      status: 'OPEN',
      reasonCode: 'OWNED_MENTION_RATE_DROP',
      deltaBasisPoints: -500,
      alertCount: 1,
      durationMs: 12
    });
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/secret prompt|secret answer|private-alias|private-canonical|private\.example|private reasoning|Bearer secret/);
  });

  it('drops non-finite numbers and bounds string metadata', () => {
    const sink = vi.fn();
    const observability = new VisibilityHistoryObservability(sink);
    observability.emit({
      event: 'visibility.monitoring.reconcile.completed',
      projectId: 'p'.repeat(500),
      processedCount: Number.POSITIVE_INFINITY,
      enqueuedCount: 4,
      durationMs: Number.NaN
    });

    const emitted = sink.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(emitted.projectId)).toHaveLength(160);
    expect(emitted).not.toHaveProperty('processedCount');
    expect(emitted.enqueuedCount).toBe(4);
    expect(emitted).not.toHaveProperty('durationMs');
  });
});
