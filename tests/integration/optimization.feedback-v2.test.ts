import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../src/db/prisma.js'
import { growthRepository } from '../../src/modules/growth/growth.repository.js'
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js'
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js'

const advisoryRootDir = path.resolve('vendor/third-party-skills')
const repository = new OptimizationRepository()
const projectIds: string[] = []

type ActionType =
  | 'ON_PAGE_OPTIMIZATION'
  | 'CONTENT_CREATION'
  | 'TECHNICAL_SEO_REMEDIATION'

type Profile = {
  id: string
  projectId: string
  feedbackProfileVersion: string
  inputFingerprint: string
  sampleCount: number
  historicalRankAdjustment: number
}

type FeedbackLookup = {
  projectId: string
  marketScopeMode: string
  marketCode: string | null
  locale: string | null
  recommendedActionType: ActionType
}

type FeedbackPort = {
  findLatestProfileForScope(input: FeedbackLookup): Promise<Profile | null>
}

type ServiceConstructor = new (
  repository: OptimizationRepository,
  aiTasks: { createAndEnqueue(input: unknown): Promise<{ id: string }> },
  feedbackProfiles: FeedbackPort,
) => OptimizationService

const directTaskService = {
  async createAndEnqueue(_input: unknown) {
    throw new Error('AI queue must not be used by deterministic P9-A V2 tests')
  },
}

function createService(feedbackProfiles: FeedbackPort): OptimizationService {
  const Constructor = OptimizationService as unknown as ServiceConstructor
  return new Constructor(repository, directTaskService, feedbackProfiles)
}

async function createProject() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const project = await prisma.project.create({
    data: {
      name: `P9-A V2 feedback ${nonce}`,
      slug: `p9a-v2-feedback-${nonce}`,
      primaryDomain: `p9a-v2-feedback-${nonce}.example.com`,
      planLevel: 'ADVANCED',
    },
  })
  projectIds.push(project.id)
  return project
}

async function createGrowthOpportunity(input: {
  projectId: string
  query: string
  primaryType: 'RANKING_UPSIDE' | 'CONTENT_GAP' | 'SEO_GAP'
  score: number
}) {
  const identity = await growthRepository.getOrCreateOpportunityIdentity({
    projectId: input.projectId,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: input.query,
    canonicalPage: `https://example.com/${input.query.replaceAll(' ', '-')}`,
  })

  const snapshot = await growthRepository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId: input.projectId,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-08-08T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-14T00:00:00.000Z'),
    previousWindowStart: new Date('2026-08-01T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-15T00:00:00.000Z'),
    primaryType: input.primaryType,
    secondaryTypes: [],
    score: input.score,
    priority: 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' },
      },
    },
    breakdown: {
      demandState: 'KNOWN',
      demandScore: 20,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: 20,
      ctrGapState: 'KNOWN',
      ctrGapScore: 10,
      siteGapState: 'KNOWN',
      siteGapScore: 10,
      gscTrendState: 'KNOWN',
      gscTrendScore: 6,
      p6VisibilityState: 'KNOWN',
      p6VisibilityScore: 4,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: input.score,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: input.score,
      formulaVersion: 'GROWTH_SCORE_V1',
    },
    evidence: [],
  })

  await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9A_V2_FEEDBACK_TEST_FIXTURE',
  })
}

function profile(input: {
  projectId: string
  suffix: number
  historicalRankAdjustment: number
}): Profile {
  return {
    id: `00000000-0000-4000-8000-${String(800000000000 + input.suffix)}`,
    projectId: input.projectId,
    feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
    inputFingerprint: String(input.suffix).padStart(64, 'a').slice(-64),
    sampleCount: 5,
    historicalRankAdjustment: input.historicalRankAdjustment,
  }
}

function explanation(plan: { explanation: unknown }) {
  return plan.explanation as Record<string, unknown>
}

