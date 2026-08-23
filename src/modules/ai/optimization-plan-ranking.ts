import { createHash } from 'node:crypto'
import type { AiTask, Prisma } from '@prisma/client'
import { z } from 'zod'
import type { CreateAiTaskInput } from './ai.service.js'
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js'
import {
  OptimizationRepository,
  optimizationRepository,
  type CreateOptimizationPlanInput,
} from '../optimization/optimization.repository.js'
import { applyBoundedRankAdjustments } from '../optimization/optimization.ranking.js'
import {
  OPTIMIZATION_ACTION_MAP_VERSION,
  OPTIMIZATION_PLAN_VERSION,
  type RecommendedActionType,
} from '../optimization/optimization.types.js'

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

const RecommendedActionSchema = z.enum([
  'ON_PAGE_OPTIMIZATION',
  'SERP_SNIPPET_OPTIMIZATION',
  'CONTENT_CREATION',
  'TECHNICAL_SEO_REMEDIATION',
  'GEO_CITABILITY_IMPROVEMENT',
  'AI_VISIBILITY_IMPROVEMENT',
  'CANNIBALIZATION_REMEDIATION',
  'CONTENT_REFRESH',
])

const SourceReferenceSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
}).strict()

const AdvisoryContextSchema = z.object({
  skillId: z.string().min(1),
  methodKey: z.string().min(1),
  authority: z.literal('ADVISORY_ONLY'),
  projectionSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceRepo: z.string().min(1),
  upstreamCommit: z.string().min(1),
  localVersion: z.string().min(1),
}).strict()

const RankingFactCandidateSchema = z.object({
  candidateId: z.string().uuid(),
  candidateKey: z.string().min(1),
  deterministicRank: z.number().int().positive(),
  recommendedActionType: RecommendedActionSchema,
  market: z.object({
    marketScopeMode: z.enum(['CONFIGURED_MARKET', 'UNCONFIGURED_LEGACY', 'INVALID_PROVENANCE']),
    marketCode: z.string().nullable(),
    locale: z.string().nullable(),
  }).strict(),
  growth: z.object({
    opportunityType: z.string().min(1),
    score: z.number(),
    priority: z.string().min(1),
    evidenceQuality: z.string().min(1),
    evidenceCoverage: z.number(),
  }).strict(),
  advisoryContext: z.array(AdvisoryContextSchema).max(20),
  sourceFactReferences: z.array(SourceReferenceSchema).max(200),
}).strict()

const RankingFactSnapshotSchema = z.object({
  version: z.literal('OPTIMIZATION_PLAN_RANKING_FACTS_V1'),
  authority: z.literal('P9_A_FIRST_PARTY_PLANNER'),
  candidates: z.array(RankingFactCandidateSchema).min(1).max(100),
}).strict()

type RankingFactCandidate = z.infer<typeof RankingFactCandidateSchema>

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

