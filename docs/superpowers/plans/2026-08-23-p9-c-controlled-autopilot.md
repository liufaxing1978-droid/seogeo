# P9-C Controlled Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build controlled autopilot so an explicitly opted-in Advanced/Enterprise project can automatically create a P8 Draft PR only for a current, warning-free, exact LOW-risk `CREATE_CONTENT_PAGE` change, while preserving human merge/deploy authority.

**Architecture:** P9-C owns policy, immutable policy decisions, race-safe quota/concurrency reservation, and exactly one `optimization-autopilot` BullMQ queue. It starts only from P9-B `READY_FOR_POLICY / COMPLETED` items. P8 remains authoritative for content preparation, exact `PublicationPlan`/`PublicationPreview`, deterministic validation, risk, machine authorization, live target validation, Git mutation, Draft PR creation, and verification. Human `PublicationApproval -> APPROVED` and machine `PublicationAutomationAuthorization -> AUTOMATION_AUTHORIZED` remain distinct and converge into the existing P8 execution worker.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, BullMQ 5.58, Zod 3.25, Express 5, Vitest 3.2, Supertest 7, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-p9-c-controlled-autopilot-design.md`

## Global Constraints

- Base: `main@58d031cb07342a6655ae84093c00ce7bfaf6f0c2`; branch: `feat/p9-c-controlled-autopilot`.
- The user approved the P9-C design on 2026-08-23. Never implement directly on `main`.
- P7 owns Growth identity, score, evidence, ranking eligibility, lifecycle, and provenance. P9-C reads persisted facts only and never imports P7 scoring/detector implementations.
- P9-A candidates/plans remain immutable. P9-C never updates `OptimizationPlan.automationEligibility`.
- P9-B owns workflow run/item position. P9-C never rewrites `OptimizationRun`/`OptimizationRunItem`.
- P8 owns exact operations, risk, validation, plan/preview, target revision checks, mutation adapter, Draft PR, verification, rollback proposals, merge, and deploy.
- Never fake a human `PublicationApproval`. Machine authorization is `PublicationAutomationAuthorization`, and machine execution starts at `AUTOMATION_AUTHORIZED`, not `APPROVED`.
- V1 automatic mapping is exactly `CONTENT_CREATION -> CREATE_CONTENT_PAGE`. Every other P9 action and every other exact P8 operation is manual-only.
- Exact P8 risk must be LOW. MEDIUM/HIGH never receive machine authorization.
- Any P8 warning blocks automation. P9-C never confirms `SOURCE_GAP` or another warning on behalf of a human.
- Feature: `CONTROLLED_AUTOPILOT`; STANDARD=false, ADVANCED=true, ENTERPRISE=true. Entitlement never enables policy automatically.
- Policy defaults: enabled=false, allowed risk LOW, operations `[CREATE_CONTENT_PAGE]`, daily quota=3, max concurrency=1, require fresh evidence=true, minimum evidence coverage=70, pause on verification failure=true, project kill switch=false.
- Bounds: daily quota 1..10, max concurrency 1..3, minimum evidence coverage 70..100.
- `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH` fails closed. Only explicit OFF permits machine authorization/enqueue; missing/malformed/unknown means ON.
- Add exactly one P9-C queue: `optimization-autopilot`. No event bus and no second P8 execution queue.
- Queue payloads contain durable IDs only. Never queue content bodies, prompts/responses, raw evidence/provider payloads, policy JSON, diffs, Git tokens, or credentials.
- P9-C daily reconciliation is UTC and date-free at scheduling time; worker derives the UTC date when processing.
- Quota/concurrency reservation must be transactionally serialized in PostgreSQL. Non-atomic count-then-insert is forbidden.
- All migrations are forward-only. Never edit applied P8/P9-A/P9-B migrations.
- P9-C implementation modules must not import `github-mutation.adapter.ts`, DeepSeek transport/provider implementations, P7 scoring/detectors, merge/deploy helpers, or automatic rollback code.
- Existing human P8 approval/execution semantics must remain green.
- PR stays Draft until exact-head `verify`, `production-audit`, and `e2e` are green, manual authority review is complete, and unresolved review threads are zero.
- Merge requires a separate explicit human `合并`; deployment requires separate explicit authorization.

## Planned Files

P9-C:
- `src/modules/optimization-autopilot/autopilot.config.ts`
- `src/modules/optimization-autopilot/autopilot.types.ts`
- `src/modules/optimization-autopilot/autopilot.identity.ts`
- `src/modules/optimization-autopilot/autopilot.policy.ts`
- `src/modules/optimization-autopilot/autopilot.gates.ts`
- `src/modules/optimization-autopilot/autopilot.repository.ts`
- `src/modules/optimization-autopilot/autopilot.reservation.ts`
- `src/modules/optimization-autopilot/autopilot.queue.ts`
- `src/modules/optimization-autopilot/autopilot.service.ts`
- `src/modules/optimization-autopilot/autopilot.worker.ts`
- `src/modules/optimization-autopilot/autopilot.routes.ts`
- `src/modules/optimization-autopilot/autopilot-observability.ts`

P8/cross-cutting:
- `src/modules/publication/publication-automation-preparation.ts`
- `src/modules/publication/publication-automation-authorization.ts`
- `src/modules/publication/publication-execution.service.ts`
- `src/modules/publication/publication.types.ts`
- `src/modules/publication/publication.repository.ts`
- `src/modules/publication/publication.routes.ts`
- `src/modules/publication/publication-execution.worker.ts`
- `src/modules/publication/publication-ai.ts`
- `src/modules/ai/ai.worker.ts`
- `src/modules/optimization-orchestration/orchestration.worker.ts`
- `src/auth/feature-flags.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`
- `src/app.ts`
- `.env.example`

Prisma:
- `prisma/models/optimization-autopilot.prisma`
- `prisma/models/optimization-orchestration.prisma`
- `prisma/models/publication.prisma`
- `prisma/migrations/20260823140000_add_p9c_controlled_autopilot/migration.sql`

---

### Task 1: Persistence foundation, feature entitlement, and fail-closed global switch

**Files:**
- Create: `prisma/models/optimization-autopilot.prisma`
- Modify: `prisma/models/optimization-orchestration.prisma`
- Modify: `prisma/models/publication.prisma`
- Create: `prisma/migrations/20260823140000_add_p9c_controlled_autopilot/migration.sql`
- Modify: `src/auth/feature-flags.ts`
- Create: `src/modules/optimization-autopilot/autopilot.config.ts`
- Modify: `.env.example`
- Create: `tests/unit/autopilot.config.test.ts`
- Create: `tests/unit/autopilot.feature-gate.test.ts`
- Create: `tests/integration/autopilot.persistence.test.ts`

**Schema:**

```prisma
enum OptimizationAutopilotDecisionStatus {
  AUTOPILOT_READY
  P8_PREPARATION_REQUIRED
  MANUAL_REQUIRED
  POLICY_BLOCKED
  DEFERRED_QUOTA
  DEFERRED_CONFLICT
  STALE
  P8_VALIDATION_BLOCKED
}

