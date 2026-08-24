import { describe, expect, it, vi } from 'vitest';
import {
  OPTIMIZATION_AUTOPILOT_QUEUE_NAME,
  OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS,
  OptimizationAutopilotQueue,
  buildOptimizationAutopilotJobOptions,
  type OptimizationAutopilotJobData
} from '../../src/modules/optimization-autopilot/autopilot.queue.js';

const RUN_ITEM_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

describe('P9-C autopilot queue', () => {
  it('uses the single owned queue name and bounded retry contract', () => {
    expect(OPTIMIZATION_AUTOPILOT_QUEUE_NAME).toBe('optimization-autopilot');
    expect(OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS).toBe(2);
    expect(buildOptimizationAutopilotJobOptions(RUN_ITEM_ID)).toEqual({
      jobId: `optimization-autopilot-${RUN_ITEM_ID}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 200
    });
  });

  it('keeps the reconciliation payload date-free so the worker resolves the current UTC date', () => {
    const daily: OptimizationAutopilotJobData = { kind: 'RECONCILE_DAILY' };

    expect(daily).toEqual({ kind: 'RECONCILE_DAILY' });
    expect(daily).not.toHaveProperty('utcDate');
    expect(daily).not.toHaveProperty('date');
  });

  it('enqueues only durable run-item and project ids with a deterministic job id', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = new OptimizationAutopilotQueue({ add } as never);

    await queue.enqueueRunItem(RUN_ITEM_ID, PROJECT_ID);

    expect(add).toHaveBeenCalledWith(
      'evaluate-run-item',
      { kind: 'EVALUATE_RUN_ITEM', runItemId: RUN_ITEM_ID, projectId: PROJECT_ID },
      buildOptimizationAutopilotJobOptions(RUN_ITEM_ID)
    );
  });
});
