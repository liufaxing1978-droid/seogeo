import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  buildOptimizationAutopilotDecisionKey
} from '../../src/modules/optimization-autopilot/autopilot.identity.js';
import {
  normalizeAutopilotPolicy,
  toAutopilotPolicySnapshot
} from '../../src/modules/optimization-autopilot/autopilot.policy.js';
import {
  OptimizationAutopilotRepository
} from '../../src/modules/optimization-autopilot/autopilot.repository.js';

type RegclassRow = {
  policy: string | null;
  decision: string | null;
  reservation: string | null;
  authorization: string | null;
};

type NameRow = { name: string };
type TestDb = typeof prisma | Prisma.TransactionClient;

const ROLLBACK_SENTINEL = 'P9_C_PERSISTENCE_TEST_ROLLBACK';

async function withRollback(run: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) {
      throw error;
    }
  }
}

async function createProject(db: TestDb = prisma) {
  const suffix = randomUUID();
  return db.project.create({
    data: {
      name: `P9-C ${suffix}`,
      slug: `p9-c-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
}

async function createDecisionFixture(db: TestDb, projectId: string) {
  const growthIdentity = await db.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `p9-c-test:${randomUUID()}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'controlled autopilot test',
      canonicalPage: null,
      identityPayload: {}
    }
  });

  const growthSnapshot = await db.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'CONTENT_GAP',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 85,
      rankingEligible: true,
      sourceProvenance: {}
    }
  });

  const candidate = await db.optimizationCandidate.create({
    data: {
      projectId,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${randomUUID()}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: null,
      locale: 'zh-CN',
      opportunityType: 'CONTENT_GAP',
      normalizedQuery: 'controlled autopilot test',
      canonicalPage: null,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 85,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: {},
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const plan = await db.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'CONTENT_CREATION',
      sourceFactReferences: [],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: {}
    }
  });

  const run = await db.optimizationRun.create({
    data: {
      projectId,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `run:${randomUUID()}`,
      triggerPayload: {},
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1
    }
  });

  const runItem = await db.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId,
      optimizationPlanId: plan.id,
      itemKey: `item:${randomUUID()}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date()
    }
  });

  return { candidate, plan, run, runItem };
}

describe('P9-C persistence foundation', () => {
  it('installs the controlled-autopilot durable tables', async () => {
    const [row] = await prisma.$queryRawUnsafe<RegclassRow[]>(`
      SELECT
        to_regclass('public."AutopilotPolicy"')::text AS policy,
        to_regclass('public."OptimizationAutopilotDecision"')::text AS decision,
        to_regclass('public."AutopilotExecutionReservation"')::text AS reservation,
        to_regclass('public."PublicationAutomationAuthorization"')::text AS authorization
    `);

    expect(row).toBeDefined();
    expect(row?.policy).not.toBeNull();
    expect(row?.decision).not.toBeNull();
    expect(row?.reservation).not.toBeNull();
    expect(row?.authorization).not.toBeNull();
  });

  it('enforces exactly one publication execution authorization source', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid = to_regclass('public."PublicationExecution"')
        AND contype = 'c'
    `);

    expect(rows.map((row) => row.name)).toContain('PublicationExecution_one_authorization_source');
  });

  it('installs immutable decision and machine-authorization triggers', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND c.relname IN ('OptimizationAutopilotDecision', 'PublicationAutomationAuthorization')
      ORDER BY t.tgname ASC
    `);

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'OptimizationAutopilotDecision_immutable',
      'PublicationAutomationAuthorization_immutable'
    ]));
  });

  it('deduplicates P9-origin proposals by their stable source identity', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'PublicationProposal'
    `);

    expect(rows.some((row) =>
      row.indexdef.includes('UNIQUE')
      && row.indexdef.includes('"projectId"')
      && row.indexdef.includes('"sourceType"')
      && row.indexdef.includes('"sourceReferenceId"')
      && row.indexdef.includes('"sourceSnapshotId"')
      && row.indexdef.includes('WHERE')
      && row.indexdef.includes('P9_OPTIMIZATION_PLAN')
    )).toBe(true);
  });

  it('treats a missing policy as disabled without creating a row', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);

      const before = await db.autopilotPolicy.count({ where: { projectId: project.id } });
      expect(await repository.getPolicy(project.id)).toBeNull();
      const after = await db.autopilotPolicy.count({ where: { projectId: project.id } });

      expect(before).toBe(0);
      expect(after).toBe(0);
    });
  });

  it('upserts policy audit state and reuses an identical immutable decision', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);
      const policyInput = normalizeAutopilotPolicy({ enabled: true });
      const policy = await repository.upsertPolicy(project.id, policyInput, 'actor:task-2');
      const fixture = await createDecisionFixture(db, project.id);
      const policySnapshot = toAutopilotPolicySnapshot(policyInput);
      const sourceSnapshot = {
        optimizationPlanId: fixture.plan.id,
        candidateId: fixture.candidate.id,
        growthOpportunityIdentityId: fixture.candidate.growthOpportunityIdentityId,
        growthSnapshotId: fixture.candidate.growthSnapshotId,
        marketScopeMode: fixture.candidate.marketScopeMode,
        marketCode: fixture.candidate.marketCode,
        locale: fixture.candidate.locale,
        recommendedActionType: fixture.plan.recommendedActionType,
        growthEvidenceCoverage: fixture.candidate.growthEvidenceCoverage,
        growthScoreState: fixture.candidate.growthScoreState,
        growthRankingEligible: fixture.candidate.growthRankingEligible,
        growthLifecycleStatus: fixture.candidate.growthLifecycleStatus,
        candidateCreatedAt: fixture.candidate.createdAt.toISOString(),
        planCreatedAt: fixture.plan.createdAt.toISOString()
      };
      const decisionKey = buildOptimizationAutopilotDecisionKey({
        projectId: project.id,
        runItemId: fixture.runItem.id,
        optimizationPlanId: fixture.plan.id,
        policyVersion: policy.policyVersion,
        policySnapshot,
        sourceSnapshot,
        p8PlanId: null,
        p8PreviewId: null
      });
      const input = {
        projectId: project.id,
        runId: fixture.run.id,
        runItemId: fixture.runItem.id,
        optimizationPlanId: fixture.plan.id,
        policyId: policy.id,
        policyVersion: policy.policyVersion,
        policySnapshot,
        sourceSnapshot,
        status: 'P8_PREPARATION_REQUIRED' as const,
        reasonCodes: ['AUTOPILOT_P8_PREPARATION_REQUIRED'],
        p8PlanId: null,
        p8PreviewId: null,
        decisionKey
      };

      expect(policy).toMatchObject({
        projectId: project.id,
        enabled: true,
        enabledBy: 'actor:task-2',
        updatedBy: 'actor:task-2'
      });
      expect(policy.enabledAt).not.toBeNull();

      const first = await repository.createOrGetDecision(input);
      const second = await repository.createOrGetDecision(input);

      expect(second.id).toBe(first.id);
      expect(await db.optimizationAutopilotDecision.count({ where: { decisionKey } })).toBe(1);

      await expect(repository.createOrGetDecision({
        ...input,
        sourceSnapshot: { ...sourceSnapshot, growthEvidenceCoverage: 99 }
      })).rejects.toThrow('AUTOPILOT_DECISION_IDENTITY_COLLISION');
    });
  });
});
