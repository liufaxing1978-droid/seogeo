# P9-C Controlled Autopilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a controlled-autopilot policy layer that can automatically prepare and create a P8 Draft PR for an explicitly opted-in Advanced/Enterprise project only when the exact persisted P8 change is provably LOW risk, exact `CREATE_CONTENT_PAGE`, current, warning-free, quota-safe, conflict-free, and authorized by a distinct machine-authorization record.

**Architecture:** P9-C owns policy, deterministic decisions, quota/concurrency reservation, and one `optimization-autopilot` BullMQ queue. It consumes P9-B items only after `READY_FOR_POLICY / COMPLETED`, creates immutable P9 policy decisions, and invokes narrow P8-owned preparation/authorization/execution services. P8 remains authoritative for content preparation, exact `PublicationPlan`, `PublicationPreview`, deterministic validation, risk, live target checks, Git mutation, Draft PR creation, and verification. Human `PublicationApproval -> APPROVED` and machine `PublicationAutomationAuthorization -> AUTOMATION_AUTHORIZED` remain semantically distinct but converge into the existing P8 execution worker.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, BullMQ 5.58, Zod 3.25, Express 5, Vitest 3.2, Supertest 7, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-p9-c-controlled-autopilot-design.md`

## Global Constraints

- Base is `main@58d031cb07342a6655ae84093c00ce7bfaf6f0c2`; implementation branch is `feat/p9-c-controlled-autopilot`.
- The P9-C design was explicitly approved by the user on 2026-08-23. Do not implement directly on `main`.
- P7 remains authoritative for Growth identity, score, evidence, ranking eligibility, lifecycle, and provenance. P9-C may read persisted P7 facts but must not import or call detector/scoring functions.
- P9-A candidates/plans remain immutable. P9-C must not set or rewrite `OptimizationPlan.automationEligibility`.
- P9-B remains authoritative for run/item orchestration position. P9-C must not rewrite `OptimizationRun` or `OptimizationRunItem` state.
- P8 remains authoritative for exact publication operations, risk, deterministic validation, immutable plan/preview binding, Git mutation, Draft PR creation, real-site verification, rollback proposals, merge, and deploy.
- Machine authorization must never be represented as human `PublicationApproval`; machine entry status is `AUTOMATION_AUTHORIZED`, never `APPROVED`.
- P9-C V1 automatic scope is exactly `P9-A CONTENT_CREATION -> P8 CREATE_CONTENT_PAGE`. Every other P9 action or exact P8 operation is manual-only in V1.
- P8 risk must be exactly `LOW`; MEDIUM/HIGH can never receive machine authorization.
- Any P8 warning, including `SOURCE_GAP`, requires human review and blocks automatic authorization. P9-C must never auto-confirm warning codes.
- `CONTROLLED_AUTOPILOT`: STANDARD=false, ADVANCED=true, ENTERPRISE=true. Entitlement does not imply opt-in.
- Project policy defaults: disabled, LOW only, `[CREATE_CONTENT_PAGE]`, daily quota 3, concurrency 1, fresh evidence required, minimum coverage 70, pause on verification failure enabled, project kill switch off.
- Policy bounds: daily quota 1..10, concurrency 1..3, minimum evidence coverage 70..100.
- `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH` fails closed: only an explicitly parsed OFF value allows machine authorization/enqueue; missing/malformed/unknown means ON.
- Add exactly one P9-C-owned queue: `optimization-autopilot`. Do not add an event bus or a second P8 execution queue.
- P9-C queue payloads contain durable IDs only. Never put article bodies, provider payloads, prompts, responses, Git tokens, diffs, source evidence bodies, or policy JSON in BullMQ payloads.
- Daily reconciliation uses UTC and a date-free scheduled job. The worker derives the UTC date at runtime.
- Quota/concurrency must use a PostgreSQL serialization guard; a non-atomic count-then-insert implementation is forbidden.
- All schema changes are additive/forward-only. Never edit an already-applied P8/P9-A/P9-B migration.
- P9-C implementation modules must not import `github-mutation.adapter.ts`, `deepseek.provider.ts`, P7 score/detector implementations, merge helpers, deploy helpers, or automatic rollback code.
- Human P8 approval/execution behavior must remain regression-compatible.
- PR stays Draft until its exact final head passes `verify`, `production-audit`, and `e2e`, manual authority review is complete, and unresolved review threads are zero.
- Merge still requires a separate explicit human `合并`. Deployment requires a separate explicit authorization.

## Planned File Structure

P9-C module:
- `src/modules/optimization-autopilot/autopilot.config.ts`
- `src/modules/optimization-autopilot/autopilot.types.ts`
- `src/modules/optimization-autopilot/autopilot.identity.ts`
- `src/modules/optimization-autopilot/autopilot.policy.ts`
- `src/modules/optimization-autopilot/autopilot.repository.ts`
- `src/modules/optimization-autopilot/autopilot.reservation.ts`
- `src/modules/optimization-autopilot/autopilot.queue.ts`
- `src/modules/optimization-autopilot/autopilot.service.ts`
- `src/modules/optimization-autopilot/autopilot.worker.ts`
- `src/modules/optimization-autopilot/autopilot.routes.ts`

P8 additive/refactor surface:
- `src/modules/publication/publication-automation-preparation.ts`
- `src/modules/publication/publication-automation-authorization.ts`
- `src/modules/publication/publication-execution.service.ts`
- `src/modules/publication/publication.types.ts`
- `src/modules/publication/publication.repository.ts`
- `src/modules/publication/publication.routes.ts`
- `src/modules/publication/publication-execution.worker.ts`
- `src/modules/publication/publication-ai.ts`
- `src/modules/ai/ai.worker.ts`

Cross-cutting:
- `src/auth/feature-flags.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`
- `src/modules/optimization-orchestration/orchestration.worker.ts`
- `src/app.ts`
- `.env.example`

Prisma:
- `prisma/models/optimization-autopilot.prisma`
- `prisma/models/optimization-orchestration.prisma`
- `prisma/models/publication.prisma`
- `prisma/migrations/20260823140000_add_p9c_controlled_autopilot/migration.sql`

Tests:
- `tests/unit/autopilot.config.test.ts`
- `tests/unit/autopilot.feature-gate.test.ts`
- `tests/unit/autopilot.identity.test.ts`
- `tests/unit/autopilot.policy.test.ts`
- `tests/unit/autopilot.gates.test.ts`
- `tests/unit/autopilot.queue.test.ts`
- `tests/unit/autopilot.boundary.test.ts`
- `tests/integration/autopilot.persistence.test.ts`
- `tests/integration/autopilot.reservation.test.ts`
- `tests/integration/autopilot.preparation.test.ts`
- `tests/integration/autopilot.authorization.test.ts`
- `tests/integration/autopilot.execution.test.ts`
- `tests/integration/autopilot.worker.test.ts`
- `tests/integration/autopilot.api.test.ts`
- extend `tests/integration/publication.execution.test.ts`
- extend `tests/unit/publication.execution-worker.test.ts`
- extend `tests/unit/orchestration.advance-worker.test.ts`
- extend `tests/unit/queues.test.ts`
- extend `tests/unit/worker-bootstrap.test.ts`
- create `tests/e2e/p9c-controlled-autopilot.spec.ts`

---

### Task 1: Add policy/persistence foundation, feature entitlement, and fail-closed global switch

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

**Schema contract:**

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

enum AutopilotReservationStatus {
  RESERVED
  CONSUMED
  RELEASED
}
```

