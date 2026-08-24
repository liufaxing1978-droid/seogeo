import { describe, expect, it, vi } from 'vitest';
import { processOptimizationOrchestrationJob } from '../../src/modules/optimization-orchestration/orchestration.worker.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ITEM_ID = '33333333-3333-4333-8333-333333333333';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const COMPLETED_AT = new Date('2026-08-24T00:00:00.000Z');

function harness(enqueueRunItem = vi.fn().mockResolvedValue({ id: 'autopilot-job' })) {
  const run = {
    id: RUN_ID,
    projectId: PROJECT_ID,
    status: 'RUNNING',
    planningCompletedAt: new Date('2026-08-23T23:00:00.000Z')
  };
  const item = {
    id: RUN_ITEM_ID,
    runId: RUN_ID,
    projectId: PROJECT_ID,
    optimizationPlanId: PLAN_ID,
    status: 'PENDING',
    currentStage: 'PLANNED',
    reasonCode: null as string | null
  };
  const plan = { id: PLAN_ID, projectId: PROJECT_ID };

  const transitionItem = vi.fn().mockImplementation(async (input: {
    to: string;
    patch: { currentStage?: string; reasonCode?: string | null };
  }) => {
    item.status = input.to;
    if (input.patch.currentStage) item.currentStage = input.patch.currentStage;
    if ('reasonCode' in input.patch) item.reasonCode = input.patch.reasonCode ?? null;
    return true;
  });
  const transitionRun = vi.fn().mockResolvedValue(true);
  const repository = {
    getRun: vi.fn().mockResolvedValue(run),
    getPlan: vi.fn().mockResolvedValue(plan),
    listRunItems: vi.fn().mockResolvedValue([item]),
    transitionItem,
    refreshRunCounters: vi.fn().mockResolvedValue({
      itemCount: 1,
      completedCount: 1,
      failureCount: 0
    }),
    transitionRun
  };

  return {
    run,
    item,
    repository,
    transitionItem,
    transitionRun,
    enqueueRunItem,
    deps: {
      repository,
      autopilotQueue: { enqueueRunItem },
      now: () => COMPLETED_AT
    }
  };
}

describe('P9-B -> P9-C durable handoff', () => {
  it('enqueues only after the run item is durably COMPLETED at READY_FOR_POLICY', async () => {
    const state = harness();
    state.enqueueRunItem.mockImplementation(async (runItemId: string, projectId: string) => {
      expect(runItemId).toBe(RUN_ITEM_ID);
      expect(projectId).toBe(PROJECT_ID);
      expect(state.item.status).toBe('COMPLETED');
      expect(state.item.currentStage).toBe('READY_FOR_POLICY');
      expect(state.transitionItem).toHaveBeenCalledWith({
        itemId: RUN_ITEM_ID,
        from: 'PENDING',
        to: 'COMPLETED',
        patch: {
          currentStage: 'READY_FOR_POLICY',
          reasonCode: null,
          completedAt: COMPLETED_AT
        }
      });
      return { id: 'autopilot-job' };
    });

    await processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: RUN_ID, projectId: PROJECT_ID } },
      state.deps as never
    );

    expect(state.enqueueRunItem).toHaveBeenCalledTimes(1);
    expect(state.enqueueRunItem).toHaveBeenCalledWith(RUN_ITEM_ID, PROJECT_ID);
    expect(state.transitionRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: RUN_ID,
      from: 'RUNNING',
      to: 'SUCCEEDED'
    }));
  });

  it('does not roll back the durable P9-B checkpoint when the Redis handoff fails', async () => {
    const enqueueError = new Error('redis unavailable');
    const state = harness(vi.fn().mockRejectedValue(enqueueError));

    await expect(processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: RUN_ID, projectId: PROJECT_ID } },
      state.deps as never
    )).rejects.toThrow('redis unavailable');

    expect(state.transitionItem).toHaveBeenCalledTimes(1);
    expect(state.item.status).toBe('COMPLETED');
    expect(state.item.currentStage).toBe('READY_FOR_POLICY');
    expect(state.enqueueRunItem).toHaveBeenCalledWith(RUN_ITEM_ID, PROJECT_ID);
  });
});
