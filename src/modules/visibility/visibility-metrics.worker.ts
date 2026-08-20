import { emitVisibilityMetricsEvent } from './visibility-metrics.observability.js';
import {
  VisibilityMetricsRepository,
  visibilityMetricsRepository
} from './visibility-metrics.repository.js';
import {
  VisibilityMetricsError,
  VisibilityMetricsService
} from './visibility-metrics.service.js';
import type { MaterializeVisibilityMetricSnapshotJobData } from './visibility-metrics.queue.js';

export const VISIBILITY_METRICS_WORKER_CONCURRENCY = 2;

export interface VisibilityMetricsJobLike {
  name: string;
  data: Record<string, unknown>;
}

export interface VisibilityMonitoringHandoffPort {
  enqueueSnapshot(projectId: string, snapshotId: string): Promise<unknown>;
}

export interface VisibilityMetricsWorkerDependencies {
  metricsService?: Pick<VisibilityMetricsService, 'materializeSnapshot'>;
  repository?: Pick<VisibilityMetricsRepository, 'get'>;
  monitoringQueue?: VisibilityMonitoringHandoffPort;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VisibilityMetricsError(
      'VISIBILITY_METRICS_MATERIALIZATION_FAILED',
      `${field} is required for visibility metric jobs`
    );
  }
  return value;
}

function jobData(data: Record<string, unknown>): MaterializeVisibilityMetricSnapshotJobData {
  return {
    projectId: requiredString(data.projectId, 'projectId'),
    snapshotId: requiredString(data.snapshotId, 'snapshotId'),
    formulaVersion: requiredString(data.formulaVersion, 'formulaVersion'),
    extractorVersion: requiredString(data.extractorVersion, 'extractorVersion'),
    subjectSetHash: requiredString(data.subjectSetHash, 'subjectSetHash'),
    windowStart: requiredString(data.windowStart, 'windowStart'),
    windowEnd: requiredString(data.windowEnd, 'windowEnd'),
    inputCutoffAt: requiredString(data.inputCutoffAt, 'inputCutoffAt'),
    scopeHash: requiredString(data.scopeHash, 'scopeHash')
  };
}

export async function processVisibilityMetricsJob(
  job: VisibilityMetricsJobLike,
  dependencies: VisibilityMetricsWorkerDependencies = {}
) {
  if (job.name !== 'materialize-metric-snapshot') {
    throw new VisibilityMetricsError(
      'VISIBILITY_METRICS_MATERIALIZATION_FAILED',
      `Unsupported visibility metrics job: ${job.name}`
    );
  }

  const data = jobData(job.data);
  const repository = dependencies.repository ?? visibilityMetricsRepository;
  const snapshot = await repository.get(data.projectId, data.snapshotId);
  const identityMatches = snapshot !== null
    && snapshot.formulaVersion === data.formulaVersion
    && snapshot.extractorVersion === data.extractorVersion
    && snapshot.subjectSetHash === data.subjectSetHash
    && snapshot.windowStart.toISOString() === data.windowStart
    && snapshot.windowEnd.toISOString() === data.windowEnd
    && snapshot.inputCutoffAt.toISOString() === data.inputCutoffAt
    && snapshot.scopeHash === data.scopeHash;

  if (!identityMatches) {
    throw new VisibilityMetricsError(
      'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND',
      'Visibility metric snapshot job identity did not match the project snapshot'
    );
  }

  emitVisibilityMetricsEvent('visibility.metrics.started', {
    projectId: data.projectId,
    snapshotId: data.snapshotId,
    formulaVersion: data.formulaVersion,
    extractorVersion: data.extractorVersion,
    subjectSetHash: data.subjectSetHash,
    scopeHash: data.scopeHash,
    status: 'RUNNING'
  });

  const service = dependencies.metricsService ?? new VisibilityMetricsService();
  const completed = await service.materializeSnapshot(data.projectId, data.snapshotId);

  if (completed.status === 'COMPLETED' && dependencies.monitoringQueue) {
    try {
      await dependencies.monitoringQueue.enqueueSnapshot(data.projectId, data.snapshotId);
    } catch {
      // P6-C truth is already durable. P6-D reconciliation repairs a missed handoff.
    }
  }

  return completed;
}
