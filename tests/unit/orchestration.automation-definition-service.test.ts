import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-09-02T21:00:00.000Z');

function definition(overrides: Record<string, unknown> = {}) {
  return {
    id: DEFINITION_ID,
    projectId: PROJECT_ID,
    key: 'daily-search-refresh',
    actionType: 'SEARCH_REFRESH',
    actionConfig: {
      version: 'SEARCH_REFRESH_V1',
      bindingId: BINDING_ID,
      lookbackDays: 7,
      lagDays: 1
    },
    enabled: true,
    scheduleCron: '0 7 * * *',
    overlapPolicy: 'SKIP_IF_RUNNING',
    maxAttempts: 3,
    timeoutMs: 300_000,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as any;
}

function harness() {
  const created = definition();
  const updated = definition({ enabled: false, scheduleCron: null });
  const definitions = {
    listAutomationDefinitions: vi.fn().mockResolvedValue([created]),
    createAutomationDefinition: vi.fn().mockResolvedValue(created),
    updateAutomationDefinition: vi.fn().mockResolvedValue(updated)
  };
  const schedules = {
    syncDefinitionSchedule: vi.fn().mockResolvedValue(undefined)
  };
  const service = new OptimizationOrchestrationService({
    repository: {} as never,
    planningQueue: {} as never,
    projects: {} as never,
    automationDefinitions: definitions,
    automationSchedules: schedules,
    now: () => NOW
  } as any);

  return { service, definitions, schedules, created, updated };
}

describe('OL-2 automation definition management', () => {
  it('lists only project-scoped automation definitions', async () => {
    const state = harness();

    await expect(state.service.listAutomationDefinitions(PROJECT_ID)).resolves.toEqual([
      state.created
    ]);
    expect(state.definitions.listAutomationDefinitions).toHaveBeenCalledWith(PROJECT_ID);
  });

  it('creates a bounded SEARCH_REFRESH definition and immediately reconciles its scheduler', async () => {
    const state = harness();
    const actionConfig = {
      version: 'SEARCH_REFRESH_V1' as const,
      bindingId: BINDING_ID,
      lookbackDays: 7,
      lagDays: 1
    };

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: ' daily-search-refresh ',
      actionType: 'SEARCH_REFRESH',
      actionConfig,
      enabled: true,
      scheduleCron: '0 7 * * *',
      maxAttempts: 3,
      timeoutMs: 300_000
    })).resolves.toEqual(state.created);

    expect(state.definitions.createAutomationDefinition).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      key: 'daily-search-refresh',
      actionType: 'SEARCH_REFRESH',
      actionConfig,
      enabled: true,
      scheduleCron: '0 7 * * *',
      overlapPolicy: 'SKIP_IF_RUNNING',
      maxAttempts: 3,
      timeoutMs: 300_000
    });
    expect(state.schedules.syncDefinitionSchedule).toHaveBeenCalledWith(state.created);
  });

  it('updates a project-scoped definition then removes its scheduler when disabled', async () => {
    const state = harness();

    await expect(state.service.updateAutomationDefinition({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      patch: {
        enabled: false,
        scheduleCron: null
      }
    })).resolves.toEqual(state.updated);

    expect(state.definitions.updateAutomationDefinition).toHaveBeenCalledWith({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      patch: {
        enabled: false,
        scheduleCron: null
      }
    });
    expect(state.schedules.syncDefinitionSchedule).toHaveBeenCalledWith(state.updated);
  });

  it('fails closed when a project-scoped update cannot find the definition', async () => {
    const state = harness();
    state.definitions.updateAutomationDefinition.mockResolvedValueOnce(null);

    await expect(state.service.updateAutomationDefinition({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      patch: { enabled: false }
    })).rejects.toThrow(/definition not found/i);

    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });

  it('reconciles every persisted project definition so queue drift can be repaired', async () => {
    const state = harness();
    const disabled = definition({
      id: '55555555-5555-4555-8555-555555555555',
      enabled: false,
      scheduleCron: null
    });
    state.definitions.listAutomationDefinitions.mockResolvedValueOnce([
      state.created,
      disabled
    ]);

    await expect(state.service.reconcileAutomationSchedules(PROJECT_ID)).resolves.toEqual({
      considered: 2,
      synced: 2
    });

    expect(state.schedules.syncDefinitionSchedule).toHaveBeenNthCalledWith(1, state.created);
    expect(state.schedules.syncDefinitionSchedule).toHaveBeenNthCalledWith(2, disabled);
  });

  it('fails closed before scheduler sync when a persisted definition violates the current management contract', async () => {
    const state = harness();
    const unsafeDefinitions = [
      definition({ actionType: 'UNREGISTERED_ACTION' }),
      definition({ actionConfig: {} }),
      definition({ scheduleCron: 'not a cron' }),
      definition({ maxAttempts: 0 })
    ];

    for (const unsafe of unsafeDefinitions) {
      state.definitions.listAutomationDefinitions.mockResolvedValueOnce([unsafe]);
      state.schedules.syncDefinitionSchedule.mockClear();

      await expect(state.service.reconcileAutomationSchedules(PROJECT_ID)).rejects.toThrow();
      expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
    }
  });

  it('rejects unsafe execution policy values before persistence', async () => {
    const state = harness();

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: 'daily-search-refresh',
      actionType: 'SEARCH_REFRESH',
      actionConfig: state.created.actionConfig,
      enabled: true,
      scheduleCron: '0 7 * * *',
      maxAttempts: 0,
      timeoutMs: 300_000
    })).rejects.toThrow(/maxAttempts/i);

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: 'daily-search-refresh',
      actionType: 'SEARCH_REFRESH',
      actionConfig: state.created.actionConfig,
      enabled: true,
      scheduleCron: '0 7 * * *',
      maxAttempts: 3,
      timeoutMs: 0
    })).rejects.toThrow(/timeoutMs/i);

    expect(state.definitions.createAutomationDefinition).not.toHaveBeenCalled();
    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });
});