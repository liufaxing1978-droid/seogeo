import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma.js'
import { AiRepository } from '../../src/modules/ai/ai.repository.js'
import type { CreateAiTaskInput } from '../../src/modules/ai/ai.service.js'
import { executeAiTask } from '../../src/modules/ai/ai.worker.js'
import { materializeOptimizationRankingFallback } from '../../src/modules/ai/optimization-plan-ranking.js'
import { AiProviderError } from '../../src/modules/ai/provider.js'
import { growthRepository } from '../../src/modules/growth/growth.repository.js'
import { buildCandidateDrafts } from '../../src/modules/optimization/optimization.candidate.js'
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js'
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js'

const advisoryRootDir = path.resolve('vendor/third-party-skills')
const repository = new OptimizationRepository()
const service = new OptimizationService()
const aiRepository = new AiRepository()
const directTaskService = {
  createAndEnqueue(input: CreateAiTaskInput) {
    return aiRepository.createTask(input)
  },
}
const projectIds: string[] = []

function providerResponse(content: string) {
  return {
    provider: 'DEEPSEEK' as const,
    model: 'deepseek-reasoner',
    responseId: 'p9-a-test-response',
    content,
    finishReason: 'stop',
    latencyMs: 5,
    usage: {
      promptTokens: 10,
      completionTokens: 10,
      totalTokens: 20,
      cacheHitTokens: 0,
      cacheMissTokens: 10,
      reasoningTokens: 4,
    },
  }
}

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

  await prisma.aiTask.deleteMany({ where: { projectId: { in: projectIds } } })

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

  it('queues one bounded AI ranking task and freezes adjusted plans only after worker success', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'ai success high',
      primaryType: 'RANKING_UPSIDE',
      score: 90,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'ai success low',
      primaryType: 'RANKING_UPSIDE',
      score: 80,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })

    const aiService = new OptimizationService(repository, directTaskService)
    const result = await aiService.materializeProject(project.id, { advisoryRootDir, useAi: true })

    expect(result.aiTaskId).toBeTruthy()
    expect(result.plans).toEqual([])
    expect(await repository.listPlans(project.id)).toEqual([])

    const high = result.candidates.find((candidate) => candidate.growthScore === 90)
    const low = result.candidates.find((candidate) => candidate.growthScore === 80)
    expect(high).toBeDefined()
    expect(low).toBeDefined()

    await executeAiTask(result.aiTaskId!, {
      repository: aiRepository,
      gateway: {
        async complete() {
          return providerResponse(JSON.stringify({
            adjustments: [
              { candidateId: high!.id, adjustment: 1, explanation: 'Move high candidate down one bounded place.', sourceReferences: [] },
              { candidateId: low!.id, adjustment: -1, explanation: 'Move low candidate up one bounded place.', sourceReferences: [] },
            ],
            sourceReferences: [],
          }))
        },
      },
    })

    const task = await aiRepository.getTask(result.aiTaskId!)
    expect(task?.status).toBe('COMPLETED')

    const plans = await repository.listPlans(project.id)
    expect(plans).toHaveLength(2)
    expect(plans.find((plan) => plan.candidateId === high!.id)).toMatchObject({
      deterministicRank: 1,
      aiRankAdjustment: 1,
      finalRank: 2,
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
      automationEligibility: false,
    })
    expect(plans.find((plan) => plan.candidateId === low!.id)).toMatchObject({
      deterministicRank: 2,
      aiRankAdjustment: -1,
      finalRank: 1,
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
      automationEligibility: false,
    })

    expect(plans.map((plan) => plan.explanation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ai: expect.objectContaining({ applied: true, fallback: false }) }),
      expect.objectContaining({ ai: expect.objectContaining({ applied: true, fallback: false }) }),
    ]))

    expect(await prisma.publicationProposal.count({ where: { projectId: project.id } })).toBe(0)
    expect(await prisma.publicationPlan.count({ where: { projectId: project.id } })).toBe(0)
  })

  it('keeps the AI task failed but idempotently freezes deterministic fallback plans after provider failure', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'ai provider failure high',
      primaryType: 'RANKING_UPSIDE',
      score: 91,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'ai provider failure low',
      primaryType: 'CONTENT_GAP',
      score: 71,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })

    const aiService = new OptimizationService(repository, directTaskService)
    const result = await aiService.materializeProject(project.id, { advisoryRootDir, useAi: true })
    expect(result.aiTaskId).toBeTruthy()
    expect(result.plans).toEqual([])

    await expect(executeAiTask(result.aiTaskId!, {
      repository: aiRepository,
      gateway: {
        async complete() {
          throw new AiProviderError('P9-A upstream unavailable', 'UPSTREAM', 'DEEPSEEK', true, 503)
        },
      },
    })).rejects.toThrow(/upstream unavailable/i)

    const task = await aiRepository.getTask(result.aiTaskId!)
    expect(task).toMatchObject({ status: 'FAILED', errorCode: 'UPSTREAM' })

    const firstPlans = await repository.listPlans(project.id)
    expect(firstPlans).toHaveLength(2)
    expect(firstPlans.every((plan) => plan.aiRankAdjustment === 0)).toBe(true)
    expect(firstPlans.every((plan) => plan.finalRank === plan.deterministicRank)).toBe(true)
    expect(firstPlans.every((plan) => plan.automationEligibility === false)).toBe(true)
    expect(firstPlans.map((plan) => plan.explanation)).toEqual(expect.arrayContaining([
      expect.objectContaining({ ai: { applied: false, fallback: true, adjustment: 0, annotation: null } }),
      expect.objectContaining({ ai: { applied: false, fallback: true, adjustment: 0, annotation: null } }),
    ]))

    await materializeOptimizationRankingFallback(task!)
    const secondPlans = await repository.listPlans(project.id)
    expect(secondPlans.map((plan) => plan.id)).toEqual(firstPlans.map((plan) => plan.id))
    expect(secondPlans.map((plan) => plan.recommendedActionType).sort()).toEqual(
      firstPlans.map((plan) => plan.recommendedActionType).sort(),
    )

    expect(await prisma.publicationProposal.count({ where: { projectId: project.id } })).toBe(0)
    expect(await prisma.publicationPlan.count({ where: { projectId: project.id } })).toBe(0)
  })

  it('uses the same deterministic fallback after invalid AI output without changing actions or eligibility', async () => {
    const project = await createProject()
    await createGrowthOpportunity({
      projectId: project.id,
      query: 'ai invalid output',
      primaryType: 'RANKING_UPSIDE',
      score: 86,
      scoreState: 'KNOWN',
      rankingEligible: true,
    })

    const aiService = new OptimizationService(repository, directTaskService)
    const result = await aiService.materializeProject(project.id, { advisoryRootDir, useAi: true })
    const candidate = result.candidates.find((item) => item.eligibilityState === 'ELIGIBLE')
    expect(candidate).toBeDefined()

    await expect(executeAiTask(result.aiTaskId!, {
      repository: aiRepository,
      gateway: {
        async complete() {
          return providerResponse(JSON.stringify({
            adjustments: [{
              candidateId: candidate!.id,
              adjustment: 3,
              explanation: 'Out of bounds and must be rejected.',
              sourceReferences: [],
            }],
            sourceReferences: [],
          }))
        },
      },
    })).rejects.toThrow(/required schema|valid structured output|match/i)

    expect(await aiRepository.getTask(result.aiTaskId!)).toMatchObject({
      status: 'FAILED',
      errorCode: 'INVALID_AI_OUTPUT',
    })
    expect(await repository.listPlans(project.id)).toEqual([
      expect.objectContaining({
        candidateId: candidate!.id,
        recommendedActionType: 'ON_PAGE_OPTIMIZATION',
        aiRankAdjustment: 0,
        finalRank: 1,
        automationEligibility: false,
        explanation: expect.objectContaining({
          ai: { applied: false, fallback: true, adjustment: 0, annotation: null },
        }),
      }),
    ])
  })
})
