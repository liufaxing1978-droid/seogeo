import { describe, expect, it, vi } from 'vitest';
import { VisibilityHistoryService } from '../../src/modules/visibility/visibility-history.service.js';
import { processVisibilityMonitoringJob } from '../../src/modules/visibility/visibility-monitoring.worker.js';
import {
  P6D_OBSERVABILITY_EVENTS,
  VisibilityHistoryObservability
} from '../../src/modules/visibility/visibility-history.observability.js';

function completedSnapshot(id: string, projectId = 'project-1', start = '2026-07-01T00:00:00.000Z') {
  const windowStart = new Date(start);
  const windowEnd = new Date(windowStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    id,
    projectId,
    status: 'COMPLETED',
    formulaVersion: 'VISIBILITY_METRICS_V1',
    extractorVersion: 'VISIBILITY_EXTRACTION_V1',
    subjectSetHash: 'subject-hash',
    scopeHash: 'scope-hash',
    windowStart,
    windowEnd
  };
}

const row = {
  metricType: 'MENTION_RATE',
  metricStatus: 'CALCULATED',
  dimensionType: 'OVERALL',
  dimensionKey: 'OVERALL',
  actorType: 'OWNED_ROLLUP',
  actorSubjectId: null,
  actorKey: 'OWNED_ROLLUP',
  numerator: 2,
  denominator: 10
};

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

  it('emits comparison completion only after durable comparison creation', async () => {
    const sink = vi.fn();
    const observability = new VisibilityHistoryObservability(sink);
    const previous = completedSnapshot('previous-1');
    const current = completedSnapshot('current-1', 'project-1', '2026-07-08T00:00:00.000Z');
    const createComparisonAtomic = vi.fn(async () => {
      expect(sink).not.toHaveBeenCalled();
      return { id: 'comparison-1' };
    });
    const repository = {
      getSnapshot: vi.fn(async () => current),
      findNearestCompatiblePrevious: vi.fn(async () => previous),
      findComparison: vi.fn(async () => null),
      listRows: vi.fn(async () => [row]),
      createComparisonAtomic
    };

    const service = new VisibilityHistoryService(repository as never, observability);
    await expect(service.materializeForSnapshot('project-1', 'current-1')).resolves.toEqual({
      comparisonId: 'comparison-1',
      outcome: 'COMPLETED'
    });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.history.comparison.completed',
      projectId: 'project-1',
      currentSnapshotId: 'current-1',
      previousSnapshotId: 'previous-1',
      comparisonId: 'comparison-1',
      status: 'COMPLETED'
    }));
  });

  it('emits incomparable and failure outcomes without private error payloads', async () => {
    const sink = vi.fn();
    const observability = new VisibilityHistoryObservability(sink);
    const current = completedSnapshot('current-2');
    const noPrevious = new VisibilityHistoryService({
      getSnapshot: vi.fn(async () => current),
      findNearestCompatiblePrevious: vi.fn(async () => null)
    } as never, observability);

    await expect(noPrevious.materializeForSnapshot('project-1', 'current-2')).resolves.toEqual({
      comparisonId: null,
      outcome: 'NO_COMPATIBLE_PREVIOUS'
    });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.history.comparison.incomparable',
      projectId: 'project-1',
      currentSnapshotId: 'current-2',
      status: 'NO_COMPATIBLE_PREVIOUS'
    }));

    sink.mockClear();
    const missing = new VisibilityHistoryService({ getSnapshot: vi.fn(async () => null) } as never, observability);
    await expect(missing.materializeForSnapshot('project-1', 'missing')).rejects.toMatchObject({
      code: 'VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND'
    });
    expect(sink).toHaveBeenCalledWith({
      event: 'visibility.history.comparison.failed',
      projectId: 'project-1',
      currentSnapshotId: 'missing',
      status: 'FAILED',
      reasonCode: 'VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND'
    });
  });

  it('emits reconciliation completion only after all enqueue writes succeed', async () => {
    const sink = vi.fn();
    const observability = new VisibilityHistoryObservability(sink);
    const queue = { enqueueSnapshot: vi.fn(async () => undefined) };
    const repository = {
      listReconciliationCandidates: vi.fn(async () => [
        { id: 'snapshot-a', projectId: 'project-a' },
        { id: 'snapshot-b', projectId: 'project-b' }
      ])
    };

    await expect(processVisibilityMonitoringJob(
      { name: 'reconcile-history', data: {} },
      { repository: repository as never, queue, observability }
    )).resolves.toEqual({ processed: 2, enqueued: 2 });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.monitoring.reconcile.completed',
      processedCount: 2,
      enqueuedCount: 2
    }));

    sink.mockClear();
    await expect(processVisibilityMonitoringJob(
      { name: 'reconcile-history', data: {} },
      {
        repository: repository as never,
        queue: { enqueueSnapshot: vi.fn(async () => { throw new Error('queue write failed'); }) },
        observability
      }
    )).rejects.toThrow(/queue write failed/i);
    expect(sink).not.toHaveBeenCalled();
  });
});
