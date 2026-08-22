# P9-A Optimization Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a P7-authoritative immutable optimization planner that materializes market-aware candidates, ranks eligible work deterministically, packages integrity-checked advisory method provenance, optionally applies bounded DeepSeek reranking, and freezes `OptimizationPlan` artifacts without owning P8 risk or execution.

**Architecture:** P9-A reads only persisted P7 Growth identities/latest snapshots/lifecycle as authoritative opportunity input. Pure first-party modules project market provenance, eligibility, action class, candidate identity, and deterministic rank; immutable Prisma rows persist candidates/plans; P9-0H contributes projection-only advisory provenance; the existing AI gateway optionally supplies strict `[-2,+2]` adjustments and falls back to zero without blocking deterministic frozen plans.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, Zod 3.25, Vitest 3.2, existing DeepSeek AI gateway/BullMQ AI queue, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-a-optimization-planner-design.md`

## Global Constraints

- Base is `main@60c9dbf56c23d4b7644913e123383538d6f8699c`; branch is `feat/p9-a-optimization-planner`.
- Never write implementation directly to `main`.
- P7 Growth remains authoritative for opportunity identity, score, priority, evidence, lifecycle, and UNKNOWN semantics.
- P9-A never reads P5/P6/Search Facts to synthesize a second opportunity universe and never calls P7 score/detector implementations.
- Unknown/missing P7 values remain unknown; they are never converted to zero or inferred success/failure.
- P8 remains authoritative for risk class, approval, PublicationPlan, preview, mutation, Draft PR execution, verification, rollback, merge, and deploy.
- `automationEligibility` is always `false` in P9-A V1.
- P9-0H skills remain `ADVISORY_ONLY`; only first-party projection identities/provenance may enter planner artifacts.
- No raw vendor Markdown is persisted as planner instructions, imported, executed, or sent to DeepSeek as authority.
- No new optimization BullMQ queue, cron, event bus, or daily reconciliation; P9-B owns orchestration.
- No HTTP route in P9-A V1.
- DeepSeek may only adjust already-eligible ordering by integer `[-2,+2]`; it cannot change facts, eligibility, action, market, score, risk, or approval.
- Accepted AI output must also satisfy `abs(finalRank - deterministicRank) <= 2` for every candidate; otherwise the entire adjustment set falls back to zero.
- `historicalRankAdjustment = 0` for all P9-A V1 plans.
- Candidate and plan rows are database-immutable through P9-A-specific PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- Migrations are forward-only during implementation: Task 2 creates planner tables; Task 6 creates a later migration for the new AI enum. Never edit an already-applied migration to add Task 6 state.
- Final exact PR head must pass `verify`, `production-audit`, and `e2e`. Do not merge without a separate explicit human `合并` instruction.

## File Structure

Prisma:
- `prisma/models/optimization.prisma` — planner enums/models.
- `prisma/schema.prisma` — root Prisma client schema mirror.
- `prisma/models/ai-gateway.prisma` — add `OPTIMIZATION_PLAN_RANKING` in Task 6.
- `prisma/migrations/20260822151000_add_p9a_optimization_planner/migration.sql` — planner tables/indexes/FKs/immutability.
- `prisma/migrations/20260822152000_add_p9a_optimization_ai_task_type/migration.sql` — forward-only AI enum addition.

Planner:
- `src/modules/optimization/optimization.types.ts`
- `src/modules/optimization/optimization.policy.ts`
- `src/modules/optimization/optimization.provenance.ts`
- `src/modules/optimization/optimization.candidate.ts`
- `src/modules/optimization/optimization.ranking.ts`
- `src/modules/optimization/optimization.advisory.ts`
- `src/modules/optimization/optimization.repository.ts`
- `src/modules/optimization/optimization.service.ts`

AI:
- `src/modules/ai/optimization-plan-ranking.ts`
- `src/modules/ai/prompts/prompt-registry.ts`
- `src/modules/ai/ai.worker.ts`

Tests/docs:
- `tests/unit/optimization.policy.test.ts`
- `tests/unit/optimization.provenance.test.ts`
- `tests/unit/optimization.ranking.test.ts`
- `tests/unit/optimization.advisory.test.ts`
- `tests/unit/optimization.boundary.test.ts`
- `tests/integration/optimization.persistence.test.ts`
- `tests/integration/optimization.materialization.test.ts`
- `tests/integration/optimization.ai-ranking.test.ts`
- `tests/integration/optimization.service.test.ts`
- `docs/development/p9-a-optimization-planner.md`

---

### Task 1: Lock pure planner contracts, market provenance, eligibility, action map, and candidate identity

**Files:**
- Create: `tests/unit/optimization.policy.test.ts`
- Create: `tests/unit/optimization.provenance.test.ts`
- Create: `src/modules/optimization/optimization.types.ts`
- Create: `src/modules/optimization/optimization.policy.ts`
- Create: `src/modules/optimization/optimization.provenance.ts`
- Create: `src/modules/optimization/optimization.candidate.ts`

**Interfaces:**

```ts
export const OPTIMIZATION_CANDIDATE_VERSION = 'OPTIMIZATION_CANDIDATE_V1' as const
export const OPTIMIZATION_PLAN_VERSION = 'OPTIMIZATION_PLAN_V1' as const
export const OPTIMIZATION_ACTION_MAP_VERSION = 'OPTIMIZATION_ACTION_MAP_V1' as const

