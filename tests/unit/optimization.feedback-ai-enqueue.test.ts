import path from 'node:path'
import type { OptimizationCandidate } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import type { CreateOptimizationCandidateInput, GrowthPlannerSource } from '../../src/modules/optimization/optimization.repository.js'
import { OptimizationService } from '../../src/modules/optimization/optimization.service.js'

const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const CANDIDATE_ID = '00000000-0000-4000-8000-000000000010'
const PROFILE_ID = '00000000-0000-4000-8000-000000000030'
const advisoryRootDir = path.resolve('vendor/third-party-skills')

function source(): GrowthPlannerSource {
  return {
    projectId: PROJECT_ID,
    identityId: '00000000-0000-4000-8000-000000000020',
    snapshotId: '00000000-0000-4000-8000-000000000021',
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    opportunityType: 'RANKING_UPSIDE',
    normalizedQuery: 'feedback ai enqueue',
    canonicalPage: 'https://example.com/feedback-ai-enqueue',
    growthScore: 90,
    growthScoreState: 'KNOWN',
    growthPriority: 'HIGH',
    growthEvidenceQuality: 'COMPLETE',
    growthEvidenceCoverage: 1,
    growthRankingEligible: true,
    growthLifecycleStatus: 'NEW',
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
    sourceFactReferences: [{
      type: 'GROWTH_OPPORTUNITY_SNAPSHOT',
      id: '00000000-0000-4000-8000-000000000021',
    }],
  }
}

describe('P9-A V2 AI enqueue', () => {
  it('reads feedback before enqueue and freezes it into V2 ranking facts without creating a plan', async () => {
    const createAndEnqueue = vi.fn(async (input: unknown) => ({
      id: '00000000-0000-4000-8000-000000000099',
      input,
    }))
    const findLatestProfileForScope = vi.fn(async () => ({
      id: PROFILE_ID,
      projectId: PROJECT_ID,
      feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
      profileKey: 'a'.repeat(64),
      scopeKey: 'b'.repeat(64),
      marketScopeMode: 'UNCONFIGURED_LEGACY' as const,
      marketCode: null,
      locale: null,
      recommendedActionType: 'ON_PAGE_OPTIMIZATION' as const,
      sampleCount: 5,
      positiveCount: 5,
      neutralCount: 0,
      negativeCount: 0,
      rollingEffectBalance: 1,
      historicalRankAdjustment: -5,
      windowLimit: 20,
      oldestEvidenceCutoffAt: new Date('2026-07-01T00:00:00.000Z'),
      newestEvidenceCutoffAt: new Date('2026-08-01T00:00:00.000Z'),
      inputEvidenceIdsJson: [],
      inputFingerprint: 'f'.repeat(64),
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
    }))
    const createPlan = vi.fn(async () => {
      throw new Error('V2 AI enqueue must not create a plan synchronously')
    })
    const repository = {
      listLatestGrowthInputs: vi.fn(async () => [source()]),
      createCandidate: vi.fn(async (draft: CreateOptimizationCandidateInput) => ({
        ...draft,
        id: CANDIDATE_ID,
        createdAt: new Date('2026-08-25T00:00:00.000Z'),
      } as OptimizationCandidate)),
      createPlan,
    }

    const service = new OptimizationService(
      repository as never,
      { createAndEnqueue } as never,
      { findLatestProfileForScope },
    )
    const result = await service.materializeProject(PROJECT_ID, {
      advisoryRootDir,
      useAi: true,
      planVersion: 'OPTIMIZATION_PLAN_V2',
    })

    expect(findLatestProfileForScope).toHaveBeenCalledTimes(1)
    expect(findLatestProfileForScope).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    })
    expect(createPlan).not.toHaveBeenCalled()
    expect(result).toEqual({
      candidates: [expect.objectContaining({ id: CANDIDATE_ID })],
      plans: [],
      aiTaskId: '00000000-0000-4000-8000-000000000099',
    })

    const taskInput = createAndEnqueue.mock.calls[0]![0] as Record<string, unknown>
    const facts = taskInput.factSnapshot as Record<string, unknown>
    expect(facts).toMatchObject({
      version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V2',
      planVersion: 'OPTIMIZATION_PLAN_V2',
    })
    const candidates = facts.candidates as Array<Record<string, unknown>>
    expect(candidates[0]?.feedback).toEqual({
      profileId: PROFILE_ID,
      profileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
      inputFingerprint: 'f'.repeat(64),
      sampleCount: 5,
      historicalRankAdjustment: -5,
    })
  })
})
