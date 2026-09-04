import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const DEFINITION_ID = '00000000-0000-4000-8000-000000000002';
const RUN_ID = '00000000-0000-4000-8000-000000000003';

const definition = {
  id: DEFINITION_ID,
  projectId: PROJECT_ID,
  key: 'daily-search-refresh',
  actionType: 'SEARCH_REFRESH',
  actionConfig: {
    version: 'SEARCH_REFRESH_V1',
    bindingId: '44444444-4444-4444-8444-444444444444',
    lookbackDays: 7,
    lagDays: 1
  },
  enabled: true,
  scheduleCron: '0 3 * * *',
  overlapPolicy: 'SKIP_IF_RUNNING',
  maxAttempts: 3,
  timeoutMs: 300_000
} as any;

const failedRun = {
  id: RUN_ID,
  definitionId: DEFINITION_ID,
  projectId: PROJECT_ID,
  source: 'MANUAL',
  requestKey: 'manual-1',
  status: 'FAILED',
  attempt: 1,
  deadlineAt: new Date('2026-09-02T03:05:00.000Z'),
  blockedByRunId: null,
  startedAt: new Date('2026-09-02T03:00:00.000Z'),
  completedAt: new Date('2026-09-02T03:01:00.000Z'),
  lastErrorCode: 'UPSTREAM_UNAVAILABLE'
} as any;

describe('automation retry deadline identity', () => {
  it('returns the exact deadline persisted by the FAILED to QUEUED retry transition', async () => {
    const transitionAutomationRun = vi.fn().mockResolvedValue(true);
    const nowValues = [
      new Date('2026-09-02T04:00:00.000Z'),
      new Date('2026-09-02T04:00:01.000Z')
    ];
    const service = new OptimizationOrchestrationService({
      repository: { createOrGetRun: vi.fn(), getRun: vi.fn() },
      planningQueue: { enqueueRun: vi.fn() },
      projects: { list: vi.fn(), findById: vi.fn() },
      automationRuns: {
        findAutomationDefinition: vi.fn().mockResolvedValue(definition),
        findActiveAutomationRun: vi.fn(),
        createAutomationRun: vi.fn(),
        getAutomationRun: vi.fn().mockResolvedValue(failedRun),
        transitionAutomationRun,
        listTimedOutAutomationRuns: vi.fn()
      },
      automationQueue: { enqueueRun: vi.fn().mockResolvedValue(undefined) },
      now: () => nowValues.shift() ?? new Date('2026-09-02T04:00:01.000Z')
    } as any);

    const result = await service.retryAutomationRun({
      runId: RUN_ID,
      projectId: PROJECT_ID
    });

    const persistedDeadline = transitionAutomationRun.mock.calls[0][0].patch.deadlineAt;
    expect(result.deadlineAt).toEqual(persistedDeadline);
  });
});
