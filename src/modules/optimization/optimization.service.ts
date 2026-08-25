import type {
  MarketCode,
  OptimizationCandidate,
  OptimizationFeedbackProfile,
  OptimizationMarketScopeMode,
  OptimizationPlan,
  RecommendedActionType,
} from '@prisma/client'
import { createAdvisorySkillRegistry } from '../advisory-skills/advisory-skill.registry.js'
import {
  buildOptimizationPlanRankingTaskInput,
  type OptimizationPlanRankingSeed,
} from '../ai/optimization-plan-ranking.js'
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js'
import { OptimizationFeedbackRepository } from '../optimization-feedback/feedback.repository.js'
import { OPTIMIZATION_FEEDBACK_PROFILE_VERSION } from '../optimization-feedback/feedback.types.js'
import { buildAdvisoryContext } from './optimization.advisory.js'
import { buildCandidateDrafts } from './optimization.candidate.js'
import { recommendedActionForGrowthType } from './optimization.policy.js'
import {
  OptimizationRepository,
  optimizationRepository,
  type CreateOptimizationPlanInput,
} from './optimization.repository.js'
import {
  applyFeedbackAwareRankAdjustments,
  rankEligibleCandidates,
  type BoundedRankSeed,
} from './optimization.ranking.js'
import {
  OPTIMIZATION_ACTION_MAP_VERSION,
  OPTIMIZATION_PLAN_V2,
  OPTIMIZATION_PLAN_VERSION,
  type OptimizationPlanVersion,
} from './optimization.types.js'

export type MaterializeOptimizationOptions = {
  advisoryRootDir: string
  useAi?: boolean
  planVersion?: OptimizationPlanVersion
}

export type MaterializeOptimizationResult = {
  candidates: OptimizationCandidate[]
  plans: OptimizationPlan[]
  aiTaskId: string | null
}

export type OptimizationFeedbackProfileReadPort = {
  findLatestProfileForScope(input: {
    projectId: string
    marketScopeMode: OptimizationMarketScopeMode
    marketCode: MarketCode | null
    locale: string | null
    recommendedActionType: RecommendedActionType
  }): Promise<OptimizationFeedbackProfile | null>
}

type PreparedPlan = {
  deterministicPlan: CreateOptimizationPlanInput
  aiSeed: OptimizationPlanRankingSeed
  rankSeed: BoundedRankSeed
  marketScopeMode: OptimizationMarketScopeMode
  marketCode: MarketCode | null
  locale: string | null
  recommendedActionType: RecommendedActionType
}

type FrozenFeedback = {
  profile: OptimizationFeedbackProfile | null
  historicalRankAdjustment: number
}

function compatibleFeedbackProfile(
  profile: OptimizationFeedbackProfile | null,
  projectId: string,
): profile is OptimizationFeedbackProfile {
  if (!profile) return false
  return (
    profile.projectId === projectId
    && profile.feedbackProfileVersion === OPTIMIZATION_FEEDBACK_PROFILE_VERSION
    && /^[0-9a-f]{64}$/i.test(profile.inputFingerprint)
    && Number.isInteger(profile.sampleCount)
    && profile.sampleCount >= 0
    && Number.isInteger(profile.historicalRankAdjustment)
    && profile.historicalRankAdjustment >= -10
    && profile.historicalRankAdjustment <= 10
  )
}

function withFeedbackExplanation(
  explanation: unknown,
  feedback: {
    feedbackProfileId: string | null
    feedbackProfileVersion: string | null
    feedbackInputFingerprint: string | null
    feedbackSampleCount: number | null
    historicalRankAdjustment: number
    historicalFallback: boolean
  },
): Record<string, unknown> {
  if (!explanation || typeof explanation !== 'object' || Array.isArray(explanation)) {
    throw new Error('Optimization plan explanation must be an object')
  }
  return {
    ...(explanation as Record<string, unknown>),
    feedback,
  }
}

export class OptimizationService {
  constructor(
    private readonly repository: OptimizationRepository = optimizationRepository,
    private readonly aiTasks: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService,
    private readonly feedbackProfiles: OptimizationFeedbackProfileReadPort = new OptimizationFeedbackRepository(),
  ) {}

