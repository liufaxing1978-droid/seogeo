import { createHash } from 'node:crypto'
import type { AiTask, Prisma } from '@prisma/client'
import { z } from 'zod'
import type { CreateAiTaskInput } from './ai.service.js'
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js'
import type { RecommendedActionType } from '../optimization/optimization.types.js'

export const OPTIMIZATION_PLAN_RANKING_PROMPT_ID = 'optimization-plan-ranking-v1' as const

const AdjustmentSchema = z.object({
  candidateId: z.string().uuid(),
  adjustment: z.number().int().min(-2).max(2),
  explanation: z.string().min(1).max(1000),
  sourceReferences: z.array(z.string().min(1)).max(40),
}).strict()

const OptimizationPlanRankingOutputSchema = z.object({
  adjustments: z.array(AdjustmentSchema).max(100),
  sourceReferences: z.array(z.string().min(1)).max(200),
}).strict()

export type OptimizationPlanRankingOutput = z.infer<typeof OptimizationPlanRankingOutputSchema>

export type OptimizationPlanRankingSeed = {
  candidateId: string
  candidateKey: string
  deterministicRank: number
  recommendedActionType: RecommendedActionType
  market: {
    marketScopeMode: 'CONFIGURED_MARKET' | 'UNCONFIGURED_LEGACY' | 'INVALID_PROVENANCE'
    marketCode: string | null
    locale: string | null
  }
  growth: {
    opportunityType: string
    score: number
    priority: string
    evidenceQuality: string
    evidenceCoverage: number
  }
  advisoryContext: Array<{
    skillId: string
    methodKey: string
    authority: 'ADVISORY_ONLY'
    projectionSha256: string
    sourceRepo: string
    upstreamCommit: string
    localVersion: string
  }>
  sourceFactReferences: Array<{ type: string; id: string }>
}

type Ref = { type: string; id: string }
type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  )
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function refKey(reference: Ref): string {
  return `${reference.type}:${reference.id}`
}

function sourceRefsFromJson(value: unknown): Ref[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const record = asRecord(raw)
    if (!record) return []
    const type = record.type
    const id = record.id
    return typeof type === 'string' && type.length > 0 && typeof id === 'string' && id.length > 0
      ? [{ type, id }]
      : []
  })
}

function candidateIdsFromFactSnapshot(value: unknown): Set<string> {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.candidates)) return new Set()
  return new Set(root.candidates.flatMap((raw) => {
    const candidate = asRecord(raw)
    return typeof candidate?.candidateId === 'string' ? [candidate.candidateId] : []
  }))
}

function normalizeSeeds(seeds: readonly OptimizationPlanRankingSeed[]): OptimizationPlanRankingSeed[] {
  if (seeds.length === 0) throw new Error('Optimization ranking requires at least one candidate')
  if (seeds.length > 100) throw new Error('Optimization ranking accepts at most 100 candidates')

  const ids = new Set<string>()
  for (const seed of seeds) {
    if (ids.has(seed.candidateId)) throw new Error(`Duplicate optimization ranking candidate ${seed.candidateId}`)
    ids.add(seed.candidateId)
    if (!Number.isInteger(seed.deterministicRank) || seed.deterministicRank < 1) {
      throw new Error('Optimization ranking deterministicRank must be a positive integer')
    }
    if (!Number.isFinite(seed.growth.score)) {
      throw new Error('Optimization ranking seed score must be finite')
    }
  }

  return [...seeds].sort(
    (left, right) => left.candidateId.localeCompare(right.candidateId)
      || left.candidateKey.localeCompare(right.candidateKey),
  )
}

export function buildOptimizationPlanRankingTaskInput(
  projectId: string,
  seeds: readonly OptimizationPlanRankingSeed[],
): CreateAiTaskInput {
  const normalizedSeeds = normalizeSeeds(seeds)
  const sourceReferenceMap = new Map<string, Ref>()

  const candidates = normalizedSeeds.map((seed) => {
    for (const reference of seed.sourceFactReferences) {
      sourceReferenceMap.set(refKey(reference), { ...reference })
    }

    return {
      candidateId: seed.candidateId,
      candidateKey: seed.candidateKey,
      deterministicRank: seed.deterministicRank,
      recommendedActionType: seed.recommendedActionType,
      market: { ...seed.market },
      growth: { ...seed.growth },
      advisoryContext: seed.advisoryContext.map((method) => ({
        skillId: method.skillId,
        methodKey: method.methodKey,
        authority: method.authority,
        projectionSha256: method.projectionSha256,
        sourceRepo: method.sourceRepo,
        upstreamCommit: method.upstreamCommit,
        localVersion: method.localVersion,
      })),
      sourceFactReferences: seed.sourceFactReferences.map((reference) => ({ ...reference })),
    }
  })

  const sourceReferences = [...sourceReferenceMap.values()].sort(
    (left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  )

  const factSnapshot = {
    version: 'OPTIMIZATION_PLAN_RANKING_FACTS_V1',
    authority: 'P9_A_FIRST_PARTY_PLANNER',
    candidates,
  }
  const seedSetHash = createHash('sha256').update(canonicalJson(factSnapshot)).digest('hex')

  return {
    projectId,
    taskType: 'OPTIMIZATION_PLAN_RANKING',
    requestKey: `optimization-plan-ranking:${seedSetHash}:${OPTIMIZATION_PLAN_RANKING_PROMPT_ID}`,
    promptVersion: OPTIMIZATION_PLAN_RANKING_PROMPT_ID,
    factSnapshot: canonicalize(factSnapshot) as Prisma.InputJsonValue,
    sourceReferences: canonicalize(sourceReferences) as Prisma.InputJsonValue,
  }
}

export function parseOptimizationPlanRankingOutput(
  content: string,
  task: Pick<AiTask, 'factSnapshot' | 'sourceReferences'> | {
    factSnapshot: unknown
    sourceReferences: unknown
  },
): OptimizationPlanRankingOutput {
  const output = parseStructuredOutput(content, OptimizationPlanRankingOutputSchema)
  const allowedCandidateIds = candidateIdsFromFactSnapshot(task.factSnapshot)
  const allowedSourceReferences = new Set(sourceRefsFromJson(task.sourceReferences).map(refKey))
  const seenCandidates = new Set<string>()

  for (const item of output.adjustments) {
    if (!allowedCandidateIds.has(item.candidateId)) {
      throw new AiOutputValidationError('AI output contains an unknown optimization candidate')
    }
    if (seenCandidates.has(item.candidateId)) {
      throw new AiOutputValidationError('AI output contains a duplicate optimization candidate')
    }
    seenCandidates.add(item.candidateId)

    if (item.sourceReferences.some((reference) => !allowedSourceReferences.has(reference))) {
      throw new AiOutputValidationError('AI output contains a source reference that was not supplied')
    }
  }

  if (output.sourceReferences.some((reference) => !allowedSourceReferences.has(reference))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied')
  }

  return output
}
