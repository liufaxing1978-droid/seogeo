import { describe, expect, it, vi } from 'vitest';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000021';

describe('OL-3 automation run read repository', () => {
  it('queries only the requested project with a bounded latest-first result set', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new OptimizationOrchestrationRepository({
      automationRun: { findMany },
    } as never) as any;

    const result = await repository.listAutomationRuns({
      projectId: PROJECT_ID,
      limit: 25,
    });

    expect(result).toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 25,
    });
  });
});
