import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma.js'
import { growthRepository } from '../../src/modules/growth/growth.repository.js'
import { buildCandidateDrafts } from '../../src/modules/optimization/optimization.candidate.js'
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js'
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js'

const advisoryRootDir = path.resolve('vendor/third-party-skills')
const repository = new OptimizationRepository()
const service = new OptimizationService()
const projectIds: string[] = []

async function createProject() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const project = await prisma.project.create({
    data: {
      name: `P9-A service ${nonce}`,
      slug: `p9a-service-${nonce}`,
      primaryDomain: `p9a-service-${nonce}.example.com`,
      planLevel: 'ADVANCED',
    },
  })
  projectIds.push(project.id)
  return project
}

async function createGrowthOpportunity(input: {
  projectId: string
  query: string
  primaryType: 'RANKING_UPSIDE' | 'CONTENT_GAP'
  score: number | null
  scoreState: 'KNOWN' | 'UNKNOWN'
  rankingEligible: boolean
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
    priority: input.scoreState === 'KNOWN' ? 'HIGH' : 'UNKNOWN',
    scoreState: input.scoreState,
    evidenceQuality: input.scoreState === 'KNOWN' ? 'COMPLETE' : 'UNKNOWN',
    evidenceCoverage: input.scoreState === 'KNOWN' ? 1 : 0,
    rankingEligible: input.rankingEligible,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' },
      },
    },
    breakdown: {
      demandState: input.scoreState,
      demandScore: input.scoreState === 'KNOWN' ? 20 : null,
      positionPotentialState: input.scoreState,
      positionPotentialScore: input.scoreState === 'KNOWN' ? 20 : null,
      ctrGapState: input.scoreState,
      ctrGapScore: input.scoreState === 'KNOWN' ? 10 : null,
      siteGapState: input.scoreState,
      siteGapScore: input.scoreState === 'KNOWN' ? 10 : null,
      gscTrendState: input.scoreState,
      gscTrendScore: input.scoreState === 'KNOWN' ? 6 : null,
      p6VisibilityState: input.scoreState,
      p6VisibilityScore: input.scoreState === 'KNOWN' ? 4 : null,
      trendVisibilityDisplayState: input.scoreState,
      trendVisibilityDisplayScore: input.score,
      availableWeight: input.scoreState === 'KNOWN' ? 100 : 0,
      evidenceCoverage: input.scoreState === 'KNOWN' ? 1 : 0,
      weightedTotal: input.score,
      formulaVersion: 'GROWTH_SCORE_V1',
    },
    evidence: [],
  })

  await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9A_SERVICE_TEST_FIXTURE',
  })

  return { identity, snapshot }
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

describe('P9-A deterministic plan service', () => {
  it('persists all audit candidates, freezes plans only for eligible work, and creates no P8 artifacts', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'eligible planner query',
      primaryType: 'RANKING_UPSIDE',
      score: 88,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'unknown planner query',
      primaryType: 'CONTENT_GAP',
      score: null,
      scoreState: 'UNKNOWN',
      rankingEligible: false,
    })

    const beforeP8 = {
      proposals: await prisma.publicationProposal.count({ where: { projectId: project.id } }),
      plans: await prisma.publicationPlan.count({ where: { projectId: project.id } }),
    }

    const first = await service.materializeProject(project.id, { advisoryRootDir, useAi: false })
    const second = await service.materializeProject(project.id, { advisoryRootDir, useAi: false })

    expect(first.aiTaskId).toBeNull()
    expect(first.candidates).toHaveLength(2)
    expect(first.candidates.filter((candidate) => candidate.eligibilityState === 'INELIGIBLE')).toHaveLength(1)
    expect(first.plans).toHaveLength(1)
    expect(second.candidates.map((candidate) => candidate.id).sort()).toEqual(
      first.candidates.map((candidate) => candidate.id).sort(),
    )
    expect(second.plans.map((plan) => plan.id)).toEqual(first.plans.map((plan) => plan.id))

    expect(first.plans[0]).toMatchObject({
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      automationEligibility: false,
    })

    const advisoryContext = first.plans[0]?.advisoryContext as Array<Record<string, unknown>>
    expect(advisoryContext.map((item) => item.methodKey)).toEqual(['ON_PAGE_SEO_CHECK', 'SEO_AUDIT'])
    expect(advisoryContext.every((item) => item.authority === 'ADVISORY_ONLY')).toBe(true)
    expect(JSON.stringify(advisoryContext)).not.toContain('RAW VENDOR-DERIVED STEP')
    expect(advisoryContext.every((item) => !Object.prototype.hasOwnProperty.call(item, 'projection'))).toBe(true)

    expect(first.plans[0]?.explanation).toMatchObject({
      authority: 'P9_A_FIRST_PARTY_PLANNER',
      action: {
        version: 'OPTIMIZATION_ACTION_MAP_V1',
        recommendedActionType: 'ON_PAGE_OPTIMIZATION',
      },
      ai: { applied: false, fallback: false, adjustment: 0, annotation: null },
    })

    expect({
      proposals: await prisma.publicationProposal.count({ where: { projectId: project.id } }),
      plans: await prisma.publicationPlan.count({ where: { projectId: project.id } }),
    }).toEqual(beforeP8)
  })

  it('fails closed instead of accepting a conflicting immutable plan payload', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'conflict planner query',
      primaryType: 'RANKING_UPSIDE',
      score: 77,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })

    const [source] = await repository.listLatestGrowthInputs(project.id)
    expect(source).toBeDefined()
    const [draft] = buildCandidateDrafts(source!)
    expect(draft).toBeDefined()
    const candidate = await repository.createCandidate(draft!)

    await repository.createPlan({
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'CONTENT_REFRESH',
      sourceFactReferences: source!.sourceFactReferences,
      deterministicRank: 99,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 99,
      advisoryContext: [],
      automationEligibility: false,
      explanation: { authority: 'CONFLICTING_TEST_PAYLOAD' },
    })

    await expect(
      service.materializeProject(project.id, { advisoryRootDir, useAi: false }),
    ).rejects.toThrow(/conflict|immutable/i)
  })
})