enum AutopilotReservationStatus { RESERVED CONSUMED RELEASED }
```

Add `AutopilotPolicy`, immutable `OptimizationAutopilotDecision`, `AutopilotExecutionReservation`, and immutable P8 `PublicationAutomationAuthorization`. Add `P9_OPTIMIZATION_PLAN` to `PublicationProposalSourceType`; add `AUTOMATION_AUTHORIZED` to publication execution status/event enums. Make `PublicationExecution.approvalId` nullable, add nullable `automationAuthorizationId`, and add a DB CHECK enforcing exactly one non-null authorization source. Add nullable unique `PublicationProposal.automationPreparationKey` for idempotent P9 preparation.

- [ ] **Step 1: Write RED tests**

```ts
it('gates controlled autopilot to Advanced and Enterprise', () => {
  expect(hasFeature('STANDARD', 'CONTROLLED_AUTOPILOT')).toBe(false)
  expect(hasFeature('ADVANCED', 'CONTROLLED_AUTOPILOT')).toBe(true)
  expect(hasFeature('ENTERPRISE', 'CONTROLLED_AUTOPILOT')).toBe(true)
})

it('fails the global switch closed', () => {
  expect(parseControlledAutopilotGlobalKillSwitch(undefined)).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('garbage')).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('true')).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('false')).toBe(false)
})
```

Persistence RED also proves execution rejects both authorization IDs null and both non-null; decision/automation authorization reject UPDATE/DELETE; preparation key is unique.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.config.test.ts tests/unit/autopilot.feature-gate.test.ts tests/integration/autopilot.persistence.test.ts
```

Expected: missing P9-C modules/schema/feature.

- [ ] **Step 3: Implement minimal GREEN**

```ts
export function parseControlledAutopilotGlobalKillSwitch(value: string | undefined): boolean {
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false
  return true
}
```

Add `CONTROLLED_AUTOPILOT` to Advanced only; Enterprise inherits. Add `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` to `.env.example`. Migration adds all new types/tables/relations/checks/immutability triggers without altering old migrations.

