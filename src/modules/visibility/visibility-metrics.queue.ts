import { createHash } from 'node:crypto';
import { emitVisibilityMetricsEvent } from './visibility-metrics.observability.js';

export const VISIBILITY_METRICS_QUEUE_NAME = 'visibility-metrics' as const;
export const VISIBILITY_METRICS_ATTEMPTS = 2;

export interface MaterializeVisibilityMetricSnapshotJobData {
  projectId: string;
  snapshotId: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  windowStart: string;
  windowEnd: string;
  inputCutoffAt: string;
  scopeHash: string;
}

export interface VisibilityMetricsQueuePort {
  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ): Promise<{ id?: string | null }>;
}

function canonicalJobIdentity(data: MaterializeVisibilityMetricSnapshotJobData) {
  return JSON.stringify({
    projectId: data.projectId,
    snapshotId: data.snapshotId,
    formulaVersion: data.formulaVersion,
    extractorVersion: data.extractorVersion,
    subjectSetHash: data.subjectSetHash,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    inputCutoffAt: data.inputCutoffAt,
    scopeHash: data.scopeHash
  });
}

export function buildVisibilityMetricsJobId(
  data: MaterializeVisibilityMetricSnapshotJobData
): string {
  const digest = createHash('sha256').update(canonicalJobIdentity(data)).digest('hex');
  return `visibility-metrics-${digest}`;
}

export class VisibilityMetricsQueue {
  constructor(private readonly queue: VisibilityMetricsQueuePort) {}

  async enqueueSnapshot(data: MaterializeVisibilityMetricSnapshotJobData) {
    const result = await this.queue.add(
      'materialize-metric-snapshot',
      data as unknown as Record<string, unknown>,
      {
        jobId: buildVisibilityMetricsJobId(data),
        attempts: VISIBILITY_METRICS_ATTEMPTS
      }
    );

    emitVisibilityMetricsEvent('visibility.metrics.queued', {
      projectId: data.projectId,
      snapshotId: data.snapshotId,
      formulaVersion: data.formulaVersion,
      extractorVersion: data.extractorVersion,
      subjectSetHash: data.subjectSetHash,
      scopeHash: data.scopeHash,
      status: 'QUEUED'
    });

    return result;
  }
}
