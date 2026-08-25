import { describe, expect, it } from 'vitest'
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js'
import * as optimizationRankingModule from '../../src/modules/ai/optimization-plan-ranking.js'
import type { OptimizationPlanRankingSeed } from '../../src/modules/ai/optimization-plan-ranking.js'

const {
  OPTIMIZATION_PLAN_RANKING_PROMPT_ID,
  buildOptimizationPlanRankingTaskInput,
  parseOptimizationPlanRankingOutput,
} = optimizationRankingModule

const PROJECT_ID = '00000000-0000-4000-8000-000000000001'
const CANDIDATE_A = '00000000-0000-4000-8000-000000000010'
const CANDIDATE_B = '00000000-0000-4000-8000-000000000011'
const SNAPSHOT_A = '00000000-0000-4000-8000-000000000020'
const SNAPSHOT_B = '00000000-0000-4000-8000-000000000021'
const PROFILE_A = '00000000-0000-4000-8000-000000000030'

function seed(input: {
  candidateId: string
  candidateKey: string
  snapshotId: string
  deterministicRank: number
  score: number
}): OptimizationPlanRankingSeed {
  return {
    candidateId: input.candidateId,
    candidateKey: input.candidateKey,
    deterministicRank: input.deterministicRank,
    recommendedActionType: 'ON_PAGE_OPTIMIZATION',
    market: {
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
    },
    growth: {
      opportunityType: 'RANKING_UPSIDE',
      score: input.score,
      priority: 'HIGH',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
    },
    advisoryContext: [{
      skillId: 'aaron.on-page-seo-checker',
      methodKey: 'ON_PAGE_SEO_CHECK',
      authority: 'ADVISORY_ONLY',
      projectionSha256: 'a'.repeat(64),
      sourceRepo: 'aaron-he-zhu/aaron-marketing-skills',
      upstreamCommit: '1'.repeat(40),
      localVersion: '1.0.0',
    }],
    sourceFactReferences: [
      { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: input.snapshotId },
    ],
  }
}

const SEEDS = [
  seed({ candidateId: CANDIDATE_A, candidateKey: 'a'.repeat(64), snapshotId: SNAPSHOT_A, deterministicRank: 1, score: 90 }),
  seed({ candidateId: CANDIDATE_B, candidateKey: 'b'.repeat(64), snapshotId: SNAPSHOT_B, deterministicRank: 2, score: 80 }),
]

function taskFor(seeds: readonly OptimizationPlanRankingSeed[] = SEEDS) {
  const input = buildOptimizationPlanRankingTaskInput(PROJECT_ID, seeds)
  return {
    factSnapshot: input.factSnapshot,
    sourceReferences: input.sourceReferences,
  }
}

type FrozenFeedback = {
  profileId: string
  profileVersion: string
  inputFingerprint: string
  sampleCount: number
  historicalRankAdjustment: number
} | null

type V2Seed = OptimizationPlanRankingSeed & { feedback: FrozenFeedback }

function v2Seeds(): V2Seed[] {
  return [
    {
      ...SEEDS[0]!,
      feedback: {
        profileId: PROFILE_A,
        profileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
        inputFingerprint: 'f'.repeat(64),
        sampleCount: 5,
        historicalRankAdjustment: -4,
      },
    },
    { ...SEEDS[1]!, feedback: null },
  ]
}

function buildV2Task(seeds: readonly V2Seed[] = v2Seeds()) {
  return (buildOptimizationPlanRankingTaskInput as unknown as (
    projectId: string,
    seeds: readonly V2Seed[],
    options: { planVersion: 'OPTIMIZATION_PLAN_V2' },
  ) => ReturnType<typeof buildOptimizationPlanRankingTaskInput>)(
    PROJECT_ID,
    seeds,
    { planVersion: 'OPTIMIZATION_PLAN_V2' },
  )
}

