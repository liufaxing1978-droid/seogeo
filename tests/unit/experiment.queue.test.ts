import { describe, expect, it, vi } from 'vitest';
import {
  OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS,
  OPTIMIZATION_EXPERIMENT_QUEUE_NAME,
  OptimizationExperimentQueue,
  type OptimizationExperimentJobData
} from '../../src/modules/optimization-experiments/experiment.queue.js';

describe('P9-D experiment evaluation queue', () => {
  it('uses one dedicated queue and the frozen bounded retry policy', () => {
    expect(OPTIMIZATION_EXPERIMENT_QUEUE_NAME).toBe('optimization-experiment-evaluation');
    expect(OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS).toBe(2);
  });

  it('enqueues a start job with durable identifiers only', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = new OptimizationExperimentQueue({ add } as never);

    await queue.enqueueStart('execution-1', 'project-1');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'start-experiment',
      {
        kind: 'START_EXPERIMENT',
        publicationExecutionId: 'execution-1',
        projectId: 'project-1'
      },
      {
        jobId: 'optimization-experiment-start-execution-1',
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 200
      }
    );
    expect(Object.keys(add.mock.calls[0]![1] as object).sort()).toEqual([
      'kind',
      'projectId',
      'publicationExecutionId'
    ]);
  });

  it('enqueues an evaluation window with durable identifiers only', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-2' });
    const queue = new OptimizationExperimentQueue({ add } as never);

    await queue.enqueueWindow('experiment-1', 'project-1', '14D');

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'evaluate-window',
      {
        kind: 'EVALUATE_WINDOW',
        experimentId: 'experiment-1',
        projectId: 'project-1',
        windowType: '14D'
      },
      {
        jobId: 'optimization-experiment-window-experiment-1-14D',
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 200
      }
    );
    expect(Object.keys(add.mock.calls[0]![1] as object).sort()).toEqual([
      'experimentId',
      'kind',
      'projectId',
      'windowType'
    ]);
  });

  it('keeps daily reconciliation date-free and payload-only', () => {
    const payload: OptimizationExperimentJobData = { kind: 'RECONCILE_DAILY' };
    expect(payload).toEqual({ kind: 'RECONCILE_DAILY' });
    expect(Object.keys(payload)).toEqual(['kind']);
  });
});
