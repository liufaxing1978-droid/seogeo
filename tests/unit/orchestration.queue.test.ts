import { describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES } from '../../src/queue/queues.js';
import {
  OPTIMIZATION_ORCHESTRATION_QUEUE_NAME,
  OPTIMIZATION_PLANNING_QUEUE_NAME,
  OPTIMIZATION_QUEUE_ATTEMPTS,
  OptimizationOrchestrationQueue,
  OptimizationPlanningQueue,
  buildOptimizationOrchestrationJobOptions,
  buildOptimizationPlanningJobOptions,
  type OptimizationPlanningJobData
} from '../../src/modules/optimization-orchestration/orchestration.queue.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

describe('P9-B orchestration queues', () => {
  it('registers exactly the two P9-B queue names in the central registry', () => {
    expect(OPTIMIZATION_PLANNING_QUEUE_NAME).toBe('optimization-planning');
    expect(OPTIMIZATION_ORCHESTRATION_QUEUE_NAME).toBe('optimization-orchestration');
    expect(QUEUE_NAMES).toContain(OPTIMIZATION_PLANNING_QUEUE_NAME);
    expect(QUEUE_NAMES).toContain(OPTIMIZATION_ORCHESTRATION_QUEUE_NAME);
  });

  it('exports the bounded retry count and the date-free reconciliation payload', () => {
    const daily: OptimizationPlanningJobData = { kind: 'RECONCILE_DAILY' };

    expect(OPTIMIZATION_QUEUE_ATTEMPTS).toBe(2);
    expect(daily).toEqual({ kind: 'RECONCILE_DAILY' });
    expect(daily).not.toHaveProperty('utcDate');
  });

  it('uses deterministic bounded retry options for planning', () => {
    expect(buildOptimizationPlanningJobOptions(RUN_ID)).toEqual({
      jobId: `optimization-planning-${RUN_ID}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 200
    });
  });

  it('uses deterministic bounded retry options for orchestration', () => {
    expect(buildOptimizationOrchestrationJobOptions(RUN_ID)).toEqual({
      jobId: `optimization-orchestration-${RUN_ID}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 200
    });
  });

  it('enqueues only run/project ids on the planning queue', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = new OptimizationPlanningQueue({ add } as never);

    await queue.enqueueRun(RUN_ID, PROJECT_ID);

    expect(add).toHaveBeenCalledWith(
      'materialize-run',
      { kind: 'MATERIALIZE_RUN', runId: RUN_ID, projectId: PROJECT_ID },
      buildOptimizationPlanningJobOptions(RUN_ID)
    );
  });

  it('enqueues only run/project ids on the orchestration queue', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-2' });
    const queue = new OptimizationOrchestrationQueue({ add } as never);

    await queue.enqueueRun(RUN_ID, PROJECT_ID);

    expect(add).toHaveBeenCalledWith(
      'advance-run',
      { runId: RUN_ID, projectId: PROJECT_ID },
      buildOptimizationOrchestrationJobOptions(RUN_ID)
    );
  });
});
