import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_PROJECT_ID = '00000000-0000-4000-8000-000000000009';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000002';
const RUN_ID = '00000000-0000-4000-8000-000000000003';
const ACTIVE_RUN_ID = '00000000-0000-4000-8000-000000000004';

const definition = {
  id: DEFINITION_ID,
  projectId: PROJECT_ID,
  key: 'daily-search-refresh',
  actionType: 'SEARCH_REFRESH',
  enabled: true,
  scheduleCron: '0 3 * * *',
  overlapPolicy: 'SKIP_IF_RUNNING',
  maxAttempts: 3,
  timeoutMs: 300_000
};

function automationRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    definitionId: DEFINITION_ID,
    projectId: PROJECT_ID,
    source: 'MANUAL',
    requestKey: 'manual-1',
    status: 'QUEUED',
    attempt: 1,
    deadlineAt: new Date('2026-09-02T03:05:00.000Z'),
    blockedByRunId: null,
    startedAt: null,
    completedAt: null,
    lastErrorCode: null,
    ...overrides
  };
}

function setup(options?: { activeRun?: ReturnType<typeof automationRun> | null }) {
  const createAutomationRun = vi.fn(async (input: Record<string, unknown>) =>
    automationRun({
      source: input.source,
      requestKey: input.requestKey,
      status: input.status,
      deadlineAt: input.deadlineAt,
      blockedByRunId: input.blockedByRunId ?? null
    })
  );
  const findAutomationDefinition = vi.fn().mockResolvedValue(definition);
  const findActiveAutomationRun = vi.fn().mockResolvedValue(options?.activeRun ?? null);
  const getAutomationRun = vi.fn().mockResolvedValue(null);
  const transitionAutomationRun = vi.fn().mockResolvedValue(true);
  const listTimedOutAutomationRuns = vi.fn().mockResolvedValue([]);
  const enqueueAutomationRun = vi.fn().mockResolvedValue({ id: 'job' });

  const service = new OptimizationOrchestrationService({
    repository: {
      createOrGetRun: vi.fn(),
      getRun: vi.fn()
    },
    planningQueue: { enqueueRun: vi.fn() },
    projects: { list: vi.fn(), findById: vi.fn() },
    automationRuns: {
      findAutomationDefinition,
      findActiveAutomationRun,
      createAutomationRun,
      getAutomationRun,
      transitionAutomationRun,
      listTimedOutAutomationRuns
    },
    automationQueue: { enqueueRun: enqueueAutomationRun },
    now: () => new Date('2026-09-02T03:00:00.000Z')
  } as any);

  return {
    service: service as any,
    createAutomationRun,
    findAutomationDefinition,
    findActiveAutomationRun,
    getAutomationRun,
    transitionAutomationRun,
    listTimedOutAutomationRuns,
    enqueueAutomationRun
  };
}

