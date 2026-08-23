import { describe, expect, it } from 'vitest';
import {
  buildDailyTriggerKey,
  buildGrowthTriggerKey,
  buildManualTriggerKey,
  buildRunItemKey
} from '../../src/modules/optimization-orchestration/orchestration.identity.js';

const PROJECT_A = '00000000-0000-0000-0000-000000000001';
const PROJECT_B = '00000000-0000-0000-0000-000000000002';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';

const growth = {
  projectId: PROJECT_A,
  asOfDate: '2026-08-23T00:00:00.000Z',
  materializationVersion: 'GROWTH_MATERIALIZATION_V1',
  formulaVersion: 'GROWTH_SCORE_V1',
  state: 'COMPLETED' as const,
  selectedGscSnapshotIds: ['snapshot-a', 'snapshot-b']
};

describe('P9-B orchestration identities', () => {
  it('normalizes Growth snapshot ids before hashing', () => {
    const first = buildGrowthTriggerKey({
      ...growth,
      selectedGscSnapshotIds: ['snapshot-b', 'snapshot-a', 'snapshot-a']
    });
    const reordered = buildGrowthTriggerKey({
      ...growth,
      selectedGscSnapshotIds: ['snapshot-a', 'snapshot-b']
    });
    const changed = buildGrowthTriggerKey({
      ...growth,
      selectedGscSnapshotIds: ['snapshot-a', 'snapshot-c']
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reuses the same manual request identity and keeps projects isolated', () => {
    const first = buildManualTriggerKey({ projectId: PROJECT_A, manualRequestId: REQUEST_ID });
    const same = buildManualTriggerKey({ projectId: PROJECT_A, manualRequestId: REQUEST_ID });
    const otherProject = buildManualTriggerKey({ projectId: PROJECT_B, manualRequestId: REQUEST_ID });

    expect(first).toBe(same);
    expect(first).not.toBe(otherProject);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes the daily identity when the UTC date changes', () => {
    const first = buildDailyTriggerKey({
      projectId: PROJECT_A,
      utcDate: '2026-08-23',
      plannerVersion: 'OPTIMIZATION_PLAN_V1'
    });
    const same = buildDailyTriggerKey({
      projectId: PROJECT_A,
      utcDate: '2026-08-23',
      plannerVersion: 'OPTIMIZATION_PLAN_V1'
    });
    const nextDay = buildDailyTriggerKey({
      projectId: PROJECT_A,
      utcDate: '2026-08-24',
      plannerVersion: 'OPTIMIZATION_PLAN_V1'
    });

    expect(first).toBe(same);
    expect(first).not.toBe(nextDay);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('builds deterministic run item identities from run and frozen plan ids', () => {
    const first = buildRunItemKey({ runId: RUN_ID, optimizationPlanId: PLAN_ID });
    const same = buildRunItemKey({ runId: RUN_ID, optimizationPlanId: PLAN_ID });
    const otherPlan = buildRunItemKey({
      runId: RUN_ID,
      optimizationPlanId: '44444444-4444-4444-8444-444444444444'
    });

    expect(first).toBe(same);
    expect(first).not.toBe(otherPlan);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
