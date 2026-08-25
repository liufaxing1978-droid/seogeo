import { describe, expect, it, vi } from 'vitest';
import { processDistributionPreparationJob } from '../../src/modules/distribution/distribution.worker.js';
import { processGrowthMaterializationJob } from '../../src/modules/growth/growth.worker.js';
import { processOptimizationAutopilotJob } from '../../src/modules/optimization-autopilot/autopilot.worker.js';
import {
  processOptimizationOrchestrationJob,
  processOptimizationPlanningJob
} from '../../src/modules/optimization-orchestration/orchestration.worker.js';
import { processOptimizationExperimentJob } from '../../src/modules/optimization-experiments/experiment.worker.js';
import { PUBLICATION_EXECUTION_QUEUE_NAME } from '../../src/modules/publication/publication-execution.queue.js';
import { processVisibilityJob } from '../../src/modules/visibility/visibility.worker.js';
import { processVisibilityMetricsJob } from '../../src/modules/visibility/visibility-metrics.worker.js';
import {
  OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_EVERY_MS,
  OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER,
  OPTIMIZATION_AUTOPILOT_WORKER_CONCURRENCY,
  OPTIMIZATION_DAILY_RECONCILE_EVERY_MS,
  OPTIMIZATION_DAILY_RECONCILE_SCHEDULER,
  OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_EVERY_MS,
  OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER,
  OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY,
  OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY,
  OPTIMIZATION_PLANNING_WORKER_CONCURRENCY,
  buildOptimizationAutopilotRuntimeDeps,
  buildPublicationVerificationExperimentHandoff,
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

  it('activates the single P9-C autopilot worker with bounded concurrency', () => {
    expect(OPTIMIZATION_AUTOPILOT_WORKER_CONCURRENCY).toBe(2);
    expect(workerDefinitionForQueue('optimization-autopilot')).toMatchObject({
      processor: processOptimizationAutopilotJob,
      concurrency: 2
    });
  });

  it('activates the P9-D experiment queue with the real processor at concurrency 2', () => {
    expect(OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY).toBe(2);
    expect(workerDefinitionForQueue('optimization-experiment-evaluation')).toMatchObject({
      processor: processOptimizationExperimentJob,
      concurrency: 2
    });
  });

  it('wires P8 VERIFIED handoff only to the P9-D start queue producer', async () => {
    const enqueueStart = vi.fn().mockResolvedValue(undefined);
    const deps = buildPublicationVerificationExperimentHandoff({ enqueueStart });

    await deps.onVerified({ executionId: 'execution-1', projectId: 'project-1' });

    expect(enqueueStart).toHaveBeenCalledTimes(1);
    expect(enqueueStart).toHaveBeenCalledWith('execution-1', 'project-1');
  });

  it('wires P9-C to the existing P8 site-mutation-execution producer instead of a second execution queue', () => {
    const repository = { listReadyItemsWithoutEffectiveDecision: async () => [] };
    const autopilotQueue = { enqueueRunItem: async () => undefined };
    const executionQueue = { add: async () => undefined };

    const deps = buildOptimizationAutopilotRuntimeDeps({
      repository: repository as never,
      queue: autopilotQueue,
      executionQueue
    });

    expect(deps.repository).toBe(repository);
    expect(deps.queue).toBe(autopilotQueue);
    expect(deps.executionQueue).toBe(executionQueue);
    expect(PUBLICATION_EXECUTION_QUEUE_NAME).toBe('site-mutation-execution');
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

  it('defines one P9-C daily repair scheduler on the same autopilot queue with a date-free payload', () => {
    expect(OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_EVERY_MS).toBe(24 * 60 * 60 * 1000);
    expect(OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER).toEqual({
      id: 'optimization-autopilot-daily-reconcile',
      repeat: { every: 24 * 60 * 60 * 1000 },
      job: {
        name: 'reconcile-daily',
        data: { kind: 'RECONCILE_DAILY' }
      }
    });
    expect(OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('utcDate');
    expect(OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('date');
  });

  it('defines one P9-D daily experiment reconciliation scheduler with a date-free payload', () => {
    expect(OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_EVERY_MS).toBe(24 * 60 * 60 * 1000);
    expect(OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER).toEqual({
      id: 'optimization-experiment-daily-reconcile',
      repeat: { every: 24 * 60 * 60 * 1000 },
      job: {
        name: 'reconcile-daily',
        data: { kind: 'RECONCILE_DAILY' }
      }
    });
    expect(OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('utcDate');
    expect(OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER.job.data).not.toHaveProperty('date');
  });
});