  async materializeProject(
    projectId: string,
    options: MaterializeOptimizationOptions,
  ): Promise<MaterializeOptimizationResult> {
    const sources = await this.repository.listLatestGrowthInputs(projectId)
    const drafts = sources.flatMap((source) => buildCandidateDrafts(source))
    const candidates: OptimizationCandidate[] = []
    const candidateByKey = new Map<string, OptimizationCandidate>()

    for (const draft of drafts) {
      const candidate = await this.repository.createCandidate(draft)
      candidates.push(candidate)
      candidateByKey.set(draft.candidateKey, candidate)
    }

    const ranked = rankEligibleCandidates(drafts)
    const registry = await createAdvisorySkillRegistry({ rootDir: options.advisoryRootDir })

    const prepared: PreparedPlan[] = ranked.map((rankedCandidate) => {
      const persistedCandidate = candidateByKey.get(rankedCandidate.candidateKey)
      if (!persistedCandidate) {
        throw new Error('Persisted optimization candidate missing for ranked draft')
      }

      const recommendedActionType = recommendedActionForGrowthType(rankedCandidate.opportunityType)
      if (!recommendedActionType) {
        throw new Error('Eligible optimization candidate has no supported action mapping')
      }
      if (rankedCandidate.growthScore === null || !Number.isFinite(rankedCandidate.growthScore)) {
        throw new Error('Eligible optimization candidate lost its finite P7 growth score')
      }

      const advisoryContext = buildAdvisoryContext({
        actionType: recommendedActionType,
        registry,
      })
      const sourceFactReferences = rankedCandidate.sourceFactReferences.map((reference) => ({ ...reference }))
      const growth = {
        opportunityType: rankedCandidate.opportunityType,
        score: rankedCandidate.growthScore,
        priority: rankedCandidate.growthPriority,
        evidenceQuality: rankedCandidate.growthEvidenceQuality,
        evidenceCoverage: rankedCandidate.growthEvidenceCoverage,
      }
      const market = {
        marketScopeMode: rankedCandidate.marketScopeMode,
        marketCode: rankedCandidate.marketCode,
        locale: rankedCandidate.locale,
      }

      return {
        deterministicPlan: {
          candidateId: persistedCandidate.id,
          projectId,
          planVersion: OPTIMIZATION_PLAN_VERSION,
          recommendedActionType,
          sourceFactReferences,
          deterministicRank: rankedCandidate.deterministicRank,
          aiRankAdjustment: 0,
          historicalRankAdjustment: 0,
          finalRank: rankedCandidate.deterministicRank,
          advisoryContext,
          automationEligibility: false,
          explanation: {
            authority: 'P9_A_FIRST_PARTY_PLANNER',
            growth,
            action: {
              version: OPTIMIZATION_ACTION_MAP_VERSION,
              recommendedActionType,
            },
            market,
            advisoryMethods: advisoryContext.map(({ skillId, methodKey }) => ({ skillId, methodKey })),
            ai: {
              applied: false,
              fallback: false,
              adjustment: 0,
              annotation: null,
            },
          },
        },
        aiSeed: {
          candidateId: persistedCandidate.id,
          candidateKey: rankedCandidate.candidateKey,
          deterministicRank: rankedCandidate.deterministicRank,
          recommendedActionType,
          market,
          growth,
          advisoryContext,
          sourceFactReferences,
        },
        rankSeed: {
          candidateId: persistedCandidate.id,
          candidateKey: rankedCandidate.candidateKey,
          deterministicRank: rankedCandidate.deterministicRank,
        },
        marketScopeMode: rankedCandidate.marketScopeMode,
        marketCode: rankedCandidate.marketCode,
        locale: rankedCandidate.locale,
        recommendedActionType,
      }
    })

    if (options.useAi === true) {
      if (prepared.length === 0) {
        return { candidates, plans: [], aiTaskId: null }
      }
      const task = await this.aiTasks.createAndEnqueue(
        buildOptimizationPlanRankingTaskInput(projectId, prepared.map((item) => item.aiSeed)),
      )
      return {
        candidates,
        plans: [],
        aiTaskId: task.id,
      }
    }

    const planVersion = options.planVersion ?? OPTIMIZATION_PLAN_VERSION
    if (planVersion === OPTIMIZATION_PLAN_VERSION) {
      const plans: OptimizationPlan[] = []
      for (const item of prepared) {
        plans.push(await this.repository.createPlan(item.deterministicPlan))
      }
      return {
        candidates,
        plans,
        aiTaskId: null,
      }
    }

    if (planVersion !== OPTIMIZATION_PLAN_V2) {
      throw new Error(`Unsupported optimization plan version ${planVersion}`)
    }

    const frozenFeedback: FrozenFeedback[] = []
    for (const item of prepared) {
      const profile = await this.feedbackProfiles.findLatestProfileForScope({
        projectId,
        marketScopeMode: item.marketScopeMode,
        marketCode: item.marketCode,
        locale: item.locale,
        recommendedActionType: item.recommendedActionType,
      })
      if (compatibleFeedbackProfile(profile, projectId)) {
        frozenFeedback.push({
          profile,
          historicalRankAdjustment: profile.historicalRankAdjustment,
        })
      } else {
        frozenFeedback.push({ profile: null, historicalRankAdjustment: 0 })
      }
    }

    const historicalAdjustments = prepared.map((item, index) => ({
      candidateId: item.rankSeed.candidateId,
      adjustment: frozenFeedback[index]!.historicalRankAdjustment,
    }))
    const rankedV2 = applyFeedbackAwareRankAdjustments(
      prepared.map((item) => item.rankSeed),
      [],
      historicalAdjustments,
    )
    const rankedV2ByCandidate = new Map(rankedV2.map((item) => [item.candidateId, item] as const))

    const plans: OptimizationPlan[] = []
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index]!
      const feedback = frozenFeedback[index]!
      const rankResult = rankedV2ByCandidate.get(item.rankSeed.candidateId)
      if (!rankResult) {
        throw new Error('Feedback-aware optimization ranking result is missing a candidate')
      }
      const profile = feedback.profile
      const deterministicPlan: CreateOptimizationPlanInput = {
        ...item.deterministicPlan,
        planVersion: OPTIMIZATION_PLAN_V2,
        historicalRankAdjustment: rankResult.historicalRankAdjustment,
        finalRank: rankResult.finalRank,
        explanation: withFeedbackExplanation(item.deterministicPlan.explanation, {
          feedbackProfileId: profile?.id ?? null,
          feedbackProfileVersion: profile?.feedbackProfileVersion ?? null,
          feedbackInputFingerprint: profile?.inputFingerprint ?? null,
          feedbackSampleCount: profile?.sampleCount ?? null,
          historicalRankAdjustment: rankResult.historicalRankAdjustment,
          historicalFallback: rankResult.historicalFallback,
        }),
      }
      plans.push(await this.repository.createPlan(deterministicPlan))
    }

    return {
      candidates,
      plans,
      aiTaskId: null,
    }
  }
}

export const optimizationService = new OptimizationService()
