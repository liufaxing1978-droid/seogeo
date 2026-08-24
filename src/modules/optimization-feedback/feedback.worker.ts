import type { OptimizationFeedbackQueue } from './feedback.queue.js';
import type { FeedbackObservabilityEvent } from './feedback.observability.js';
import type { OptimizationFeedbackRepository } from './feedback.repository.js';
import type { OptimizationFeedbackService } from './feedback.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const OPTIMIZATION_FEEDBACK_RECONCILE_DAYS = 90;
export const OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT = 100;

export type OptimizationFeedbackWorkerDeps = {
  service: Pick<OptimizationFeedbackService, 'materializeObservation'>;
  repository: Pick<
    OptimizationFeedbackRepository,
    'listFeedbackEnabledProjectIds' | 'listRecentTerminalCandidates'
  >;
  queue: Pick<OptimizationFeedbackQueue, 'enqueueObservation'>;
  observability: { emit(event: FeedbackObservabilityEvent): void };
  now?: () => Date;
};

export type OptimizationFeedbackWorkerJob =
  | {
      name: 'materialize-observation';
      data: {
        kind: 'MATERIALIZE_OBSERVATION';
        projectId: string;
        experimentId: string;
        observationId: string;
      };
    }
  | {
      name: 'reconcile-daily';
      data: { kind: 'RECONCILE_DAILY' };
    };

function assertJobIdentity(job: OptimizationFeedbackWorkerJob): void {
  const expected = job.data.kind === 'MATERIALIZE_OBSERVATION'
    ? 'materialize-observation'
    : 'reconcile-daily';
  if (job.name !== expected) throw new Error('FEEDBACK_JOB_KIND_MISMATCH');
}

export async function processOptimizationFeedbackJob(
  job: OptimizationFeedbackWorkerJob,
  deps: OptimizationFeedbackWorkerDeps
): Promise<void> {
  assertJobIdentity(job);

  if (job.data.kind === 'MATERIALIZE_OBSERVATION') {
    await deps.service.materializeObservation({
      projectId: job.data.projectId,
      experimentId: job.data.experimentId,
      observationId: job.data.observationId
    });
    return;
  }

  const now = deps.now?.() ?? new Date();
  const createdAtGte = new Date(
    now.getTime() - OPTIMIZATION_FEEDBACK_RECONCILE_DAYS * DAY_MS
  );
  const projectIds = [...await deps.repository.listFeedbackEnabledProjectIds()].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const projectId of projectIds) {
    const candidates = await deps.repository.listRecentTerminalCandidates({
      projectId,
      createdAtGte,
      limit: OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT
    });
    for (const candidate of candidates.slice(0, OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT)) {
      await deps.queue.enqueueObservation(
        candidate.projectId,
        candidate.experimentId,
        candidate.observationId
      );
    }
    deps.observability.emit({
      event: 'optimization.feedback.reconciled',
      projectId
    });
  }
}
