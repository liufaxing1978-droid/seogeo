import {
  VisibilityHistoryRepository,
  visibilityHistoryRepository
} from './visibility-history.repository.js';
import { VisibilityHistoryService } from './visibility-history.service.js';
import { VisibilityHistoryError } from './visibility-history.types.js';
import type { VisibilityMonitoringQueue } from './visibility-monitoring.queue.js';

export const VISIBILITY_MONITORING_WORKER_CONCURRENCY = 2;
export const VISIBILITY_MONITORING_RECONCILE_LIMIT = 100;

export interface VisibilityMonitoringJobLike {
  name: string;
  data: Record<string, unknown>;
}

export interface VisibilityMonitoringWorkerDependencies {
  historyService?: Pick<VisibilityHistoryService, 'materializeForSnapshot'>;
  repository?: Pick<VisibilityHistoryRepository, 'listReconciliationCandidates'>;
  queue?: Pick<VisibilityMonitoringQueue, 'enqueueSnapshot'>;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_PERSISTENCE_FAILED',
      `${field} is required for visibility monitoring jobs`
    );
  }
  return value;
}

export async function processVisibilityMonitoringJob(
  job: VisibilityMonitoringJobLike,
  dependencies: VisibilityMonitoringWorkerDependencies = {}
) {
  if (job.name === 'evaluate-snapshot') {
    const projectId = requiredString(job.data.projectId, 'projectId');
    const snapshotId = requiredString(job.data.snapshotId, 'snapshotId');
    const service = dependencies.historyService ?? new VisibilityHistoryService();
    return service.materializeForSnapshot(projectId, snapshotId);
  }

  if (job.name === 'reconcile-history') {
    const repository = dependencies.repository ?? visibilityHistoryRepository;
    if (!dependencies.queue) {
      throw new VisibilityHistoryError(
        'VISIBILITY_HISTORY_PERSISTENCE_FAILED',
        'Visibility monitoring queue is required for reconciliation'
      );
    }

    const candidates = await repository.listReconciliationCandidates(
      VISIBILITY_MONITORING_RECONCILE_LIMIT
    );
    let enqueued = 0;
    for (const candidate of candidates) {
      await dependencies.queue.enqueueSnapshot(candidate.projectId, candidate.id);
      enqueued += 1;
    }
    return { processed: candidates.length, enqueued };
  }

  throw new VisibilityHistoryError(
    'VISIBILITY_HISTORY_PERSISTENCE_FAILED',
    `Unsupported visibility monitoring job: ${job.name}`
  );
}
