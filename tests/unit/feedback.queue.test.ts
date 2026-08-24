import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS,
  OPTIMIZATION_FEEDBACK_QUEUE_NAME,
  OptimizationFeedbackQueue,
  buildOptimizationFeedbackObservationJobId,
  buildOptimizationFeedbackObservationJobOptions
} from '../../src/modules/optimization-feedback/feedback.queue.js';
import { OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION } from '../../src/modules/optimization-feedback/feedback.types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

describe('P9-E feedback queue', () => {
  it('uses the exact bounded materialization queue contract', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = new OptimizationFeedbackQueue({ add } as never);

    await queue.enqueueObservation('project-1', 'experiment-1', 'observation-1');

    const payload = {
      kind: 'MATERIALIZE_OBSERVATION',
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1'
    };
    const hash = createHash('sha256').update(JSON.stringify(canonicalize({
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      feedbackEvidenceVersion: OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION
    }))).digest('hex');

    expect(OPTIMIZATION_FEEDBACK_QUEUE_NAME).toBe('optimization-feedback-materialization');
    expect(OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS).toBe(2);
    expect(buildOptimizationFeedbackObservationJobId(
      'project-1',
      'experiment-1',
      'observation-1'
    )).toBe(`optimization-feedback-${hash}`);
    expect(buildOptimizationFeedbackObservationJobOptions(
      'project-1',
      'experiment-1',
      'observation-1'
    )).toEqual({
      jobId: `optimization-feedback-${hash}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 200
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'materialize-observation',
      payload,
      expect.objectContaining({
        jobId: `optimization-feedback-${hash}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 200
      })
    );
  });
});
