import type { OptimizationCandidate, OptimizationPlan } from '@prisma/client'
import { createAdvisorySkillRegistry } from '../advisory-skills/advisory-skill.registry.js'
import {
  buildOptimizationPlanRankingTaskInput,
  type OptimizationPlanRankingSeed,
} from '../ai/optimization-plan-ranking.js'
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js'
import { buildAdvisoryContext } from './optimization.advisory.js'
import { buildCandidateDrafts } from './optimization.candidate.js'
import { recommendedActionForGrowthType } from './optimization.policy.js'
import {
  OptimizationRepository,
  optimizationRepository,
  type CreateOptimizationPlanInput,
} from './optimization.repository.js'
import { rankEligibleCandidates } from './optimization.ranking.js'
import {
  OPTIMIZATION_ACTION_MAP_VERSION,
  OPTIMIZATION_PLAN_VERSION,
} from './optimization.types.js'

export type MaterializeOptimizationOptions = {
  advisoryRootDir: string
  useAi?: boolean
}

export type MaterializeOptimizationResult = {
  candidates: OptimizationCandidate[]
  plans: OptimizationPlan[]
  aiTaskId: string | null
}

type PreparedPlan = {
  deterministicPlan: CreateOptimizationPlanInput
  aiSeed: OptimizationPlanRankingSeed
}

export class OptimizationService {
  constructor(
    private readonly repository: OptimizationRepository = optimizationRepository,
    private readonly aiTasks: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService,
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
}

export const optimizationService = new OptimizationService()