- [ ] **Step 4: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run tests/unit/autopilot.config.test.ts tests/unit/autopilot.feature-gate.test.ts tests/integration/autopilot.persistence.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add .env.example src/auth/feature-flags.ts src/modules/optimization-autopilot/autopilot.config.ts prisma/models/optimization-autopilot.prisma prisma/models/optimization-orchestration.prisma prisma/models/publication.prisma prisma/migrations/20260823140000_add_p9c_controlled_autopilot/migration.sql tests/unit/autopilot.config.test.ts tests/unit/autopilot.feature-gate.test.ts tests/integration/autopilot.persistence.test.ts
git commit -m "feat(p9-c): add controlled autopilot persistence foundation"
```

---

### Task 2: Policy normalization, deterministic identities, and immutable decisions

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.types.ts`
- Create: `src/modules/optimization-autopilot/autopilot.identity.ts`
- Create: `src/modules/optimization-autopilot/autopilot.policy.ts`
- Create: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `src/modules/optimization-autopilot/autopilot.service.ts`
- Create: `tests/unit/autopilot.identity.test.ts`
- Create: `tests/unit/autopilot.policy.test.ts`
- Extend: `tests/integration/autopilot.persistence.test.ts`

**Interfaces:**

```ts
export const CONTROLLED_AUTOPILOT_POLICY_VERSION = 'CONTROLLED_AUTOPILOT_POLICY_V1' as const
export const OPTIMIZATION_AUTOPILOT_DECISION_VERSION = 'OPTIMIZATION_AUTOPILOT_DECISION_V1' as const
export const P9C_AUTOMATIC_OPERATION = 'CREATE_CONTENT_PAGE' as const

export type AutopilotPolicyMutation = {
  enabled: boolean
  allowedRiskClass?: 'LOW'
  allowedOperationClasses?: readonly ['CREATE_CONTENT_PAGE']
  dailyDraftPrLimit?: number
  maxConcurrentRuns?: number
  requireFreshEvidence?: boolean
  minimumEvidenceCoverage?: number
  pauseOnVerificationFailure?: boolean
  killSwitch?: boolean
}
```

Repository API:

```ts
class OptimizationAutopilotRepository {
  getPolicy(projectId: string): Promise<AutopilotPolicy | null>
  upsertPolicy(projectId: string, input: NormalizedAutopilotPolicy, actorId: string): Promise<AutopilotPolicy>
  loadRunItemContext(runItemId: string, projectId: string): Promise<AutopilotRunItemContext | null>
  createOrGetDecision(input: CreateAutopilotDecisionInput): Promise<OptimizationAutopilotDecision>
  listReadyItemsWithoutEffectiveDecision(limit: number): Promise<Array<{ id: string; projectId: string }>>
}
```

- [ ] **Step 1: Write RED tests**

```ts
expect(normalizeAutopilotPolicy({ enabled: true })).toMatchObject({
  enabled: true,
  allowedRiskClass: 'LOW',
  allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
  dailyDraftPrLimit: 3,
  maxConcurrentRuns: 1,
  requireFreshEvidence: true,
  minimumEvidenceCoverage: 70,
  pauseOnVerificationFailure: true,
  killSwitch: false
})
```

Prove MEDIUM/HIGH, unsupported operations, quota outside 1..10, concurrency outside 1..3, coverage outside 70..100 are rejected. Same immutable inputs reuse one decision; changed policy snapshot or exact P8 plan/preview changes decision key.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.identity.test.ts tests/unit/autopilot.policy.test.ts tests/integration/autopilot.persistence.test.ts
```

- [ ] **Step 3: Implement canonical identity/policy persistence**

Canonical JSON recursively sorts object keys and preserves explicit nulls. Sort/dedupe operation arrays before policy hashing. `createOrGetDecision()` re-reads and exact-identity-checks P2002 collisions. `getPolicy()` performs no write; missing row means disabled.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/autopilot.identity.test.ts tests/unit/autopilot.policy.test.ts tests/integration/autopilot.persistence.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.types.ts src/modules/optimization-autopilot/autopilot.identity.ts src/modules/optimization-autopilot/autopilot.policy.ts src/modules/optimization-autopilot/autopilot.repository.ts src/modules/optimization-autopilot/autopilot.service.ts tests/unit/autopilot.identity.test.ts tests/unit/autopilot.policy.test.ts tests/integration/autopilot.persistence.test.ts
git commit -m "feat(p9-c): add autopilot policy and decisions"
```

---

### Task 3: Freshness, verification pause, conflicts, and exact P8 gates

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.gates.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `tests/unit/autopilot.gates.test.ts`
- Create: `tests/integration/autopilot.authority.test.ts`

**Result:**

```ts
type AutopilotGateResult =
  | { allowed: true }
  | {
      allowed: false
      status: 'P8_PREPARATION_REQUIRED' | 'MANUAL_REQUIRED' | 'POLICY_BLOCKED' | 'DEFERRED_CONFLICT' | 'STALE' | 'P8_VALIDATION_BLOCKED'
      reasonCode: string
    }
```

Readers load latest Growth snapshot for the candidate identity, latest authoritative P8 verification state, active P8 URL/path conflicts, existing automatic handoff, and exact P8 plan/preview/site/channel if present.

- [ ] **Step 1: Write RED tests**

