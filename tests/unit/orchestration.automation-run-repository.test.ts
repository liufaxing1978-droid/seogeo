import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000021';
const RUN_ID = '00000000-0000-4000-8000-000000000022';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000023';
const AS_OF = new Date('2026-09-04T13:00:00.000Z');
const DEADLINE = new Date('2026-09-04T12:59:00.000Z');

describe('OL-3 automation run read repository', () => {
  it('queries only the requested project with a bounded latest-first result set', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new OptimizationOrchestrationRepository({
      automationRun: { findMany },
    } as never) as any;

    const result = await repository.listAutomationRuns({
      projectId: PROJECT_ID,
      limit: 25,
    });

    expect(result).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
  });

  it('repairs overdue queued runs so expired queue backlog cannot block overlap forever', async () => {
    const queuedRun = {
      id: RUN_ID,
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      source: 'MANUAL',
      requestKey: 'manual:queued-timeout-repair',
      status: 'QUEUED',
      attempt: 1,
      deadlineAt: DEADLINE,
      blockedByRunId: null,
      startedAt: null,
      completedAt: null,
      lastErrorCode: null,
      createdAt: new Date('2026-09-04T12:55:00.000Z'),
      updatedAt: new Date('2026-09-04T12:55:00.000Z')
    };
    const findMany = vi.fn(async (input: {
      where?: { status?: { in?: string[] } };
    }) => {
      const statuses = input.where?.status?.in;
      return Array.isArray(statuses) && statuses.includes('QUEUED') ? [queuedRun] : [];
    });
    const updateMany = vi.fn(async (input: {
      where?: { status?: string };
    }) => ({ count: input.where?.status === 'QUEUED' ? 1 : 0 }));
    const repository = new OptimizationOrchestrationRepository({
      automationRun: { findMany, updateMany }
    } as never);
    const service = new OptimizationOrchestrationService({
      repository: {} as never,
      planningQueue: {} as never,
      projects: {} as never,
      automationRuns: repository,
      automationQueue: { enqueueRun: vi.fn() }
    } as never);

    await expect(service.expireTimedOutAutomationRuns(AS_OF)).resolves.toEqual({
      considered: 1,
      timedOut: 1
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['QUEUED', 'RUNNING'] },
        deadlineAt: { lte: AS_OF }
      },
      orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }]
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: RUN_ID, status: 'QUEUED' },
      data: {
        status: 'TIMED_OUT',
        completedAt: AS_OF,
        lastErrorCode: 'AUTOMATION_TIMEOUT'
      }
    });
  });
});
