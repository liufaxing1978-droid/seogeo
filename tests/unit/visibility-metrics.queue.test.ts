import { describe, expect, it } from 'vitest';
import {
  VISIBILITY_METRICS_ATTEMPTS,
  VISIBILITY_METRICS_QUEUE_NAME,
  VisibilityMetricsQueue,
  buildVisibilityMetricsJobId,
  type VisibilityMetricsQueuePort
} from '../../src/modules/visibility/visibility-metrics.queue.js';

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

describe('P6-C visibility metrics queue', () => {
  it('uses the dedicated queue, attempts=2 and deterministic bounded job identity', async () => {
    expect(VISIBILITY_METRICS_QUEUE_NAME).toBe('visibility-metrics');
    expect(VISIBILITY_METRICS_ATTEMPTS).toBe(2);

    const first = buildVisibilityMetricsJobId(JOB);
    const second = buildVisibilityMetricsJobId({ ...JOB });
    expect(first).toBe(second);
    expect(first).toMatch(/^visibility-metrics:[a-f0-9]{64}$/);

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
});
