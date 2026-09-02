import { describe, expect, it, vi } from 'vitest';
import { processOptimizationAutomationJob } from '../../src/modules/optimization-orchestration/orchestration.automation.worker.js';
import * as workerBootstrap from '../../src/queue/worker-bootstrap.js';
import {
  OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY,
  buildOptimizationAutomationRuntimeDeps,
  workerDefinitionForQueue
} from '../../src/queue/worker-bootstrap.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-02T20:30:00.000Z');

describe('OL-2 automation worker bootstrap', () => {
  it('registers the automation worker with bounded concurrency on the central worker runtime', () => {
    expect(OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY).toBe(2);
    expect(workerDefinitionForQueue('optimization-automation' as never)).toMatchObject({
      processor: processOptimizationAutomationJob,
      concurrency: 2
    });
  });

  it('builds the central runtime with the real SEARCH_REFRESH dispatcher instead of a not-configured stub', async () => {
    const sync = vi.fn().mockResolvedValue({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'COMPLETED',
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01',
      sourceRefs: [],
      searchFactSnapshotIds: [],
      discoveryState: 'REFRESHED',
      reason: null
    });
    const repository = {} as never;
    const service = {} as never;
    const runtime = buildOptimizationAutomationRuntimeDeps({
      repository,
      service,
      searchSync: { sync },
      now: () => NOW
    });

    await runtime.actions.execute({
      actionType: 'SEARCH_REFRESH',
      actionConfig: {
        version: 'SEARCH_REFRESH_V1',
        bindingId: BINDING_ID,
        lookbackDays: 7,
        lagDays: 1
      },
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    });

    expect(runtime.repository).toBe(repository);
    expect(runtime.service).toBe(service);
    expect(sync).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01'
    });
  });

  it('reconciles every persisted project definition set before the automation runtime is considered ready', async () => {
    const reconcile = (workerBootstrap as unknown as Record<string, unknown>)[
      'reconcileOptimizationAutomationDefinitionSchedules'
    ];
    expect(reconcile).toBeTypeOf('function');
    if (typeof reconcile !== 'function') return;

    const list = vi.fn().mockResolvedValue([
      { id: PROJECT_ID, planLevel: 'ADVANCED' },
      { id: SECOND_PROJECT_ID, planLevel: 'PRO' }
    ]);
    const reconcileAutomationSchedules = vi.fn()
      .mockResolvedValueOnce({ considered: 2, synced: 2 })
      .mockResolvedValueOnce({ considered: 1, synced: 1 });

    const result = await (reconcile as (input: {
      projects: { list: typeof list };
      orchestration: { reconcileAutomationSchedules: typeof reconcileAutomationSchedules };
    }) => Promise<{ projects: number; definitions: number; synced: number }>)({
      projects: { list },
      orchestration: { reconcileAutomationSchedules }
    });

    expect(list).toHaveBeenCalledTimes(1);
    expect(reconcileAutomationSchedules).toHaveBeenNthCalledWith(1, PROJECT_ID);
    expect(reconcileAutomationSchedules).toHaveBeenNthCalledWith(2, SECOND_PROJECT_ID);
    expect(result).toEqual({ projects: 2, definitions: 3, synced: 3 });
  });

  it('fails startup reconciliation closed instead of silently accepting scheduler drift', async () => {
    const reconcile = (workerBootstrap as unknown as Record<string, unknown>)[
      'reconcileOptimizationAutomationDefinitionSchedules'
    ];
    expect(reconcile).toBeTypeOf('function');
    if (typeof reconcile !== 'function') return;

    const list = vi.fn().mockResolvedValue([
      { id: PROJECT_ID, planLevel: 'ADVANCED' },
      { id: SECOND_PROJECT_ID, planLevel: 'PRO' }
    ]);
    const reconcileAutomationSchedules = vi.fn()
      .mockRejectedValueOnce(new Error('scheduler unavailable'));

    await expect((reconcile as (input: {
      projects: { list: typeof list };
      orchestration: { reconcileAutomationSchedules: typeof reconcileAutomationSchedules };
    }) => Promise<unknown>)({
      projects: { list },
      orchestration: { reconcileAutomationSchedules }
    })).rejects.toThrow('scheduler unavailable');

    expect(reconcileAutomationSchedules).toHaveBeenCalledTimes(1);
    expect(reconcileAutomationSchedules).toHaveBeenCalledWith(PROJECT_ID);
  });
});