async function cleanupImmutableFixtures() {
  if (projectIds.length === 0) return

  await prisma.$executeRawUnsafe(
    'ALTER TABLE "OptimizationPlan" DISABLE TRIGGER "OptimizationPlan_immutable"',
  )
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "OptimizationCandidate" DISABLE TRIGGER "OptimizationCandidate_immutable"',
  )

  try {
    await prisma.optimizationPlan.deleteMany({ where: { projectId: { in: projectIds } } })
    await prisma.optimizationCandidate.deleteMany({ where: { projectId: { in: projectIds } } })
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "OptimizationCandidate" ENABLE TRIGGER "OptimizationCandidate_immutable"',
    )
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "OptimizationPlan" ENABLE TRIGGER "OptimizationPlan_immutable"',
    )
  }

  for (const projectId of [...projectIds].reverse()) {
    await prisma.project.delete({ where: { id: projectId } })
  }
}

afterAll(cleanupImmutableFixtures)

describe('P9-A V2 feedback-aware deterministic materialization', () => {
  it('keeps omitted/default V1 byte-compatible in authority behavior and never reads feedback', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'v1 feedback isolation',
      primaryType: 'RANKING_UPSIDE',
      score: 90,
    })

    const findLatestProfileForScope = vi.fn(async () => {
      throw new Error('V1 must not read P9-E feedback')
    })
    const service = createService({ findLatestProfileForScope })
    const result = await service.materializeProject(project.id, { advisoryRootDir, useAi: false })

    expect(findLatestProfileForScope).not.toHaveBeenCalled()
    expect(result.plans).toHaveLength(1)
    expect(result.plans[0]).toMatchObject({
      planVersion: 'OPTIMIZATION_PLAN_V1',
      historicalRankAdjustment: 0,
      deterministicRank: 1,
      finalRank: 1,
    })
    expect(explanation(result.plans[0]!)).not.toHaveProperty('feedback')
  })

  it('V2 reads the exact scope/action profile, freezes bounded provenance, and uses no profile for another action', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'v2 profile exact on page',
      primaryType: 'RANKING_UPSIDE',
      score: 90,
    })
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'v2 profile exact content',
      primaryType: 'CONTENT_GAP',
      score: 80,
    })

    const onPageProfile = profile({ projectId: project.id, suffix: 1, historicalRankAdjustment: -4 })
    const findLatestProfileForScope = vi.fn(async (input: FeedbackLookup) => (
      input.projectId === project.id
      && input.marketScopeMode === 'UNCONFIGURED_LEGACY'
      && input.marketCode === null
      && input.locale === null
      && input.recommendedActionType === 'ON_PAGE_OPTIMIZATION'
        ? onPageProfile
        : null
    ))
    const service = createService({ findLatestProfileForScope })
    const result = await service.materializeProject(project.id, {
      advisoryRootDir,
      useAi: false,
      planVersion: 'OPTIMIZATION_PLAN_V2',
    } as Parameters<OptimizationService['materializeProject']>[1])

    expect(findLatestProfileForScope).toHaveBeenCalledTimes(2)
    expect(findLatestProfileForScope).toHaveBeenCalledWith({
      projectId: project.id,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    })
    expect(findLatestProfileForScope).toHaveBeenCalledWith({
      projectId: project.id,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      recommendedActionType: 'CONTENT_CREATION',
    })

    expect(result.plans).toHaveLength(2)
    const onPagePlan = result.plans.find((plan) => plan.recommendedActionType === 'ON_PAGE_OPTIMIZATION')
    const contentPlan = result.plans.find((plan) => plan.recommendedActionType === 'CONTENT_CREATION')
    expect(onPagePlan).toMatchObject({
      planVersion: 'OPTIMIZATION_PLAN_V2',
      historicalRankAdjustment: -4,
    })
    expect(explanation(onPagePlan!)).toMatchObject({
      feedback: {
        feedbackProfileId: onPageProfile.id,
        feedbackProfileVersion: onPageProfile.feedbackProfileVersion,
        feedbackInputFingerprint: onPageProfile.inputFingerprint,
        feedbackSampleCount: onPageProfile.sampleCount,
        historicalRankAdjustment: -4,
        historicalFallback: false,
      },
    })
    expect(contentPlan).toMatchObject({
      planVersion: 'OPTIMIZATION_PLAN_V2',
      historicalRankAdjustment: 0,
    })
    expect(explanation(contentPlan!)).toMatchObject({
      feedback: {
        feedbackProfileId: null,
        feedbackProfileVersion: null,
        feedbackInputFingerprint: null,
        feedbackSampleCount: null,
        historicalRankAdjustment: 0,
        historicalFallback: false,
      },
    })
  })

  it('creates a separate immutable V2 row without changing the existing V1 plan', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'v1 v2 coexistence',
      primaryType: 'RANKING_UPSIDE',
      score: 88,
    })

    const v1Service = createService({
      findLatestProfileForScope: vi.fn(async () => null),
    })
    const v1 = await v1Service.materializeProject(project.id, { advisoryRootDir, useAi: false })
    const frozenV1 = JSON.parse(JSON.stringify(v1.plans[0]))

    const v2Profile = profile({ projectId: project.id, suffix: 2, historicalRankAdjustment: -3 })
    const v2Service = createService({
      findLatestProfileForScope: vi.fn(async () => v2Profile),
    })
    const v2 = await v2Service.materializeProject(project.id, {
      advisoryRootDir,
      useAi: false,
      planVersion: 'OPTIMIZATION_PLAN_V2',
    } as Parameters<OptimizationService['materializeProject']>[1])

    expect(v2.plans[0]).toMatchObject({
      candidateId: v1.plans[0]!.candidateId,
      planVersion: 'OPTIMIZATION_PLAN_V2',
      historicalRankAdjustment: -3,
    })
    const persisted = await repository.listPlans(project.id)
    expect(persisted).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(persisted.find((plan) => plan.planVersion === 'OPTIMIZATION_PLAN_V1')))).toEqual(frozenV1)
  })

  it('falls back the whole deterministic V2 set to historical zero when feedback would displace any candidate by more than ten', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'fallback rank 01',
      primaryType: 'RANKING_UPSIDE',
      score: 100,
    })
    for (let rank = 2; rank <= 11; rank += 1) {
      await createGrowthOpportunity({
        projectId: project.id,
        query: `fallback rank ${String(rank).padStart(2, '0')}`,
        primaryType: 'SEO_GAP',
        score: 101 - rank,
      })
    }
    for (let rank = 12; rank <= 13; rank += 1) {
      await createGrowthOpportunity({
        projectId: project.id,
        query: `fallback rank ${String(rank).padStart(2, '0')}`,
        primaryType: 'CONTENT_GAP',
        score: 101 - rank,
      })
    }

    const profiles: Record<ActionType, Profile> = {
      ON_PAGE_OPTIMIZATION: profile({ projectId: project.id, suffix: 3, historicalRankAdjustment: 10 }),
      TECHNICAL_SEO_REMEDIATION: profile({ projectId: project.id, suffix: 4, historicalRankAdjustment: 0 }),
      CONTENT_CREATION: profile({ projectId: project.id, suffix: 5, historicalRankAdjustment: -10 }),
    }
    const service = createService({
      findLatestProfileForScope: vi.fn(async (input: FeedbackLookup) => profiles[input.recommendedActionType]),
    })
    const result = await service.materializeProject(project.id, {
      advisoryRootDir,
      useAi: false,
      planVersion: 'OPTIMIZATION_PLAN_V2',
    } as Parameters<OptimizationService['materializeProject']>[1])

    expect(result.plans).toHaveLength(13)
    expect(result.plans.every((plan) => plan.planVersion === 'OPTIMIZATION_PLAN_V2')).toBe(true)
    expect(result.plans.every((plan) => plan.historicalRankAdjustment === 0)).toBe(true)
    expect(result.plans.every((plan) => (
      ((explanation(plan).feedback as Record<string, unknown>).historicalFallback === true)
    ))).toBe(true)
    expect(result.plans.map((plan) => plan.finalRank)).toEqual(
      result.plans.map((plan) => plan.deterministicRank),
    )
  })
})
