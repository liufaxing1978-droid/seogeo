import { describe, expect, it, vi } from 'vitest';
import { processOptimizationAutomationJob } from '../../src/modules/optimization-orchestration/orchestration.automation.worker.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-02T03:00:00.000Z');

const ACTION_CONFIG = {
  version: 'SEARCH_REFRESH_V1',
  bindingId: BINDING_ID,
  lookbackDays: 7,
  lagDays: 1
};

function queuedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    definitionId: DEFINITION_ID,
    projectId: PROJECT_ID,
    source: 'MANUAL',
    requestKey: 'manual:request-1',
    status: 'QUEUED',
    attempt: 1,
    deadlineAt: new Date('2026-09-02T03:05:00.000Z'),
    blockedByRunId: null,
    startedAt: null,
    completedAt: null,
    lastErrorCode: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as any;
}

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: DEFINITION_ID,
    projectId: PROJECT_ID,
    key: 'daily-search-refresh',
    actionType: 'SEARCH_REFRESH',
    actionConfig: ACTION_CONFIG,
    enabled: true,
    scheduleCron: '0 3 * * *',
    overlapPolicy: 'SKIP_IF_RUNNING',
    maxAttempts: 3,
    timeoutMs: 300_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as any;
}

function harness(options?: { run?: any; definition?: any; actionError?: Error }) {
  const run = options?.run ?? queuedRun();
  const def = options?.definition ?? definition();
  const transitionAutomationRun = vi.fn().mockResolvedValue(true);
  const execute = options?.actionError
    ? vi.fn().mockRejectedValue(options.actionError)
    : vi.fn().mockResolvedValue(undefined);
  const startAutomationRun = vi.fn().mockResolvedValue(run);

  return {
    transitionAutomationRun,
    execute,
    startAutomationRun,
    deps: {
      repository: {
        getAutomationRun: vi.fn().mockResolvedValue(run),
        findAutomationDefinition: vi.fn().mockResolvedValue(def),
        transitionAutomationRun
      },
      service: { startAutomationRun },
      actions: { execute },
      now: () => NOW
    }
  };
}

describe('OL-2 automation worker', () => {
  it('uses the same service entrypoint for a scheduled occurrence and derives idempotency from the scheduler job id', async () => {
    const state = harness();

    await processOptimizationAutomationJob(
      {
        id: 'repeat:daily-search-refresh:2026-09-02T03:00:00.000Z',
        name: 'start-scheduled-automation',
        data: {
          kind: 'START_SCHEDULED',
          definitionId: DEFINITION_ID,
          projectId: PROJECT_ID
        }
      } as never,
      state.deps as never
    );

    expect(state.startAutomationRun).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      source: 'SCHEDULED',
      requestKey: 'scheduler:repeat:daily-search-refresh:2026-09-02T03:00:00.000Z'
    });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('fails closed when a scheduled occurrence has no durable job id', async () => {
    const state = harness();

    await expect(processOptimizationAutomationJob(
      {
        name: 'start-scheduled-automation',
        data: {
          kind: 'START_SCHEDULED',
          definitionId: DEFINITION_ID,
          projectId: PROJECT_ID
        }
      } as never,
      state.deps as never
    )).rejects.toThrow(/job id|scheduler/i);

    expect(state.startAutomationRun).not.toHaveBeenCalled();
  });

  it('moves a queued run through RUNNING to SUCCEEDED around the action dispatcher', async () => {
    const state = harness();

    await processOptimizationAutomationJob(
      {
        id: 'automation-job-1',
        name: 'execute-automation-run',
        data: { kind: 'EXECUTE_RUN', runId: RUN_ID, projectId: PROJECT_ID }
      } as never,
      state.deps as never
    );

    expect(state.transitionAutomationRun).toHaveBeenNthCalledWith(1, {
      runId: RUN_ID,
      from: 'QUEUED',
      to: 'RUNNING',
      patch: {
        startedAt: NOW,
        lastErrorCode: null
      }
    });
    expect(state.execute).toHaveBeenCalledWith({
      actionType: 'SEARCH_REFRESH',
      actionConfig: ACTION_CONFIG,
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    });
    expect(state.transitionAutomationRun).toHaveBeenNthCalledWith(2, {
      runId: RUN_ID,
      from: 'RUNNING',
      to: 'SUCCEEDED',
      patch: {
        completedAt: NOW,
        lastErrorCode: null
      }
    });
  });

  it('persists an action failure as business FAILED without asking BullMQ to spend a second business attempt', async () => {
    const error = Object.assign(new Error('provider unavailable'), {
      code: 'SEARCH_PROVIDER_UNAVAILABLE'
    });
    const state = harness({ actionError: error });

    await expect(processOptimizationAutomationJob(
      {
        id: 'automation-job-1',
        name: 'execute-automation-run',
        data: { kind: 'EXECUTE_RUN', runId: RUN_ID, projectId: PROJECT_ID }
      } as never,
      state.deps as never
    )).resolves.toBeUndefined();

    expect(state.transitionAutomationRun).toHaveBeenLastCalledWith({
      runId: RUN_ID,
      from: 'RUNNING',
      to: 'FAILED',
      patch: {
        completedAt: NOW,
        lastErrorCode: 'SEARCH_PROVIDER_UNAVAILABLE'
      }
    });
  });

  it('times out an already-expired queued run before invoking its action', async () => {
    const state = harness({
      run: queuedRun({ deadlineAt: new Date('2026-09-02T02:59:59.000Z') })
    });

    await processOptimizationAutomationJob(
      {
        id: 'automation-job-1',
        name: 'execute-automation-run',
        data: { kind: 'EXECUTE_RUN', runId: RUN_ID, projectId: PROJECT_ID }
      } as never,
      state.deps as never
    );

    expect(state.transitionAutomationRun).toHaveBeenCalledWith({
      runId: RUN_ID,
      from: 'QUEUED',
      to: 'TIMED_OUT',
      patch: {
        completedAt: NOW,
        lastErrorCode: 'AUTOMATION_TIMEOUT'
      }
    });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('is idempotent for terminal runs and never repeats their side effects', async () => {
    const state = harness({ run: queuedRun({ status: 'SUCCEEDED' }) });

    await processOptimizationAutomationJob(
      {
        id: 'automation-job-1',
        name: 'execute-automation-run',
        data: { kind: 'EXECUTE_RUN', runId: RUN_ID, projectId: PROJECT_ID }
      } as never,
      state.deps as never
    );

    expect(state.transitionAutomationRun).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });
});