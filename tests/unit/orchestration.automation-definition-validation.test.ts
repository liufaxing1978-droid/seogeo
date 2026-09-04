import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';

function harness() {
  const updatedDefinition = {
    id: DEFINITION_ID,
    projectId: PROJECT_ID,
    key: 'daily-search-refresh',
    actionType: 'SEARCH_REFRESH',
    actionConfig: {},
    enabled: true,
    scheduleCron: '0 7 * * *',
    overlapPolicy: 'SKIP_IF_RUNNING',
    maxAttempts: 3,
    timeoutMs: 300_000
  };
  const definitions = {
    listAutomationDefinitions: vi.fn().mockResolvedValue([]),
    createAutomationDefinition: vi.fn().mockResolvedValue({ id: 'definition-1' }),
    updateAutomationDefinition: vi.fn().mockResolvedValue(updatedDefinition)
  };
  const schedules = {
    syncDefinitionSchedule: vi.fn().mockResolvedValue(undefined)
  };
  const service = new OptimizationOrchestrationService({
    repository: {} as never,
    planningQueue: {} as never,
    projects: {} as never,
    automationDefinitions: definitions,
    automationSchedules: schedules
  } as any);

  return { service, definitions, schedules };
}

function validSearchRefreshConfig() {
  return {
    version: 'SEARCH_REFRESH_V1' as const,
    bindingId: BINDING_ID,
    lookbackDays: 7,
    lagDays: 1
  };
}

describe('automation definition action validation', () => {
  it('rejects an unregistered action type before persistence', async () => {
    const state = harness();

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: 'unsupported-action',
      actionType: 'UNSUPPORTED_ACTION',
      actionConfig: {},
      enabled: true,
      scheduleCron: '0 7 * * *',
      maxAttempts: 3,
      timeoutMs: 300_000
    })).rejects.toThrow(/unsupported|not registered/i);

    expect(state.definitions.createAutomationDefinition).not.toHaveBeenCalled();
    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });

  it('rejects invalid SEARCH_REFRESH config before persistence', async () => {
    const state = harness();

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: 'invalid-search-refresh-config',
      actionType: 'SEARCH_REFRESH',
      actionConfig: {},
      enabled: true,
      scheduleCron: '0 7 * * *',
      maxAttempts: 3,
      timeoutMs: 300_000
    })).rejects.toThrow(/configuration|config.*invalid|invalid.*config/i);

    expect(state.definitions.createAutomationDefinition).not.toHaveBeenCalled();
    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });

  it('rejects invalid SEARCH_REFRESH config on update before persistence', async () => {
    const state = harness();

    await expect(state.service.updateAutomationDefinition({
      definitionId: DEFINITION_ID,
      projectId: PROJECT_ID,
      patch: {
        actionConfig: {}
      }
    })).rejects.toThrow(/configuration|config.*invalid|invalid.*config/i);

    expect(state.definitions.updateAutomationDefinition).not.toHaveBeenCalled();
    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });

  it('rejects an invalid non-empty cron schedule before persistence', async () => {
    const state = harness();

    await expect(state.service.createAutomationDefinition({
      projectId: PROJECT_ID,
      key: 'invalid-cron',
      actionType: 'SEARCH_REFRESH',
      actionConfig: validSearchRefreshConfig(),
      enabled: true,
      scheduleCron: 'not a cron',
      maxAttempts: 3,
      timeoutMs: 300_000
    })).rejects.toThrow(/cron|schedule/i);

    expect(state.definitions.createAutomationDefinition).not.toHaveBeenCalled();
    expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
  });

  it('fails closed before persistence when an unrelated update would carry forward an unsafe persisted definition', async () => {
    const state = harness();
    const baseDefinition = {
      id: DEFINITION_ID,
      projectId: PROJECT_ID,
      key: 'legacy-definition',
      actionType: 'SEARCH_REFRESH',
      actionConfig: validSearchRefreshConfig(),
      enabled: true,
      scheduleCron: '0 7 * * *',
      overlapPolicy: 'SKIP_IF_RUNNING',
      maxAttempts: 3,
      timeoutMs: 300_000
    };
    const unsafeDefinitions = [
      { ...baseDefinition, actionType: 'UNREGISTERED_ACTION' },
      { ...baseDefinition, actionConfig: {} },
      { ...baseDefinition, scheduleCron: 'not a cron' },
      { ...baseDefinition, maxAttempts: 0 }
    ];

    for (const unsafe of unsafeDefinitions) {
      state.definitions.listAutomationDefinitions.mockResolvedValueOnce([unsafe]);
      state.definitions.updateAutomationDefinition.mockClear();
      state.schedules.syncDefinitionSchedule.mockClear();

      await expect(state.service.updateAutomationDefinition({
        definitionId: DEFINITION_ID,
        projectId: PROJECT_ID,
        patch: { enabled: false }
      })).rejects.toThrow();

      expect(state.definitions.updateAutomationDefinition).not.toHaveBeenCalled();
      expect(state.schedules.syncDefinitionSchedule).not.toHaveBeenCalled();
    }
  });
});