describe('P9-A optimization plan AI ranking', () => {
  it('builds a deterministic bounded V1 task without vendor raw content or P8 authority state', () => {
    const forward = buildOptimizationPlanRankingTaskInput(PROJECT_ID, SEEDS)
    const reversed = buildOptimizationPlanRankingTaskInput(PROJECT_ID, [...SEEDS].reverse())

    expect(forward.taskType).toBe('OPTIMIZATION_PLAN_RANKING')
    expect(forward.promptVersion).toBe('optimization-plan-ranking-v1')
    expect(forward.requestKey).toBe(reversed.requestKey)
    expect(forward.requestKey).toMatch(/^optimization-plan-ranking:[0-9a-f]{64}:optimization-plan-ranking-v1$/)
    expect(forward.factSnapshot).toEqual({
      authority: 'P9_A_FIRST_PARTY_PLANNER',
      candidates: [
        expect.objectContaining({ candidateId: CANDIDATE_A }),
        expect.objectContaining({ candidateId: CANDIDATE_B }),
      ],
      version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V1',
    })
    expect(forward.factSnapshot).not.toHaveProperty('planVersion')

    const facts = JSON.stringify(forward.factSnapshot)
    expect(facts).toContain(CANDIDATE_A)
    expect(facts).toContain('ADVISORY_ONLY')
    expect(facts).not.toContain('feedback')
    expect(facts).not.toContain('RAW VENDOR-DERIVED STEP')
    expect(facts).not.toContain('sourceFileHashes')
    expect(facts).not.toContain('riskClass')
    expect(facts).not.toContain('approval')
    expect(facts).not.toContain('publicationPlan')
  })

  it('builds strict V2 facts with frozen feedback while preserving the same AI output authority', () => {
    const task = buildV2Task()
    const facts = task.factSnapshot as unknown as Record<string, unknown>
    expect(facts).toMatchObject({
      version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V2',
      planVersion: 'OPTIMIZATION_PLAN_V2',
      authority: 'P9_A_FIRST_PARTY_PLANNER',
    })
    const candidates = facts.candidates as Array<Record<string, unknown>>
    expect(candidates[0]?.feedback).toEqual({
      profileId: PROFILE_A,
      profileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
      inputFingerprint: 'f'.repeat(64),
      sampleCount: 5,
      historicalRankAdjustment: -4,
    })
    expect(candidates[1]?.feedback).toBeNull()
  })

  it('projects V2 prompt facts without any feedback object or feedback provenance', () => {
    const project = (optimizationRankingModule as unknown as Record<string, unknown>)[
      'projectOptimizationRankingPromptFacts'
    ]
    expect(project).toBeTypeOf('function')
    if (typeof project !== 'function') return

    const task = buildV2Task()
    const projected = (project as (facts: unknown) => unknown)(task.factSnapshot)
    const serialized = JSON.stringify(projected)
    expect(serialized).toContain('OPTIMIZATION_PLAN_RANKING_FACTS_V2')
    expect(serialized).toContain('OPTIMIZATION_PLAN_V2')
    expect(serialized).not.toContain('"feedback"')
    expect(serialized).not.toContain(PROFILE_A)
    expect(serialized).not.toContain('f'.repeat(64))
    expect(serialized).not.toContain('historicalRankAdjustment')
    expect(serialized).not.toContain('sampleCount')
  })

  it('accepts only integer adjustments from -2 through +2 and supplied source references', () => {
    const task = taskFor()
    const valid = JSON.stringify({
      adjustments: [
        {
          candidateId: CANDIDATE_A,
          adjustment: -2,
          explanation: 'Prefer the higher-confidence eligible item.',
          sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
        },
        {
          candidateId: CANDIDATE_B,
          adjustment: 2,
          explanation: 'Deprioritize within the bounded ranking window.',
          sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_B}`],
        },
      ],
      sourceReferences: [
        `GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`,
        `GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_B}`,
      ],
    })

    expect(parseOptimizationPlanRankingOutput(valid, task).adjustments.map((item) => item.adjustment)).toEqual([-2, 2])

    for (const invalidAdjustment of [-3, 3, 0.5]) {
      expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
        adjustments: [{
          candidateId: CANDIDATE_A,
          adjustment: invalidAdjustment,
          explanation: 'invalid',
          sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
        }],
        sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
      }), task)).toThrow()
    }
  })

  it('rejects duplicate or unknown candidate ids, unknown fields, and unsupplied source refs', () => {
    const task = taskFor()
    const base = {
      adjustment: 0,
      explanation: 'bounded',
      sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
    }

    expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
      adjustments: [
        { candidateId: CANDIDATE_A, ...base },
        { candidateId: CANDIDATE_A, ...base },
      ],
      sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
    }), task)).toThrow(/duplicate/i)

    expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
      adjustments: [{ candidateId: '00000000-0000-4000-8000-000000000099', ...base }],
      sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
    }), task)).toThrow(/candidate/i)

    expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
      adjustments: [{ candidateId: CANDIDATE_A, ...base, unexpected: true }],
      sourceReferences: [`GROWTH_OPPORTUNITY_SNAPSHOT:${SNAPSHOT_A}`],
    }), task)).toThrow()

    expect(() => parseOptimizationPlanRankingOutput(JSON.stringify({
      adjustments: [{
        candidateId: CANDIDATE_A,
        adjustment: 0,
        explanation: 'bounded',
        sourceReferences: ['GROWTH_OPPORTUNITY_SNAPSHOT:not-supplied'],
      }],
      sourceReferences: ['GROWTH_OPPORTUNITY_SNAPSHOT:not-supplied'],
    }), task)).toThrow(/source reference/i)
  })

  it('registers a REASONING JSON prompt that explicitly denies planner and P8 authority changes', () => {
    const prompt = getPromptDefinition(OPTIMIZATION_PLAN_RANKING_PROMPT_ID)
    expect(prompt.mode).toBe('REASONING')
    expect(prompt.responseFormat).toBe('JSON')
    expect(prompt.system).toContain('eligibility')
    expect(prompt.system).toContain('recommended action')
    expect(prompt.system).toContain('score')
    expect(prompt.system).toContain('market')
    expect(prompt.system).toContain('risk')
    expect(prompt.system).toContain('approval')
  })
})
