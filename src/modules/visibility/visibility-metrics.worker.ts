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

export interface VisibilityMetricsWorkerDependencies {
  metricsService?: Pick<VisibilityMetricsService, 'materializeSnapshot'>;
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
  const service = dependencies.metricsService ?? new VisibilityMetricsService();
  return service.materializeSnapshot(data.projectId, data.snapshotId);
}
