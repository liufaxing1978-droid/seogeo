# P9-A Optimization Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a P7-authoritative, immutable optimization planner that materializes market-aware candidates, ranks eligible work deterministically, attaches integrity-checked advisory methods, optionally applies a bounded DeepSeek rerank, and freezes `OptimizationPlan` artifacts without owning P8 risk or execution.

**Architecture:** P9-A reads only persisted P7 Growth identities/latest snapshots/lifecycle as its authoritative opportunity input. Pure first-party modules project market provenance, eligibility, action class, candidate identity, and deterministic ranking; immutable Prisma rows persist candidates/plans; P9-0H contributes projection-only advisory provenance; the existing AI gateway optionally supplies strict `[-2,+2]` ranking adjustments and falls back to zero without blocking frozen deterministic plans.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, Zod 3.25, Vitest 3.2, existing DeepSeek AI gateway/BullMQ AI queue, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-a-optimization-planner-design.md`

## Global Constraints

- Base is `main@60c9dbf56c23d4b7644913e123383538d6f8699c`; branch is `feat/p9-a-optimization-planner`.
- Never write implementation directly to `main`.
- P7 Growth remains authoritative for opportunity identity, score, priority, evidence, lifecycle, and UNKNOWN semantics.
- P9-A never reads P5/P6/Search Facts to synthesize a second opportunity universe.
- P9-A never changes P7 score/evidence/lifecycle and never treats unknown values as zero.
- P8 remains authoritative for risk class, approval, PublicationPlan, preview, mutation, Draft PR execution, verification, rollback, merge, and deploy.
- `automationEligibility` is always `false` in P9-A V1.
- P9-0H third-party skills remain `ADVISORY_ONLY`; only first-party projections/provenance may be consumed.
- No raw vendor Markdown body is returned, persisted as instructions, imported, executed, or sent as authority to DeepSeek.
- No new optimization BullMQ queue, cron, event bus, or daily reconciliation in P9-A; P9-B owns orchestration.
- No HTTP route in P9-A V1.
- DeepSeek may only adjust already-eligible candidate ordering by an integer `[-2,+2]`; it cannot change facts, eligibility, action, market, score, risk, or approvals.
- Any accepted AI adjustment set must also satisfy `abs(finalRank - deterministicRank) <= 2` for every candidate; otherwise the whole set falls back to zero.
- `historicalRankAdjustment = 0` for all P9-A V1 plans.
- Candidate and plan rows are database-immutable through dedicated PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- Final exact PR head must pass `verify`, `production-audit`, and `e2e`. Do not merge without a separate explicit human `合并` instruction.

## File Structure

Prisma:

- `prisma/models/optimization.prisma` — P9-A enums/models.
- `prisma/schema.prisma` — generated-client source mirror for the new enums/models and `AiTaskType` value.
- `prisma/models/ai-gateway.prisma` — add `OPTIMIZATION_PLAN_RANKING` to modular AI task enum.
- `prisma/migrations/20260822151000_add_p9a_optimization_planner/migration.sql` — enum value, P9-A tables/indexes/FKs, immutability triggers.

First-party planner:

- `src/modules/optimization/optimization.types.ts` — V1 literal contracts.
- `src/modules/optimization/optimization.policy.ts` — action map, eligibility policy, priority ordinal, advisory map.
- `src/modules/optimization/optimization.provenance.ts` — strict P9-0G market provenance projection.
- `src/modules/optimization/optimization.candidate.ts` — canonical hash identity and candidate draft materialization.
- `src/modules/optimization/optimization.ranking.ts` — deterministic ranks and bounded AI adjustment application.
- `src/modules/optimization/optimization.advisory.ts` — projection-only advisory packaging.
- `src/modules/optimization/optimization.repository.ts` — immutable create/get/list persistence and authoritative P7 read query.
- `src/modules/optimization/optimization.service.ts` — explicit manual/programmatic planner entrypoint.

AI integration:

- `src/modules/ai/optimization-plan-ranking.ts` — strict task builder/parser + success/fallback plan materializers.
- `src/modules/ai/prompts/prompt-registry.ts` — `optimization-plan-ranking-v1` prompt.
- `src/modules/ai/ai.worker.ts` — dispatch, parsing, materialization, and failure fallback for the new task.

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

### Task 1: Lock the pure P9-A contracts, identity, provenance, eligibility, and action map

**Files:**
- Create: `tests/unit/optimization.policy.test.ts`
- Create: `tests/unit/optimization.provenance.test.ts`
- Create: `src/modules/optimization/optimization.types.ts`
- Create: `src/modules/optimization/optimization.policy.ts`
- Create: `src/modules/optimization/optimization.provenance.ts`
- Create: `src/modules/optimization/optimization.candidate.ts`

**Interfaces:**

Produces these exact V1 values/types:

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
  scopes: Array<{ marketScopeMode: OptimizationMarketScopeMode; marketCode: string | null; locale: string | null }>
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

- [ ] **Step 1: Write the failing contract tests**

`tests/unit/optimization.policy.test.ts` must lock all nine Growth type mappings and fail-closed eligibility:

```ts
it('maps all P7 V1 opportunity types without AI authority', () => {
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
  })).toEqual({ state: 'INELIGIBLE', reasonCodes: ['GROWTH_SCORE_UNKNOWN', 'GROWTH_SCORE_MISSING'] })
})
```

`tests/unit/optimization.provenance.test.ts` must lock configured fan-out, legacy null scope, invalid audit scope, dedupe, and candidate-key determinism:

```ts
it('projects configured market scopes from P9-0G scoring-lane provenance', () => {
  const result = projectGrowthMarketScopes({ searchFacts: {
    version: 'GROWTH_SEARCH_PROVENANCE_V1', mode: 'CONFIGURED_MARKET',
    scoringLane: { marketProjections: [
      { marketCode: 'CN', locale: 'zh-CN', propertyRef: 'gsc:site' },
      { marketCode: 'GLOBAL', locale: 'en', propertyRef: 'gsc:site' }
    ] }
  } })
  expect(result.scopes).toEqual([
    { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'CN', locale: 'zh-CN' },
    { marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'GLOBAL', locale: 'en' }
  ])
  expect(result.provenanceReasonCodes).toEqual([])
})

