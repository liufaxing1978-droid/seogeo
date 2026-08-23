import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { OptimizationCandidate, OptimizationPlan } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import {
  OptimizationOrchestrationWorkerError,
  classifyOptimizationOrchestrationError,
  processOptimizationPlanningJob
} from '../../src/modules/optimization-orchestration/orchestration.worker.js';

const optimizationRepository = new OptimizationRepository();
const orchestrationRepository = new OptimizationOrchestrationRepository();
const projectIds: string[] = [];
const NOW = new Date('2026-08-23T05:00:00.000Z');

async function createProject(label: string) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-B worker ${label}`,
      slug: `p9b-worker-${nonce}`,
      primaryDomain: `p9b-worker-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createGrowthSource(projectId: string, rank: number) {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `p9b-worker-${randomUUID()}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `planning-worker-${rank}`,
      canonicalPage: `https://example.com/planning-worker-${rank}`,
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
      score: 80 - rank,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { version: 'GROWTH_SEARCH_PROVENANCE_V1' }
    }
  });
  return { identity, snapshot };
}

async function createPlan(projectId: string, rank: number): Promise<{ candidate: OptimizationCandidate; plan: OptimizationPlan }> {
  const growth = await createGrowthSource(projectId, rank);
  const candidate = await optimizationRepository.createCandidate({
    projectId,
    growthOpportunityIdentityId: growth.identity.id,
    growthSnapshotId: growth.snapshot.id,
    candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
    candidateKey: `${rank}`.padStart(64, String(rank % 10)),
    marketScopeMode: 'UNCONFIGURED_LEGACY',
    marketCode: null,
    locale: null,
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: growth.identity.normalizedQuery,
    canonicalPage: growth.identity.canonicalPage,
    growthScore: growth.snapshot.score,
    growthScoreState: growth.snapshot.scoreState,
    growthPriority: growth.snapshot.priority,
    growthEvidenceQuality: growth.snapshot.evidenceQuality,
    growthEvidenceCoverage: growth.snapshot.evidenceCoverage,
    growthRankingEligible: growth.snapshot.rankingEligible,
    growthLifecycleStatus: 'NEW',
    sourceProvenance: growth.snapshot.sourceProvenance,
    eligibilityState: 'ELIGIBLE',
    eligibilityReasonCodes: []
  });

  const plan = await optimizationRepository.createPlan({
    candidateId: candidate.id,
    projectId,
    planVersion: 'OPTIMIZATION_PLAN_V1',
    recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    sourceFactReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: candidate.growthSnapshotId }],
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

async function createQueuedRun(projectId: string, suffix: string) {
  return orchestrationRepository.createOrGetRun({
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
}

async function p8Counts(projectId: string) {
  const [proposals, plans, executions] = await Promise.all([
    prisma.publicationProposal.count({ where: { projectId } }),
    prisma.publicationPlan.count({ where: { projectId } }),
    prisma.publicationExecution.count({ where: { projectId } })
  ]);
  return { proposals, plans, executions };
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

describe('P9-B planning worker', () => {
  it('checkpoints real run items before orchestration handoff without touching P8', async () => {
    const project = await createProject('normal');
    const first = await createPlan(project.id, 1);
    const second = await createPlan(project.id, 2);
    const run = await createQueuedRun(project.id, 'a');
    const beforeP8 = await p8Counts(project.id);
    const materializeProject = vi.fn().mockResolvedValue({
      candidates: [first.candidate, second.candidate],
      plans: [first.plan, second.plan],
      aiTaskId: null
    });
    const enqueueRun = vi.fn().mockImplementation(async () => {
      const persisted = await orchestrationRepository.getRun(run.id);
      expect(persisted?.planningCompletedAt).toEqual(NOW);
      expect(persisted).toMatchObject({
        status: 'RUNNING',
        candidateCount: 2,
        plannedCount: 2,
        itemCount: 2
      });
      expect(await orchestrationRepository.listRunItems(run.id)).toHaveLength(2);
      return { id: 'continuation' };
    });

    await processOptimizationPlanningJob(
      { name: 'materialize-run', data: { kind: 'MATERIALIZE_RUN', runId: run.id, projectId: project.id } },
      {
        repository: orchestrationRepository,
        materializeProject,
        orchestrationQueue: { enqueueRun },
        orchestrationService: { reconcileUtcDate: vi.fn() },
        advisoryRootDir: '/tmp/p9b-advisory-test',
        now: () => NOW
      }
    );

    expect(materializeProject).toHaveBeenCalledTimes(1);
    expect(materializeProject).toHaveBeenCalledWith(project.id, {
      advisoryRootDir: '/tmp/p9b-advisory-test',
      useAi: false
    });
    expect(enqueueRun).toHaveBeenCalledWith(run.id, project.id);
    const items = await orchestrationRepository.listRunItems(run.id);
    expect(items.map((item) => item.optimizationPlanId).sort()).toEqual([first.plan.id, second.plan.id].sort());
    expect(items.every((item) => item.currentStage === 'PLANNED' && item.status === 'PENDING')).toBe(true);
    expect(await p8Counts(project.id)).toEqual(beforeP8);
  });

  it('retries only orchestration handoff after a durable planning checkpoint', async () => {
    const project = await createProject('handoff-retry');
    const fixture = await createPlan(project.id, 1);
    const run = await createQueuedRun(project.id, 'b');
    const materializeProject = vi.fn().mockResolvedValue({
      candidates: [fixture.candidate],
      plans: [fixture.plan],
      aiTaskId: null
    });
    const enqueueRun = vi.fn()
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockResolvedValueOnce({ id: 'continuation' });
    const deps = {
      repository: orchestrationRepository,
      materializeProject,
      orchestrationQueue: { enqueueRun },
      orchestrationService: { reconcileUtcDate: vi.fn() },
      advisoryRootDir: '/tmp/p9b-advisory-test',
      now: () => NOW
    };
    const job = { name: 'materialize-run', data: { kind: 'MATERIALIZE_RUN' as const, runId: run.id, projectId: project.id } };

    await expect(processOptimizationPlanningJob(job, deps)).rejects.toThrow('redis unavailable');
    const checkpointed = await orchestrationRepository.getRun(run.id);
    expect(checkpointed?.planningCompletedAt).toEqual(NOW);
    expect(await orchestrationRepository.listRunItems(run.id)).toHaveLength(1);

    await expect(processOptimizationPlanningJob(job, deps)).resolves.toBeUndefined();

    expect(materializeProject).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledTimes(2);
    expect(await orchestrationRepository.listRunItems(run.id)).toHaveLength(1);
  });

  it('checkpoints and hands off a valid zero-plan run', async () => {
    const project = await createProject('zero-plan');
    const run = await createQueuedRun(project.id, 'c');
    const materializeProject = vi.fn().mockResolvedValue({ candidates: [], plans: [], aiTaskId: null });
    const enqueueRun = vi.fn().mockResolvedValue({ id: 'continuation' });

    await processOptimizationPlanningJob(
      { name: 'materialize-run', data: { kind: 'MATERIALIZE_RUN', runId: run.id, projectId: project.id } },
      {
        repository: orchestrationRepository,
        materializeProject,
        orchestrationQueue: { enqueueRun },
        orchestrationService: { reconcileUtcDate: vi.fn() },
        advisoryRootDir: '/tmp/p9b-advisory-test',
        now: () => NOW
      }
    );

    expect(await orchestrationRepository.getRun(run.id)).toMatchObject({
      status: 'RUNNING',
      candidateCount: 0,
      plannedCount: 0,
      itemCount: 0,
      planningCompletedAt: NOW
    });
    expect(await orchestrationRepository.listRunItems(run.id)).toEqual([]);
    expect(enqueueRun).toHaveBeenCalledWith(run.id, project.id);
  });

  it('fails closed with a stable code when P9-A returns a cross-project plan', async () => {
    const project = await createProject('mismatch-owner');
    const other = await createProject('mismatch-plan');
    const wrong = await createPlan(other.id, 1);
    const run = await createQueuedRun(project.id, 'd');
    const materializeProject = vi.fn().mockResolvedValue({
      candidates: [wrong.candidate],
      plans: [wrong.plan],
      aiTaskId: null
    });
    const enqueueRun = vi.fn();

    await expect(processOptimizationPlanningJob(
      { name: 'materialize-run', data: { kind: 'MATERIALIZE_RUN', runId: run.id, projectId: project.id } },
      {
        repository: orchestrationRepository,
        materializeProject,
        orchestrationQueue: { enqueueRun },
        orchestrationService: { reconcileUtcDate: vi.fn() },
        advisoryRootDir: '/tmp/p9b-advisory-test',
        now: () => NOW
      }
    )).rejects.toMatchObject({ code: 'CANDIDATE_PROJECT_MISMATCH' });

    expect(await orchestrationRepository.getRun(run.id)).toMatchObject({
      status: 'FAILED',
      failureCount: 1,
      lastErrorCode: 'CANDIDATE_PROJECT_MISMATCH'
    });
    expect(await orchestrationRepository.listRunItems(run.id)).toEqual([]);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('derives the daily UTC date at execution time and never calls P9-A', async () => {
    const reconcileUtcDate = vi.fn().mockResolvedValue({ considered: 3, queued: 2 });
    const materializeProject = vi.fn();

    await processOptimizationPlanningJob(
      { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' } },
      {
        repository: orchestrationRepository,
        materializeProject,
        orchestrationQueue: { enqueueRun: vi.fn() },
        orchestrationService: { reconcileUtcDate },
        advisoryRootDir: '/tmp/p9b-advisory-test',
        now: () => new Date('2026-08-24T00:01:02.000Z')
      }
    );

    expect(reconcileUtcDate).toHaveBeenCalledWith('2026-08-24');
    expect(materializeProject).not.toHaveBeenCalled();
  });

  it('classifies deterministic worker codes as non-retryable', () => {
    expect(classifyOptimizationOrchestrationError('PLAN_PROJECT_MISMATCH')).toBe('NON_RETRYABLE');
    expect(classifyOptimizationOrchestrationError('RUN_PROJECT_MISMATCH')).toBe('NON_RETRYABLE');
    expect(classifyOptimizationOrchestrationError('RUN_NOT_FOUND')).toBe('NON_RETRYABLE');
    expect(classifyOptimizationOrchestrationError('REDIS_UNAVAILABLE')).toBe('RETRYABLE');
    expect(new OptimizationOrchestrationWorkerError('RUN_NOT_FOUND', 'bounded message').code).toBe('RUN_NOT_FOUND');
  });
});
