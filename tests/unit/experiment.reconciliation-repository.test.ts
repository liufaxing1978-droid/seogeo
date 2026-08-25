import { describe, expect, it, vi } from 'vitest';
import { OptimizationExperimentRepository } from '../../src/modules/optimization-experiments/experiment.repository.js';
import { OPTIMIZATION_EXPERIMENT_VERSION } from '../../src/modules/optimization-experiments/experiment.types.js';

const NOW = new Date('2026-08-24T00:00:00.000Z');

describe('P9-D experiment reconciliation repository', () => {
  it('lists only bounded VERIFIED P9 executions without a V1 experiment in stable order', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'execution-1', projectId: 'project-1' },
      { id: 'execution-2', projectId: 'project-2' }
    ]);
    const repository = new OptimizationExperimentRepository({
      publicationExecution: { findMany },
      optimizationExperiment: { findMany: vi.fn() }
    } as never);

    const result = await repository.listVerifiedP9ExecutionsWithoutExperiment({ limit: 100 });

    expect(result).toEqual([
      { publicationExecutionId: 'execution-1', projectId: 'project-1' },
      { publicationExecutionId: 'execution-2', projectId: 'project-2' }
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: 'VERIFIED',
        plan: {
          is: {
            proposal: {
              is: {
                sourceType: 'P9_OPTIMIZATION_PLAN',
                sourceReferenceId: { not: null }
              }
            }
          }
        },
        verifications: {
          some: {
            status: 'VERIFIED',
            observedAt: { not: null },
            observedUrl: { not: null }
          }
        },
        optimizationExperiments: {
          none: { experimentVersion: OPTIMIZATION_EXPERIMENT_VERSION }
        }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true, projectId: true }
    }));
  });

  it('derives due windows only from frozen schedules for a bounded stable experiment scan', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'experiment-1',
        projectId: 'project-1',
        verifiedAnchorAt: new Date('2026-08-01T00:00:00.000Z'),
        observationScheduleJson: [
          { windowType: '14D', windowDays: 14 },
          { windowType: '28D', windowDays: 28 },
          { windowType: '56D', windowDays: 56 }
        ]
      },
      {
        id: 'experiment-2',
        projectId: 'project-2',
        verifiedAnchorAt: new Date('2026-08-20T00:00:00.000Z'),
        observationScheduleJson: [
          { windowType: '7D', windowDays: 7 },
          { windowType: '14D', windowDays: 14 },
          { windowType: '28D', windowDays: 28 }
        ]
      }
    ]);
    const repository = new OptimizationExperimentRepository({
      publicationExecution: { findMany: vi.fn() },
      optimizationExperiment: { findMany }
    } as never);

    const result = await repository.listDueExperimentWindows({ now: NOW, limit: 200 });

    expect(result).toEqual([
      { experimentId: 'experiment-1', projectId: 'project-1', windowType: '14D' }
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        experimentVersion: OPTIMIZATION_EXPERIMENT_VERSION,
        verifiedAnchorAt: { lte: NOW }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
      select: {
        id: true,
        projectId: true,
        verifiedAnchorAt: true,
        observationScheduleJson: true
      }
    });
  });

  it('fails closed on malformed immutable frozen schedules', async () => {
    const repository = new OptimizationExperimentRepository({
      publicationExecution: { findMany: vi.fn() },
      optimizationExperiment: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'experiment-1',
            projectId: 'project-1',
            verifiedAnchorAt: new Date('2026-08-01T00:00:00.000Z'),
            observationScheduleJson: [{ windowType: '14D', windowDays: 28 }]
          }
        ])
      }
    } as never);

    await expect(repository.listDueExperimentWindows({ now: NOW, limit: 200 }))
      .rejects.toThrow('EXPERIMENT_FROZEN_SCHEDULE_INVALID');
  });
});