it('persists one invalid-provenance identity instead of inventing a market', () => {
  expect(projectGrowthMarketScopes({}).scopes).toEqual([
    { marketScopeMode: 'INVALID_PROVENANCE', marketCode: null, locale: null }
  ])
})
```

- [ ] **Step 2: Verify RED**

Run on the branch:

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts
```

Expected: RED because `src/modules/optimization/*` production modules do not exist. Commit the test-only RED before production code.

- [ ] **Step 3: Implement the minimal pure contracts**

In `optimization.policy.ts`, use frozen first-party maps and a stable reason ordering. `INVALID_PROVENANCE` must force `INELIGIBLE`. `DONE`, `DISMISSED`, and `RESOLVED` are terminal; `NEW`, `REVIEWED`, `PLANNED`, `IN_PROGRESS`, and `REOPENED` are not terminal by P9-A policy.

In `optimization.provenance.ts`, accept only:

```ts
{
  searchFacts: {
    version: 'GROWTH_SEARCH_PROVENANCE_V1',
    mode: 'CONFIGURED_MARKET' | 'UNCONFIGURED_LEGACY',
    scoringLane: { marketProjections?: Array<{ marketCode: string; locale: string; propertyRef?: string }> }
  }
}
```

Configured mode requires at least one non-empty `marketCode`/`locale` pair. Deduplicate by exact pair and sort by `marketCode`, then `locale`. Anything missing/contradictory returns the single `INVALID_PROVENANCE` scope and `INVALID_MARKET_PROVENANCE` or `SOURCE_PROVENANCE_MISSING`; no project defaults are consulted.

In `optimization.candidate.ts`, canonicalize object keys recursively and SHA-256 exactly the candidate identity contract. Do not hash score, priority, advisory data, or current time.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit production + tests as `feat: add P9-A planner contracts`.

---

### Task 2: Add immutable OptimizationCandidate and OptimizationPlan persistence

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

Models must use P7 enum types for opportunity/score/priority/evidence/lifecycle where possible rather than duplicate semantic enums.

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

`listLatestGrowthInputs` must return one latest snapshot per Growth identity using deterministic ordering `currentWindowEnd desc`, `createdAt desc`, `id desc`, including identity/lifecycle/snapshot evidence references and sourceProvenance. It is a read boundary only.

- [ ] **Step 1: Write persistence RED**

Create `tests/integration/optimization.persistence.test.ts` with unique project fixtures. First assert the Prisma client/models do not yet support P9-A; after schema generation this becomes the persistence/immutability test.

