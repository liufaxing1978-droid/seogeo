import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../src/db/prisma.js'
import { createAdvisorySkillRegistry } from '../../src/modules/advisory-skills/advisory-skill.registry.js'
import { parseOptimizationPlanRankingOutput } from '../../src/modules/ai/optimization-plan-ranking.js'
import { growthRepository } from '../../src/modules/growth/growth.repository.js'
import { buildAdvisoryContext } from '../../src/modules/optimization/optimization.advisory.js'
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js'

const optimizationSourceDir = path.resolve('src/modules/optimization')
const advisoryRootDir = path.resolve('vendor/third-party-skills')
const projectIds: string[] = []

async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name)
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath]
  }))).flat().sort()
}

async function optimizationSource(): Promise<string> {
  const files = (await walkFiles(optimizationSourceDir)).filter((file) => file.endsWith('.ts'))
  return (await Promise.all(files.map(async (file) => `${file}\n${await readFile(file, 'utf8')}`))).join('\n')
}

async function cleanupBoundaryFixtures() {
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

afterAll(cleanupBoundaryFixtures)

describe('P9-A planner authority boundaries', () => {
  it('does not import P7 scoring/detector/service authority', async () => {
    const source = await optimizationSource()
    const forbiddenImports = [
      /from ['"][^'"]*growth[^'"]*(?:score|scoring|detector|service)[^'"]*['"]/iu,
      /from ['"][^'"]*(?:detectors|growth\.service|growth\.score)[^'"]*['"]/iu,
    ]

    for (const pattern of forbiddenImports) {
      expect(source, `forbidden P7 authority import: ${pattern}`).not.toMatch(pattern)
    }

    expect(source).not.toMatch(/growthOpportunity(?:Identity|Snapshot|Evidence|Lifecycle)\.(?:create|update|updateMany|delete|deleteMany|upsert)\s*\(/u)
  })

  it('does not import P8 mutation/approval/execution/verification or Git/deployment authority', async () => {
    const source = await optimizationSource()
    const forbidden = [
      /from ['"][^'"]*publication[^'"]*['"]/iu,
      /from ['"][^'"]*(?:git|github|deploy|rollback)[^'"]*['"]/iu,
      /\bpublication(?:Proposal|Plan|Preview|Execution)\.(?:create|update|upsert|delete)\s*\(/u,
      /\b(?:merge|deploy|rollback|createDraftPr|createPullRequest)\s*\(/iu,
    ]

    for (const pattern of forbidden) {
      expect(source, `forbidden P8/Git authority pattern: ${pattern}`).not.toMatch(pattern)
    }
  })

  it('owns no optimization BullMQ queue, cron, Redis, or event bus', async () => {
    const source = await optimizationSource()
    for (const pattern of [
      /from ['"]bullmq['"]/u,
      /from ['"]ioredis['"]/u,
      /from ['"]node-cron['"]/u,
      /new Queue\s*\(/u,
      /optimization[-_ ]queue/iu,
      /event[-_. ]bus/iu,
    ]) {
      expect(source, `forbidden optimization runtime owner: ${pattern}`).not.toMatch(pattern)
    }
  })

  it('packages advisory context as bounded identity/provenance only', async () => {
    const registry = await createAdvisorySkillRegistry({ rootDir: advisoryRootDir })
    const context = buildAdvisoryContext({ actionType: 'ON_PAGE_OPTIMIZATION', registry })

    expect(context).toHaveLength(2)
    for (const item of context) {
      expect(Object.keys(item).sort()).toEqual([
        'authority',
        'localVersion',
        'methodKey',
        'projectionSha256',
        'skillId',
        'sourceRepo',
        'upstreamCommit',
      ].sort())
      expect(item.authority).toBe('ADVISORY_ONLY')
    }
    expect(JSON.stringify(context)).not.toMatch(/(?:steps|checks|requiredInputs|rawBody|sourceFileHashes|executable)/u)
  })

  it('rejects AI ranking fields that try to override action, score, evidence, market, risk, or approval', () => {
    const candidateId = '00000000-0000-4000-8000-000000000001'
    const task = {
      factSnapshot: {
        version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V1',
        authority: 'P9_A_FIRST_PARTY_PLANNER',
        candidates: [{ candidateId }],
      },
      sourceReferences: [],
    }

    const forbiddenFields = [
      ['recommendedActionType', 'CONTENT_REFRESH'],
      ['score', 999],
      ['evidence', { fabricated: true }],
      ['marketCode', 'GLOBAL'],
      ['riskLevel', 'LOW'],
      ['approvalRequired', false],
    ] as const

    for (const [field, value] of forbiddenFields) {
      expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
        adjustments: [{
          candidateId,
          adjustment: 0,
          explanation: 'Attempted override must be rejected.',
          sourceReferences: [],
          [field]: value,
        }],
        sourceReferences: [],
      }), task)).toThrow(/required schema|match/i)
    }
  })

  it('leaves P7 snapshot/evidence/lifecycle and P8 publication rows unchanged during planner materialization', async () => {
    const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const project = await prisma.project.create({
      data: {
        name: `P9-A boundary ${nonce}`,
        slug: `p9a-boundary-${nonce}`,
        primaryDomain: `p9a-boundary-${nonce}.example.com`,
        planLevel: 'ADVANCED',
      },
    })
    projectIds.push(project.id)

    const identity = await growthRepository.getOrCreateOpportunityIdentity({
      projectId: project.id,
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'authority boundary query',
      canonicalPage: 'https://example.com/authority-boundary',
    })
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
          scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' },
        },
      },
      breakdown: {
        demandState: 'KNOWN', demandScore: 20,
        positionPotentialState: 'KNOWN', positionPotentialScore: 20,
        ctrGapState: 'KNOWN', ctrGapScore: 12,
        siteGapState: 'KNOWN', siteGapScore: 12,
        gscTrendState: 'KNOWN', gscTrendScore: 7,
        p6VisibilityState: 'KNOWN', p6VisibilityScore: 5,
        trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 83,
        availableWeight: 100,
        evidenceCoverage: 1,
        weightedTotal: 83,
        formulaVersion: 'GROWTH_SCORE_V1',
      },
      evidence: [],
    })
    await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'P9A_BOUNDARY_TEST',
    })

    const beforeGrowth = await prisma.growthOpportunityIdentity.findUniqueOrThrow({
      where: { id: identity.id },
      select: {
        lifecycle: { select: { status: true, latestSnapshotId: true } },
        snapshots: {
          where: { id: snapshot.id },
          select: {
            id: true,
            score: true,
            scoreState: true,
            priority: true,
            evidenceQuality: true,
            evidenceCoverage: true,
            rankingEligible: true,
            evidence: { select: { id: true, fingerprint: true, evidenceState: true } },
          },
        },
      },
    })
    const beforeP8 = {
      proposals: await prisma.publicationProposal.count({ where: { projectId: project.id } }),
      plans: await prisma.publicationPlan.count({ where: { projectId: project.id } }),
      previews: await prisma.publicationPreview.count({ where: { projectId: project.id } }),
      executions: await prisma.publicationExecution.count({ where: { projectId: project.id } }),
    }

    const service = new OptimizationService()
    await service.materializeProject(project.id, { advisoryRootDir, useAi: false })

    const afterGrowth = await prisma.growthOpportunityIdentity.findUniqueOrThrow({
      where: { id: identity.id },
      select: {
        lifecycle: { select: { status: true, latestSnapshotId: true } },
        snapshots: {
          where: { id: snapshot.id },
          select: {
            id: true,
            score: true,
            scoreState: true,
            priority: true,
            evidenceQuality: true,
            evidenceCoverage: true,
            rankingEligible: true,
            evidence: { select: { id: true, fingerprint: true, evidenceState: true } },
          },
        },
      },
    })
    const afterP8 = {
      proposals: await prisma.publicationProposal.count({ where: { projectId: project.id } }),
      plans: await prisma.publicationPlan.count({ where: { projectId: project.id } }),
      previews: await prisma.publicationPreview.count({ where: { projectId: project.id } }),
      executions: await prisma.publicationExecution.count({ where: { projectId: project.id } }),
    }

    expect(afterGrowth).toEqual(beforeGrowth)
    expect(afterP8).toEqual(beforeP8)
  })
})
