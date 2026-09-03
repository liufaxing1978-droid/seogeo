import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

function harness() {
  const definitions = {
    listAutomationDefinitions: vi.fn().mockResolvedValue([]),
    createAutomationDefinition: vi.fn().mockResolvedValue({ id: 'definition-1' }),
    updateAutomationDefinition: vi.fn()
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
});