```ts
expect(evaluateStaticAutopilotGates({ ...base, p8: null })).toEqual({
  allowed: false,
  status: 'P8_PREPARATION_REQUIRED',
  reasonCode: 'AUTOPILOT_P8_PREPARATION_REQUIRED'
})

expect(evaluateStaticAutopilotGates({
  ...base,
  p8: { ...p8, riskClass: 'LOW', operationTypes: ['CREATE_CONTENT_PAGE'], warningCodes: ['SOURCE_GAP'] }
})).toMatchObject({ allowed: false, reasonCode: 'AUTOPILOT_P8_WARNING_REQUIRES_HUMAN' })
```

Lock deterministic first-failure ordering for unsupported action, insufficient evidence, stale source, terminal lifecycle, unresolved verification failure, conflict, P8 MEDIUM/HIGH, broad/unknown operation, any warning, missing Git Draft PR capability, and stale target binding.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.gates.test.ts tests/integration/autopilot.authority.test.ts
```

- [ ] **Step 3: Implement persisted-facts-only gates**

Fresh means the candidate references the latest persisted Growth snapshot for its identity; do not calculate a new Growth formula. Ambiguous overlap is conflict. Exact automatic operation predicate:

```ts
function exactAutomaticOperationAllowed(types: readonly string[]): boolean {
  return types.length === 1 && types[0] === 'CREATE_CONTENT_PAGE'
}
```

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/autopilot.gates.test.ts tests/integration/autopilot.authority.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.gates.ts src/modules/optimization-autopilot/autopilot.repository.ts tests/unit/autopilot.gates.test.ts tests/integration/autopilot.authority.test.ts
git commit -m "feat(p9-c): enforce deterministic autopilot gates"
```

---

### Task 4: Race-safe daily quota and concurrency reservation

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.reservation.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `tests/integration/autopilot.reservation.test.ts`

**Interface:**

```ts
type ReserveAutopilotCapacityResult =
  | { reserved: true; reservation: AutopilotExecutionReservation }
  | { reserved: false; reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' | 'AUTOPILOT_CONCURRENCY_LIMIT' }
```

- [ ] **Step 1: Write RED race tests**

```ts
const results = await Promise.all([
  reserveAutopilotCapacity({ projectId, decisionId: d1, utcDate: '2026-08-23', dailyDraftPrLimit: 1, maxConcurrentRuns: 3 }),
  reserveAutopilotCapacity({ projectId, decisionId: d2, utcDate: '2026-08-23', dailyDraftPrLimit: 1, maxConcurrentRuns: 3 })
])
expect(results.filter((result) => result.reserved)).toHaveLength(1)
```

Also prove same-decision reuse; project/date isolation; `AUTOMATION_AUTHORIZED`, `QUEUED`, `EXECUTING` consume concurrency; `PR_CREATED` releases concurrency but retains daily quota; human-approved executions do not count.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.reservation.test.ts
```

- [ ] **Step 3: Implement PostgreSQL serialization**

Within one Prisma transaction acquire:

```sql
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));
```

with key `p9c:${projectId}:${utcDate}`, then count capacity and create/reuse reservation in the same transaction. Never count outside the lock and insert later.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.reservation.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.reservation.ts src/modules/optimization-autopilot/autopilot.repository.ts tests/integration/autopilot.reservation.test.ts
git commit -m "feat(p9-c): add race-safe autopilot reservations"
```

---

### Task 5: One P9-C queue, P9-B handoff, and UTC reconciliation

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.queue.ts`
- Create: `src/modules/optimization-autopilot/autopilot.worker.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/modules/optimization-orchestration/orchestration.worker.ts`
- Create: `tests/unit/autopilot.queue.test.ts`
- Extend: `tests/unit/orchestration.advance-worker.test.ts`
- Extend: `tests/unit/queues.test.ts`
- Extend: `tests/unit/worker-bootstrap.test.ts`

**Queue:**

```ts
export const OPTIMIZATION_AUTOPILOT_QUEUE_NAME = 'optimization-autopilot' as const
export type OptimizationAutopilotJobData =
  | { kind: 'EVALUATE_RUN_ITEM'; runItemId: string; projectId: string }
  | { kind: 'RECONCILE_DAILY' }
```

Use attempts=2, exponential 5000ms, removeOnComplete=100, removeOnFail=200, deterministic `optimization-autopilot-${runItemId}` job ID.

- [ ] **Step 1: Write RED tests**

```ts
expect(QUEUE_NAMES).toContain('optimization-autopilot')
expect(buildOptimizationAutopilotJobOptions(RUN_ITEM_ID)).toMatchObject({
  jobId: `optimization-autopilot-${RUN_ITEM_ID}`,
  attempts: 2,
  backoff: { type: 'exponential', delay: 5_000 }
})
```

P9-B test proves enqueue occurs only after durable `READY_FOR_POLICY / COMPLETED`. If enqueue throws, the worker attempt may fail, but P9-B state remains committed; replay/reconciliation may enqueue again.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.queue.test.ts tests/unit/orchestration.advance-worker.test.ts tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
```

