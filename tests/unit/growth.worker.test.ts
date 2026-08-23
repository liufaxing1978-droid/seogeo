import { describe, expect, it, vi } from 'vitest';
import {
  GROWTH_MATERIALIZATION_QUEUE_NAME,
  buildGrowthMaterializationJobId,
  processGrowthMaterializationJob
} from '../../src/modules/growth/growth.worker.js';

const identity = {
  projectId: '00000000-0000-0000-0000-000000000001',
  formulaVersion: 'GROWTH_SCORE_V1',
  materializationVersion: 'GROWTH_MATERIALIZATION_V1',
  currentWindowStart: '2026-07-21',
  currentWindowEnd: '2026-08-17',
  previousWindowStart: '2026-06-23',
  previousWindowEnd: '2026-07-20',
  dataCutoffAt: '2026-08-17',
  selectedGscSnapshotIds: ['b', 'a']
};

const job = {
  name: 'materialize-window',
  data: {
    projectId: identity.projectId,
    asOfDate: '2026-08-20T12:00:00.000Z'
  }
};

describe('P7-A growth materialization worker', () => {
  it('uses the dedicated queue and a deterministic BullMQ-safe identity', () => {
    expect(GROWTH_MATERIALIZATION_QUEUE_NAME).toBe('growth-materialization');
    const first = buildGrowthMaterializationJobId(identity);
    const reordered = buildGrowthMaterializationJobId({
      ...identity,
      selectedGscSnapshotIds: ['a', 'b']
    });
    const changed = buildGrowthMaterializationJobId({
      ...identity,
      selectedGscSnapshotIds: ['a', 'c']
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^growth-materialization-[a-f0-9]{64}$/);
  });

  it('materializes from persisted inputs and emits bounded started/completed events', async () => {
    const materialize = vi.fn().mockResolvedValue({
      state: 'COMPLETED',
      selectedGscSnapshotIds: ['a', 'b'],
      opportunitySnapshotCount: 2,
      topicSnapshotCount: 1,
      missingDates: []
    });
    const events: Array<Record<string, unknown>> = [];

    await processGrowthMaterializationJob(job, {
      materialize,
      emit: (event) => events.push(event)
    });

    expect(materialize).toHaveBeenCalledOnce();
    expect(materialize).toHaveBeenCalledWith(
      identity.projectId,
      new Date('2026-08-20T12:00:00.000Z')
    );
    expect(events.map((event) => event.event)).toEqual([
      'growth.materialization.started',
      'growth.materialization.completed'
    ]);
    expect(events[1]).toMatchObject({
      projectId: identity.projectId,
      status: 'COMPLETED',
      selectedGscSnapshotCount: 2,
      opportunitySnapshotCount: 2,
      topicSnapshotCount: 1
    });
  });

  it.each(['COMPLETED', 'INELIGIBLE'] as const)(
    'hands off a successful %s materialization only after the bounded completed event',
    async (state) => {
      const order: string[] = [];
      const triggerGrowth = vi.fn(async () => {
        order.push('triggered');
      });
      const materialize = vi.fn(async () => {
        order.push('materialized');
        return {
          state,
          selectedGscSnapshotIds: ['snapshot-b', 'snapshot-a'],
          opportunitySnapshotCount: state === 'COMPLETED' ? 2 : 0,
          topicSnapshotCount: state === 'COMPLETED' ? 1 : 0,
          missingDates: []
        };
      });

      await processGrowthMaterializationJob(job, {
        materialize,
        emit: (event) => order.push(`event:${String(event.event)}`),
        optimizationTrigger: { triggerGrowth }
      });

      expect(order).toEqual([
        'event:growth.materialization.started',
        'materialized',
        'event:growth.materialization.completed',
        'triggered'
      ]);
      expect(triggerGrowth).toHaveBeenCalledOnce();
      expect(triggerGrowth).toHaveBeenCalledWith({
        projectId: identity.projectId,
        asOfDate: '2026-08-20T12:00:00.000Z',
        materializationVersion: 'GROWTH_MATERIALIZATION_V1',
        formulaVersion: 'GROWTH_SCORE_V1',
        state,
        selectedGscSnapshotIds: ['snapshot-b', 'snapshot-a']
      });
    }
  );

  it('never hands off when Growth materialization throws', async () => {
    const materialize = vi.fn().mockRejectedValue(new Error('growth persistence failed'));
    const triggerGrowth = vi.fn();
    const events: Array<Record<string, unknown>> = [];

    await expect(processGrowthMaterializationJob(job, {
      materialize,
      emit: (event) => events.push(event),
      optimizationTrigger: { triggerGrowth }
    })).rejects.toThrow('growth persistence failed');

    expect(triggerGrowth).not.toHaveBeenCalled();
    expect(events.map((event) => event.event)).toEqual([
      'growth.materialization.started',
      'growth.materialization.failed'
    ]);
  });

  it('isolates post-success orchestration handoff failure from committed Growth semantics', async () => {
    const materialize = vi.fn().mockResolvedValue({
      state: 'COMPLETED',
      selectedGscSnapshotIds: ['a', 'b'],
      opportunitySnapshotCount: 2,
      topicSnapshotCount: 1,
      missingDates: []
    });
    const triggerGrowth = vi.fn().mockRejectedValue(new Error('redis unavailable'));
    const events: Array<Record<string, unknown>> = [];

    await expect(processGrowthMaterializationJob(job, {
      materialize,
      emit: (event) => events.push(event),
      optimizationTrigger: { triggerGrowth }
    })).resolves.toBeUndefined();

    expect(materialize).toHaveBeenCalledOnce();
    expect(triggerGrowth).toHaveBeenCalledOnce();
    expect(events.map((event) => event.event)).toEqual([
      'growth.materialization.started',
      'growth.materialization.completed'
    ]);
  });

  it('emits a safe failure event and rethrows', async () => {
    const materialize = vi.fn().mockRejectedValue(new Error('secret query payload'));
    const events: Array<Record<string, unknown>> = [];

    await expect(processGrowthMaterializationJob(job, {
      materialize,
      emit: (event) => events.push(event)
    })).rejects.toThrow('secret query payload');

    expect(events.at(-1)).toMatchObject({
      event: 'growth.materialization.failed',
      projectId: identity.projectId,
      status: 'FAILED',
      errorCode: 'GROWTH_MATERIALIZATION_FAILED'
    });
    expect(JSON.stringify(events.at(-1))).not.toContain('secret query payload');
  });
});