The final test must prove:

```ts
const candidate = await repository.createCandidate(validCandidateInput)
const again = await repository.createCandidate(validCandidateInput)
expect(again.id).toBe(candidate.id)

await expect(prisma.optimizationCandidate.update({
  where: { id: candidate.id }, data: { normalizedQuery: 'mutated' }
})).rejects.toThrow()
await expect(prisma.optimizationCandidate.delete({ where: { id: candidate.id } })).rejects.toThrow()
```

and equivalent UPDATE/DELETE rejection for `OptimizationPlan`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.persistence.test.ts
```

Expected: RED because Prisma models/repository do not exist.

- [ ] **Step 3: Add schema and migration**

`OptimizationCandidate` must include the spec fields and these constraints:

```prisma
@@unique([projectId, candidateKey], map: "OptimizationCandidate_project_key")
@@index([projectId, eligibilityState, createdAt], map: "OptimizationCandidate_project_eligibility_idx")
@@index([growthOpportunityIdentityId, growthSnapshotId], map: "OptimizationCandidate_growth_source_idx")
```

`OptimizationPlan`:

```prisma
@@unique([candidateId, planVersion], map: "OptimizationPlan_candidate_version")
@@index([projectId, finalRank, createdAt], map: "OptimizationPlan_project_rank_idx")
```

Use `Json` for bounded `sourceProvenance`, `eligibilityReasonCodes`, `sourceFactReferences`, `advisoryContext`, and `explanation`. Use `Int` for ranks/adjustments; `Boolean @default(false)` for automation eligibility.

The migration must add FKs to `Project`, `GrowthOpportunityIdentity`, `GrowthOpportunitySnapshot`, and candidate→plan with `ON DELETE RESTRICT`. Add:

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

Do not reuse or alter P8's immutability function.

- [ ] **Step 4: Implement repository create/get/list only**

`createCandidate` and `createPlan` must be idempotent on their unique identities: lookup-first or catch unique collision and return the exact stored row after validating project/source identity. No update/delete methods exist.

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

Commit as `feat: persist immutable P9-A planner artifacts`.

---

### Task 3: Materialize market-aware candidates from authoritative P7 latest snapshots

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

Lock these cases:

1. configured Growth provenance with CN/zh-CN + GLOBAL/en yields two candidate rows;
2. duplicate same market projection yields one row;
3. legacy provenance yields one `UNCONFIGURED_LEGACY` candidate with null market/locale;
4. missing provenance yields one `INVALID_PROVENANCE` ineligible candidate with null market/locale and no inferred country/language;
5. terminal lifecycle and UNKNOWN score still persist ineligible candidates for audit;
6. rerunning unchanged P7 snapshots is idempotent;
7. a newer Growth snapshot produces a new candidate and leaves prior candidate untouched.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.materialization.test.ts
```

Expected: RED because source-to-candidate orchestration is incomplete.

- [ ] **Step 3: Implement candidate drafts**

Each projected scope is evaluated with `evaluateOptimizationEligibility`. Copy only bounded P7 fields and first-party source references; do not embed evidence bodies/provider raw payloads. `INVALID_PROVENANCE` must be forced ineligible before any rank/action plan work.

- [ ] **Step 4: Add repository source reader integration**

Use `OptimizationRepository.listLatestGrowthInputs(projectId)` to obtain authoritative latest snapshots. The reader must not call Growth score functions/detectors; it reads stored values only.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.policy.test.ts tests/unit/optimization.provenance.test.ts tests/integration/optimization.materialization.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit as `feat: materialize P9-A optimization candidates`.

---

### Task 4: Add deterministic ranking and integrity-checked advisory packaging

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

export async function buildAdvisoryContext(input: {
  actionType: RecommendedActionType
  registry: AdvisorySkillRegistry
}): Promise<AdvisoryPlanContext>
```

- [ ] **Step 1: Write ranking/advisory RED**

Ranking tests lock score-desc, priority ordinal, coverage-desc, candidateKey tiebreak, exclusion of ineligible candidates, and no score recomputation.

Advisory tests use a fake `AdvisorySkillRegistry` and require exact action→method keys, deterministic ordering, only bounded provenance fields, and `authority: 'ADVISORY_ONLY'`. Assert serialized context does not contain projection steps/raw bodies.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/unit/optimization.advisory.test.ts
```

