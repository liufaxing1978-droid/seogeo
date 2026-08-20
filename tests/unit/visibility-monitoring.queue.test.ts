import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  VISIBILITY_MONITORING_ATTEMPTS,
  VISIBILITY_MONITORING_QUEUE_NAME,
  VisibilityMonitoringQueue,
  buildVisibilityMonitoringJobId,
  type VisibilityMonitoringQueuePort
} from '../../src/modules/visibility/visibility-monitoring.queue.js';

class FakeQueue implements VisibilityMonitoringQueuePort {
  readonly calls: Array<{
    name: string;
    data: Record<string, unknown>;
    options: { jobId: string; attempts: number };
  }> = [];

  async add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

describe('P6-D visibility monitoring queue', () => {
  it('uses a deterministic snapshot job identity and database-only retry allowance', async () => {
    const data = { projectId: 'project-a', snapshotId: 'snapshot-a' };
    const digest = createHash('sha256').update('project-a:snapshot-a').digest('hex');

    expect(VISIBILITY_MONITORING_QUEUE_NAME).toBe('visibility-monitoring');
    expect(VISIBILITY_MONITORING_ATTEMPTS).toBe(2);
    expect(buildVisibilityMonitoringJobId(data)).toBe(`visibility-monitoring-${digest}`);

    const port = new FakeQueue();
    const queue = new VisibilityMonitoringQueue(port);
    await queue.enqueueSnapshot(data.projectId, data.snapshotId);

    expect(port.calls).toEqual([{
      name: 'evaluate-snapshot',
      data,
      options: {
        jobId: `visibility-monitoring-${digest}`,
        attempts: 2
      }
    }]);
  });

  it('uses one stable reconciliation job identity', async () => {
    const port = new FakeQueue();
    const queue = new VisibilityMonitoringQueue(port);

    await queue.enqueueReconcile();

    expect(port.calls).toEqual([{
      name: 'reconcile-history',
      data: {},
      options: {
        jobId: 'visibility-monitoring-reconcile',
        attempts: 2
      }
    }]);
  });
});
