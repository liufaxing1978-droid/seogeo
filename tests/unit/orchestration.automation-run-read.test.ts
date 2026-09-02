import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000011';

function setup() {
  const listAutomationRuns = vi.fn().mockResolvedValue([]);
  const service = new OptimizationOrchestrationService({
    repository: {
      createOrGetRun: vi.fn(),
      getRun: vi.fn(),
    },
    planningQueue: { enqueueRun: vi.fn() },
    projects: { list: vi.fn(), findById: vi.fn() },
    automationRuns: {
      findAutomationDefinition: vi.fn(),
      findActiveAutomationRun: vi.fn(),
      createAutomationRun: vi.fn(),
      getAutomationRun: vi.fn(),
      transitionAutomationRun: vi.fn(),
      listTimedOutAutomationRuns: vi.fn(),
      listAutomationRuns,
    },
    automationQueue: { enqueueRun: vi.fn() },
  } as any);

  return { service: service as any, listAutomationRuns };
}

describe('OL-3 automation run read service', () => {
  it('delegates a bounded project-scoped recent-run query to persistence', async () => {
    const { service, listAutomationRuns } = setup();

    const result = await service.listAutomationRuns({
      projectId: PROJECT_ID,
      limit: 25,
    });

    expect(result).toEqual([]);
    expect(listAutomationRuns).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      limit: 25,
    });
  });
});
