import { createHash } from 'node:crypto';

export const VISIBILITY_MONITORING_QUEUE_NAME = 'visibility-monitoring' as const;
export const VISIBILITY_MONITORING_ATTEMPTS = 2;

export interface VisibilityMonitoringQueuePort {
  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ): Promise<{ id?: string | null }>;
}

export function buildVisibilityMonitoringJobId(input: {
  projectId: string;
  snapshotId: string;
}) {
  const digest = createHash('sha256')
    .update(`${input.projectId}:${input.snapshotId}`)
    .digest('hex');
  return `visibility-monitoring-${digest}`;
}

export class VisibilityMonitoringQueue {
  constructor(private readonly queue: VisibilityMonitoringQueuePort) {}

  async enqueueSnapshot(projectId: string, snapshotId: string) {
    return this.queue.add(
      'evaluate-snapshot',
      { projectId, snapshotId },
      {
        jobId: buildVisibilityMonitoringJobId({ projectId, snapshotId }),
        attempts: VISIBILITY_MONITORING_ATTEMPTS
      }
    );
  }

  async enqueueReconcile() {
    return this.queue.add(
      'reconcile-history',
      {},
      {
        jobId: 'visibility-monitoring-reconcile',
        attempts: VISIBILITY_MONITORING_ATTEMPTS
      }
    );
  }
}