Expected: missing production modules.

- [ ] **Step 3: Implement deterministic ranking**

Priority ordinal is first-party constant:

```ts
const PRIORITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, MONITOR: 4, UNKNOWN: 5 } as const
```

Sort only eligible candidates by `growthScore desc`, priority ordinal asc, evidenceCoverage desc, candidateKey asc; assign 1-based ranks.

- [ ] **Step 4: Implement advisory packaging**

Use the exact method-key mapping from the spec and call `registry.getByMethodKeys(...)`. Require every requested method to exist exactly once; missing/duplicate/integrity exceptions abort plan packaging. Return only provenance identity fields, not `projection.steps/checks/outputs`.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/unit/optimization.advisory.test.ts tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit as `feat: rank and package P9-A advisory plans`.

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
  materializeProject(projectId: string, options: MaterializeOptimizationOptions): Promise<MaterializeOptimizationResult>
}
```

For `useAi !== true`, freeze plans immediately with:

```text
planVersion = OPTIMIZATION_PLAN_V1
aiRankAdjustment = 0
historicalRankAdjustment = 0
finalRank = deterministicRank
automationEligibility = false
```

- [ ] **Step 1: Write zero-AI service RED**

The integration test builds P7 fixtures, runs `materializeProject(..., { advisoryRootDir, useAi: false })`, and requires:

- all auditable candidates persisted;
- plans only for eligible candidates;
- plan action comes from first-party map;
- exact deterministic/advisory provenance persists;
- `aiTaskId === null`;
- rerun returns the same candidate/plan ids;
- no PublicationProposal/PublicationPlan/Execution rows are created.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.service.test.ts
```

Expected: missing/incomplete service.

- [ ] **Step 3: Implement plan-seed and deterministic explanation**

The first-party explanation JSON must separate authority:

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

Do not duplicate raw P7 evidence text or vendor projection content.

- [ ] **Step 4: Implement zero-AI persistence path**

Create/get the immutable plan by `(candidateId, OPTIMIZATION_PLAN_V1)`. It must never update an existing plan. If an existing plan identity is present with conflicting payload, fail closed rather than rewriting it.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/integration/optimization.service.test.ts tests/integration/optimization.persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit as `feat: freeze deterministic P9-A plans`.

---

### Task 6: Add strict DeepSeek optimization ranking task contract

**Files:**
- Modify: `prisma/models/ai-gateway.prisma`
- Modify: `prisma/schema.prisma`
- Modify: `prisma/migrations/20260822151000_add_p9a_optimization_planner/migration.sql`
- Create: `src/modules/ai/optimization-plan-ranking.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Create: `tests/integration/optimization.ai-ranking.test.ts`

**Interfaces:**

Add enum value:

```prisma
OPTIMIZATION_PLAN_RANKING
```

Prompt id is exactly:

```ts
export const OPTIMIZATION_PLAN_RANKING_PROMPT_ID = 'optimization-plan-ranking-v1'
```

Strict output:

```ts
const OptimizationPlanRankingOutputSchema = z.object({
  adjustments: z.array(z.object({
    candidateId: z.string().uuid(),
    adjustment: z.number().int().min(-2).max(2),
    explanation: z.string().min(1).max(1000),
    sourceReferences: z.array(z.string().min(1)).max(40)
  }).strict()).max(100),
  sourceReferences: z.array(z.string().min(1)).max(200)
}).strict()
```

Functions:

```ts
export function parseOptimizationPlanRankingOutput(content: string, task: Pick<AiTask, 'factSnapshot' | 'sourceReferences'>): OptimizationPlanRankingOutput
export function buildOptimizationPlanRankingTaskInput(projectId: string, seeds: readonly OptimizationPlanSeed[]): CreateAiTaskInput
```

- [ ] **Step 1: Write AI contract RED**

Test valid adjustment, out-of-range ±3, duplicate candidate ids, unknown candidate id, unknown output fields, and source references not supplied to the task. Also assert the fact snapshot contains only bounded candidate facts/actions/ranks/market/advisory identities and not vendor raw bodies/P8 risk.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/optimization.ai-ranking.test.ts
```

Expected: missing task type/module/prompt.

- [ ] **Step 3: Add Prisma enum value and prompt**