- [ ] **Step 3: Implement queue and scheduler**

Inject:

```ts
type AutopilotRunItemQueuePort = {
  enqueueRunItem(runItemId: string, projectId: string): Promise<unknown>
}
```

into P9-B advance worker. Register one `reconcile-daily` scheduler on the same P9-C queue; payload is only `{ kind: 'RECONCILE_DAILY' }`. Reconciliation scans bounded ready items without an effective current decision and never mutates P9-B rows.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/autopilot.queue.test.ts tests/unit/orchestration.advance-worker.test.ts tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.queue.ts src/modules/optimization-autopilot/autopilot.worker.ts src/queue/queues.ts src/queue/worker-bootstrap.ts src/modules/optimization-orchestration/orchestration.worker.ts tests/unit/autopilot.queue.test.ts tests/unit/orchestration.advance-worker.test.ts tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
git commit -m "feat(p9-c): add autopilot queue and durable handoff"
```

---

### Task 6: P8-owned automatic CONTENT_CREATION preparation through existing P4/P8 AI

**Files:**
- Create: `src/modules/publication/publication-automation-preparation.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Modify: `src/modules/publication/publication-ai.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Create: `tests/integration/autopilot.preparation.test.ts`
- Extend: existing publication AI tests

**Port:**

```ts
interface PublicationAutomationPreparationPort {
  prepareContentCreation(input: {
    projectId: string
    runItemId: string
    optimizationPlanId: string
    decisionId: string
  }): Promise<{
    state: 'WAITING_FOR_BRIEF' | 'WAITING_FOR_ARTICLE' | 'P8_READY' | 'MANUAL_REQUIRED' | 'VALIDATION_BLOCKED'
    proposalId: string | null
    draftId: string | null
    planId: string | null
    previewId: string | null
    reasonCode: string | null
  }>
}
```

- [ ] **Step 1: Write RED preparation tests**

Prove:
- only `CONTENT_CREATION` enters automatic preparation;
- proposal source is `P9_OPTIMIZATION_PLAN`, with deterministic preparation key and bounded P9 provenance;
- retry reuses one proposal/draft/AI task chain;
- `OptimizationPlan.sourceFactReferences` is accepted only as an array of allowlisted `{type,id}` references where type is one of `GROWTH_OPPORTUNITY_IDENTITY`, `GROWTH_OPPORTUNITY_SNAPSHOT`, `GROWTH_OPPORTUNITY_EVIDENCE`; unknown/ref-project mismatch fails manual/blocking;
- P8 materializes these references as `ContentSourceReference` rows with `internalRef=true`, stable `sourceType`, and bounded identifier/title metadata only; it never copies raw P7 evidence/provider payloads into the AI packet;
- seed slug is deterministic ASCII: `p9-${candidate.candidateKey.slice(0, 16)}`; title may remain Unicode. AI does not decide target URL/slug;
- seed draft is never planned; existing `createContentBriefTask()` and `createArticleGenerationTask()` are reused;
- article completion produces a newer immutable draft version before plan creation;
- completed brief `evidenceNeeds` with `NEEDS_SOURCE` or `UNCERTAIN` becomes P8 validation `sourceGaps`; therefore `SOURCE_GAP` warning blocks automatic planning/authorization;
- target resolution requires exactly one enabled `GITHUB_GIT / GIT_DRAFT_PR` site and exactly one enabled channel whose persisted `allowedOperationClasses` explicitly contains `CREATE_CONTENT_PAGE`; zero/multiple/unconfigured matches return `MANUAL_REQUIRED`;
- generated draft validation has zero blocking/warning codes;
- exact P8 operation is `CREATE_CONTENT_PAGE`, P8 risk is LOW, and exact preview is persisted;
- preparation never calls mutation adapter `apply()`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.preparation.test.ts
```

- [ ] **Step 3: Implement minimal P8 preparation**

Reload P9 IDs in P8; do not accept client-supplied body/risk/hash/URL. Seed body:

```ts
const seedBody = `# ${candidate.normalizedQuery}\n\n<!-- Controlled-autopilot seed; generated article revision required before planning. -->`
const slugCandidate = `p9-${candidate.candidateKey.slice(0, 16)}`
```

Do not call `buildPublicationPlan()` for seed version 1. After article materialization, resolve source gaps from the persisted completed brief; validate generated revision; resolve exactly one explicitly CREATE-enabled Git channel; read target snapshot through a P8-owned adapter/target port; use CREATE intent; call P8 risk/policy functions; create immutable preview.

After a publication brief/article task is durably completed, the AI worker invokes an injected **best-effort** continuation callback. It reloads P9 proposal provenance and re-enqueues the run item. Continuation failure must not mark the already-completed AI task failed; daily reconciliation repairs it. Non-P9 AI tasks produce no P9-C enqueue.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.preparation.test.ts tests/integration/publication.ai-generation.test.ts tests/unit/ai.prompt-registry.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/publication/publication-automation-preparation.ts src/modules/publication/publication.repository.ts src/modules/publication/publication.types.ts src/modules/publication/publication-ai.ts src/modules/ai/ai.worker.ts src/queue/worker-bootstrap.ts tests/integration/autopilot.preparation.test.ts tests/integration/publication.ai-generation.test.ts tests/unit/ai.prompt-registry.test.ts
git commit -m "feat(p9-c): add P8 controlled content preparation"
```

---

### Task 7: Immutable P8 machine authorization

**Files:**
- Create: `src/modules/publication/publication-automation-authorization.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Create: `tests/integration/autopilot.authorization.test.ts`

**Interface:**

```ts
export async function authorizePublicationAutomation(input: AuthorizePublicationAutomationInput): Promise<AutomationAuthorizationRecord>
export function assertAutomationAuthorizationCurrent(...): void
```

- [ ] **Step 1: Write RED tests**

Prove machine authorization has no human approver field; freezes project/decision/reservation/plan/version/hash/content/preview/base/repository/branch/blob/policy identity; requires exact LOW + exact CREATE; requires zero warnings; requires `AUTOPILOT_READY` decision bound to same exact P8 artifacts; requires current OFF kill switches and RESERVED matching capacity; expired/stale auth fails before adapter work; row is immutable.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.authorization.test.ts
```

- [ ] **Step 3: Implement P8 validator**

Reuse human approval's immutable binding semantics without calling or weakening `approvePublicationPlan()`. Add machine-only checks for exact LOW/CREATE, decision/policy identity, live kill switches, reservation ownership/currentness, and expiry.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.authorization.test.ts tests/integration/publication.approval.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/publication/publication-automation-authorization.ts src/modules/publication/publication.repository.ts src/modules/publication/publication.types.ts tests/integration/autopilot.authorization.test.ts
git commit -m "feat(p9-c): add P8 automation authorization"
```

---

### Task 8: Typed human/machine P8 execution with one existing worker

**Files:**
- Create: `src/modules/publication/publication-execution.service.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.routes.ts`
- Modify: `src/modules/publication/publication-execution.worker.ts`
- Extend: `tests/unit/publication.execution-worker.test.ts`
- Extend: `tests/integration/publication.execution.test.ts`
- Create: `tests/integration/autopilot.execution.test.ts`

**Creation API:**

```ts
class PublicationExecutionService {
  createHumanApprovedExecution(input: { projectId: string; planId: string }): Promise<PublicationExecution>
  createAutomationAuthorizedExecution(input: { projectId: string; planId: string; automationAuthorizationId: string }): Promise<PublicationExecution>
}
```

Execution key is domain-separated by `PUBLICATION_EXECUTION_KEY_V2`, authorization kind, plan ID, authorization ID, and plan hash.

- [ ] **Step 1: Write RED tests**

Human chain remains `APPROVED -> QUEUED -> EXECUTING -> PR_CREATED`; machine chain is `AUTOMATION_AUTHORIZED -> QUEUED -> EXECUTING -> PR_CREATED`. Both use `processPublicationExecutionJob()`. Machine validates machine auth before adapter resolution; human continues exact approval validation; live target drift blocks both; duplicate PR_CREATED delivery performs zero extra reads/writes. Existing `/execute` remains human-only. No generic untyped authorization ID API is introduced.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts tests/integration/autopilot.execution.test.ts
```

- [ ] **Step 3: Implement discriminated authorization**

```ts
type PublicationExecutionAuthorization =
  | { kind: 'HUMAN_APPROVAL'; approval: ApprovalRecord }
  | { kind: 'AUTOPILOT_AUTHORIZATION'; authorization: AutomationAuthorizationRecord }
```

Load exactly the selected relation. Invalid cardinality fails closed. Validate stored authorization before adapter resolution and live target afterward. Keep adapter resolution/apply/transition/Draft-PR logic shared. Route delegates human execution creation to the new service.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts tests/integration/autopilot.execution.test.ts tests/integration/publication.api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/publication/publication-execution.service.ts src/modules/publication/publication.types.ts src/modules/publication/publication.repository.ts src/modules/publication/publication.routes.ts src/modules/publication/publication-execution.worker.ts tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts tests/integration/autopilot.execution.test.ts tests/integration/publication.api.test.ts
git commit -m "refactor(p9-c): support typed P8 machine execution authorization"
```

---

### Task 9: Complete P9-C worker, observability, idempotent P8 handoff

**Files:**
- Modify: `src/modules/optimization-autopilot/autopilot.service.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.worker.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `src/modules/optimization-autopilot/autopilot-observability.ts`
- Create: `tests/integration/autopilot.worker.test.ts`