export type OptimizationMarketScopeMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY'
  | 'INVALID_PROVENANCE'

export type OptimizationEligibilityState = 'ELIGIBLE' | 'INELIGIBLE'

export type OptimizationEligibilityReason =
  | 'INVALID_MARKET_PROVENANCE'
  | 'SOURCE_PROVENANCE_MISSING'
  | 'GROWTH_NOT_RANKING_ELIGIBLE'
  | 'GROWTH_SCORE_UNKNOWN'
  | 'GROWTH_SCORE_MISSING'
  | 'GROWTH_LIFECYCLE_TERMINAL'
  | 'UNSUPPORTED_OPPORTUNITY_TYPE'

export type RecommendedActionType =
  | 'ON_PAGE_OPTIMIZATION'
  | 'SERP_SNIPPET_OPTIMIZATION'
  | 'CONTENT_CREATION'
  | 'TECHNICAL_SEO_REMEDIATION'
  | 'GEO_CITABILITY_IMPROVEMENT'
  | 'AI_VISIBILITY_IMPROVEMENT'
  | 'CANNIBALIZATION_REMEDIATION'
  | 'CONTENT_REFRESH'
```

Pure functions:

```ts
export function projectGrowthMarketScopes(sourceProvenance: unknown): {
  scopes: Array<{
    marketScopeMode: OptimizationMarketScopeMode
    marketCode: string | null
    locale: string | null
  }>
  provenanceReasonCodes: OptimizationEligibilityReason[]
}

export function buildOptimizationCandidateKey(input: {
  projectId: string
  growthOpportunityIdentityId: string
  growthSnapshotId: string
  marketScopeMode: OptimizationMarketScopeMode
  marketCode: string | null
  locale: string | null
}): string

export function recommendedActionForGrowthType(type: string): RecommendedActionType | null

export function evaluateOptimizationEligibility(input: {
  marketScopeMode: OptimizationMarketScopeMode
  provenanceReasonCodes: readonly OptimizationEligibilityReason[]
  growthRankingEligible: boolean
  growthScoreState: string
  growthScore: number | null
  growthLifecycleStatus: string
  opportunityType: string
}): { state: OptimizationEligibilityState; reasonCodes: OptimizationEligibilityReason[] }
```

- [ ] **Step 1: Write test-only RED**

`optimization.policy.test.ts` locks every V1 action mapping and fail-closed eligibility:

```ts
it('maps every P7 V1 opportunity type deterministically', () => {
  expect(recommendedActionForGrowthType('RANKING_UPSIDE')).toBe('ON_PAGE_OPTIMIZATION')
  expect(recommendedActionForGrowthType('CTR_UNDERPERFORMANCE')).toBe('SERP_SNIPPET_OPTIMIZATION')
  expect(recommendedActionForGrowthType('CONTENT_GAP')).toBe('CONTENT_CREATION')
  expect(recommendedActionForGrowthType('NEW_CONTENT_OPPORTUNITY')).toBe('CONTENT_CREATION')
  expect(recommendedActionForGrowthType('SEO_GAP')).toBe('TECHNICAL_SEO_REMEDIATION')
  expect(recommendedActionForGrowthType('GEO_CITABILITY_GAP')).toBe('GEO_CITABILITY_IMPROVEMENT')
  expect(recommendedActionForGrowthType('AI_VISIBILITY_GAP')).toBe('AI_VISIBILITY_IMPROVEMENT')
  expect(recommendedActionForGrowthType('KEYWORD_CANNIBALIZATION')).toBe('CANNIBALIZATION_REMEDIATION')
  expect(recommendedActionForGrowthType('DECLINING_PERFORMANCE')).toBe('CONTENT_REFRESH')
  expect(recommendedActionForGrowthType('FUTURE_UNKNOWN')).toBeNull()
})

