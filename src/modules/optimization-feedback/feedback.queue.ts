import { createHash } from 'node:crypto';
import type { JobsOptions, Queue } from 'bullmq';
import { OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION } from './feedback.types.js';

export const OPTIMIZATION_FEEDBACK_QUEUE_NAME = 'optimization-feedback-materialization' as const;
export const OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS = 2;

export type OptimizationFeedbackJobData =
  | {
      kind: 'MATERIALIZE_OBSERVATION';
      projectId: string;
      experimentId: string;
      observationId: string;
    }
  | {
      kind: 'RECONCILE_DAILY';
    };

type QueueAdder = Pick<Queue, 'add'>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function boundedOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 200
  };
}

export function buildOptimizationFeedbackObservationJobId(
  projectId: string,
  experimentId: string,
  observationId: string
): string {
  const identity = JSON.stringify(canonicalize({
    projectId,
    experimentId,
    observationId,
    feedbackEvidenceVersion: OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION
  }));
  const hash = createHash('sha256').update(identity).digest('hex');
  return `optimization-feedback-${hash}`;
}

export function buildOptimizationFeedbackObservationJobOptions(
  projectId: string,
  experimentId: string,
  observationId: string
): JobsOptions {
  return boundedOptions(buildOptimizationFeedbackObservationJobId(
    projectId,
    experimentId,
    observationId
  ));
}

export class OptimizationFeedbackQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueObservation(
    projectId: string,
    experimentId: string,
    observationId: string
  ): Promise<unknown> {
    const payload: OptimizationFeedbackJobData = {
      kind: 'MATERIALIZE_OBSERVATION',
      projectId,
      experimentId,
      observationId
    };
    return this.queue.add(
      'materialize-observation',
      payload,
      buildOptimizationFeedbackObservationJobOptions(projectId, experimentId, observationId)
    );
  }
}