The prompt system message must explicitly state: ranking advice only; never invent facts; never alter eligibility/action/score/market/risk/approval; return strict JSON. Use existing `REASONING` + `JSON` prompt conventions.

- [ ] **Step 4: Implement strict task builder/parser**

Task request key is deterministic over planner version + sorted candidate ids/seed hashes, for example:

```ts
requestKey: `optimization-plan-ranking:${seedSetHash}:${OPTIMIZATION_PLAN_RANKING_PROMPT_ID}`
```

Allowed source references are represented with first-party `TYPE:id` strings and validated as a subset on output.

- [ ] **Step 5: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx vitest run tests/integration/optimization.ai-ranking.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Commit as `feat: add bounded P9-A DeepSeek ranking task`.

---

### Task 7: Materialize AI-ranked plans atomically and fall back to zero on AI failure

**Files:**
- Modify: `src/modules/optimization/optimization.ranking.ts`
- Modify: `src/modules/ai/optimization-plan-ranking.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/modules/optimization/optimization.service.ts`
- Modify: `tests/integration/optimization.ai-ranking.test.ts`
- Modify: `tests/integration/optimization.service.test.ts`

**Interfaces:**

```ts
export function applyBoundedRankAdjustments(
  ranked: readonly RankedCandidate[],
  adjustments: readonly { candidateId: string; adjustment: number }[]
): Array<{ candidateId: string; deterministicRank: number; aiRankAdjustment: number; finalRank: number }>

export async function materializeOptimizationRankingSuccess(task: AiTask, output: OptimizationPlanRankingOutput, tx: Prisma.TransactionClient): Promise<void>
export async function materializeOptimizationRankingFallback(task: AiTask): Promise<void>
```

- [ ] **Step 1: Write final-rank/fallback RED**

Tests require:

