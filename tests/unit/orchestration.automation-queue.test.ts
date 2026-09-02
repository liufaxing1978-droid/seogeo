import { describe, expect, it, vi } from 'vitest';
import { QUEUE_NAMES } from '../../src/queue/queues.js';
import {
  OPTIMIZATION_AUTOMATION_QUEUE_ATTEMPTS,
  OPTIMIZATION_AUTOMATION_QUEUE_NAME,
  OptimizationAutomationQueue,
  buildOptimizationAutomationJobOptions,
  type OptimizationAutomationJobData
} from '../../src/modules/optimization-orchestration/orchestration.queue.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';

describe('OL-2 automation queue', () => {
  it('registers a dedicated automation queue with bounded delivery retries', () => {
    expect(OPTIMIZATION_AUTOMATION_QUEUE_NAME).toBe('optimization-automation');
    expect(QUEUE_NAMES).toContain(OPTIMIZATION_AUTOMATION_QUEUE_NAME);
    expect(OPTIMIZATION_AUTOMATION_QUEUE_ATTEMPTS).toBe(2);
    expect(buildOptimizationAutomationJobOptions(RUN_ID)).toEqual({
      jobId: `optimization-automation-${RUN_ID}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: true,
      removeOnFail: 200
    });
  });

  it('enqueues only durable run/project ids for execution', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'job-1' });
    const queue = new OptimizationAutomationQueue({ add } as never);

    await queue.enqueueRun(RUN_ID, PROJECT_ID);

    const expected: OptimizationAutomationJobData = {
      kind: 'EXECUTE_RUN',
      runId: RUN_ID,
      projectId: PROJECT_ID
    };
    expect(add).toHaveBeenCalledWith(
      'execute-automation-run',
      expected,
      buildOptimizationAutomationJobOptions(RUN_ID)
    );
  });

  it('upserts an enabled cron definition as a UTC scheduler that only carries definition/project ids', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'scheduler' });
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const queue = new OptimizationAutomationQueue({
      add: vi.fn(),
      upsertJobScheduler,
      removeJobScheduler
    } as never);

    await queue.syncDefinitionSchedule({
      id: DEFINITION_ID,
      projectId: PROJECT_ID,
      enabled: true,
      scheduleCron: '0 3 * * *'
    });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      `optimization-automation-definition-${DEFINITION_ID}`,
      { pattern: '0 3 * * *', tz: 'UTC' },
      {
        name: 'start-scheduled-automation',
        data: {
          kind: 'START_SCHEDULED',
          definitionId: DEFINITION_ID,
          projectId: PROJECT_ID
        },
        opts: {
          removeOnComplete: 100,
          removeOnFail: 200
        }
      }
    );
    expect(removeJobScheduler).not.toHaveBeenCalled();
  });

  it('removes the scheduler when the definition is disabled or has no cron', async () => {
    const upsertJobScheduler = vi.fn();
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const queue = new OptimizationAutomationQueue({
      add: vi.fn(),
      upsertJobScheduler,
      removeJobScheduler
    } as never);

    await queue.syncDefinitionSchedule({
      id: DEFINITION_ID,
      projectId: PROJECT_ID,
      enabled: false,
      scheduleCron: '0 3 * * *'
    });
    await queue.syncDefinitionSchedule({
      id: DEFINITION_ID,
      projectId: PROJECT_ID,
      enabled: true,
      scheduleCron: null
    });

    expect(upsertJobScheduler).not.toHaveBeenCalled();
    expect(removeJobScheduler).toHaveBeenCalledTimes(2);
    expect(removeJobScheduler).toHaveBeenNthCalledWith(
      1,
      `optimization-automation-definition-${DEFINITION_ID}`
    );
    expect(removeJobScheduler).toHaveBeenNthCalledWith(
      2,
      `optimization-automation-definition-${DEFINITION_ID}`
    );
  });
});