import type { OptimizationCandidate, OptimizationPlan } from '@prisma/client'
import { createAdvisorySkillRegistry } from '../advisory-skills/advisory-skill.registry.js'
import { buildAdvisoryContext } from './optimization.advisory.js'
import { buildCandidateDrafts } from './optimization.candidate.js'
import { recommendedActionForGrowthType } from './optimization.policy.js'
import {
  OptimizationRepository,
  optimizationRepository,
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

export class OptimizationService {
  constructor(
    private readonly repository: OptimizationRepository = optimizationRepository,
  ) {}

  async materializeProject(
    projectId: string,
    options: MaterializeOptimizationOptions,
  ): Promise<MaterializeOptimizationResult> {
    if (options.useAi === true) {
      throw new Error('P9-A AI ranking is not available in deterministic planning mode')
    }

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

    const planSeeds = ranked.map((rankedCandidate) => {
      const persistedCandidate = candidateByKey.get(rankedCandidate.candidateKey)
      if (!persistedCandidate) {
        throw new Error('Persisted optimization candidate missing for ranked draft')
      }

      const recommendedActionType = recommendedActionForGrowthType(rankedCandidate.opportunityType)
      if (!recommendedActionType) {
        throw new Error('Eligible optimization candidate has no supported action mapping')
      }

      const advisoryContext = buildAdvisoryContext({
        actionType: recommendedActionType,
        registry,
      })

      return {
        candidateId: persistedCandidate.id,
        projectId,
        planVersion: OPTIMIZATION_PLAN_VERSION,
        recommendedActionType,
        sourceFactReferences: rankedCandidate.sourceFactReferences.map((reference) => ({ ...reference })),
        deterministicRank: rankedCandidate.deterministicRank,
        aiRankAdjustment: 0,
        historicalRankAdjustment: 0,
        finalRank: rankedCandidate.deterministicRank,
        advisoryContext,
        automationEligibility: false,
        explanation: {
          authority: 'P9_A_FIRST_PARTY_PLANNER',
          growth: {
            opportunityType: rankedCandidate.opportunityType,
            score: rankedCandidate.growthScore,
            priority: rankedCandidate.growthPriority,
            evidenceQuality: rankedCandidate.growthEvidenceQuality,
            evidenceCoverage: rankedCandidate.growthEvidenceCoverage,
          },
          action: {
            version: OPTIMIZATION_ACTION_MAP_VERSION,
            recommendedActionType,
          },
          market: {
            marketScopeMode: rankedCandidate.marketScopeMode,
            marketCode: rankedCandidate.marketCode,
            locale: rankedCandidate.locale,
          },
          advisoryMethods: advisoryContext.map(({ skillId, methodKey }) => ({ skillId, methodKey })),
          ai: {
            applied: false,
            fallback: false,
            adjustment: 0,
            annotation: null,
          },
        },
      }
    })

    const plans: OptimizationPlan[] = []
    for (const seed of planSeeds) {
      plans.push(await this.repository.createPlan(seed))
    }

    return {
      candidates,
      plans,
      aiTaskId: null,
    }
  }
}

export const optimizationService = new OptimizationService()
