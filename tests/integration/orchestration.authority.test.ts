import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { growthRepository } from '../../src/modules/growth/growth.repository.js';
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import {
  processOptimizationOrchestrationJob,
  processOptimizationPlanningJob
} from '../../src/modules/optimization-orchestration/orchestration.worker.js';

const advisoryRootDir = path.resolve('vendor/third-party-skills');
const orchestrationRepository = new OptimizationOrchestrationRepository();
const projectIds: string[] = [];
const PLANNING_NOW = new Date('2026-08-23T07:00:00.000Z');
const ADVANCE_NOW = new Date('2026-08-23T07:05:00.000Z');

async function createAuthorityFixture() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-B authority ${nonce}`,
      slug: `p9b-authority-${nonce}`,
      primaryDomain: `p9b-authority-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const identity = await growthRepository.getOrCreateOpportunityIdentity({
    projectId: project.id,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: 'p9 b authority query',
    canonicalPage: 'https://example.com/p9-b-authority'
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
    score: 86,
    priority: 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          source: 'RAW_GSC_COMPATIBILITY'
        }
      }
    },
    breakdown: {
      demandState: 'KNOWN',
      demandScore: 20,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: 20,
      ctrGapState: 'KNOWN',
      ctrGapScore: 14,
      siteGapState: 'KNOWN',
      siteGapScore: 12,
      gscTrendState: 'KNOWN',
      gscTrendScore: 8,
      p6VisibilityState: 'KNOWN',
      p6VisibilityScore: 6,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: 86,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 86,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: []
  });

  await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: snapshot.id,
      projectId: project.id,
      sourceModule: 'GSC',
      sourceType: 'P9_B_AUTHORITY_FIXTURE',
      sourceId: randomUUID(),
      sourceFactVersion: 'AUTHORITY_FIXTURE_V1',
      ruleKey: 'P9_B_AUTHORITY_BOUNDARY',
      rootCauseKey: 'P9_B_AUTHORITY_BOUNDARY',
      evidenceState: 'PASS',
      severity: 'INFO',
      numericValue: 1,
      textSummary: 'Frozen P7 evidence for P9-B authority verification.',
      fingerprint: randomUUID()
    }
  });

  await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9B_AUTHORITY_TEST'
  });

  const run = await orchestrationRepository.createOrGetRun({
    projectId: project.id,
    runVersion: 'OPTIMIZATION_RUN_V1',
    triggerType: 'MANUAL',
    triggerSource: 'MANUAL_REQUEST',
    triggerKey: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    triggerPayload: {
      version: 'P9_B_MANUAL_TRIGGER_V1',
      manualRequestId: randomUUID(),
      requestedBy: 'integration-authority-test'
    }
  });

  return { project, identity, snapshot, run };
}

async function growthAuthoritySnapshot(projectId: string) {
  return prisma.growthOpportunityIdentity.findMany({
    where: { projectId },
    orderBy: { id: 'asc' },
    include: {
      lifecycle: true,
      lifecycleEvents: { orderBy: { id: 'asc' } },
      snapshots: {
        orderBy: { id: 'asc' },
        include: {
          breakdown: true,
          evidence: { orderBy: { id: 'asc' } }
        }
      }
    }
  });
}

async function optimizationAuthoritySnapshot(projectId: string) {
  const [candidates, plans, rankingAiTasks] = await Promise.all([
    prisma.optimizationCandidate.findMany({
      where: { projectId },
      orderBy: { id: 'asc' }
    }),
    prisma.optimizationPlan.findMany({
      where: { projectId },
      orderBy: { id: 'asc' }
    }),
    prisma.aiTask.count({
      where: { projectId, taskType: 'OPTIMIZATION_PLAN_RANKING' }
    })
  ]);
  return { candidates, plans, rankingAiTasks };
}

async function p8AuthoritySnapshot(projectId: string) {
  const [proposals, plans, previews, approvals, executions] = await Promise.all([
    prisma.publicationProposal.count({ where: { projectId } }),
    prisma.publicationPlan.count({ where: { projectId } }),
    prisma.publicationPreview.count({ where: { projectId } }),
    prisma.publicationApproval.count({ where: { projectId } }),
    prisma.publicationExecution.count({ where: { projectId } })
  ]);
  return { proposals, plans, previews, approvals, executions };
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

  await prisma.aiTask.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId: { in: projectIds } } });

  for (const projectId of [...projectIds].reverse()) {
    await prisma.project.delete({ where: { id: projectId } });
  }
}

