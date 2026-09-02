import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000031';
const RUN_ID = '00000000-0000-4000-8000-000000000032';

describe('OL-3 automation run detail service', () => {
  it('delegates a project-scoped run lookup instead of reading by bare run id', async () => {
    const run = { id: RUN_ID, projectId: PROJECT_ID, status: 'SUCCEEDED' };
    const getAutomationRunForProject = vi.fn().mockResolvedValue(run);
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
        getAutomationRunForProject,
        transitionAutomationRun: vi.fn(),
        listTimedOutAutomationRuns: vi.fn(),
      },
      automationQueue: { enqueueRun: vi.fn() },
    } as any) as any;

    const result = await service.getAutomationRun({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });

    expect(result).toBe(run);
    expect(getAutomationRunForProject).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });
  });
});
