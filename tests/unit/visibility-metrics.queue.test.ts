import { describe, expect, it, vi } from 'vitest';
import {
  VISIBILITY_METRICS_ATTEMPTS,
  VISIBILITY_METRICS_QUEUE_NAME,
  VisibilityMetricsQueue,
  buildVisibilityMetricsJobId,
  type VisibilityMetricsQueuePort
} from '../../src/modules/visibility/visibility-metrics.queue.js';
import { processVisibilityMetricsJob } from '../../src/modules/visibility/visibility-metrics.worker.js';

class FakeQueue implements VisibilityMetricsQueuePort {
  calls: Array<{ name: string; data: Record<string, unknown>; options: { jobId: string; attempts: number } }> = [];

  async add(name: string, data: Record<string, unknown>, options: { jobId: string; attempts: number }) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

const JOB = {
  projectId: '11111111-1111-4111-8111-111111111111',
  snapshotId: '22222222-2222-4222-8222-222222222222',
  formulaVersion: 'VISIBILITY_METRICS_V1',
  extractorVersion: 'VISIBILITY_EXTRACTION_V1',
  subjectSetHash: 'a'.repeat(64),
  windowStart: '2026-08-01T00:00:00.000Z',
  windowEnd: '2026-08-08T00:00:00.000Z',
  inputCutoffAt: '2026-08-08T00:05:00.000Z',
  scopeHash: 'b'.repeat(64)
};

const SNAPSHOT = {
  id: JOB.snapshotId,
  projectId: JOB.projectId,
  formulaVersion: JOB.formulaVersion,
  extractorVersion: JOB.extractorVersion,
  subjectSetHash: JOB.subjectSetHash,
  windowStart: new Date(JOB.windowStart),
  windowEnd: new Date(JOB.windowEnd),
  inputCutoffAt: new Date(JOB.inputCutoffAt),
  scopeHash: JOB.scopeHash
};

describe('P6-C visibility metrics queue', () => {
  it('uses the dedicated queue, attempts=2 and deterministic BullMQ-safe bounded job identity', async () => {
    expect(VISIBILITY_METRICS_QUEUE_NAME).toBe('visibility-metrics');
    expect(VISIBILITY_METRICS_ATTEMPTS).toBe(2);

    const first = buildVisibilityMetricsJobId(JOB);
    const second = buildVisibilityMetricsJobId({ ...JOB });
    expect(first).toBe(second);
    expect(first).toMatch(/^visibility-metrics-[a-f0-9]{64}$/);
    expect(first).not.toContain(':');

    const port = new FakeQueue();
    const queue = new VisibilityMetricsQueue(port);
    await queue.enqueueSnapshot(JOB);

    expect(port.calls).toEqual([{
      name: 'materialize-metric-snapshot',
      data: JOB,
      options: { jobId: first, attempts: 2 }
    }]);
  });

  it('changes job identity when any frozen measurement input changes', () => {
    const base = buildVisibilityMetricsJobId(JOB);
    expect(buildVisibilityMetricsJobId({ ...JOB, inputCutoffAt: '2026-08-08T00:06:00.000Z' })).not.toBe(base);
    expect(buildVisibilityMetricsJobId({ ...JOB, scopeHash: 'c'.repeat(64) })).not.toBe(base);
    expect(buildVisibilityMetricsJobId({ ...JOB, subjectSetHash: 'd'.repeat(64) })).not.toBe(base);
  });

  it('validates the frozen same-project snapshot identity and performs zero network calls', async () => {
    const materializeSnapshot = vi.fn(async () => ({ id: JOB.snapshotId, status: 'COMPLETED' }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const result = await processVisibilityMetricsJob(
        { name: 'materialize-metric-snapshot', data: JOB },
        {
          repository: { get: vi.fn(async () => SNAPSHOT as never) },
          metricsService: { materializeSnapshot: materializeSnapshot as never }
        }
      );

      expect(result).toMatchObject({ id: JOB.snapshotId, status: 'COMPLETED' });
      expect(materializeSnapshot).toHaveBeenCalledWith(JOB.projectId, JOB.snapshotId);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects a missing or mismatched project snapshot before materialization', async () => {
    const materializeSnapshot = vi.fn();

    await expect(processVisibilityMetricsJob(
      { name: 'materialize-metric-snapshot', data: JOB },
      {
        repository: { get: vi.fn(async () => null) },
        metricsService: { materializeSnapshot: materializeSnapshot as never }
      }
    )).rejects.toMatchObject({ code: 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND' });

    expect(materializeSnapshot).not.toHaveBeenCalled();
  });
});
