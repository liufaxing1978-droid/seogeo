import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { OptimizationCandidate, OptimizationPlan } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js';
import { buildRunItemKey } from '../../src/modules/optimization-orchestration/orchestration.identity.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import { processOptimizationOrchestrationJob } from '../../src/modules/optimization-orchestration/orchestration.worker.js';

const optimizationRepository = new OptimizationRepository();
const orchestrationRepository = new OptimizationOrchestrationRepository();
const projectIds: string[] = [];
const NOW = new Date('2026-08-23T06:00:00.000Z');

async function createProject(label: string) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-B advance ${label}`,
      slug: `p9b-advance-${nonce}`,
      primaryDomain: `p9b-advance-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createPlan(projectId: string, rank: number): Promise<{ candidate: OptimizationCandidate; plan: OptimizationPlan }> {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `p9b-advance-${randomUUID()}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `advance-worker-${rank}`,
      canonicalPage: `https://example.com/advance-worker-${rank}`,
      identityPayload: { authority: 'P7_GROWTH' }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'RANKING_UPSIDE',
      secondaryTypes: [],
      score: 90 - rank,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { version: 'GROWTH_SEARCH_PROVENANCE_V1' }
    }
  });

  const candidate = await optimizationRepository.createCandidate({
    projectId,
    growthOpportunityIdentityId: identity.id,
    growthSnapshotId: snapshot.id,
    candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
    candidateKey: `${rank}`.padStart(64, String(rank % 10)),
    marketScopeMode: 'UNCONFIGURED_LEGACY',
    marketCode: null,
    locale: null,
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: identity.normalizedQuery,
    canonicalPage: identity.canonicalPage,
    growthScore: snapshot.score,
    growthScoreState: snapshot.scoreState,
    growthPriority: snapshot.priority,
    growthEvidenceQuality: snapshot.evidenceQuality,
    growthEvidenceCoverage: snapshot.evidenceCoverage,
    growthRankingEligible: snapshot.rankingEligible,
    growthLifecycleStatus: 'NEW',
    sourceProvenance: snapshot.sourceProvenance,
    eligibilityState: 'ELIGIBLE',
    eligibilityReasonCodes: []
  });
  const plan = await optimizationRepository.createPlan({
    candidateId: candidate.id,
    projectId,
    planVersion: 'OPTIMIZATION_PLAN_V1',
    recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    sourceFactReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: snapshot.id }],
    deterministicRank: rank,
    aiRankAdjustment: 0,
    historicalRankAdjustment: 0,
    finalRank: rank,
    advisoryContext: [],
    automationEligibility: false,
    explanation: { authority: 'P9_A_FIRST_PARTY_PLANNER' }
  });
  return { candidate, plan };
}

async function createRunningRun(projectId: string, suffix: string) {
  const run = await orchestrationRepository.createOrGetRun({
    projectId,
    runVersion: 'OPTIMIZATION_RUN_V1',
    triggerType: 'MANUAL',
    triggerSource: 'MANUAL_REQUEST',
    triggerKey: suffix.repeat(64).slice(0, 64),
    triggerPayload: {
      version: 'P9_B_MANUAL_TRIGGER_V1',
      manualRequestId: randomUUID(),
      requestedBy: 'integration-test'
    }
  });
  expect(await orchestrationRepository.transitionRun({
    runId: run.id,
    from: 'QUEUED',
    to: 'RUNNING',
    patch: { startedAt: new Date('2026-08-23T05:30:00.000Z') }
  })).toBe(true);
  return (await orchestrationRepository.getRun(run.id))!;
}

async function checkpointRun(runId: string, candidateCount: number, plannedCount: number, itemCount: number) {
  expect(await orchestrationRepository.markPlanningComplete({
    runId,
    candidateCount,
    plannedCount,
    itemCount,
    planningCompletedAt: new Date('2026-08-23T05:45:00.000Z')
  })).toBe(true);
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

  await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId: { in: projectIds } } });
  for (const projectId of [...projectIds].reverse()) {
    await prisma.project.delete({ where: { id: projectId } });
  }
}