**Flow:**

```text
load source/project/policy
-> entitlement + enabled + kill switches
-> freshness + verification pause + conflicts
-> unsupported action => immutable MANUAL_REQUIRED
-> missing P8 => immutable P8_PREPARATION_REQUIRED + P8 preparation
-> exact P8 ready => exact risk/operation/validation/capability/target gates
-> atomically reserve quota/concurrency
-> recheck kill switches
-> immutable AUTOPILOT_READY decision bound to exact P8 plan/preview
-> create/reuse P8 machine authorization
-> create/reuse AUTOMATION_AUTHORIZED execution
-> mark reservation CONSUMED
-> enqueue existing site-mutation-execution
```

Reservation failure yields `DEFERRED_QUOTA` or stable concurrency policy reason, never `AUTOPILOT_READY`.

- [ ] **Step 1: Write RED full-worker tests**

Prove disabled/Standard/unsupported action paths create no restricted P8 work; first valid content evaluation can prepare P8; final exact ready path creates exactly one decision/reservation/auth/execution queue job; replay creates no duplicates; final kill-switch recheck blocks before auth/enqueue; MEDIUM/HIGH/warning/stale/conflict/verification pause/quota/concurrency/target drift stop before adapter apply; P7/P9-A/P9-B source rows remain unchanged.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.worker.test.ts
```

- [ ] **Step 3: Implement worker and bounded events**

Retry infrastructure failures only; deterministic policy results are non-retryable. P9-C never calls Git transport.

Events:

```text
optimization.autopilot.decision.created
optimization.autopilot.deferred
optimization.autopilot.authorization.created
optimization.autopilot.execution.queued
```

Allowlist IDs/status/reason/policyVersion/P8 IDs/risk/operationCount/utcDate only. Exclude bodies, query text, prompts/responses, diffs, policy JSON, provider payloads, tokens, credentials.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.worker.test.ts tests/integration/autopilot.preparation.test.ts tests/integration/autopilot.authorization.test.ts tests/integration/autopilot.execution.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.service.ts src/modules/optimization-autopilot/autopilot.worker.ts src/modules/optimization-autopilot/autopilot.repository.ts src/modules/optimization-autopilot/autopilot-observability.ts tests/integration/autopilot.worker.test.ts
git commit -m "feat(p9-c): complete controlled autopilot worker"
```

---

### Task 10: Strict project policy API and app wiring

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/autopilot.api.test.ts`

Routes:

```text
GET /api/v1/projects/:projectId/optimization/autopilot-policy
PUT /api/v1/projects/:projectId/optimization/autopilot-policy
```

Both run `requireFeature('CONTROLLED_AUTOPILOT')` before API port. GET is persisted-read only. PUT actor is `project-api:${projectId}`.

- [ ] **Step 1: Write RED API tests**

Strict PUT:

```ts
z.object({
  enabled: z.boolean(),
  allowedRiskClass: z.literal('LOW').optional(),
  allowedOperationClasses: z.array(z.literal('CREATE_CONTENT_PAGE')).length(1).optional(),
  dailyDraftPrLimit: z.number().int().min(1).max(10).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(3).optional(),
  requireFreshEvidence: z.boolean().optional(),
  minimumEvidenceCoverage: z.number().min(70).max(100).optional(),
  pauseOnVerificationFailure: z.boolean().optional(),
  killSwitch: z.boolean().optional()
}).strict()
```

Prove Standard fails before port; Advanced/Enterprise succeed; missing policy GET returns safe default projection without creating a row; client fields (`enabledBy`, `updatedBy`, `policyVersion`, status/hashes, MEDIUM/HIGH) reject; actor is server-derived; cross-project isolation; GET triggers no queue/AI/provider/Git work.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.api.test.ts
```

- [ ] **Step 3: Implement routes/app injection**