it('keeps UNKNOWN score ineligible instead of converting it to zero', () => {
  expect(evaluateOptimizationEligibility({
    marketScopeMode: 'UNCONFIGURED_LEGACY', provenanceReasonCodes: [],
    growthRankingEligible: true, growthScoreState: 'UNKNOWN', growthScore: null,
    growthLifecycleStatus: 'NEW', opportunityType: 'RANKING_UPSIDE'
  })).toEqual({
    state: 'INELIGIBLE',
    reasonCodes: ['GROWTH_SCORE_UNKNOWN', 'GROWTH_SCORE_MISSING']
  })
})
```

`optimization.provenance.test.ts` locks configured fan-out, legacy null scope, invalid audit scope, dedupe/sort, and candidate-key determinism:

```ts
it('projects P9-0G configured market scopes', () => {
  const result = projectGrowthMarketScopes({ searchFacts: {
    version: 'GROWTH_SEARCH_PROVENANCE_V1', mode: 'CONFIGURED_MARKET',
    scoringLane: { marketProjections: [
      { marketCode: 'GLOBAL', locale: 'en', propertyRef: 'gsc:site' },
      { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' }
    ] }
  } })
  expect(result.scopes).toEqual([
    { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'CN', locale: 'zh-CN' },
    { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'GLOBAL', locale: 'en' }
  ])
  expect(result.provenanceReasonCodes).toEqual([])
})

it('creates one invalid provenance scope without inventing a market', () => {
  expect(projectGrowthMarketScopes({})).toEqual({
    scopes: [{ marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }],
    provenanceReasonCodes: ['SOURCE_PROVENANCE_MISSING']
  })
})
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts
```

Expected: module-resolution/type failure because `src/modules/optimization/*` does not exist. Commit this test-only RED before production code.

- [ ] **Step 3: Implement minimal pure production modules**

`optimization.policy.ts` uses frozen first-party maps and stable reason ordering. `INVALID_PROVENANCE` always forces `INELIGIBLE`. `DONE`, `DISMISSED`, `RESOLVED` are terminal; `NEW`, `REVIEWED`, `PLANNED`, `IN_PROGRESS`, `REOPENED` are not terminal.

`optimization.provenance.ts` accepts only the P9-0G V1 shape. `CONFIGURED_MARKET` requires at least one non-empty `marketCode`/`locale`; exact pairs are deduped and sorted. `UNCONFIGURED_LEGACY` always returns one null scope. Missing/malformed/contradictory data returns one `INVALID_PROVENANCE` null scope plus stable reason codes; project defaults are never consulted.

`optimization.candidate.ts` recursively canonicalizes object keys and SHA-256 hashes exactly the identity fields from the spec. Score, priority, advisory content, and timestamps never enter the key.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

`feat: add P9-A planner contracts`

---

### Task 2: Add immutable planner tables and repository persistence

**Files:**
- Create: `prisma/models/optimization.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822151000_add_p9a_optimization_planner/migration.sql`
- Create: `src/modules/optimization/optimization.repository.ts`
- Create: `tests/integration/optimization.persistence.test.ts`

**Interfaces:**

Prisma enums:

```prisma
enum OptimizationMarketScopeMode {
  CONFIGURED_MARKET
  UNCONFIGURED_LEGACY
  INVALID_PROVENANCE
}

enum OptimizationEligibilityState {
  ELIGIBLE
  INELIGIBLE
}

enum RecommendedActionType {
  ON_PAGE_OPTIMIZATION
  SERP_SNIPPET_OPTIMIZATION
  CONTENT_CREATION
  TECHNICAL_SEO_REMEDIATION
  GEO_CITABILITY_IMPROVEMENT
  AI_VISIBILITY_IMPROVEMENT
  CANNIBALIZATION_REMEDIATION
  CONTENT_REFRESH
}
```

Use existing P7 enums for `GrowthOpportunityType`, `GrowthScoreState`, `GrowthPriority`, `GrowthEvidenceQuality`, and `GrowthLifecycleStatus` instead of duplicating them.

Repository surface:

```ts
export class OptimizationRepository {
  listLatestGrowthInputs(projectId: string): Promise<GrowthPlannerSource[]>
  createCandidate(input: CreateOptimizationCandidateInput): Promise<OptimizationCandidate>
  getCandidateByKey(projectId: string, candidateKey: string): Promise<OptimizationCandidate | null>
  listCandidates(projectId: string): Promise<OptimizationCandidate[]>
  createPlan(input: CreateOptimizationPlanInput): Promise<OptimizationPlan>
  getPlan(candidateId: string, planVersion: string): Promise<OptimizationPlan | null>
  listPlans(projectId: string): Promise<OptimizationPlan[]>
}
```

No update/delete methods.

- [ ] **Step 1: Write persistence RED**

Create DB fixtures and final assertions for candidate/plan idempotency plus trigger rejection:

```ts
const first = await repository.createCandidate(validCandidateInput)
const second = await repository.createCandidate(validCandidateInput)
expect(second.id).toBe(first.id)

await expect(prisma.optimizationCandidate.update({
  where: { id: first.id }, data: { normalizedQuery: 'mutated' }
})).rejects.toThrow()
await expect(prisma.optimizationCandidate.delete({ where: { id: first.id } })).rejects.toThrow()
```

Repeat UPDATE/DELETE rejection for `OptimizationPlan`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.persistence.test.ts
```

Expected: missing Prisma models/repository.

- [ ] **Step 3: Add schema + first forward migration**

`OptimizationCandidate` includes all spec fields and:

```prisma
@@unique([projectId, candidateKey], map: "OptimizationCandidate_project_key")
@@index([projectId, eligibilityState, createdAt], map: "OptimizationCandidate_project_eligibility_idx")
@@index([growthOpportunityIdentityId, growthSnapshotId], map: "OptimizationCandidate_growth_source_idx")
```

`OptimizationPlan` includes all spec fields and:

```prisma
@@unique([candidateId, planVersion], map: "OptimizationPlan_candidate_version")
@@index([projectId, finalRank, createdAt], map: "OptimizationPlan_project_rank_idx")
```

Use bounded `Json` fields for `sourceProvenance`, `eligibilityReasonCodes`, `sourceFactReferences`, `advisoryContext`, `explanation`; `Int` for ranks/adjustments; `Boolean @default(false)` for `automationEligibility`.

Migration FKs reference `Project`, `GrowthOpportunityIdentity`, `GrowthOpportunitySnapshot`, and candidate→plan with `ON DELETE RESTRICT`. Add dedicated immutability function/triggers:

```sql
CREATE OR REPLACE FUNCTION "reject_p9a_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-A immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationCandidate_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationCandidate"
FOR EACH ROW EXECUTE FUNCTION "reject_p9a_immutable_mutation"();

CREATE TRIGGER "OptimizationPlan_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationPlan"
FOR EACH ROW EXECUTE FUNCTION "reject_p9a_immutable_mutation"();
```

Do not modify P8's function/triggers.

- [ ] **Step 4: Implement repository**

`listLatestGrowthInputs` reads one latest snapshot per Growth identity ordered `currentWindowEnd desc`, `createdAt desc`, `id desc`, including identity/lifecycle/snapshot fields, sourceProvenance, and bounded evidence references. It does not call GrowthService, score functions, or detectors.

`createCandidate`/`createPlan` are idempotent on unique identity. On collision, return the exact stored row only after validating project/source identity; never update an immutable row.

- [ ] **Step 5: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run tests/integration/optimization.persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

`feat: persist immutable P9-A planner artifacts`

---

### Task 3: Materialize audit candidates from latest persisted P7 snapshots

**Files:**
- Modify: `src/modules/optimization/optimization.candidate.ts`
- Create: `tests/integration/optimization.materialization.test.ts`

**Interfaces:**

```ts
export type GrowthPlannerSource = {
  projectId: string
  identityId: string
  snapshotId: string
  snapshotVersion: string
  formulaVersion: string
  opportunityType: string
  normalizedQuery: string
  canonicalPage: string | null
  growthScore: number | null
  growthScoreState: string
  growthPriority: string
  growthEvidenceQuality: string
  growthEvidenceCoverage: number
  growthRankingEligible: boolean
  growthLifecycleStatus: string
  sourceProvenance: unknown
  sourceFactReferences: Array<{ type: string; id: string }>
}

export function buildCandidateDrafts(source: GrowthPlannerSource): OptimizationCandidateDraft[]
```

- [ ] **Step 1: Write materialization RED**

Lock:
1. configured CN/zh-CN + GLOBAL/en → two candidates;
2. duplicate exact projection → one candidate;
3. legacy → one null-market candidate;
4. missing/malformed provenance → one `INVALID_PROVENANCE` ineligible candidate with null market/locale and no plan eligibility;
5. terminal lifecycle and UNKNOWN score still persist audit candidates as ineligible;
6. unchanged rerun is idempotent;
7. newer Growth snapshot creates a new candidate and never rewrites the prior row.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.materialization.test.ts
```

Expected: source→candidate orchestration missing.

- [ ] **Step 3: Implement candidate draft materialization**

For each projected scope, compute stable key and eligibility. Copy only bounded stored P7 fields and source reference identities. Do not embed arbitrary provider payloads or raw evidence bodies. `INVALID_PROVENANCE` is ineligible before action/ranking work.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts tests/integration/optimization.materialization.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

`feat: materialize P9-A optimization candidates`

---

### Task 4: Add deterministic ranking and projection-only advisory packaging

**Files:**
- Create: `src/modules/optimization/optimization.ranking.ts`
- Create: `src/modules/optimization/optimization.advisory.ts`
- Create: `tests/unit/optimization.ranking.test.ts`
- Create: `tests/unit/optimization.advisory.test.ts`

**Interfaces:**

```ts
export type RankedCandidate = OptimizationCandidateDraft & { deterministicRank: number }
export function rankEligibleCandidates(candidates: readonly OptimizationCandidateDraft[]): RankedCandidate[]

export type AdvisoryPlanContext = Array<{
  skillId: string
  methodKey: string
  authority: 'ADVISORY_ONLY'
  projectionSha256: string
  sourceRepo: string
  upstreamCommit: string
  localVersion: string
}>

export function buildAdvisoryContext(input: {
  actionType: RecommendedActionType
  registry: AdvisorySkillRegistry
}): AdvisoryPlanContext
```

- [ ] **Step 1: Write ranking/advisory RED**

Ranking tests lock score-desc, priority ordinal, coverage-desc, candidateKey tiebreak, and exclusion of ineligible candidates. Advisory tests use a fake registry and assert exact action→method mapping, deterministic order, exact bounded provenance fields, `ADVISORY_ONLY`, and absence of projection steps/raw bodies.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/unit/optimization.advisory.test.ts
```

Expected: missing production modules.

- [ ] **Step 3: Implement ranking**

```ts
const PRIORITY_ORDER = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, MONITOR: 4, UNKNOWN: 5
} as const
```

Sort eligible candidates by `growthScore desc`, priority asc, evidenceCoverage desc, candidateKey asc; assign 1-based rank. Never compute another opportunity score.

- [ ] **Step 4: Implement advisory packaging**

Use the exact action→method map from the spec and `registry.getByMethodKeys(...)`. Every requested method must exist exactly once. Missing/duplicate/integrity errors abort plan packaging. Persist only method/provenance identity fields.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/unit/optimization.advisory.test.ts tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

`feat: rank and package P9-A advisory plans`

---

### Task 5: Freeze deterministic zero-AI OptimizationPlans

**Files:**
- Modify: `src/modules/optimization/optimization.repository.ts`
- Create: `src/modules/optimization/optimization.service.ts`
- Create: `tests/integration/optimization.service.test.ts`

**Interfaces:**

```ts
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
  materializeProject(
    projectId: string,
    options: MaterializeOptimizationOptions
  ): Promise<MaterializeOptimizationResult>
}
```

For `useAi !== true`, persist plans with exactly:

```text
planVersion = OPTIMIZATION_PLAN_V1
aiRankAdjustment = 0
historicalRankAdjustment = 0
finalRank = deterministicRank
automationEligibility = false
```

- [ ] **Step 1: Write service RED**

Build P7 fixtures and call `materializeProject(..., { advisoryRootDir, useAi: false })`. Require all audit candidates persisted, plans only for eligible candidates, deterministic action/advisory provenance, `aiTaskId === null`, idempotent rerun, and unchanged P8 publication table counts.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.service.test.ts
```

Expected: service missing.

- [ ] **Step 3: Implement first-party frozen explanation**

```ts
{
  authority: 'P9_A_FIRST_PARTY_PLANNER',
  growth: { opportunityType, score, priority, evidenceQuality, evidenceCoverage },
  action: { version: 'OPTIMIZATION_ACTION_MAP_V1', recommendedActionType },
  market: { marketScopeMode, marketCode, locale },
  advisoryMethods: advisoryContext.map(({ skillId, methodKey }) => ({ skillId, methodKey })),
  ai: { applied: false, fallback: false, adjustment: 0, annotation: null }
}
```

No raw P7 evidence text or vendor projection body.

- [ ] **Step 4: Implement zero-AI plan persistence**

Existing `(candidateId, OPTIMIZATION_PLAN_V1)` must be returned only when immutable payload identity is consistent; conflicting content fails closed rather than updating it.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/integration/optimization.service.test.ts tests/integration/optimization.persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

`feat: freeze deterministic P9-A plans`

---

### Task 6: Add the DeepSeek ranking task with a separate forward migration

**Files:**
- Modify: `prisma/models/ai-gateway.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822152000_add_p9a_optimization_ai_task_type/migration.sql`
- Create: `src/modules/ai/optimization-plan-ranking.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Create: `tests/integration/optimization.ai-ranking.test.ts`

**Interfaces:**

Add exactly:

```prisma
OPTIMIZATION_PLAN_RANKING
```

to `AiTaskType` through the **new** Task 6 migration:

```sql
ALTER TYPE "AiTaskType" ADD VALUE 'OPTIMIZATION_PLAN_RANKING';
```

Do not edit `20260822151000_add_p9a_optimization_planner` after Task 2 has been applied.

Prompt/task contract:

```ts
export const OPTIMIZATION_PLAN_RANKING_PROMPT_ID = 'optimization-plan-ranking-v1'

const OptimizationPlanRankingOutputSchema = z.object({
  adjustments: z.array(z.object({
    candidateId: z.string().uuid(),
    adjustment: z.number().int().min(-2).max(2),
    explanation: z.string().min(1).max(1000),
    sourceReferences: z.array(z.string().min(1)).max(40)
  }).strict()).max(100),
  sourceReferences: z.array(z.string().min(1)).max(200)
}).strict()

export function parseOptimizationPlanRankingOutput(
  content: string,
  task: Pick<AiTask, 'factSnapshot' | 'sourceReferences'>
): OptimizationPlanRankingOutput

export function buildOptimizationPlanRankingTaskInput(
  projectId: string,
  seeds: readonly OptimizationPlanSeed[]
): CreateAiTaskInput
```

- [ ] **Step 1: Write AI contract RED**

Test valid output plus: ±3 reject, duplicate candidate reject, unknown candidate reject, unknown object fields reject, unsupplied source ref reject. Assert task factSnapshot contains only candidate facts/action/ranks/market/advisory identities and contains neither vendor raw content nor P8 risk/approval state.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.ai-ranking.test.ts
```

Expected: missing enum/module/prompt.

- [ ] **Step 3: Add forward migration and prompt registry entry**

Prompt states: ranking advice only; never invent facts; never alter eligibility/action/score/market/risk/approval; return strict JSON. Follow existing JSON/REASONING prompt conventions.

- [ ] **Step 4: Implement task builder/parser**

Use a deterministic seed-set hash over sorted candidate ids and immutable seed fields:

```ts
requestKey: `optimization-plan-ranking:${seedSetHash}:${OPTIMIZATION_PLAN_RANKING_PROMPT_ID}`
```

Source refs are first-party `TYPE:id` strings and output refs must be a subset.

- [ ] **Step 5: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run tests/integration/optimization.ai-ranking.test.ts
npm run typecheck
```

Expected: both forward migrations apply and test passes.

- [ ] **Step 6: Commit**

`feat: add bounded P9-A DeepSeek ranking task`

---

### Task 7: Materialize AI-ranked plans and deterministic failure fallback

**Files:**
- Modify: `src/modules/optimization/optimization.ranking.ts`
- Modify: `src/modules/ai/optimization-plan-ranking.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/modules/optimization/optimization.service.ts`
- Modify: `tests/unit/optimization.ranking.test.ts`
- Modify: `tests/integration/optimization.ai-ranking.test.ts`
- Modify: `tests/integration/optimization.service.test.ts`

**Interfaces:**

```ts
export function applyBoundedRankAdjustments(
  ranked: readonly RankedCandidate[],
  adjustments: readonly { candidateId: string; adjustment: number }[]
): Array<{
  candidateId: string
  deterministicRank: number
  aiRankAdjustment: number
  finalRank: number
}>

export async function materializeOptimizationRankingSuccess(
  task: AiTask,
  output: OptimizationPlanRankingOutput,
  tx: Prisma.TransactionClient
): Promise<void>

export async function materializeOptimizationRankingFallback(task: AiTask): Promise<void>
```

- [ ] **Step 1: Write RED for rank direction/displacement/fallback**

Require: negative adjustment improves signal; positive worsens; ties use deterministic rank then key; accepted final displacement ≤2; violating set falls back all-zero; worker success freezes adjusted plans; provider error/invalid output leaves failed AI task auditable and then idempotently freezes zero-adjustment plans; fallback never changes eligibility/action/advisory context.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/integration/optimization.ai-ranking.test.ts tests/integration/optimization.service.test.ts
```

Expected: missing worker materializer/fallback behavior.

- [ ] **Step 3: Implement bounded rank application**

Missing candidate adjustments default to 0. Compute `adjustedRankSignal = deterministicRank + aiRankAdjustment`, sort by signal asc then deterministic rank asc then key asc, assign final ordinals, then enforce displacement ≤2. Any violation rejects the set and returns all-zero ranking.

- [ ] **Step 4: Wire exhaustive AI worker switches**

In `ai.worker.ts` add:
- `expectedPromptId` → `optimization-plan-ranking-v1`;
- `resultSummary` → `Optimization plan ranking completed.`;
- `parseTaskOutput` → strict optimization parser;
- successful completion transaction → `materializeOptimizationRankingSuccess`.

- [ ] **Step 5: Wire worker failure fallback**

After existing durable `failRun(...)`, if task type is `OPTIMIZATION_PLAN_RANKING`, call idempotent `materializeOptimizationRankingFallback(task)`. It creates only P9-A plans. If fallback fails, surface failure; never create P8 artifacts.

- [ ] **Step 6: Wire service AI mode**

For `useAi: true`, persist candidates, rank eligible seeds, package advisory context, create/enqueue exactly one existing AI-queue task, return `plans: []` and its `aiTaskId`; worker success/fallback later freezes plans. No optimization queue is added.

- [ ] **Step 7: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/integration/optimization.ai-ranking.test.ts tests/integration/optimization.service.test.ts tests/integration/ai.worker-execution.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

`feat: materialize bounded P9-A AI ranking`

---

### Task 8: Lock P7/P8/advisory/runtime authority boundaries

**Files:**
- Create: `tests/unit/optimization.boundary.test.ts`
- Modify production only if a boundary test finds a real leak.

- [ ] **Step 1: Write boundary tests**

```ts
it('optimization modules do not import P7 score or detector implementations')
it('optimization modules do not import P8 mutation approval execution verification or Git adapters')
it('optimization modules expose no merge deploy rollback or Draft PR operation')
it('optimization modules add no BullMQ optimization queue cron or event-bus ownership')
it('advisory context contains no raw projection body or executable handle')
it('AI ranking schema has no risk approval score evidence or action override fields')
it('P7 score evidence and lifecycle are unchanged by planner materialization')
it('P8 publication row counts are unchanged by planner materialization')
```

Type-only imports are allowed when they provide no mutation authority. Prefer planner repository reads over GrowthService imports.

- [ ] **Step 2: Verify boundary suite**

```bash
npx vitest run tests/unit/optimization.boundary.test.ts tests/unit/advisory-skill.boundary.test.ts
```

If a leak is RED, make the minimum fix.

- [ ] **Step 3: Run focused P9-A suite**

```bash
npx vitest run \
  tests/unit/optimization.policy.test.ts \
  tests/unit/optimization.provenance.test.ts \
  tests/unit/optimization.ranking.test.ts \
  tests/unit/optimization.advisory.test.ts \
  tests/unit/optimization.boundary.test.ts \
  tests/integration/optimization.persistence.test.ts \
  tests/integration/optimization.materialization.test.ts \
  tests/integration/optimization.ai-ranking.test.ts \
  tests/integration/optimization.service.test.ts \
  tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Use `test: lock P9-A planner authority boundaries` if test-only; otherwise a narrowly named `fix:` commit followed by the same verification.

---

### Task 9: Development documentation and full regression

**Files:**
- Create: `docs/development/p9-a-optimization-planner.md`

- [ ] **Step 1: Document the operational contract**

Cover: P7 input authority; candidate/plan identities; all three market modes; eligibility reasons/terminal states; action map; deterministic rank; advisory mapping/provenance/integrity failure; DeepSeek bounds and zero fallback; immutability/idempotency; `automationEligibility=false`; P8 boundary; P9-B/P9-C handoffs; additive migration/revert policy without rewriting historical rows.

- [ ] **Step 2: Run Prisma gates**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Expected: PASS with both P9-A migrations applied in order.

- [ ] **Step 3: Run full regression**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all existing P0-P9-0H plus P9-A tests pass.

- [ ] **Step 4: Commit docs/final narrow fixes**

`docs: document P9-A optimization planner`, with any verification-discovered production fix committed separately and reverified.

---

### Task 10: Draft PR, exact-head CI, diff review, release gate

**Files:**
- No planned production changes; final narrow fixes only if evidence exposes a defect.

- [ ] **Step 1: Open/update Draft PR**

PR body states: base/head; P7 authority unchanged; P8 authority unchanged; advisory-only boundary; no HTTP/optimization queue/cron/auto-PR/merge/deploy; `automationEligibility=false`; bounded DeepSeek + zero fallback; two additive forward migrations; separate human `合并` required.

- [ ] **Step 2: Require exact-head CI**

```text
verify = success
production-audit = success
e2e = success
```

Within `verify`:

```text
Validate Prisma = success
Generate Prisma client = success
Apply migrations = success
Typecheck = success
Test = success
Build = success
```

- [ ] **Step 3: Manual final diff review**

Reject if the diff contains: P7 scoring/detector/formula changes; P8 risk/approval/mutation/execution/verification changes; Git write/PR/merge/deploy code in optimization; optimization queues/cron/event bus; runtime third-party fetch/raw-vendor execution; AI authority over eligibility/action/score/market/risk/approval; mutable candidate/plan repository APIs; unprotected planner tables; rewritten earlier migration; unrelated package/dependency changes; credentials/private data.

- [ ] **Step 4: Fresh verification-before-completion**

Re-fetch current PR head and its CI after every final commit; the verified SHA must equal the current head.

- [ ] **Step 5: Mark Ready for Review only after the gate**

Do not merge, deploy, or delete the branch. Human merge requires separate explicit `合并`.