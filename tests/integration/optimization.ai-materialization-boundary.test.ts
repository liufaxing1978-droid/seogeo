import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma.js'
import { growthRepository } from '../../src/modules/growth/growth.repository.js'
import { buildCandidateDrafts } from '../../src/modules/optimization/optimization.candidate.js'
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js'
import {
  materializeOptimizationRankingSuccess,
  type OptimizationPlanRankingOutput,
} from '../../src/modules/ai/optimization-plan-ranking.js'

const repository = new OptimizationRepository()
const projectIds: string[] = []

async function createProject(label: string) {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const project = await prisma.project.create({
    data: {
      name: `P9-A AI boundary ${label} ${nonce}`,
      slug: `p9a-ai-boundary-${label}-${nonce}`,
      primaryDomain: `p9a-ai-boundary-${label}-${nonce}.example.com`,
      planLevel: 'ADVANCED',
    },
  })
  projectIds.push(project.id)
  return project
}

async function createEligibleCandidate(projectId: string) {
  const identity = await growthRepository.getOrCreateOpportunityIdentity({
    projectId,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: 'cross project boundary',
    canonicalPage: 'https://example.com/cross-project-boundary',
  })

  const snapshot = await growthRepository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-08-08T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-14T00:00:00.000Z'),
    previousWindowStart: new Date('2026-08-01T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-15T00:00:00.000Z'),
    primaryType: 'RANKING_UPSIDE',
    secondaryTypes: [],
    score: 83,
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
          source: 'RAW_GSC_COMPATIBILITY',
        },
      },
    },
    breakdown: {
      demandState: 'KNOWN',
      demandScore: 20,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: 20,
      ctrGapState: 'KNOWN',
      ctrGapScore: 12,
      siteGapState: 'KNOWN',
      siteGapScore: 12,
      gscTrendState: 'KNOWN',
      gscTrendScore: 7,
      p6VisibilityState: 'KNOWN',
      p6VisibilityScore: 5,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: 83,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 83,
      formulaVersion: 'GROWTH_SCORE_V1',
    },
    evidence: [],
  })

  await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9A_AI_PROJECT_BOUNDARY_TEST',
  })

  const [source] = await repository.listLatestGrowthInputs(projectId)
  expect(source).toBeDefined()
  const [draft] = buildCandidateDrafts(source!)
  expect(draft).toBeDefined()
  return repository.createCandidate(draft!)
}

async function cleanupFixtures() {
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

afterAll(cleanupFixtures)

describe('P9-A AI materialization project boundary', () => {
  it('rejects a ranking task whose candidate belongs to another project', async () => {
    const projectA = await createProject('a')
    const projectB = await createProject('b')
    const candidate = await createEligibleCandidate(projectB.id)

    const task = await prisma.aiTask.create({
      data: {
        projectId: projectA.id,
        taskType: 'OPTIMIZATION_PLAN_RANKING',
        requestKey: `cross-project-${candidate.id}`,
        promptVersion: 'optimization-plan-ranking-v1',
        factSnapshot: {
          version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V1',
          authority: 'P9_A_FIRST_PARTY_PLANNER',
          candidates: [{
            candidateId: candidate.id,
            candidateKey: candidate.candidateKey,
            deterministicRank: 1,
            recommendedActionType: 'ON_PAGE_OPTIMIZATION',
            market: {
              marketScopeMode: candidate.marketScopeMode,
              marketCode: candidate.marketCode,
              locale: candidate.locale,
            },
            growth: {
              opportunityType: candidate.opportunityType,
              score: candidate.growthScore!,
              priority: candidate.growthPriority,
              evidenceQuality: candidate.growthEvidenceQuality,
              evidenceCoverage: candidate.growthEvidenceCoverage,
            },
            advisoryContext: [],
            sourceFactReferences: [],
          }],
        },
        sourceReferences: [],
      },
    })

    const output: OptimizationPlanRankingOutput = {
      adjustments: [],
      sourceReferences: [],
    }

    await expect(
      prisma.$transaction((tx) => materializeOptimizationRankingSuccess(task, output, tx)),
    ).rejects.toThrow(/project mismatch/i)

    expect(await prisma.optimizationPlan.count({ where: { candidateId: candidate.id } })).toBe(0)
  })
})