function asJson(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue
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

function parseRankingFacts(task: AiTask): z.infer<typeof RankingFactSnapshotSchema> {
  const parsed = RankingFactSnapshotSchema.safeParse(task.factSnapshot)
  if (!parsed.success) {
    throw new Error('Optimization ranking task facts do not match the first-party contract')
  }
  return parsed.data
}

function explanationFor(
  candidate: RankingFactCandidate,
  ai: { applied: boolean; fallback: boolean; adjustment: number; annotation: string | null },
) {
  return {
    authority: 'P9_A_FIRST_PARTY_PLANNER',
    growth: { ...candidate.growth },
    action: {
      version: OPTIMIZATION_ACTION_MAP_VERSION,
      recommendedActionType: candidate.recommendedActionType,
    },
    market: { ...candidate.market },
    advisoryMethods: candidate.advisoryContext.map(({ skillId, methodKey }) => ({ skillId, methodKey })),
    ai,
  }
}

function planInputFor(
  task: AiTask,
  candidate: RankingFactCandidate,
  ranking: { aiRankAdjustment: number; finalRank: number },
  ai: { applied: boolean; fallback: boolean; adjustment: number; annotation: string | null },
): CreateOptimizationPlanInput {
  return {
    candidateId: candidate.candidateId,
    projectId: task.projectId,
    planVersion: OPTIMIZATION_PLAN_VERSION,
    recommendedActionType: candidate.recommendedActionType,
    sourceFactReferences: candidate.sourceFactReferences.map((reference) => ({ ...reference })),
    deterministicRank: candidate.deterministicRank,
    aiRankAdjustment: ranking.aiRankAdjustment,
    historicalRankAdjustment: 0,
    finalRank: ranking.finalRank,
    advisoryContext: candidate.advisoryContext.map((method) => ({ ...method })),
    automationEligibility: false,
    explanation: explanationFor(candidate, ai),
  }
}

function assertExistingTransactionPlan(
  existing: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['optimizationPlan']['findUnique']>>>,
  input: CreateOptimizationPlanInput,
): void {
  const conflict = (
    existing.candidateId !== input.candidateId
    || existing.projectId !== input.projectId
    || existing.planVersion !== input.planVersion
    || existing.recommendedActionType !== input.recommendedActionType
    || existing.deterministicRank !== input.deterministicRank
    || existing.aiRankAdjustment !== input.aiRankAdjustment
    || existing.historicalRankAdjustment !== input.historicalRankAdjustment
    || existing.finalRank !== input.finalRank
    || existing.automationEligibility !== input.automationEligibility
    || canonicalJson(existing.sourceFactReferences) !== canonicalJson(input.sourceFactReferences)
    || canonicalJson(existing.advisoryContext) !== canonicalJson(input.advisoryContext)
    || canonicalJson(existing.explanation) !== canonicalJson(input.explanation)
  )
  if (conflict) throw new Error('Optimization plan immutable payload conflict')
}

async function createPlanInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateOptimizationPlanInput,
): Promise<void> {
  const candidate = await tx.optimizationCandidate.findUnique({
    where: { id: input.candidateId },
    select: { projectId: true },
  })
  if (!candidate) {
    throw new Error('Optimization candidate does not exist')
  }
  if (candidate.projectId !== input.projectId) {
    throw new Error('Optimization candidate project mismatch')
  }

  const existing = await tx.optimizationPlan.findUnique({
    where: {
      candidateId_planVersion: {
        candidateId: input.candidateId,
        planVersion: input.planVersion,
      },
    },
  })
  if (existing) {
    assertExistingTransactionPlan(existing, input)
    return
  }

  await tx.optimizationPlan.create({
    data: {
      candidateId: input.candidateId,
      projectId: input.projectId,
      planVersion: input.planVersion,
      recommendedActionType: input.recommendedActionType,
      sourceFactReferences: asJson(input.sourceFactReferences),
      deterministicRank: input.deterministicRank,
      aiRankAdjustment: input.aiRankAdjustment,
      historicalRankAdjustment: input.historicalRankAdjustment,
      finalRank: input.finalRank,
      advisoryContext: asJson(input.advisoryContext),
      automationEligibility: input.automationEligibility,
      explanation: asJson(input.explanation),
    },
  })
}

export async function materializeOptimizationRankingSuccess(
  task: AiTask,
  output: OptimizationPlanRankingOutput,
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (task.taskType !== 'OPTIMIZATION_PLAN_RANKING') {
    throw new Error('Optimization ranking materializer received the wrong AI task type')
  }

  const facts = parseRankingFacts(task)
  const desiredAdjustment = new Map(output.adjustments.map((item) => [item.candidateId, item.adjustment] as const))
  const annotationByCandidate = new Map(output.adjustments.map((item) => [item.candidateId, item.explanation] as const))
  const ranking = applyBoundedRankAdjustments(
    facts.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      candidateKey: candidate.candidateKey,
      deterministicRank: candidate.deterministicRank,
    })),
    output.adjustments.map(({ candidateId, adjustment }) => ({ candidateId, adjustment })),
  )
  const rankingByCandidate = new Map(ranking.map((item) => [item.candidateId, item] as const))
  const wholeSetFallback = ranking.some((item) => (
    item.aiRankAdjustment !== (desiredAdjustment.get(item.candidateId) ?? 0)
  ))

  for (const candidate of facts.candidates) {
    const ranked = rankingByCandidate.get(candidate.candidateId)
    if (!ranked) throw new Error('Optimization ranking result is missing a candidate')
    const ai = wholeSetFallback
      ? { applied: false, fallback: true, adjustment: 0, annotation: null }
      : {
        applied: true,
        fallback: false,
        adjustment: ranked.aiRankAdjustment,
        annotation: annotationByCandidate.get(candidate.candidateId) ?? null,
      }
    await createPlanInTransaction(tx, planInputFor(task, candidate, ranked, ai))
  }
}

export async function materializeOptimizationRankingFallback(
  task: AiTask,
  repository: OptimizationRepository = optimizationRepository,
): Promise<void> {
  if (task.taskType !== 'OPTIMIZATION_PLAN_RANKING') {
    throw new Error('Optimization ranking fallback received the wrong AI task type')
  }

  const facts = parseRankingFacts(task)
  for (const candidate of facts.candidates) {
    await repository.createPlan(planInputFor(
      task,
      candidate,
      { aiRankAdjustment: 0, finalRank: candidate.deterministicRank },
      { applied: false, fallback: true, adjustment: 0, annotation: null },
    ))
  }
}
