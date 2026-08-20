import { VisibilityAlertsService } from './visibility-alerts.service.js';
import {
  VisibilityHistoryRepository,
  visibilityHistoryRepository
} from './visibility-history.repository.js';
import { VisibilityHistoryService } from './visibility-history.service.js';
import { VisibilityHistoryError } from './visibility-history.types.js';
import {
  VisibilityHistoryObservability,
  visibilityHistoryObservability
} from './visibility-history.observability.js';
import type { VisibilityMonitoringQueue } from './visibility-monitoring.queue.js';

export const VISIBILITY_MONITORING_WORKER_CONCURRENCY = 2;
export const VISIBILITY_MONITORING_RECONCILE_LIMIT = 100;

export interface VisibilityMonitoringJobLike {
  name: string;
  data: Record<string, unknown>;
}

export interface VisibilityMonitoringWorkerDependencies {
  historyService?: Pick<VisibilityHistoryService, 'materializeForSnapshot'>;
  alertsService?: Pick<VisibilityAlertsService, 'evaluateComparison'>;
  repository?: Pick<VisibilityHistoryRepository, 'listReconciliationCandidates'>;
  queue?: Pick<VisibilityMonitoringQueue, 'enqueueSnapshot'>;
  observability?: VisibilityHistoryObservability;
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
    const historyService = dependencies.historyService ?? new VisibilityHistoryService();
    const history = await historyService.materializeForSnapshot(projectId, snapshotId);
    if (!history.comparisonId) return { ...history, alerts: { triggered: 0, resolved: 0 } };
    const alertsService = dependencies.alertsService ?? new VisibilityAlertsService();
    const alerts = await alertsService.evaluateComparison(projectId, history.comparisonId);
    return { ...history, alerts };
  }

  if (job.name === 'reconcile-history') {
    const startedAt = Date.now();
    const repository = dependencies.repository ?? visibilityHistoryRepository;
    if (!dependencies.queue) {
      throw new VisibilityHistoryError(
        'VISIBILITY_HISTORY_PERSISTENCE_FAILED',
        'Visibility monitoring queue is required for reconciliation'
      );
    }

    const candidates = await repository.listReconciliationCandidates(VISIBILITY_MONITORING_RECONCILE_LIMIT);
    let enqueued = 0;
    for (const candidate of candidates) {
      await dependencies.queue.enqueueSnapshot(candidate.projectId, candidate.id);
      enqueued += 1;
    }
    (dependencies.observability ?? visibilityHistoryObservability).emit({
      event: 'visibility.monitoring.reconcile.completed',
      processedCount: candidates.length,
      enqueuedCount: enqueued,
      status: 'COMPLETED',
      durationMs: Date.now() - startedAt
    });
    return { processed: candidates.length, enqueued };
  }

  throw new VisibilityHistoryError(
    'VISIBILITY_HISTORY_PERSISTENCE_FAILED',
    `Unsupported visibility monitoring job: ${job.name}`
  );
}