Add `optimizationAutopilotApi?: OptimizationAutopilotApiPort` to `AppOptions`, mount under `/api/v1`, and expose no public evaluate/execute endpoint in P9-C V1.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.routes.ts src/app.ts tests/integration/autopilot.api.test.ts
git commit -m "feat(p9-c): expose controlled autopilot policy API"
```

---

### Task 11: Authority scans, E2E, docs, and exact-head release gate

**Files:**
- Create: `tests/unit/autopilot.boundary.test.ts`
- Create: `tests/e2e/p9c-controlled-autopilot.spec.ts`
- Create: `docs/development/p9-c-controlled-autopilot.md`
- Review/extend: `tests/unit/queues.test.ts`
- Review/extend: `tests/unit/worker-bootstrap.test.ts`
- Do not modify `.github/workflows/ci.yml` unless an independently proven CI defect is handled as a separate reviewed change.

- [ ] **Step 1: Add static authority tests**

Scan P9-C implementation and reject imports/references to:

```text
github-mutation.adapter
deepseek.provider
growth-score
growth-detector
mergePullRequest
merge_pull_request
forcePush
autoRollback
```

Also assert only one P9-C queue, no P9-C UPDATE/DELETE methods for P7/P9-A/P9-B authority tables, no PR merge/deploy path, machine auth has no approver field, and human approval semantics remain separate.

- [ ] **Step 2: Add Chromium E2E safety contract**

`tests/e2e/p9c-controlled-autopilot.spec.ts` covers: Standard denied; Advanced policy off by default; GET no side effects; safe policy values persist; forbidden MEDIUM/HIGH/unknown fields reject; UI/API wording does not claim auto merge/deploy. Real external Git/provider writes are not used; Draft-PR behavior remains integration-tested with injected fakes.

- [ ] **Step 3: Write operator docs**

`docs/development/p9-c-controlled-autopilot.md` documents OFF default, feature matrix, exact CREATE-only path, deterministic hash slug, internal source-reference projection, source-gap stop, channel explicit CREATE allowlist, global/project kill switches, policy bounds, UTC quota/concurrency, human vs machine authorization, P8 authority, queue/scheduler, reason-code triage, AI continuation, no merge/deploy/auto-rollback, and operational disable/rollback via kill switch + policy disable without deleting audit history.

- [ ] **Step 4: Focused release regression**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run \
  tests/unit/autopilot.config.test.ts \
  tests/unit/autopilot.feature-gate.test.ts \
  tests/unit/autopilot.identity.test.ts \
  tests/unit/autopilot.policy.test.ts \
  tests/unit/autopilot.gates.test.ts \
  tests/unit/autopilot.queue.test.ts \
  tests/unit/autopilot.boundary.test.ts \
  tests/integration/autopilot.persistence.test.ts \
  tests/integration/autopilot.reservation.test.ts \
  tests/integration/autopilot.preparation.test.ts \
  tests/integration/autopilot.authorization.test.ts \
  tests/integration/autopilot.execution.test.ts \
  tests/integration/autopilot.worker.test.ts \
  tests/integration/autopilot.api.test.ts \
  tests/integration/publication.execution.test.ts \
  tests/unit/publication.execution-worker.test.ts
npm run typecheck
npm run build
```

- [ ] **Step 5: Full local regression**

```bash
npm test
npm run test:e2e
npm run build
```

- [ ] **Step 6: Manual final diff review**

Confirm no P7 score/detector changes; no P9-A/P9-B authority mutation; no fake approval; machine state `AUTOMATION_AUTHORIZED`; P8 remains exact risk/plan/preview/mutation authority; automatic path exact CREATE only; source-gap/channel/slug rules are enforced; reservation is serialized; kill switch rechecked immediately before machine auth/enqueue; no merge/deploy/auto-rollback; additive migrations only; no unrelated dependency/CI changes.

- [ ] **Step 7: Commit release docs/tests**

```bash
git add tests/unit/autopilot.boundary.test.ts tests/e2e/p9c-controlled-autopilot.spec.ts docs/development/p9-c-controlled-autopilot.md tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
git commit -m "docs(p9-c): add controlled autopilot release gate"
```

- [ ] **Step 8: Open/update Draft PR**

Title:

```text
P9-C: add controlled autopilot policy
```

Do not mark Ready until the exact PR head has:

```text
verify            ✅  # Prisma validate/generate/migrate, Typecheck, full Vitest, Build
production-audit  ✅
e2e               ✅  # full Chromium suite
```

- [ ] **Step 9: Final exact-head review**

Exact head must equal the head verified by all three jobs; unresolved review threads=0; manual changed-file authority review complete; no success claim based on superseded CI. Do not merge or deploy.

## Definition of Done

P9-C is complete only when this exact fail-closed path is proven:

```text
P9-A CONTENT_CREATION
-> P9-B READY_FOR_POLICY
-> P9-C persisted policy gates
-> P8 existing content brief/article AI pipeline
-> source gaps = none
-> deterministic safe slug + explicitly CREATE-enabled Git channel
-> exact P8 CREATE_CONTENT_PAGE plan/preview
-> exact P8 LOW + zero warnings
-> race-safe quota/concurrency reservation
-> immutable P9 AUTOPILOT_READY decision
-> immutable P8 PublicationAutomationAuthorization
-> PublicationExecution = AUTOMATION_AUTHORIZED
-> existing P8 execution worker
-> Draft PR
-> human merge / human deployment
```

Any ambiguity, stale/unknown evidence, unsupported action/operation, source gap, warning, MEDIUM/HIGH risk, channel ambiguity, conflict, quota/concurrency block, verification pause, kill switch, or revision drift stops automation without workaround.