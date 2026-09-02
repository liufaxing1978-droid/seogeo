import { describe, expect, it, vi } from 'vitest';
import {
  OptimizationAutomationActionDispatcher,
  buildSearchRefreshWindow
} from '../../src/modules/optimization-orchestration/orchestration.automation.actions.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-02T20:30:00.000Z');

function searchConfig(overrides: Record<string, unknown> = {}) {
  return {
    version: 'SEARCH_REFRESH_V1',
    bindingId: BINDING_ID,
    lookbackDays: 7,
    lagDays: 1,
    ...overrides
  };
}

describe('OL-2 automation action dispatcher', () => {
  it('builds an inclusive UTC window from lookback and provider lag instead of persisting stale dates', () => {
    expect(buildSearchRefreshWindow(NOW, { lookbackDays: 7, lagDays: 1 })).toEqual({
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01'
    });
  });

  it('reuses the existing official search sync command for SEARCH_REFRESH', async () => {
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
    const dispatcher = new OptimizationAutomationActionDispatcher({
      searchSync: { sync },
      now: () => NOW
    });

    await dispatcher.execute({
      actionType: 'SEARCH_REFRESH',
      actionConfig: searchConfig(),
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01'
    });
  });

  it('accepts an idempotent ALREADY_COMPLETED official search outcome', async () => {
    const sync = vi.fn().mockResolvedValue({
      provider: 'BING_WEBMASTER',
      state: 'ALREADY_COMPLETED',
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01',
      sourceRefs: [],
      searchFactSnapshotIds: [],
      discoveryState: 'NOT_RUN',
      reason: null
    });
    const dispatcher = new OptimizationAutomationActionDispatcher({
      searchSync: { sync },
      now: () => NOW
    });

    await expect(dispatcher.execute({
      actionType: 'SEARCH_REFRESH',
      actionConfig: searchConfig(),
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    })).resolves.toBeUndefined();
  });

  it('fails closed on missing, malformed, or secret-bearing SEARCH_REFRESH config', async () => {
    const sync = vi.fn();
    const dispatcher = new OptimizationAutomationActionDispatcher({
      searchSync: { sync },
      now: () => NOW
    });

    for (const actionConfig of [
      null,
      { version: 'SEARCH_REFRESH_V1', bindingId: 'not-a-uuid', lookbackDays: 7, lagDays: 1 },
      searchConfig({ apiKey: 'must-not-be-persisted' })
    ]) {
      await expect(dispatcher.execute({
        actionType: 'SEARCH_REFRESH',
        actionConfig,
        projectId: PROJECT_ID,
        runId: RUN_ID,
        definitionId: DEFINITION_ID
      })).rejects.toMatchObject({ code: 'AUTOMATION_ACTION_CONFIG_INVALID' });
    }

    expect(sync).not.toHaveBeenCalled();
  });

  it('turns non-success official search outcomes into explicit automation failures', async () => {
    const sync = vi.fn().mockResolvedValue({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'UNAVAILABLE',
      dateFrom: '2026-08-26',
      dateTo: '2026-09-01',
      sourceRefs: [],
      searchFactSnapshotIds: [],
      discoveryState: 'NOT_RUN',
      reason: 'SYNC_NOT_CONFIGURED'
    });
    const dispatcher = new OptimizationAutomationActionDispatcher({
      searchSync: { sync },
      now: () => NOW
    });

    await expect(dispatcher.execute({
      actionType: 'SEARCH_REFRESH',
      actionConfig: searchConfig(),
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    })).rejects.toMatchObject({ code: 'SEARCH_REFRESH_SYNC_NOT_CONFIGURED' });
  });

  it('fails closed for action types without a registered adapter', async () => {
    const dispatcher = new OptimizationAutomationActionDispatcher({
      searchSync: { sync: vi.fn() },
      now: () => NOW
    });

    await expect(dispatcher.execute({
      actionType: 'UNKNOWN_ACTION',
      actionConfig: {},
      projectId: PROJECT_ID,
      runId: RUN_ID,
      definitionId: DEFINITION_ID
    })).rejects.toMatchObject({ code: 'AUTOMATION_ACTION_UNSUPPORTED' });
  });
});