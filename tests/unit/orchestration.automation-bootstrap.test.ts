import { describe, expect, it } from 'vitest';
import { processOptimizationAutomationJob } from '../../src/modules/optimization-orchestration/orchestration.worker.js';
import {
  OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY,
  workerDefinitionForQueue
} from '../../src/queue/worker-bootstrap.js';

describe('OL-2 automation worker bootstrap', () => {
  it('registers the automation worker with bounded concurrency on the central worker runtime', () => {
    expect(OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY).toBe(2);
    expect(workerDefinitionForQueue('optimization-automation' as never)).toMatchObject({
      processor: processOptimizationAutomationJob,
      concurrency: 2
    });
  });
});