Add `AutopilotPolicy`, immutable `OptimizationAutopilotDecision`, and `AutopilotExecutionReservation`. Extend `PublicationProposalSourceType` with `P9_OPTIMIZATION_PLAN`. Add immutable `PublicationAutomationAuthorization`. Extend `PublicationExecutionStatus` and `PublicationExecutionEventType` with `AUTOMATION_AUTHORIZED`. Make `PublicationExecution.approvalId` nullable, add nullable `automationAuthorizationId`, and enforce a PostgreSQL CHECK requiring exactly one authorization source.

Add one nullable unique `automationPreparationKey` to `PublicationProposal` so repeated P9 preparation can reuse one proposal without relying on mutable metadata queries.

- [ ] **Step 1: Write RED tests**

```ts
it('gates controlled autopilot to Advanced and Enterprise only', () => {
  expect(hasFeature('STANDARD', 'CONTROLLED_AUTOPILOT')).toBe(false)
  expect(hasFeature('ADVANCED', 'CONTROLLED_AUTOPILOT')).toBe(true)
  expect(hasFeature('ENTERPRISE', 'CONTROLLED_AUTOPILOT')).toBe(true)
})

it('treats missing or malformed global switch values as killed', () => {
  expect(parseControlledAutopilotGlobalKillSwitch(undefined)).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('garbage')).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('true')).toBe(true)
  expect(parseControlledAutopilotGlobalKillSwitch('false')).toBe(false)
})
```