- negative adjustment improves the rank signal; positive worsens it;
- ties resolve by deterministic rank then candidate key;
- every accepted final displacement is ≤2;
- an adjustment set causing displacement >2 is rejected as a set;
- valid AI worker completion freezes plans with accepted adjustments/model annotation;
- provider error and invalid output both leave the AI task auditable as failed **and then idempotently freeze plans with zero adjustments**;
- fallback never changes candidate eligibility/action/advisory context.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/integration/optimization.ai-ranking.test.ts tests/integration/optimization.service.test.ts
```

Expected: RED for missing worker materialization/fallback behavior.

- [ ] **Step 3: Implement bounded rank application**

Start with each missing candidate adjustment = 0. Compute `adjustedRankSignal = deterministicRank + adjustment`, sort ascending, assign final ordinal, then reject if any `Math.abs(finalRank - deterministicRank) > 2`. On rejection, use the all-zero result.

- [ ] **Step 4: Wire AI worker success**

Update all exhaustive `AiTaskType` switches in `ai.worker.ts`:

- `expectedPromptId` → `optimization-plan-ranking-v1`;
- `resultSummary` → `Optimization plan ranking completed.`;
- `parseTaskOutput` → `parseOptimizationPlanRankingOutput`;
- `completeRun` materializer → `materializeOptimizationRankingSuccess` inside the same completion transaction.

- [ ] **Step 5: Wire worker failure fallback**

After the existing durable `failRun(...)` records AI failure, if `task.taskType === 'OPTIMIZATION_PLAN_RANKING'`, call `materializeOptimizationRankingFallback(task)`. This fallback must be idempotent and create only P9-A plans. If fallback itself fails, rethrow the original/combined failure and never create P8 artifacts.

- [ ] **Step 6: Wire service AI mode**

For `useAi: true`, persist candidates, build deterministic ranked plan seeds + advisory context, create/enqueue exactly one `OPTIMIZATION_PLAN_RANKING` task, return `plans: []` until worker success/fallback materializes them, and return its `aiTaskId`. Do not create a new optimization queue.

- [ ] **Step 7: Verify GREEN**

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/integration/optimization.ai-ranking.test.ts tests/integration/optimization.service.test.ts tests/integration/ai.worker-execution.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

Commit as `feat: materialize bounded P9-A AI ranking`.

---

### Task 8: Lock planner authority boundaries and regression isolation

**Files:**
- Create: `tests/unit/optimization.boundary.test.ts`
- Modify production files only if the test exposes a real boundary leak.

- [ ] **Step 1: Write static/runtime boundary tests**

Require all of these:

```ts
it('optimization modules do not import P7 score or detector implementations')
it('optimization modules do not import P8 mutation approval execution verification or Git adapters')
it('optimization modules expose no merge deploy rollback or Draft PR operation')
it('optimization modules do not add BullMQ queue cron or event-bus ownership')
it('advisory context contains no raw projection body or executable handle')
it('AI ranking schema has no risk approval score evidence or action override fields')
it('P7 Growth score and lifecycle rows are byte/field stable before and after planner materialization')
it('P8 publication row counts remain unchanged after planner materialization')
```

Static inspection may allow imports of P7/P8 **types** only when they do not provide mutation authority. Prefer reading P7 persisted records via the planner repository rather than importing GrowthService.

- [ ] **Step 2: Verify boundary suite**

```bash
npx vitest run tests/unit/optimization.boundary.test.ts tests/unit/advisory-skill.boundary.test.ts
```

If RED exposes a real leak, make only the minimum boundary fix.

- [ ] **Step 3: Run focused P9-A regression**

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

Commit as `test: lock P9-A planner authority boundaries` if test-only, otherwise use a narrowly named `fix:` commit.

---

### Task 9: Document P9-A operational contract and run full local regression

**Files:**
- Create: `docs/development/p9-a-optimization-planner.md`

- [ ] **Step 1: Write development documentation**

Document:

- authoritative P7 input boundary;
- candidate/plan versions and identities;
- `CONFIGURED_MARKET`, `UNCONFIGURED_LEGACY`, `INVALID_PROVENANCE` semantics;
- all eligibility reason codes and terminal lifecycle states;
- exact action map;
- deterministic rank order;
- advisory mapping/provenance and fail-closed integrity behavior;
- DeepSeek `[-2,+2]` and final-displacement bounds;
- AI failure → zero-adjustment frozen-plan fallback;
- immutable DB triggers and idempotency;
- `automationEligibility=false` and P8 authority boundary;
- P9-B/P9-C future handoffs;
- rollback by reverting the additive PR/migration under repository migration policy, never rewriting historical planner rows.

- [ ] **Step 2: Run Prisma gates**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Expected: PASS on a clean/review database.

- [ ] **Step 3: Run full regression**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all existing P0-P9-0H tests plus P9-A tests pass.

- [ ] **Step 4: Commit docs/final narrow fixes**

Commit as `docs: document P9-A optimization planner` unless verification required a narrow production fix, in which case commit the fix separately and rerun the affected gates.

---

### Task 10: Draft PR, exact-head CI, final diff review, and release gate

**Files:**
- No planned production changes; only final fixes if evidence exposes a defect.

- [ ] **Step 1: Open/update Draft PR**

PR body must state:

- base and current exact head;
- P7 remains score/evidence/lifecycle authority;
- P8 remains risk/approval/mutation/verification authority;
- P9-0H remains advisory-only;
- P9-A has no HTTP route, optimization queue, cron, auto-PR, merge, deploy, or rollback execution;
- `automationEligibility=false`;
- DeepSeek is bounded ranking only with deterministic zero fallback;
- migration adds only immutable planner artifacts + AI task enum;
- human `合并` is separately required.

- [ ] **Step 2: Run/inspect exact-head CI**

Require the exact final PR head to have:

```text
verify = success
production-audit = success
e2e = success
```

Within `verify`, require:

```text
Validate Prisma = success
Generate Prisma client = success
Apply migrations = success
Typecheck = success
Test = success
Build = success
```

- [ ] **Step 3: Manual final diff review**

Reject release if the diff contains any of:

- P7 scoring/detector/formula changes;
- P8 risk/approval/mutation/execution/verification semantic changes;
- direct Git write/PR creation/merge/deploy code in `src/modules/optimization`;
- optimization BullMQ queue/cron/event bus;
- runtime third-party fetching or raw-vendor execution;
- model ability to alter eligibility/action/score/market/risk/approval;
- candidate/plan update/delete repository methods;
- unprotected mutable planner tables;
- unrelated package/dependency changes;
- credentials/private data.

- [ ] **Step 4: Fresh release verification**

Use `verification-before-completion`. Re-fetch PR head and CI; ensure the verified SHA equals the current head after all final commits.

- [ ] **Step 5: Mark Ready for Review**

Only after exact-head three-job green + manual diff review. Do **not** merge, deploy, or delete the feature branch. A separate explicit human `合并` instruction is required.