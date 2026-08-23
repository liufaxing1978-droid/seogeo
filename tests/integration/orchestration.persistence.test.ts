import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { growthRepository } from '../../src/modules/growth/growth.repository.js';
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js';
import { buildRunItemKey } from '../../src/modules/optimization-orchestration/orchestration.identity.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';

const optimizationRepository = new OptimizationRepository();
const repository = new OptimizationOrchestrationRepository();
const projectIds: string[] = [];

async function createPlanFixture(label: string) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-B persistence ${label}`,
      slug: `p9b-persistence-${nonce}`,
      primaryDomain: `p9b-persistence-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const identity = await growthRepository.getOrCreateOpportunityIdentity({
    projectId: project.id,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: `p9-b-${label}`,
    canonicalPage: `https://example.com/${nonce}`
  });
  const snapshot = await growthRepository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId: project.id,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-08-08T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-14T00:00:00.000Z'),
    previousWindowStart: new Date('2026-08-01T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-15T00:00:00.000Z'),
    primaryType: 'RANKING_UPSIDE',
    secondaryTypes: [],
    score: 82,
    priority: 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' }
      }
    },
    breakdown: {
      demandState: 'KNOWN', demandScore: 24,
      positionPotentialState: 'KNOWN', positionPotentialScore: 22,
      ctrGapState: 'KNOWN', ctrGapScore: 12,
      siteGapState: 'KNOWN', siteGapScore: 12,
      gscTrendState: 'KNOWN', gscTrendScore: 6,
      p6VisibilityState: 'KNOWN', p6VisibilityScore: 4,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 82,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 82,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: []
  });
  await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9B_TEST_FIXTURE'
  });

  const candidate = await optimizationRepository.createCandidate({
    projectId: project.id,
    growthOpportunityIdentityId: identity.id,
    growthSnapshotId: snapshot.id,
    candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
    candidateKey: Buffer.from(`${nonce}:candidate`).toString('hex').slice(0, 64).padEnd(64, '0'),
    marketScopeMode: 'UNCONFIGURED_LEGACY',
    marketCode: null,
    locale: null,
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: `p9-b-${label}`,
    canonicalPage: `https://example.com/${nonce}`,
    growthScore: 82,
    growthScoreState: 'KNOWN',
    growthPriority: 'HIGH',
    growthEvidenceQuality: 'COMPLETE',
    growthEvidenceCoverage: 1,
    growthRankingEligible: true,
    growthLifecycleStatus: 'NEW',
    sourceProvenance: { version: 'P9_A_SOURCE_PROVENANCE_V1' },
    eligibilityState: 'ELIGIBLE',
    eligibilityReasonCodes: []
  });
  const plan = await optimizationRepository.createPlan({
    candidateId: candidate.id,
    projectId: project.id,
    planVersion: 'OPTIMIZATION_PLAN_V1',
    recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    sourceFactReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: snapshot.id }],
    deterministicRank: 1,
    aiRankAdjustment: 0,
    historicalRankAdjustment: 0,
    finalRank: 1,
    advisoryContext: [],
    automationEligibility: false,
    explanation: { authority: 'P9_A_FIRST_PARTY_PLANNER' }
  });

  return { project, plan };
}

async function cleanup() {
  if (projectIds.length === 0) return;
  await prisma.optimizationRunItem.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.optimizationRun.deleteMany({ where: { projectId: { in: projectIds } } });

  await prisma.$executeRawUnsafe('ALTER TABLE "OptimizationPlan" DISABLE TRIGGER "OptimizationPlan_immutable"');
  await prisma.$executeRawUnsafe('ALTER TABLE "OptimizationCandidate" DISABLE TRIGGER "OptimizationCandidate_immutable"');
  try {
    await prisma.optimizationPlan.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.optimizationCandidate.deleteMany({ where: { projectId: { in: projectIds } } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "OptimizationCandidate" ENABLE TRIGGER "OptimizationCandidate_immutable"');
    await prisma.$executeRawUnsafe('ALTER TABLE "OptimizationPlan" ENABLE TRIGGER "OptimizationPlan_immutable"');
  }

  for (const projectId of [...projectIds].reverse()) {
    await prisma.project.delete({ where: { id: projectId } });
  }
}

afterAll(cleanup);

describe('P9-B orchestration persistence', () => {
  it('reuses the same project/trigger run identity', async () => {
    const { project } = await createPlanFixture('run-idempotency');
    const input = {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL' as const,
      triggerSource: 'MANUAL_REQUEST' as const,
      triggerKey: 'a'.repeat(64),
      triggerPayload: {
        version: 'P9_B_MANUAL_TRIGGER_V1',
        manualRequestId: '11111111-1111-4111-8111-111111111111',
        requestedBy: 'project-api:test'
      }
    };

    const first = await repository.createOrGetRun(input);
    const second = await repository.createOrGetRun(input);

    expect(second.id).toBe(first.id);
    expect(first.status).toBe('QUEUED');
  });

  it('uses compare-and-set run transitions', async () => {
    const { project } = await createPlanFixture('run-transition');
    const run = await repository.createOrGetRun({
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'DAILY_RECONCILIATION',
      triggerSource: 'DAILY_SCHEDULER',
      triggerKey: 'b'.repeat(64),
      triggerPayload: { version: 'P9_B_DAILY_TRIGGER_V1', utcDate: '2026-08-23' }
    });
    const startedAt = new Date('2026-08-23T04:00:00.000Z');

    expect(await repository.transitionRun({
      runId: run.id,
      from: 'QUEUED',
      to: 'RUNNING',
      patch: { startedAt }
    })).toBe(true);
    expect(await repository.transitionRun({
      runId: run.id,
      from: 'QUEUED',
      to: 'RUNNING',
      patch: { startedAt }
    })).toBe(false);

    expect(await repository.getRun(run.id)).toMatchObject({ status: 'RUNNING', startedAt });
  });

  it('creates run items idempotently and rejects project mismatches', async () => {
    const { project, plan } = await createPlanFixture('item-idempotency');
    const other = await createPlanFixture('item-other-project');
    const run = await repository.createOrGetRun({
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: 'c'.repeat(64),
      triggerPayload: { version: 'P9_B_GROWTH_TRIGGER_V1' }
    });
    const itemKey = buildRunItemKey({ runId: run.id, optimizationPlanId: plan.id });

    const first = await repository.createOrGetRunItem({
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: plan.id,
      itemKey
    });
    const second = await repository.createOrGetRunItem({
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: plan.id,
      itemKey
    });

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ currentStage: 'PLANNED', status: 'PENDING' });
    await expect(repository.createOrGetRunItem({
      runId: run.id,
      projectId: other.project.id,
      optimizationPlanId: plan.id,
      itemKey: buildRunItemKey({ runId: run.id, optimizationPlanId: plan.id })
    })).rejects.toThrow(/project/i);
  });

  it('keeps run-to-item foreign keys restrictive', async () => {
    const { project, plan } = await createPlanFixture('fk-restrict');
    const run = await repository.createOrGetRun({
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: 'd'.repeat(64),
      triggerPayload: { version: 'P9_B_MANUAL_TRIGGER_V1' }
    });
    await repository.createOrGetRunItem({
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: plan.id,
      itemKey: buildRunItemKey({ runId: run.id, optimizationPlanId: plan.id })
    });

    await expect(prisma.optimizationRun.delete({ where: { id: run.id } })).rejects.toThrow();
  });
});