Persistence RED must additionally prove:
- `PublicationExecution` cannot persist with both authorization IDs null;
- it cannot persist with both non-null;
- `OptimizationAutopilotDecision` and `PublicationAutomationAuthorization` reject UPDATE/DELETE through DB immutability triggers;
- `PublicationProposal.automationPreparationKey` is unique.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.config.test.ts tests/unit/autopilot.feature-gate.test.ts tests/integration/autopilot.persistence.test.ts
```

Expected: missing feature/module/schema contracts.

- [ ] **Step 3: Implement minimal schema/config/feature code**

```ts
export function parseControlledAutopilotGlobalKillSwitch(value: string | undefined): boolean {
  if (value === undefined) return true
  const normalized = value.trim().toLowerCase()
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false
  if (normalized === 'true' || normalized === '1' || normalized === 'on') return true
  return true
}
```

Add `CONTROLLED_AUTOPILOT` to the feature union and Advanced set only; Enterprise inherits it. Add `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` to `.env.example` so newly configured environments are safe by default.

Migration SQL must add enums/models/relations/checks/indexes/immutability triggers without changing prior migration files.

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

### Task 2: Implement policy normalization, deterministic identities, and immutable decision persistence

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.types.ts`
- Create: `src/modules/optimization-autopilot/autopilot.identity.ts`
- Create: `src/modules/optimization-autopilot/autopilot.policy.ts`
- Create: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `src/modules/optimization-autopilot/autopilot.service.ts`
- Create: `tests/unit/autopilot.identity.test.ts`
- Create: `tests/unit/autopilot.policy.test.ts`
- Extend: `tests/integration/autopilot.persistence.test.ts`

**Public constants/interfaces:**

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

Repository/service surface:

```ts
export class OptimizationAutopilotRepository {
  getPolicy(projectId: string): Promise<AutopilotPolicy | null>
  upsertPolicy(projectId: string, input: NormalizedAutopilotPolicy, actorId: string): Promise<AutopilotPolicy>
  loadRunItemContext(runItemId: string, projectId: string): Promise<AutopilotRunItemContext | null>
  createOrGetDecision(input: CreateAutopilotDecisionInput): Promise<OptimizationAutopilotDecision>
  listReadyItemsWithoutEffectiveDecision(limit: number): Promise<Array<{ id: string; projectId: string }>>
}
```

- [ ] **Step 1: Write RED tests**

```ts
it('normalizes policy to the exact V1 safe bounds', () => {
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
})

it('creates a new decision identity when immutable P8 binding changes', () => {
  const before = buildAutopilotDecisionKey({ ...input, p8PlanId: null, p8PreviewId: null })
  const after = buildAutopilotDecisionKey({ ...input, p8PlanId: 'plan-1', p8PreviewId: 'preview-1' })
  expect(before).not.toBe(after)
})
```

Also prove MEDIUM/HIGH risk input, quota outside 1..10, concurrency outside 1..3, coverage outside 70..100, and any operation other than `CREATE_CONTENT_PAGE` are rejected.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.identity.test.ts tests/unit/autopilot.policy.test.ts tests/integration/autopilot.persistence.test.ts
```

- [ ] **Step 3: Implement canonical identity and policy persistence**

Use recursive canonical JSON with sorted object keys and explicit nulls. Policy snapshots sort/dedupe operation classes before hashing. `createOrGetDecision()` reuses only an exactly identical unique decision key; a P2002 collision must be re-read and identity-checked.

`getPolicy()` must not create a row. A missing row means autopilot is disabled. A read route may render a calculated default projection, but GET cannot write defaults.

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

### Task 3: Add freshness, verification-pause, conflict, and exact P8 gate evaluation

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.gates.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `tests/unit/autopilot.gates.test.ts`
- Create: `tests/integration/autopilot.authority.test.ts`

**Gate result contract:**

```ts
export type AutopilotGateResult =
  | { allowed: true }
  | { allowed: false; status: 'MANUAL_REQUIRED' | 'POLICY_BLOCKED' | 'DEFERRED_CONFLICT' | 'STALE' | 'P8_VALIDATION_BLOCKED'; reasonCode: string }

export function evaluateStaticAutopilotGates(input: AutopilotGateInput): AutopilotGateResult
```

Repository readers must provide only persisted facts:
- latest Growth snapshot ID for the candidate's `growthOpportunityIdentityId`;
- latest authoritative project P8 verification outcome;
- active P8 execution target URL/path conflicts;
- existing machine authorization/execution for the same P9 run item/source identity;
- exact P8 plan/preview/site/channel when present.

- [ ] **Step 1: Write RED tests**

```ts
it('never infers LOW automation from the P9 recommended action alone', () => {
  const result = evaluateStaticAutopilotGates({
    ...base,
    recommendedActionType: 'CONTENT_CREATION',
    p8: null
  })
  expect(result).toEqual({
    allowed: false,
    status: 'P8_VALIDATION_BLOCKED',
    reasonCode: 'AUTOPILOT_P8_PREPARATION_REQUIRED'
  })
})

