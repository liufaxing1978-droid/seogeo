import { describe, expect, it, vi } from 'vitest';
import {
  processOptimizationExperimentJob,
  type OptimizationExperimentWorkerDeps
} from '../../src/modules/optimization-experiments/experiment.worker.js';

describe('P9-D experiment worker', () => {
  it('starts from a durable execution id and enqueues only the experiment frozen windows', async () => {
    const experiment = {
      id: 'experiment-1',
      projectId: 'project-1',
      observationScheduleJson: [
        { windowType: '14D', windowDays: 14 },
        { windowType: '28D', windowDays: 28 },
        { windowType: '56D', windowDays: 56 }
      ]
    };
    const service = {
      startFromVerifiedExecution: vi.fn().mockResolvedValue({
        kind: 'STARTED',
        experiment
      }),
      evaluateWindow: vi.fn()
    };
    const queue = {
      enqueueStart: vi.fn(),
      enqueueWindow: vi.fn().mockResolvedValue(undefined)
    };
    const repository = {
      listVerifiedP9ExecutionsWithoutExperiment: vi.fn(),
      listDueExperimentWindows: vi.fn()
    };
    const deps: OptimizationExperimentWorkerDeps = {
      service: service as never,
      queue: queue as never,
      repository: repository as never,
      now: () => new Date('2026-08-24T00:00:00.000Z')
    };

    await processOptimizationExperimentJob(
      {
        name: 'start-experiment',
        data: {
          kind: 'START_EXPERIMENT',
          publicationExecutionId: 'execution-1',
          projectId: 'project-1'
        }
      },
      deps
    );

    expect(service.startFromVerifiedExecution).toHaveBeenCalledWith({
      publicationExecutionId: 'execution-1',
      projectId: 'project-1'
    });
    expect(queue.enqueueWindow.mock.calls).toEqual([
      ['experiment-1', 'project-1', '14D'],
      ['experiment-1', 'project-1', '28D'],
      ['experiment-1', 'project-1', '56D']
    ]);
    expect(service.evaluateWindow).not.toHaveBeenCalled();
    expect(repository.listVerifiedP9ExecutionsWithoutExperiment).not.toHaveBeenCalled();
    expect(repository.listDueExperimentWindows).not.toHaveBeenCalled();
  });

  it('fails closed when a stored frozen schedule is malformed instead of recomputing it', async () => {
    const service = {
      startFromVerifiedExecution: vi.fn().mockResolvedValue({
        kind: 'EXISTING',
        experiment: {
          id: 'experiment-1',
          projectId: 'project-1',
          interventionType: 'CONTENT_REFRESH',
          observationScheduleJson: [
            { windowType: '14D', windowDays: 28 }
          ]
        }
      }),
      evaluateWindow: vi.fn()
    };
    const queue = {
      enqueueStart: vi.fn(),
      enqueueWindow: vi.fn()
    };
    const repository = {
      listVerifiedP9ExecutionsWithoutExperiment: vi.fn(),
      listDueExperimentWindows: vi.fn()
    };

    await expect(processOptimizationExperimentJob(
      {
        name: 'start-experiment',
        data: {
          kind: 'START_EXPERIMENT',
          publicationExecutionId: 'execution-1',
          projectId: 'project-1'
        }
      },
      {
        service: service as never,
        queue: queue as never,
        repository: repository as never
      }
    )).rejects.toThrow('EXPERIMENT_FROZEN_SCHEDULE_INVALID');

    expect(queue.enqueueWindow).not.toHaveBeenCalled();
  });

  it('evaluates exactly the requested frozen window and never schedules provider sampling', async () => {
    const service = {
      startFromVerifiedExecution: vi.fn(),
      evaluateWindow: vi.fn().mockResolvedValue(null)
    };
    const queue = {
      enqueueStart: vi.fn(),
      enqueueWindow: vi.fn()
    };
    const repository = {
      listVerifiedP9ExecutionsWithoutExperiment: vi.fn(),
      listDueExperimentWindows: vi.fn()
    };

    await processOptimizationExperimentJob(
      {
        name: 'evaluate-window',
        data: {
          kind: 'EVALUATE_WINDOW',
          experimentId: 'experiment-1',
          projectId: 'project-1',
          windowType: '28D'
        }
      },
      {
        service: service as never,
        queue: queue as never,
        repository: repository as never
      }
    );

    expect(service.evaluateWindow).toHaveBeenCalledTimes(1);
    expect(service.evaluateWindow).toHaveBeenCalledWith({
      experimentId: 'experiment-1',
      projectId: 'project-1',
      windowType: '28D'
    });
    expect(queue.enqueueStart).not.toHaveBeenCalled();
    expect(queue.enqueueWindow).not.toHaveBeenCalled();
  });

  it('reconciles bounded VERIFIED starts first, then bounded due experiment windows', async () => {
    const now = new Date('2026-08-24T00:00:00.000Z');
    const service = {
      startFromVerifiedExecution: vi.fn(),
      evaluateWindow: vi.fn()
    };
    const queue = {
      enqueueStart: vi.fn().mockResolvedValue(undefined),
      enqueueWindow: vi.fn().mockResolvedValue(undefined)
    };
    const repository = {
      listVerifiedP9ExecutionsWithoutExperiment: vi.fn().mockResolvedValue([
        { publicationExecutionId: 'execution-1', projectId: 'project-1' },
        { publicationExecutionId: 'execution-2', projectId: 'project-2' }
      ]),
      listDueExperimentWindows: vi.fn().mockResolvedValue([
        { experimentId: 'experiment-1', projectId: 'project-1', windowType: '14D' },
        { experimentId: 'experiment-2', projectId: 'project-2', windowType: '28D' }
      ])
    };

    await processOptimizationExperimentJob(
      {
        name: 'reconcile-daily',
        data: { kind: 'RECONCILE_DAILY' }
      },
      {
        service: service as never,
        queue: queue as never,
        repository: repository as never,
        now: () => now
      }
    );

    expect(repository.listVerifiedP9ExecutionsWithoutExperiment).toHaveBeenCalledWith({
      limit: 100
    });
    expect(repository.listDueExperimentWindows).toHaveBeenCalledWith({
      now,
      limit: 200
    });
    expect(queue.enqueueStart.mock.calls).toEqual([
      ['execution-1', 'project-1'],
      ['execution-2', 'project-2']
    ]);
    expect(queue.enqueueWindow.mock.calls).toEqual([
      ['experiment-1', 'project-1', '14D'],
      ['experiment-2', 'project-2', '28D']
    ]);
    expect(repository.listVerifiedP9ExecutionsWithoutExperiment.mock.invocationCallOrder[0])
      .toBeLessThan(repository.listDueExperimentWindows.mock.invocationCallOrder[0]!);
  });
});