afterAll(cleanup);

describe('P9-B orchestration advance worker', () => {
  it('advances valid persisted items to READY_FOR_POLICY and succeeds from DB-derived counters', async () => {
    const project = await createProject('normal');
    const first = await createPlan(project.id, 1);
    const second = await createPlan(project.id, 2);
    const run = await createRunningRun(project.id, 'e');

    for (const plan of [first.plan, second.plan]) {
      await orchestrationRepository.createOrGetRunItem({
        runId: run.id,
        projectId: project.id,
        optimizationPlanId: plan.id,
        itemKey: buildRunItemKey({ runId: run.id, optimizationPlanId: plan.id })
      });
    }
    await checkpointRun(run.id, 2, 2, 99);

    await processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: run.id, projectId: project.id } },
      { repository: orchestrationRepository, now: () => NOW } as never
    );

    const items = await orchestrationRepository.listRunItems(run.id);
    expect(items).toHaveLength(2);
    expect(items.every((item) =>
      item.currentStage === 'READY_FOR_POLICY' &&
      item.status === 'COMPLETED' &&
      item.reasonCode === null &&
      item.completedAt?.getTime() === NOW.getTime()
    )).toBe(true);
    expect(await orchestrationRepository.getRun(run.id)).toMatchObject({
      status: 'SUCCEEDED',
      candidateCount: 2,
      plannedCount: 2,
      itemCount: 2,
      completedCount: 2,
      failureCount: 0,
      completedAt: NOW,
      lastErrorCode: null
    });
  });

  it('succeeds a zero-item run only after a persisted planning checkpoint', async () => {
    const project = await createProject('zero');
    const run = await createRunningRun(project.id, 'f');
    await checkpointRun(run.id, 0, 0, 0);

    await processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: run.id, projectId: project.id } },
      { repository: orchestrationRepository, now: () => NOW } as never
    );

    expect(await orchestrationOrchestrationState(run.id)).toEqual({
      status: 'SUCCEEDED',
      itemCount: 0,
      completedCount: 0,
      failureCount: 0,
      completedAt: NOW
    });
  });

  it('fails the affected item and run when a persisted item references another project plan', async () => {
    const project = await createProject('mismatch-owner');
    const other = await createProject('mismatch-plan');
    const wrong = await createPlan(other.id, 1);
    const run = await createRunningRun(project.id, 'g');
    const itemKey = buildRunItemKey({ runId: run.id, optimizationPlanId: wrong.plan.id });

    const badItem = await prisma.optimizationRunItem.create({
      data: {
        runId: run.id,
        projectId: project.id,
        optimizationPlanId: wrong.plan.id,
        itemKey
      }
    });
    await checkpointRun(run.id, 1, 1, 1);

    await expect(processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: run.id, projectId: project.id } },
      { repository: orchestrationRepository, now: () => NOW } as never
    )).rejects.toMatchObject({ code: 'PLAN_PROJECT_MISMATCH' });

    expect(await prisma.optimizationRunItem.findUnique({ where: { id: badItem.id } })).toMatchObject({
      currentStage: 'PLANNED',
      status: 'FAILED',
      reasonCode: 'PLAN_PROJECT_MISMATCH',
      completedAt: NOW
    });
    expect(await orchestrationRepository.getRun(run.id)).toMatchObject({
      status: 'FAILED',
      itemCount: 1,
      completedCount: 0,
      failureCount: 1,
      completedAt: NOW,
      lastErrorCode: 'PLAN_PROJECT_MISMATCH'
    });
  });
});

async function orchestrationOrchestrationState(runId: string) {
  const run = await orchestrationRepository.getRun(runId);
  if (!run) throw new Error('run missing');
  return {
    status: run.status,
    itemCount: run.itemCount,
    completedCount: run.completedCount,
    failureCount: run.failureCount,
    completedAt: run.completedAt
  };
}