it('blocks any warning even when P8 risk is LOW', () => {
  const result = evaluateStaticAutopilotGates({
    ...base,
    p8: { ...p8, riskClass: 'LOW', operationTypes: ['CREATE_CONTENT_PAGE'], warningCodes: ['SOURCE_GAP'] }
  })
  expect(result).toMatchObject({ allowed: false, reasonCode: 'AUTOPILOT_P8_WARNING_REQUIRES_HUMAN' })
})
```

Lock deterministic first-failure order for: stale source, insufficient evidence, terminal lifecycle, unresolved verification failure, conflict, unsupported P9 action, P8 MEDIUM/HIGH, broad `UPDATE_CONTENT_PAGE`, missing Git Draft PR capability, and stale target binding.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.gates.test.ts tests/integration/autopilot.authority.test.ts
```

- [ ] **Step 3: Implement read-only deterministic gates**

Do not call P7 detector/scoring code. Freshness is equality against the latest persisted Growth snapshot for the same identity. Terminal lifecycle blocks. Verification pause is based on persisted P8 state only. Ambiguous overlap is conflict.

The exact automatic P8 operation predicate is:

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

### Task 4: Implement race-safe daily quota and concurrency reservation

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.reservation.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `tests/integration/autopilot.reservation.test.ts`

**Interface:**

```ts
export type ReserveAutopilotCapacityResult =
  | { reserved: true; reservation: AutopilotExecutionReservation }
  | { reserved: false; reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' | 'AUTOPILOT_CONCURRENCY_LIMIT' }

export async function reserveAutopilotCapacity(input: {
  projectId: string
  decisionId: string
  utcDate: string
  dailyDraftPrLimit: number
  maxConcurrentRuns: number
}): Promise<ReserveAutopilotCapacityResult>
```

- [ ] **Step 1: Write RED race tests**

```ts
const results = await Promise.all(
  Array.from({ length: 2 }, (_, index) => reserveAutopilotCapacity({
    projectId,
    decisionId: decisionIds[index]!,
    utcDate: '2026-08-23',
    dailyDraftPrLimit: 1,
    maxConcurrentRuns: 3
  }))
)
expect(results.filter((result) => result.reserved)).toHaveLength(1)
```

Also prove:
- repeated reservation for the same decision reuses one row;
- projects do not share quota;
- UTC dates do not share quota;
- `AUTOMATION_AUTHORIZED`, `QUEUED`, `EXECUTING` consume concurrency;
- `PR_CREATED` no longer consumes concurrency but still consumes the daily slot;
- human-approved executions never count against P9-C quota/concurrency.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.reservation.test.ts
```

- [ ] **Step 3: Implement transaction serialization**

Use one PostgreSQL transaction and one transaction-scoped advisory lock keyed from `p9c:${projectId}:${utcDate}` before reading capacity and inserting the reservation. The lock and reads/insertion must share the same transaction client.

Conceptual SQL:

```sql
SELECT pg_advisory_xact_lock(hashtextextended($1, 0));
```

Do not perform `count -> return -> insert` outside the lock transaction.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/autopilot.reservation.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-autopilot/autopilot.reservation.ts src/modules/optimization-autopilot/autopilot.repository.ts tests/integration/autopilot.reservation.test.ts
git commit -m "feat(p9-c): add race-safe autopilot capacity reservations"
```

---

### Task 5: Add the one P9-C queue, P9-B durable handoff, and daily reconciliation

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

**Queue contract:**

```ts
export const OPTIMIZATION_AUTOPILOT_QUEUE_NAME = 'optimization-autopilot' as const
export const OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS = 2

export type OptimizationAutopilotJobData =
  | { kind: 'EVALUATE_RUN_ITEM'; runItemId: string; projectId: string }
  | { kind: 'RECONCILE_DAILY' }

export class OptimizationAutopilotQueue {
  enqueueRunItem(runItemId: string, projectId: string): Promise<unknown>
}
```

Job options: attempts=2, exponential 5000ms, removeOnComplete=100, removeOnFail=200, deterministic run-item job ID.

- [ ] **Step 1: Write RED queue/handoff/bootstrap tests**

```ts
expect(QUEUE_NAMES).toContain('optimization-autopilot')
expect(buildOptimizationAutopilotJobOptions(RUN_ITEM_ID)).toMatchObject({
  jobId: `optimization-autopilot-${RUN_ITEM_ID}`,
  attempts: 2,
  backoff: { type: 'exponential', delay: 5_000 }
})
```