afterAll(cleanup);

describe('P9-B end-to-end authority and idempotency', () => {
  it('runs deterministic planning through READY_FOR_POLICY without mutating P7/P9-A or creating P8/AI authority', async () => {
    const { project, run } = await createAuthorityFixture();
    const beforeGrowth = await growthAuthoritySnapshot(project.id);
    const beforeP8 = await p8AuthoritySnapshot(project.id);
    const optimizationService = new OptimizationService();
    const materializeProject = vi.fn((projectId: string, options: { advisoryRootDir: string; useAi: false }) =>
      optimizationService.materializeProject(projectId, options)
    );
    const enqueueRun = vi.fn().mockResolvedValue({ id: 'advance-run' });
    const planningJob = {
      name: 'materialize-run',
      data: { kind: 'MATERIALIZE_RUN' as const, runId: run.id, projectId: project.id }
    };
    const planningDeps = {
      repository: orchestrationRepository,
      materializeProject,
      orchestrationQueue: { enqueueRun },
      orchestrationService: { reconcileUtcDate: vi.fn() },
      advisoryRootDir,
      now: () => PLANNING_NOW
    };

    await processOptimizationPlanningJob(planningJob, planningDeps);

    expect(materializeProject).toHaveBeenCalledTimes(1);
    expect(materializeProject).toHaveBeenCalledWith(project.id, {
      advisoryRootDir,
      useAi: false
    });
    expect(enqueueRun).toHaveBeenCalledWith(run.id, project.id);
    expect(await growthAuthoritySnapshot(project.id)).toEqual(beforeGrowth);
    expect(await p8AuthoritySnapshot(project.id)).toEqual(beforeP8);

    const afterPlanningOptimization = await optimizationAuthoritySnapshot(project.id);
    expect(afterPlanningOptimization.candidates.length).toBeGreaterThan(0);
    expect(afterPlanningOptimization.plans.length).toBeGreaterThan(0);
    expect(afterPlanningOptimization.rankingAiTasks).toBe(0);
    expect(afterPlanningOptimization.plans.every((plan) =>
      plan.aiRankAdjustment === 0 && plan.automationEligibility === false
    )).toBe(true);

    await processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: run.id, projectId: project.id } },
      { repository: orchestrationRepository, now: () => ADVANCE_NOW }
    );

    const items = await orchestrationRepository.listRunItems(run.id);
    expect(items.length).toBe(afterPlanningOptimization.plans.length);
    expect(items.every((item) =>
      item.currentStage === 'READY_FOR_POLICY' &&
      item.status === 'COMPLETED' &&
      item.reasonCode === null
    )).toBe(true);
    expect(await orchestrationRepository.getRun(run.id)).toMatchObject({
      status: 'SUCCEEDED',
      itemCount: items.length,
      completedCount: items.length,
      failureCount: 0,
      completedAt: ADVANCE_NOW,
      lastErrorCode: null
    });

    expect(await growthAuthoritySnapshot(project.id)).toEqual(beforeGrowth);
    expect(await optimizationAuthoritySnapshot(project.id)).toEqual(afterPlanningOptimization);
    expect(await p8AuthoritySnapshot(project.id)).toEqual(beforeP8);

    await processOptimizationPlanningJob(planningJob, planningDeps);
    await processOptimizationOrchestrationJob(
      { name: 'advance-run', data: { runId: run.id, projectId: project.id } },
      { repository: orchestrationRepository, now: () => new Date('2026-08-23T07:10:00.000Z') }
    );

    expect(materializeProject).toHaveBeenCalledTimes(1);
    expect(await orchestrationRepository.listRunItems(run.id)).toEqual(items);
    expect(await growthAuthoritySnapshot(project.id)).toEqual(beforeGrowth);
    expect(await optimizationAuthoritySnapshot(project.id)).toEqual(afterPlanningOptimization);
    expect(await p8AuthoritySnapshot(project.id)).toEqual(beforeP8);
  });
});