describe('OL-2 automation execution semantics', () => {
  it('routes manual and scheduled requests through the same persisted start path', async () => {
    const { service, createAutomationRun, enqueueAutomationRun } = setup();

    await service.startAutomationRun({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      source: 'MANUAL',
      requestKey: 'manual-1'
    });
    await service.startAutomationRun({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      source: 'SCHEDULED',
      requestKey: 'schedule:2026-09-02T03:00:00.000Z'
    });

    expect(createAutomationRun).toHaveBeenCalledTimes(2);
    expect(createAutomationRun.mock.calls.map(([input]) => input.source)).toEqual([
      'MANUAL',
      'SCHEDULED'
    ]);
    expect(enqueueAutomationRun).toHaveBeenCalledTimes(2);
    expect(enqueueAutomationRun).toHaveBeenNthCalledWith(1, RUN_ID, PROJECT_ID);
    expect(enqueueAutomationRun).toHaveBeenNthCalledWith(2, RUN_ID, PROJECT_ID);
  });

  it('records an overlap skip and does not enqueue a competing run', async () => {
    const active = automationRun({ id: ACTIVE_RUN_ID, status: 'RUNNING' });
    const { service, createAutomationRun, enqueueAutomationRun } = setup({ activeRun: active });

    await service.startAutomationRun({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      source: 'SCHEDULED',
      requestKey: 'schedule:2026-09-02T03:00:00.000Z'
    });

    expect(createAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: DEFINITION_ID,
        projectId: PROJECT_ID,
        status: 'SKIPPED',
        blockedByRunId: ACTIVE_RUN_ID
      })
    );
    expect(enqueueAutomationRun).not.toHaveBeenCalled();
  });

  it('retries a failed run only inside the definition attempt budget', async () => {
    const { service, getAutomationRun, transitionAutomationRun, enqueueAutomationRun } = setup();
    getAutomationRun.mockResolvedValueOnce(
      automationRun({ status: 'FAILED', attempt: 1, lastErrorCode: 'UPSTREAM_UNAVAILABLE' })
    );

    await service.retryAutomationRun({ runId: RUN_ID, projectId: PROJECT_ID });

    expect(transitionAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        from: 'FAILED',
        to: 'QUEUED',
        patch: expect.objectContaining({ attempt: 2, lastErrorCode: null })
      })
    );
    expect(enqueueAutomationRun).toHaveBeenCalledWith(RUN_ID, PROJECT_ID);
  });

  it('restores a retryable FAILED state when retry enqueue fails', async () => {
    const { service, getAutomationRun, transitionAutomationRun, enqueueAutomationRun } = setup();
    getAutomationRun.mockResolvedValueOnce(
      automationRun({
        status: 'FAILED',
        attempt: 1,
        completedAt: new Date('2026-09-02T02:59:00.000Z'),
        lastErrorCode: 'UPSTREAM_UNAVAILABLE'
      })
    );
    enqueueAutomationRun.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.retryAutomationRun({ runId: RUN_ID, projectId: PROJECT_ID }))
      .rejects.toThrow('queue unavailable');

    expect(transitionAutomationRun).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        runId: RUN_ID,
        from: 'FAILED',
        to: 'QUEUED',
        patch: expect.objectContaining({ attempt: 2, lastErrorCode: null })
      })
    );
    expect(transitionAutomationRun).toHaveBeenNthCalledWith(2, {
      runId: RUN_ID,
      from: 'QUEUED',
      to: 'FAILED',
      patch: {
        attempt: 1,
        deadlineAt: null,
        startedAt: null,
        completedAt: new Date('2026-09-02T03:00:00.000Z'),
        lastErrorCode: 'AUTOMATION_ENQUEUE_FAILED'
      }
    });
  });

  it('fails closed when retry budget is exhausted', async () => {
    const { service, getAutomationRun, transitionAutomationRun, enqueueAutomationRun } = setup();
    getAutomationRun.mockResolvedValueOnce(
      automationRun({ status: 'FAILED', attempt: 3, lastErrorCode: 'UPSTREAM_UNAVAILABLE' })
    );

    await expect(service.retryAutomationRun({ runId: RUN_ID, projectId: PROJECT_ID }))
      .rejects.toThrow(/attempt|retry|exhausted/i);
    expect(transitionAutomationRun).not.toHaveBeenCalled();
    expect(enqueueAutomationRun).not.toHaveBeenCalled();
  });

  it('rejects a retry when the run does not belong to the requested project', async () => {
    const { service, getAutomationRun, transitionAutomationRun, enqueueAutomationRun } = setup();
    getAutomationRun.mockResolvedValueOnce(
      automationRun({ status: 'FAILED', attempt: 1, lastErrorCode: 'UPSTREAM_UNAVAILABLE' })
    );

    await expect(service.retryAutomationRun({ runId: RUN_ID, projectId: OTHER_PROJECT_ID }))
      .rejects.toThrow(/project|not found|mismatch/i);
    expect(transitionAutomationRun).not.toHaveBeenCalled();
    expect(enqueueAutomationRun).not.toHaveBeenCalled();
  });

  it('marks overdue RUNNING executions TIMED_OUT with an explicit error code', async () => {
    const { service, listTimedOutAutomationRuns, transitionAutomationRun } = setup();
    listTimedOutAutomationRuns.mockResolvedValueOnce([
      automationRun({
        status: 'RUNNING',
        startedAt: new Date('2026-09-02T02:50:00.000Z'),
        deadlineAt: new Date('2026-09-02T02:55:00.000Z')
      })
    ]);

    const result = await service.expireTimedOutAutomationRuns(
      new Date('2026-09-02T03:00:00.000Z')
    );

    expect(result).toEqual({ considered: 1, timedOut: 1 });
    expect(transitionAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        from: 'RUNNING',
        to: 'TIMED_OUT',
        patch: expect.objectContaining({
          lastErrorCode: 'AUTOMATION_TIMEOUT',
          completedAt: new Date('2026-09-02T03:00:00.000Z')
        })
      })
    );
  });
});
