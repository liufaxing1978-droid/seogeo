import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000041';
const RUN_ID = '00000000-0000-4000-8000-000000000042';

describe('OL-3 automation run detail repository', () => {
  it('queries an automation run by id and project together', async () => {
    const run = { id: RUN_ID, projectId: PROJECT_ID, status: 'SUCCEEDED' };
    const findFirst = vi.fn().mockResolvedValue(run);
    const repository = new OptimizationOrchestrationRepository({
      automationRun: { findFirst },
    } as never) as any;

    const result = await repository.getAutomationRunForProject({
      projectId: PROJECT_ID,
      runId: RUN_ID,
    });

    expect(result).toBe(run);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: RUN_ID,
        projectId: PROJECT_ID,
      },
    });
  });
});