P9-B advance-worker test must prove enqueue happens only after the item is durably `READY_FOR_POLICY / COMPLETED`. A queue failure may reject the worker attempt, but persisted P9-B state must remain completed so retry/reconciliation is safe.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/autopilot.queue.test.ts tests/unit/orchestration.advance-worker.test.ts tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
```

- [ ] **Step 3: Implement queue/handoff/reconciliation skeleton**

Add an injected port to P9-B advance dependencies:

```ts
export type AutopilotRunItemQueuePort = {
  enqueueRunItem(runItemId: string, projectId: string): Promise<unknown>
}
```

After the durable item transition/reload proves `READY_FOR_POLICY / COMPLETED`, enqueue the ID. Replayed completed items may safely re-enqueue the deterministic job.

Register one date-free daily scheduler on the same queue:

```ts
export const OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-autopilot-daily-reconcile',
  repeat: { every: 24 * 60 * 60 * 1000 },
  job: { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' } }
} as const
```

Reconciliation scans bounded `READY_FOR_POLICY` items without an effective decision and re-enqueues them; it does not modify P9-B rows.

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

### Task 6: Add P8-owned automatic content-creation preparation through the existing P4/P8 AI path

**Files:**
- Create: `src/modules/publication/publication-automation-preparation.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Modify: `src/modules/publication/publication-ai.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Create: `tests/integration/autopilot.preparation.test.ts`
- Extend: relevant P8 AI worker tests

**P8-owned preparation port:**

```ts
export interface PublicationAutomationPreparationPort {
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

Lock these contracts:
- only `OptimizationPlan.recommendedActionType === CONTENT_CREATION` may enter this service;
- proposal is `P9_OPTIMIZATION_PLAN`, has deterministic `automationPreparationKey`, bounded provenance, and is reused on retry;
- P8 creates a deterministic seed draft only as an AI-workspace input; the seed itself can never be planned/executed automatically;
- content brief uses existing `createContentBriefTask()`;
- article generation uses existing `createArticleGenerationTask()` only after the brief is completed;
- article output must create a newer immutable draft version before plan creation;
- automatic site/channel selection requires exactly one enabled `GITHUB_GIT / GIT_DRAFT_PR` target and one compatible enabled content channel; zero or multiple matches return `MANUAL_REQUIRED`;
- P8 validator must produce zero blocking and zero warning codes;
- exact built operation is `CREATE_CONTENT_PAGE`, risk is classified by P8 as LOW, and exact preview exists;
- no Git adapter `apply()` is called during preparation.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.preparation.test.ts
```

- [ ] **Step 3: Implement bounded P8 preparation**

Use IDs as the P9->P8 boundary; reload source facts in P8. Use the existing publication AI gateway helpers rather than importing DeepSeek.

Seed draft must be clearly non-authoritative and non-publishable before the generated article revision exists:

```ts
const seedBody = `# ${title}\n\n<!-- Controlled-autopilot seed. P8 article generation is required before planning. -->`
```

Do not call `buildPublicationPlan()` for version 1 seed. After article materialization, validate the generated revision, obtain the configured target snapshot through a P8-owned mutation-target/preview dependency, build CREATE intent, classify/assert P8 operation policy, then persist the immutable plan/preview.

For prompt continuation, keep the AI worker authoritative transaction unchanged. After a publication brief/article task is durably completed, invoke an injected **best-effort** continuation callback that reloads the draft's P9 proposal provenance and re-enqueues its P9-C run item. Failure of this callback must not retroactively mark the completed AI task failed; daily P9-C reconciliation repairs missed continuation.

Production bootstrap supplies the continuation callback; non-P9 publication tasks produce no P9-C enqueue.

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

### Task 7: Add immutable P8 machine authorization with exact LOW-only bindings

**Files:**
- Create: `src/modules/publication/publication-automation-authorization.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Create: `tests/integration/autopilot.authorization.test.ts`

**Interfaces:**

```ts
export type AutomationAuthorizationRecord = {
  id: string
  projectId: string
  planId: string
  planVersion: number
  planHash: string
  contentVersion: number
  contentHash: string
  previewHash: string
  baseSha: string
  targetRepository: string
  targetBranch: string
  targetBlobHashes: unknown
  authorizedRiskClass: 'LOW'
  automationDecisionId: string
  automationPolicyVersion: string
  automationPolicyHash: string
  automationSource: 'CONTROLLED_AUTOPILOT'
  reservationId: string
  expiresAt: Date
}

export async function authorizePublicationAutomation(input: AuthorizePublicationAutomationInput): Promise<AutomationAuthorizationRecord>
export function assertAutomationAuthorizationCurrent(...): void
```

- [ ] **Step 1: Write RED authorization tests**

Prove:
- no `approverActorId` exists on machine authorization;
- exact project/decision/reservation/plan/preview/content/base/blob binding is frozen;
- P8 risk must be exactly LOW;
- exact operations must be exactly `[CREATE_CONTENT_PAGE]`;
- any blocking/warning/unconfirmed warning rejects authorization;
- decision must be `AUTOPILOT_READY` and bind the same exact P8 plan/preview;
- current project/global kill switches must be OFF;
- reservation must belong to the same project/decision and be RESERVED;
- expired/stale authorization fails before any mutation adapter work;
- authorization row is immutable.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.authorization.test.ts
```

- [ ] **Step 3: Implement P8-owned authorization validator**

Reuse the same immutable comparison semantics as human approval for plan/version/hash, content hash, preview hash, base SHA, repository, branch, and touched blobs, but do not call or weaken `approvePublicationPlan()`.

Machine-specific checks are additive: LOW only, exact CREATE operation, policy/decision identity, live kill switches, reservation ownership/currentness, expiry.

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

### Task 8: Refactor P8 execution into typed human/machine authorization paths while preserving one worker

**Files:**
- Create: `src/modules/publication/publication-execution.service.ts`
- Modify: `src/modules/publication/publication.types.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Modify: `src/modules/publication/publication.routes.ts`
- Modify: `src/modules/publication/publication-execution.worker.ts`
- Extend: `tests/unit/publication.execution-worker.test.ts`
- Extend: `tests/integration/publication.execution.test.ts`
- Create: `tests/integration/autopilot.execution.test.ts`

**Typed creation surface:**

```ts
export class PublicationExecutionService {
  createHumanApprovedExecution(input: { projectId: string; planId: string }): Promise<PublicationExecution>
  createAutomationAuthorizedExecution(input: {
    projectId: string
    planId: string
    automationAuthorizationId: string
  }): Promise<PublicationExecution>
}
```

Execution keys must be domain-separated by authorization source, for example:

```text
PUBLICATION_EXECUTION_KEY_V2
HUMAN_APPROVAL | AUTOMATION_AUTHORIZATION
planId
authorizationId
planHash
```

- [ ] **Step 1: Write RED dual-authorization tests**

Human regression must continue to assert:

```text
APPROVED -> QUEUED -> EXECUTING -> PR_CREATED
```

Machine test must assert:

```text
AUTOMATION_AUTHORIZED -> QUEUED -> EXECUTING -> PR_CREATED
```

Also prove:
- both use the same `processPublicationExecutionJob()`;
- machine path validates its machine authorization before adapter resolution;
- human path still validates `PublicationApproval` exactly as before;
- live target base/blob drift still blocks both paths;
- duplicate delivery after `PR_CREATED` performs zero additional adapter reads/writes;
- route `/execute` remains human-only and selects human approval, never machine authorization;
- there is no generic `authorizationId` creation API that can conflate sources.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts tests/integration/autopilot.execution.test.ts
```

- [ ] **Step 3: Implement discriminated authorization context**

Refactor worker context to:

```ts
type PublicationExecutionAuthorization =
  | { kind: 'HUMAN_APPROVAL'; approval: ApprovalRecord }
  | { kind: 'AUTOPILOT_AUTHORIZATION'; authorization: AutomationAuthorizationRecord }
```

Load exactly the relation selected by the execution row. A row with invalid authorization cardinality fails closed. Validate stored authorization before resolving adapter; validate live target afterward. Keep adapter selection/apply/transition/PR logic shared.

Human route `executePlan()` delegates to `PublicationExecutionService.createHumanApprovedExecution()` and existing `PublicationExecutionQueue` instead of owning execution persistence itself.

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

### Task 9: Complete the P9-C worker state machine, bounded observability, and idempotent Draft-PR handoff

**Files:**
- Modify: `src/modules/optimization-autopilot/autopilot.service.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.worker.ts`
- Modify: `src/modules/optimization-autopilot/autopilot.repository.ts`
- Create: `src/modules/optimization-autopilot/autopilot-observability.ts`
- Create: `tests/integration/autopilot.worker.test.ts`

**Worker flow:**

```text
load run item / plan / candidate / project / policy
-> entitlement + enabled + kill-switch gates
-> freshness / verification-pause / conflict gates
-> if unsupported action: immutable MANUAL_REQUIRED decision
-> if P8 not ready: immutable P8_PREPARATION_REQUIRED decision + call P8 preparation port
-> when P8 exact plan/preview ready: re-evaluate all exact P8 gates
-> reserve quota/concurrency atomically
-> recheck project/global kill switches
-> persist immutable AUTOPILOT_READY decision bound to exact P8 artifacts
-> create/reuse P8 machine authorization
-> create/reuse AUTOMATION_AUTHORIZED execution
-> consume reservation
-> enqueue existing site-mutation-execution queue
```

If reservation fails, persist `DEFERRED_QUOTA` or policy-blocked concurrency reason for that immutable evaluation; do not manufacture `AUTOPILOT_READY`.

- [ ] **Step 1: Write RED full-worker tests**

Prove:
- policy disabled creates no P8 proposal/AI task/reservation/authorization/execution;
- Standard entitlement block occurs before restricted persistence/AI/Git work;
- unsupported P9 action yields `MANUAL_REQUIRED` and no P8 automation work;
- first CONTENT_CREATION evaluation may produce `P8_PREPARATION_REQUIRED` and start/reuse P8 preparation;
- final exact P8 LOW CREATE plan produces one AUTOPILOT_READY decision, one reservation, one machine authorization, one execution queue job;
- retry/replay produces no duplicate decision for the same identity, no duplicate reservation, authorization, execution, AI request, or Draft PR;
- final kill-switch recheck blocks before authorization/execution enqueue even if earlier evaluation passed;
- MEDIUM/HIGH, warnings, stale source, conflict, verification pause, target drift, quota exhaustion all stop before adapter apply;
- P7/P9-A/P9-B source rows are byte-for-byte/logically unchanged after worker processing.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.worker.test.ts
```

- [ ] **Step 3: Implement full orchestration**

Classify deterministic policy failures as non-retryable. Retry only infrastructure failures already recognized by existing DB/Redis/provider/Git boundaries. P9-C worker itself never calls Git mutation transport.

Emit only bounded events:

```text
optimization.autopilot.decision.created
optimization.autopilot.deferred
optimization.autopilot.authorization.created
optimization.autopilot.execution.queued
```

Allowed fields: IDs, status/reason code, policy version, P8 plan/execution IDs, risk class, operation count, UTC date. Do not emit article bodies, source query text, prompts/responses, diffs, policy JSON, credentials, tokens, or provider payloads.

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

### Task 10: Add strict project-scoped policy API and app wiring

**Files:**
- Create: `src/modules/optimization-autopilot/autopilot.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/autopilot.api.test.ts`

**Routes:**

```text
GET /api/v1/projects/:projectId/optimization/autopilot-policy
PUT /api/v1/projects/:projectId/optimization/autopilot-policy
```

Both require `CONTROLLED_AUTOPILOT` before restricted service calls. GET is persisted-read only. PUT actor is server-derived as `project-api:${projectId}`.

**Strict PUT schema:**

```ts
const autopilotPolicySchema = z.object({
  enabled: z.boolean(),
  allowedRiskClass: z.literal('LOW').optional(),
  allowedOperationClasses: z.array(z.literal('CREATE_CONTENT_PAGE')).min(1).max(1).optional(),
  dailyDraftPrLimit: z.number().int().min(1).max(10).optional(),
  maxConcurrentRuns: z.number().int().min(1).max(3).optional(),
  requireFreshEvidence: z.boolean().optional(),
  minimumEvidenceCoverage: z.number().min(70).max(100).optional(),
  pauseOnVerificationFailure: z.boolean().optional(),
  killSwitch: z.boolean().optional()
}).strict()
```

- [ ] **Step 1: Write RED API tests**

Prove:
- Standard GET/PUT returns 403 before API port call;
- Advanced/Enterprise can read/write;
- GET on missing row returns safe default projection but creates no DB row;
- unknown/client-owned fields (`enabledBy`, `updatedBy`, policyVersion, decisionStatus, planHash, riskClass MEDIUM/HIGH) are rejected;
- actor identity is server-derived;
- project IDs remain scoped; cross-project policy access does not leak data;
- GET causes zero queue/AI/provider/Git side effects.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/autopilot.api.test.ts
```

- [ ] **Step 3: Implement routes/app option**

Add:

```ts
export interface AppOptions {
  // existing fields...
  optimizationAutopilotApi?: OptimizationAutopilotApiPort
}
```

Mount under `/api/v1` next to optimization orchestration routes. Do not add an execution/evaluate public endpoint in P9-C V1.

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

### Task 11: Add authority scans, E2E safety contract, operator docs, and exact-head release gate

**Files:**
- Create: `tests/unit/autopilot.boundary.test.ts`
- Create: `tests/e2e/p9c-controlled-autopilot.spec.ts`
- Create: `docs/development/p9-c-controlled-autopilot.md`
- Review/extend: `tests/unit/queues.test.ts`
- Review/extend: `tests/unit/worker-bootstrap.test.ts`
- Do not modify `.github/workflows/ci.yml` unless an independently proven CI defect requires a separate reviewed change.

- [ ] **Step 1: Write/complete authority-boundary tests**

Static scan `src/modules/optimization-autopilot/**` and reject imports/references to:

```text
github-mutation.adapter
deepseek.provider
growth-score
growth-detector
mergePullRequest
merge_pull_request
deploy
force push
forcePush
auto rollback
autoRollback
```

Also assert:
- one P9-C queue only;
- no P9-C module writes `OptimizationCandidate`, `OptimizationPlan`, `OptimizationRun`, or `OptimizationRunItem` UPDATE/DELETE methods;
- no automatic path calls PR merge or deployment APIs;
- P8 machine authorization cannot store `approverActorId`;
- human approval module remains unchanged in semantic authority.

- [ ] **Step 2: Add focused E2E safety contract**

`tests/e2e/p9c-controlled-autopilot.spec.ts` must cover persisted HTTP surfaces without requiring live Git/provider credentials:
- Standard cannot access controlled-autopilot policy;
- Advanced project policy is off by default;
- GET policy page/API has zero mutation side effects;
- enabling policy with `CREATE_CONTENT_PAGE`, quota and kill-switch settings persists exact values;
- malformed/forbidden MEDIUM/HIGH or extra fields are rejected;
- UI/API copy never claims automatic merge/deploy.

The actual Draft-PR adapter path remains covered with injected fake transports in Vitest integration tests; CI must not use real external writes.

- [ ] **Step 3: Write operator/development documentation**

`docs/development/p9-c-controlled-autopilot.md` must document:
- OFF-by-default behavior;
- feature matrix;
- exact V1 supported path;
- global/project kill switches and fail-closed env parsing;
- policy fields and bounds;
- quota/concurrency UTC semantics;
- machine authorization vs human approval;
- P8 plan/preview/risk/validation authority;
- queue/scheduler names;
- reason-code triage;
- AI continuation semantics;
- no merge/deploy/rollback authority;
- rollback path for the P9-C feature itself: kill switch ON + policy disable, without deleting history.

- [ ] **Step 4: Run focused regression before full gate**

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

- [ ] **Step 5: Run full local regression**

```bash
npm test
npm run test:e2e
npm run build
```

Expected: all current tests pass; no live credentials or external writes required.

- [ ] **Step 6: Manual changed-file authority review**

Review the final diff and confirm:
- no P7 scoring/detector changes;
- no P9-A immutable artifact mutation;
- no P9-B state authority leak;
- no fake human approval;
- machine status is `AUTOMATION_AUTHORIZED`;
- P8 is still the only exact risk/plan/preview/mutation authority;
- automatic operation is exact CREATE only;
- quota is transactionally serialized;
- kill switch recheck exists immediately before machine authorization/enqueue;
- no merge/deploy/automatic rollback path;
- migrations are additive only;
- no unrelated dependency/CI changes.

- [ ] **Step 7: Commit release docs/tests**

```bash
git add tests/unit/autopilot.boundary.test.ts tests/e2e/p9c-controlled-autopilot.spec.ts docs/development/p9-c-controlled-autopilot.md tests/unit/queues.test.ts tests/unit/worker-bootstrap.test.ts
git commit -m "docs(p9-c): add controlled autopilot release gate"
```

- [ ] **Step 8: Open/update Draft PR and require exact-head CI**

PR title:

```text
P9-C: add controlled autopilot policy
```

PR remains Draft until the exact PR head has all three GitHub Actions jobs successful:

```text
verify            ✅
production-audit  ✅
e2e               ✅
```

`verify` must include successful Prisma validate/generate/migrate, Typecheck, full Vitest, and Build. `e2e` must run the full Chromium suite. `production-audit` must retain the deployable runtime dependency audit.

- [ ] **Step 9: Final review gate**

Before marking Ready for Review:
- exact final head equals the head verified by all three jobs;
- unresolved review threads = 0;
- changed-file review is complete;
- no release assertion relies on an earlier superseded head;
- do not merge or deploy.

## Definition of Done

P9-C is complete only when an explicitly opted-in Advanced/Enterprise project can reach the following path under fully persisted, reproducible, fail-closed gates:

```text
P9-A CONTENT_CREATION
-> P9-B READY_FOR_POLICY
-> P9-C deterministic policy evaluation
-> P8-owned content preparation through existing P4/P8 AI tasks
-> exact P8 CREATE_CONTENT_PAGE plan + preview
-> exact P8 LOW risk + warning-free deterministic validation
-> race-safe quota/concurrency reservation
-> immutable P9 AUTOPILOT_READY decision
-> immutable P8 PublicationAutomationAuthorization
-> PublicationExecution = AUTOMATION_AUTHORIZED
-> existing P8 execution worker
-> Draft PR
-> human merge / human deployment
```

Any ambiguity, stale state, unsupported action/operation, warning, MEDIUM/HIGH risk, conflict, quota/concurrency block, verification pause, kill switch, or revision drift must stop automatic execution without a workaround.