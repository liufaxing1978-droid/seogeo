import { describe, expect, it, vi } from 'vitest';
import type { OptimizationRun } from '@prisma/client';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const PROJECT_A = '00000000-0000-0000-0000-000000000001';
const PROJECT_B = '00000000-0000-0000-0000-000000000002';
const PROJECT_C = '00000000-0000-0000-0000-000000000003';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function run(overrides: Partial<OptimizationRun> = {}): OptimizationRun {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: PROJECT_A,
    runVersion: 'OPTIMIZATION_RUN_V1',
    triggerType: 'MANUAL',
    triggerSource: 'MANUAL_REQUEST',
    triggerKey: 'a'.repeat(64),
    triggerPayload: {},
    status: 'QUEUED',
    candidateCount: 0,
    plannedCount: 0,
    itemCount: 0,
    completedCount: 0,
    failureCount: 0,
    startedAt: null,
    planningCompletedAt: null,
    completedAt: null,
    lastErrorCode: null,
    createdAt: new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: new Date('2026-08-23T00:00:00.000Z'),
    ...overrides
  };
}

function setup(options?: { runs?: OptimizationRun[]; projects?: Array<{ id: string; planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }> }) {
  const runs = [...(options?.runs ?? [])];
  const createOrGetRun = vi.fn(async (input: any) => {
    const existing = runs.find((item) => item.projectId === input.projectId && item.triggerKey === input.triggerKey);
    if (existing) return existing;
    const created = run({
      id: `22222222-2222-4222-8222-${String(runs.length + 1).padStart(12, '0')}`,
      projectId: input.projectId,
      triggerType: input.triggerType,
      triggerSource: input.triggerSource,
      triggerKey: input.triggerKey,
      triggerPayload: input.triggerPayload
    });
    runs.push(created);
    return created;
  });
  const getRun = vi.fn(async (runId: string) => runs.find((item) => item.id === runId) ?? null);
  const enqueueRun = vi.fn().mockResolvedValue({ id: 'job' });
  const list = vi.fn().mockResolvedValue(options?.projects ?? []);

  const service = new OptimizationOrchestrationService({
    repository: { createOrGetRun, getRun },
    planningQueue: { enqueueRun },
    projects: { list }
  });

  return { service, runs, createOrGetRun, getRun, enqueueRun, list };
}

describe('P9-B trigger service', () => {
  it('reuses the same manual request run identity and queues only its persisted ids', async () => {
    const { service, createOrGetRun, enqueueRun } = setup();

    const first = await service.triggerManual({
      projectId: PROJECT_A,
      manualRequestId: REQUEST_ID,
      requestedBy: 'project-api:test-user'
    });
    const second = await service.triggerManual({
      projectId: PROJECT_A,
      manualRequestId: REQUEST_ID,
      requestedBy: 'project-api:test-user'
    });

    expect(second.id).toBe(first.id);
    expect(createOrGetRun).toHaveBeenCalledTimes(2);
    expect(createOrGetRun.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT_A,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerPayload: {
        version: 'P9_B_MANUAL_TRIGGER_V1',
        manualRequestId: REQUEST_ID,
        requestedBy: 'project-api:test-user'
      }
    });
    expect(enqueueRun).toHaveBeenNthCalledWith(1, first.id, PROJECT_A);
    expect(enqueueRun).toHaveBeenNthCalledWith(2, first.id, PROJECT_A);
  });

  it('persists only bounded sorted Growth trigger facts', async () => {
    const { service, createOrGetRun, enqueueRun } = setup();

    const created = await service.triggerGrowth({
      projectId: PROJECT_A,
      asOfDate: '2026-08-23T00:00:00.000Z',
      materializationVersion: 'GROWTH_MATERIALIZATION_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      state: 'INELIGIBLE',
      selectedGscSnapshotIds: ['snapshot-b', 'snapshot-a', 'snapshot-b']
    });

    expect(createOrGetRun).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_A,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerPayload: {
        version: 'P9_B_GROWTH_TRIGGER_V1',
        asOfDate: '2026-08-23T00:00:00.000Z',
        growthMaterializationVersion: 'GROWTH_MATERIALIZATION_V1',
        growthFormulaVersion: 'GROWTH_SCORE_V1',
        growthState: 'INELIGIBLE',
        selectedGscSnapshotIds: ['snapshot-a', 'snapshot-b']
      }
    }));
    expect(enqueueRun).toHaveBeenCalledWith(created.id, PROJECT_A);
  });

  it('validates exact UTC dates and queues only entitled daily projects', async () => {
    const { service, createOrGetRun, enqueueRun } = setup({
      projects: [
        { id: PROJECT_A, planLevel: 'STANDARD' },
        { id: PROJECT_B, planLevel: 'ADVANCED' },
        { id: PROJECT_C, planLevel: 'ENTERPRISE' }
      ]
    });

    await expect(service.reconcileUtcDate('2026-8-23')).rejects.toThrow(/YYYY-MM-DD|UTC/i);
    await expect(service.reconcileUtcDate('2026-02-30')).rejects.toThrow(/YYYY-MM-DD|UTC/i);

    const result = await service.reconcileUtcDate('2026-08-23');

    expect(result).toEqual({ considered: 3, queued: 2 });
    expect(createOrGetRun).toHaveBeenCalledTimes(2);
    expect(createOrGetRun.mock.calls.map(([input]) => input.projectId)).toEqual([PROJECT_B, PROJECT_C]);
    expect(createOrGetRun.mock.calls[0]?.[0]).toMatchObject({
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'DAILY_RECONCILIATION',
      triggerSource: 'DAILY_SCHEDULER',
      triggerPayload: {
        version: 'P9_B_DAILY_TRIGGER_V1',
        utcDate: '2026-08-23',
        plannerVersion: 'OPTIMIZATION_PLAN_V1'
      }
    });
    expect(enqueueRun).toHaveBeenCalledTimes(2);
  });

  it('leaves a newly persisted run QUEUED when queue handoff fails', async () => {
    const { service, runs, enqueueRun } = setup();
    enqueueRun.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(service.triggerManual({
      projectId: PROJECT_A,
      manualRequestId: REQUEST_ID,
      requestedBy: 'project-api:test-user'
    })).rejects.toThrow('redis unavailable');

    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('QUEUED');
  });

  it('requeues QUEUED runs but never forces RUNNING runs back to QUEUED', async () => {
    const queued = run({ id: '33333333-3333-4333-8333-333333333333', status: 'QUEUED' });
    const running = run({ id: '44444444-4444-4444-8444-444444444444', status: 'RUNNING' });
    const { service, enqueueRun } = setup({ runs: [queued, running] });

    await expect(service.requeueRun(queued.id)).resolves.toBe(queued);
    await expect(service.requeueRun(running.id)).resolves.toBe(running);

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledWith(queued.id, queued.projectId);
  });
});
