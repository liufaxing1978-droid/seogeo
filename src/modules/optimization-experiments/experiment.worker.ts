import type { OptimizationExperiment } from '@prisma/client';
import type { OptimizationExperimentQueue } from './experiment.queue.js';
import type { OptimizationExperimentService } from './experiment.service.js';
import type { ExperimentWindowType } from './experiment.types.js';

export const OPTIMIZATION_EXPERIMENT_VERIFIED_START_RECONCILE_LIMIT = 100;
export const OPTIMIZATION_EXPERIMENT_DUE_WINDOW_RECONCILE_LIMIT = 200;

type OptimizationExperimentWorkerService = Pick<
  OptimizationExperimentService,
  'startFromVerifiedExecution' | 'evaluateWindow'
>;

type OptimizationExperimentWorkerQueue = Pick<
  OptimizationExperimentQueue,
  'enqueueStart' | 'enqueueWindow'
>;

export type VerifiedP9ExecutionWithoutExperiment = {
  publicationExecutionId: string;
  projectId: string;
};

export type DueExperimentWindow = {
  experimentId: string;
  projectId: string;
  windowType: ExperimentWindowType;
};

export type OptimizationExperimentReconciliationPort = {
  listVerifiedP9ExecutionsWithoutExperiment(input: {
    limit: number;
  }): Promise<readonly VerifiedP9ExecutionWithoutExperiment[]>;
  listDueExperimentWindows(input: {
    now: Date;
    limit: number;
  }): Promise<readonly DueExperimentWindow[]>;
};

export type OptimizationExperimentFeedbackHandoff = {
  onObservationPersisted(input: {
    projectId: string;
    experimentId: string;
    observationId: string;
  }): Promise<void>;
};

export type OptimizationExperimentWorkerDeps = {
  service: OptimizationExperimentWorkerService;
  queue: OptimizationExperimentWorkerQueue;
  repository: OptimizationExperimentReconciliationPort;
  feedbackHandoff?: OptimizationExperimentFeedbackHandoff;
  now?: () => Date;
};

type OptimizationExperimentWorkerJob =
  | {
      name: 'start-experiment';
      data: {
        kind: 'START_EXPERIMENT';
        publicationExecutionId: string;
        projectId: string;
      };
    }
  | {
      name: 'evaluate-window';
      data: {
        kind: 'EVALUATE_WINDOW';
        experimentId: string;
        projectId: string;
        windowType: ExperimentWindowType;
      };
    }
  | {
      name: 'reconcile-daily';
      data: { kind: 'RECONCILE_DAILY' };
    };

const WINDOW_DAYS: Record<ExperimentWindowType, 7 | 14 | 28 | 56> = {
  '7D': 7,
  '14D': 14,
  '28D': 28,
  '56D': 56
};

function isWindowType(value: unknown): value is ExperimentWindowType {
  return value === '7D' || value === '14D' || value === '28D' || value === '56D';
}

function frozenWindowTypes(experiment: Pick<OptimizationExperiment, 'observationScheduleJson'>): ExperimentWindowType[] {
  if (!Array.isArray(experiment.observationScheduleJson)) {
    throw new Error('EXPERIMENT_FROZEN_SCHEDULE_INVALID');
  }

  const seen = new Set<ExperimentWindowType>();
  const result: ExperimentWindowType[] = [];
  for (const item of experiment.observationScheduleJson) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('EXPERIMENT_FROZEN_SCHEDULE_INVALID');
    }
    const record = item as Record<string, unknown>;
    const windowType = record.windowType;
    if (
      !isWindowType(windowType)
      || record.windowDays !== WINDOW_DAYS[windowType]
      || seen.has(windowType)
    ) {
      throw new Error('EXPERIMENT_FROZEN_SCHEDULE_INVALID');
    }
    seen.add(windowType);
    result.push(windowType);
  }

  if (result.length === 0) {
    throw new Error('EXPERIMENT_FROZEN_SCHEDULE_INVALID');
  }
  return result;
}

function assertJobIdentity(job: OptimizationExperimentWorkerJob): void {
  const expectedName = job.data.kind === 'START_EXPERIMENT'
    ? 'start-experiment'
    : job.data.kind === 'EVALUATE_WINDOW'
      ? 'evaluate-window'
      : 'reconcile-daily';
  if (job.name !== expectedName) {
    throw new Error('EXPERIMENT_JOB_KIND_MISMATCH');
  }
}

export async function processOptimizationExperimentJob(
  job: OptimizationExperimentWorkerJob,
  deps: OptimizationExperimentWorkerDeps
): Promise<void> {
  assertJobIdentity(job);

  if (job.data.kind === 'START_EXPERIMENT') {
    const result = await deps.service.startFromVerifiedExecution({
      publicationExecutionId: job.data.publicationExecutionId,
      projectId: job.data.projectId
    });
    if (result.kind === 'DEFERRED') return;

    const windowTypes = frozenWindowTypes(result.experiment);
    for (const windowType of windowTypes) {
      await deps.queue.enqueueWindow(result.experiment.id, result.experiment.projectId, windowType);
    }
    return;
  }

  if (job.data.kind === 'EVALUATE_WINDOW') {
    const observation = await deps.service.evaluateWindow({
      experimentId: job.data.experimentId,
      projectId: job.data.projectId,
      windowType: job.data.windowType
    });
    if (observation && deps.feedbackHandoff) {
      try {
        await deps.feedbackHandoff.onObservationPersisted({
          projectId: job.data.projectId,
          experimentId: job.data.experimentId,
          observationId: observation.id
        });
      } catch {
        // Best-effort only. P9-D persistence remains authoritative and P9-E reconciliation can recover.
      }
    }
    return;
  }

  const starts = await deps.repository.listVerifiedP9ExecutionsWithoutExperiment({
    limit: OPTIMIZATION_EXPERIMENT_VERIFIED_START_RECONCILE_LIMIT
  });
  for (const start of starts) {
    await deps.queue.enqueueStart(start.publicationExecutionId, start.projectId);
  }

  const now = deps.now?.() ?? new Date();
  const dueWindows = await deps.repository.listDueExperimentWindows({
    now,
    limit: OPTIMIZATION_EXPERIMENT_DUE_WINDOW_RECONCILE_LIMIT
  });
  for (const due of dueWindows) {
    await deps.queue.enqueueWindow(due.experimentId, due.projectId, due.windowType);
  }
}
