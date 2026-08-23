import { describe, expect, it } from 'vitest';
import { processDistributionPreparationJob } from '../../src/modules/distribution/distribution.worker.js';
import { processGrowthMaterializationJob } from '../../src/modules/growth/growth.worker.js';
import {
  processOptimizationOrchestrationJob,
  processOptimizationPlanningJob
} from '../../src/modules/optimization-orchestration/orchestration.worker.js';
import { processVisibilityJob } from '../../src/modules/visibility/visibility.worker.js';
import { processVisibilityMetricsJob } from '../../src/modules/visibility/visibility-metrics.worker.js';
import {
  OPTIMIZATION_DAILY_RECONCILE_EVERY_MS,
  OPTIMIZATION_DAILY_RECONCILE_SCHEDULER,
  OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY,
  OPTIMIZATION_PLANNING_WORKER_CONCURRENCY,
  workerDefinitionForQueue
} from '../../src/queue/worker-bootstrap.js';

describe('worker bootstrap', () => {
  it('activates the reserved visibility queue with the real visibility processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('visibility');

    expect(definition).toMatchObject({
      processor: processVisibilityJob,
      concurrency: 2
    });
  });

  it('activates the P6-C visibility-metrics queue with the database-only processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('visibility-metrics');

    expect(definition).toMatchObject({
      processor: processVisibilityMetricsJob,
      concurrency: 2
    });
  });

  it('activates the P7-A growth-materialization queue with the database-only processor at concurrency 1', () => {
    const definition = workerDefinitionForQueue('growth-materialization');

    expect(definition).toMatchObject({
      processor: processGrowthMaterializationJob,
      concurrency: 1
    });
  });

  it('activates the P8-B distribution-preparation queue with the bounded processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('distribution-preparation');

    expect(definition).toMatchObject({
      processor: processDistributionPreparationJob,
      concurrency: 2
    });
  });

  it('activates P9-B planning and orchestration workers with bounded concurrency', () => {
    expect(OPTIMIZATION_PLANNING_WORKER_CONCURRENCY).toBe(1);
    expect(OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY).toBe(2);

    expect(workerDefinitionForQueue('optimization-planning')).toMatchObject({
      processor: processOptimizationPlanningJob,
      concurrency: 1
    });
    expect(workerDefinitionForQueue('optimization-orchestration')).toMatchObject({
      processor: processOptimizationOrchestrationJob,
      concurrency: 2
    });
  });

  it('defines one daily reconciliation scheduler without embedding a date in the job payload', () => {
    expect(OPTIMIZATION_DAILY_RECONCILE_EVERY_MS).toBe(24 * 60 * 60 * 1000);
    expect(OPTIMIZATION_DAILY_RECONCILE_SCHEDULER).toEqual({
      id: 'optimization-daily-reconcile',
      repeat: { every: 24 * 60 * 60 * 1000 },
      job: {
        name: 'reconcile-daily',
        data: { kind: 'RECONCILE_DAILY' }
      }
    });
    expect(OPTIMIZATION_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('utcDate');
    expect(OPTIMIZATION_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('date');
  });
});
