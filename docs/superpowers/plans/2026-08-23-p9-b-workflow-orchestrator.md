# P9-B Workflow Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, idempotent BullMQ workflow layer that triggers deterministic P9-A planning from Growth completion, daily UTC reconciliation, or an explicit manual request, persists `OptimizationRun` / `OptimizationRunItem` state, and stops at `READY_FOR_POLICY` without taking P8 or P9-C authority.

**Architecture:** P9-B adds exactly two queues, `optimization-planning` and `optimization-orchestration`, to the existing central BullMQ registry. A trigger service creates or reuses deterministic runs; the planning worker calls P9-A with `useAi:false`, persists run items plus a durable `planningCompletedAt` checkpoint, then hands off to the orchestration worker; the orchestration worker validates frozen-plan ownership, advances items to `READY_FOR_POLICY`, and derives terminal counters from PostgreSQL. Growth handoff is at-least-once with deterministic dedupe, and a daily UTC reconciliation job repairs missed Redis handoffs.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, BullMQ 5.58, Zod 3.25, Express 5, Vitest 3.2, Supertest 7, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md`

## Global Constraints

- Base: `main@28d1c7ee8b812579b570cf476154e266f87abed1`; branch: `feat/p9-b-workflow-orchestrator`.
- The user approved the P9-B design on 2026-08-23. Do not implement directly on `main`.
- P7 remains authoritative for Growth identity, score, evidence, ranking eligibility, lifecycle, and provenance. P9-B must not import P7 detector/scoring modules.
- P9-A remains authoritative for candidate eligibility, action, market scope, rank, bounded AI adjustment, and immutable `OptimizationPlan` payloads.
- P9-B V1 must call `OptimizationService.materializeProject(projectId, { advisoryRootDir, useAi: false })`; it does not orchestrate P9-A's asynchronous AI continuation.
- P8 remains authoritative for risk, approval, `PublicationProposal`, `PublicationPlan`, preview, mutation, verification, rollback, Draft PR creation, merge, and deploy.
- P9-B V1 creates no P8 proposal/plan/execution rows or foreign keys.
- `READY_FOR_POLICY` is only a P9-B routing checkpoint; it is not P9-C approval or autopilot eligibility.
- Add exactly two queues: `optimization-planning` and `optimization-orchestration`. Do not add a generic event bus or experiment queue.
- Feature entitlement: `OPTIMIZATION_ORCHESTRATION`; STANDARD=false, ADVANCED=true, ENTERPRISE=true, using the existing feature matrix and `requireFeature` middleware.
- Manual endpoint: `POST /api/v1/projects/:projectId/optimization/runs`; strict request body `{ manualRequestId: uuid }`; success response is exactly HTTP `202 Accepted`.
- Daily reconciliation uses UTC only. The scheduler job carries no date; the worker derives the current `YYYY-MM-DD` UTC date at processing time.
- Queue payloads contain IDs and bounded trigger facts only. Never include provider bodies, raw P7 evidence, advisory Markdown, AI prompts/responses, P8 patches, Git credentials, or tokens.
- Queue retry policy follows existing repository practice: attempts=2, exponential backoff=5000ms, bounded remove-on-complete/fail; deterministic contract errors are non-retryable and the bootstrap calls `job.discard()` before rethrowing.
- Run/item changes use compare-and-set `updateMany` guards on expected status. Never force a state over another worker.
- `planningCompletedAt` is a P9-B retry checkpoint: it distinguishes `RUNNING` with planning durably completed, including zero-plan results, from `RUNNING` before planning completion.
- Migrations are additive/forward-only. Never edit applied P9-A migrations.
- PR remains Draft until exact-head `verify`, `production-audit`, and `e2e` are green plus manual diff review.
- Merge requires a separate explicit human `合并`; deployment requires separate explicit authorization.

## File Structure

Prisma:
- `prisma/models/optimization-orchestration.prisma` — P9-B enums/models.
- `prisma/models/optimization.prisma` — add only the reverse `OptimizationPlan.runItems` relation.
- `prisma/migrations/20260823021000_add_p9b_workflow_orchestrator/migration.sql` — additive P9-B migration.

P9-B module:
- `src/modules/optimization-orchestration/orchestration.types.ts` — versions and trigger types.
- `src/modules/optimization-orchestration/orchestration.identity.ts` — canonical SHA-256 run/item identities.
- `src/modules/optimization-orchestration/orchestration.repository.ts` — run/item persistence and guarded transitions.
- `src/modules/optimization-orchestration/orchestration.queue.ts` — two queue names, ports, options, enqueue wrappers.
- `src/modules/optimization-orchestration/orchestration.service.ts` — Growth/manual/daily trigger creation.
- `src/modules/optimization-orchestration/orchestration.worker.ts` — planning and advance processors plus error classification.
- `src/modules/optimization-orchestration/orchestration.routes.ts` — strict manual POST API.

Integration points:
- `src/auth/feature-flags.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`
- `src/modules/growth/growth.worker.ts`
- `src/app.ts`

Tests:
- `tests/unit/orchestration.identity.test.ts`
- `tests/unit/orchestration.feature-gate.test.ts`
- `tests/unit/orchestration.queue.test.ts`
- `tests/unit/orchestration.reconciliation.test.ts`
- `tests/unit/orchestration.boundary.test.ts`
- `tests/integration/orchestration.persistence.test.ts`
- `tests/integration/orchestration.planning-worker.test.ts`
- `tests/integration/orchestration.advance-worker.test.ts`
- `tests/integration/orchestration.api.test.ts`
- extend `tests/unit/growth.worker.test.ts`
- extend `tests/unit/worker-bootstrap.test.ts`

---

### Task 1: Deterministic identities and feature entitlement

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.types.ts`
- Create: `src/modules/optimization-orchestration/orchestration.identity.ts`
- Modify: `src/auth/feature-flags.ts`
- Create: `tests/unit/orchestration.identity.test.ts`
- Create: `tests/unit/orchestration.feature-gate.test.ts`

**Interfaces:**

```ts
export const OPTIMIZATION_RUN_VERSION = 'OPTIMIZATION_RUN_V1' as const
export const OPTIMIZATION_RUN_ITEM_VERSION = 'OPTIMIZATION_RUN_ITEM_V1' as const

export type GrowthTriggerInput = {
  projectId: string
  asOfDate: string
  materializationVersion: string
  formulaVersion: string
  state: 'COMPLETED' | 'INELIGIBLE'
  selectedGscSnapshotIds: readonly string[]
}

export function buildGrowthTriggerKey(input: GrowthTriggerInput): string
export function buildDailyTriggerKey(input: { projectId: string; utcDate: string; plannerVersion: string }): string
export function buildManualTriggerKey(input: { projectId: string; manualRequestId: string }): string
export function buildRunItemKey(input: { runId: string; optimizationPlanId: string }): string
```

- [ ] **Step 1: Write RED tests**

```ts
it('normalizes Growth snapshot ids before hashing', () => {
  const a = buildGrowthTriggerKey({ ...growth, selectedGscSnapshotIds: ['b', 'a', 'a'] })
  const b = buildGrowthTriggerKey({ ...growth, selectedGscSnapshotIds: ['a', 'b'] })
  expect(a).toBe(b)
  expect(a).toMatch(/^[a-f0-9]{64}$/)
})

it('gates orchestration to Advanced and Enterprise', () => {
  expect(hasFeature('STANDARD', 'OPTIMIZATION_ORCHESTRATION')).toBe(false)
  expect(hasFeature('ADVANCED', 'OPTIMIZATION_ORCHESTRATION')).toBe(true)
  expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_ORCHESTRATION')).toBe(true)
})
```

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/orchestration.identity.test.ts tests/unit/orchestration.feature-gate.test.ts
```

Expected: missing P9-B modules / feature union failure.

- [ ] **Step 3: Implement minimal identity and feature code**

Canonicalize recursively with sorted object keys. For Growth identity, dedupe/sort snapshot IDs before hashing. Add `OPTIMIZATION_ORCHESTRATION` to `Feature` and `advancedFeatures` only; Enterprise inherits it.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/orchestration.identity.test.ts tests/unit/orchestration.feature-gate.test.ts tests/unit/feature-flags.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/auth/feature-flags.ts src/modules/optimization-orchestration/orchestration.types.ts src/modules/optimization-orchestration/orchestration.identity.ts tests/unit/orchestration.identity.test.ts tests/unit/orchestration.feature-gate.test.ts
git commit -m "feat(p9-b): add orchestration identities and entitlement"
```

---

### Task 2: Durable run/item persistence

**Files:**
- Create: `prisma/models/optimization-orchestration.prisma`
- Modify: `prisma/models/optimization.prisma`
- Create: `prisma/migrations/20260823021000_add_p9b_workflow_orchestrator/migration.sql`
- Create: `src/modules/optimization-orchestration/orchestration.repository.ts`
- Create: `tests/integration/orchestration.persistence.test.ts`

**Schema contract:**

```prisma
enum OptimizationTriggerType { EVENT DAILY_RECONCILIATION MANUAL }
enum OptimizationTriggerSource { GROWTH_MATERIALIZATION DAILY_SCHEDULER MANUAL_REQUEST }
enum OptimizationRunStatus { QUEUED RUNNING SUCCEEDED FAILED }
enum OptimizationRunItemStage { PLANNED READY_FOR_POLICY }
enum OptimizationRunItemStatus { PENDING COMPLETED FAILED }
```

`OptimizationRun` must store `projectId`, `runVersion`, trigger fields, status, candidate/planned/item/completed/failure counters, `startedAt`, `planningCompletedAt`, `completedAt`, `lastErrorCode`, timestamps, and `items`; unique `(projectId, triggerKey)`. `OptimizationRunItem` must store `runId`, `projectId`, `optimizationPlanId`, `itemKey`, stage/status/reason/timestamps; unique `(runId, optimizationPlanId)` and `(runId, itemKey)`. All Project/Run/OptimizationPlan FKs use `ON DELETE RESTRICT ON UPDATE CASCADE`.

**Repository interface:**

```ts
class OptimizationOrchestrationRepository {
  createOrGetRun(input: CreateRunInput): Promise<OptimizationRun>
  getRun(runId: string): Promise<OptimizationRun | null>
  listRunsByStatus(statuses: OptimizationRunStatus[]): Promise<OptimizationRun[]>
  transitionRun(input: GuardedRunTransition): Promise<boolean>
  markPlanningComplete(input: PlanningCompletionInput): Promise<boolean>
  createOrGetRunItem(input: CreateRunItemInput): Promise<OptimizationRunItem>
  listRunItems(runId: string): Promise<OptimizationRunItem[]>
  transitionItem(input: GuardedItemTransition): Promise<boolean>
  refreshRunCounters(runId: string): Promise<OptimizationRun>
}
```

- [ ] **Step 1: Write persistence RED**

```ts
const first = await repository.createOrGetRun(input)
const again = await repository.createOrGetRun(input)
expect(again.id).toBe(first.id)
expect(await repository.transitionRun({ runId: first.id, from: 'QUEUED', to: 'RUNNING', patch: {} })).toBe(true)
expect(await repository.transitionRun({ runId: first.id, from: 'QUEUED', to: 'RUNNING', patch: {} })).toBe(false)
```

Also lock run-item idempotency, plan/project mismatch rejection, and FK RESTRICT.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/orchestration.persistence.test.ts
```

- [ ] **Step 3: Implement additive schema/migration/repository**

On P2002 collisions, re-read and validate stable identity before reuse. P9-B rows are mutable state machines, so do not add P9-A immutable triggers. Expose no destructive delete API.

- [ ] **Step 4: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run tests/integration/orchestration.persistence.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add prisma/models/optimization-orchestration.prisma prisma/models/optimization.prisma prisma/migrations/20260823021000_add_p9b_workflow_orchestrator/migration.sql src/modules/optimization-orchestration/orchestration.repository.ts tests/integration/orchestration.persistence.test.ts
git commit -m "feat(p9-b): persist optimization workflow runs"
```

---

### Task 3: Two bounded BullMQ queue adapters

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.queue.ts`
- Modify: `src/queue/queues.ts`
- Create: `tests/unit/orchestration.queue.test.ts`

**Interfaces:**

```ts
export const OPTIMIZATION_PLANNING_QUEUE_NAME = 'optimization-planning' as const
export const OPTIMIZATION_ORCHESTRATION_QUEUE_NAME = 'optimization-orchestration' as const
export const OPTIMIZATION_QUEUE_ATTEMPTS = 2

export type OptimizationPlanningJobData =
  | { kind: 'MATERIALIZE_RUN'; runId: string; projectId: string }
  | { kind: 'RECONCILE_DAILY' }

export type OptimizationOrchestrationJobData = { runId: string; projectId: string }

export class OptimizationPlanningQueue {
  enqueueRun(runId: string, projectId: string): Promise<unknown>
}

export class OptimizationOrchestrationQueue {
  enqueueRun(runId: string, projectId: string): Promise<unknown>
}
```

- [ ] **Step 1: Write queue RED**

```ts
expect(buildPlanningRunJobOptions(RUN_ID)).toMatchObject({
  jobId: `optimization-planning-${RUN_ID}`,
  attempts: 2,
  backoff: { type: 'exponential', delay: 5_000 },
})
```

Lock equivalent orchestration options and verify both names are in `QUEUE_NAMES`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/orchestration.queue.test.ts
```

- [ ] **Step 3: Implement queue wrappers**

Use narrow `Pick<Queue<...>, 'add'>` ports. `enqueueRun` sends only `{kind:'MATERIALIZE_RUN',runId,projectId}` or `{runId,projectId}`. Daily reconciliation is scheduled directly by worker bootstrap using `{kind:'RECONCILE_DAILY'}` with no date in payload.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/orchestration.queue.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.queue.ts src/queue/queues.ts tests/unit/orchestration.queue.test.ts
git commit -m "feat(p9-b): add orchestration queues"
```

---

### Task 4: Trigger service and daily reconciliation

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.service.ts`
- Create: `tests/unit/orchestration.reconciliation.test.ts`

**Interface:**

```ts
export class OptimizationOrchestrationService {
  triggerGrowth(input: GrowthTriggerInput): Promise<OptimizationRun>
  triggerManual(input: { projectId: string; manualRequestId: string; requestedBy: string }): Promise<OptimizationRun>
  reconcileUtcDate(utcDate: string): Promise<{ considered: number; queued: number }>
  requeueRun(runId: string): Promise<OptimizationRun>
}
```

- [ ] **Step 1: Write RED with fake repository/queue/projects**

Lock same manual request reuse, bounded/sorted Growth payload, exact `YYYY-MM-DD` UTC validation, STANDARD skip, Advanced/Enterprise enqueue, and absence of P9-A/P8 calls.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/orchestration.reconciliation.test.ts
```

- [ ] **Step 3: Implement trigger service**

Create/reuse run first, then enqueue its ID. Queue add failure leaves the run `QUEUED` and rethrows to direct/manual callers. Daily reconciliation lists projects, filters with `hasFeature`, and creates/reuses exactly one daily run per eligible project/date/planner version. It may re-enqueue existing `QUEUED` runs; it must not force a `RUNNING` run back to `QUEUED`.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/orchestration.reconciliation.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.service.ts tests/unit/orchestration.reconciliation.test.ts
git commit -m "feat(p9-b): add durable orchestration triggers"
```

---

### Task 5: Planning worker with durable planning checkpoint

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.worker.ts`
- Create: `tests/integration/orchestration.planning-worker.test.ts`

**Interfaces:**

```ts
export class OptimizationOrchestrationWorkerError extends Error {
  constructor(public readonly code: string, message: string)
}

export function classifyOptimizationOrchestrationError(code: string): 'RETRYABLE' | 'NON_RETRYABLE'
export async function processOptimizationPlanningJob(job: { name: string; data: OptimizationPlanningJobData }, deps?: PlanningWorkerDeps): Promise<void>
```

- [ ] **Step 1: Write RED for normal, zero-plan, and retry behavior**

```ts
expect(materializeProject).toHaveBeenCalledWith(project.id, {
  advisoryRootDir,
  useAi: false,
})
expect(savedRun.planningCompletedAt).not.toBeNull()
expect(savedRun.plannedCount).toBe(2)
```

For a second attempt on `RUNNING + planningCompletedAt != null`, assert P9-A is not called again and orchestration enqueue is retried. For a zero-plan result, assert `planningCompletedAt` is still set and orchestration is queued. Compare P8 proposal/plan/execution counts before/after and require no change.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/orchestration.planning-worker.test.ts
```

- [ ] **Step 3: Implement guarded planning**

`MATERIALIZE_RUN` validates run/project. Terminal runs are no-ops. `QUEUED` CAS-transitions to `RUNNING`. `RUNNING + planningCompletedAt` skips P9-A and retries only orchestration handoff. Otherwise call deterministic P9-A. In one DB transaction create/reuse items for returned plans, verify every `plan.projectId === run.projectId`, persist counters and `planningCompletedAt`; enqueue orchestration only after this DB checkpoint. Deterministic contract errors persist a bounded error code and `FAILED`; retryable infrastructure errors rethrow without persisting raw error text.

For `{kind:'RECONCILE_DAILY'}`, derive `utcDate = now().toISOString().slice(0,10)` at processing time and call `orchestrationService.reconcileUtcDate(utcDate)`; do not call P9-A directly from the reconciliation job.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/orchestration.planning-worker.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.worker.ts tests/integration/orchestration.planning-worker.test.ts
git commit -m "feat(p9-b): materialize durable optimization runs"
```

---

### Task 6: Advance worker and terminal counters

**Files:**
- Modify: `src/modules/optimization-orchestration/orchestration.worker.ts`
- Create: `tests/integration/orchestration.advance-worker.test.ts`

**Interface:**

```ts
export async function processOptimizationOrchestrationJob(
  job: { name: string; data: OptimizationOrchestrationJobData },
  deps?: OrchestrationWorkerDeps,
): Promise<void>
```

- [ ] **Step 1: Write RED**

Valid PENDING items linked to same-project frozen plans must become `READY_FOR_POLICY/COMPLETED`; the run must become `SUCCEEDED` with counters derived from DB. A zero-item run with non-null `planningCompletedAt` must succeed with zero counters. A plan/project mismatch must set item `FAILED`, run `FAILED`, and stable reason `PLAN_PROJECT_MISMATCH`.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/orchestration.advance-worker.test.ts
```

- [ ] **Step 3: Implement minimal advance logic**

Load persisted run/items/plans, validate project ownership, use guarded item transitions, recompute counters from rows, then guarded-transition the run. Do not inspect P8 risk and do not create P8 artifacts.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/orchestration.advance-worker.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.worker.ts tests/integration/orchestration.advance-worker.test.ts
git commit -m "feat(p9-b): advance runs to policy checkpoint"
```

---

### Task 7: Growth completion handoff

**Files:**
- Modify: `src/modules/growth/growth.worker.ts`
- Modify: `tests/unit/growth.worker.test.ts`

**Interface extension:**

```ts
optimizationTrigger?: {
  triggerGrowth(input: GrowthTriggerInput): Promise<unknown>
}
```

- [ ] **Step 1: Write RED for order and failure isolation**

```ts
const order: string[] = []
const materialize = vi.fn(async () => { order.push('materialized'); return successResult })
const triggerGrowth = vi.fn(async () => { order.push('triggered') })
await processGrowthMaterializationJob(job, { materialize, optimizationTrigger: { triggerGrowth } })
expect(order).toEqual(['materialized', 'triggered'])
```

Lock both `COMPLETED` and `INELIGIBLE`. A thrown Growth materialization must never call P9-B. A P9-B trigger failure after Growth success must be swallowed after the existing bounded `growth.materialization.completed` event; do not emit a new event, do not rethrow, and do not rerun/rewrite Growth persistence. Daily reconciliation is the repair path.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/growth.worker.test.ts
```

- [ ] **Step 3: Implement optional post-success trigger**

Pass exactly projectId, original asOfDate, `GROWTH_MATERIALIZATION_VERSION`, `GROWTH_SCORE_VERSION`, result state, and selected snapshot IDs. No raw evidence/provider payloads.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/growth.worker.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/growth/growth.worker.ts tests/unit/growth.worker.test.ts
git commit -m "feat(p9-b): trigger orchestration after growth materialization"
```

---

### Task 8: Worker bootstrap and daily UTC scheduler

**Files:**
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `tests/unit/worker-bootstrap.test.ts`

**Constants:**

```ts
export const OPTIMIZATION_PLANNING_WORKER_CONCURRENCY = 1
export const OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY = 2
export const OPTIMIZATION_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000
```

- [ ] **Step 1: Write RED**

```ts
expect(workerDefinitionForQueue('optimization-planning')).toMatchObject({
  processor: processOptimizationPlanningJob,
  concurrency: 1,
})
expect(workerDefinitionForQueue('optimization-orchestration')).toMatchObject({
  processor: processOptimizationOrchestrationJob,
  concurrency: 2,
})
```

Also lock scheduler name `optimization-daily-reconcile`, job name `reconcile-daily`, and data `{kind:'RECONCILE_DAILY'}` with no date field.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/worker-bootstrap.test.ts tests/unit/orchestration.queue.test.ts
```

- [ ] **Step 3: Wire production queues/workers**

Instantiate support Queue objects for both P9-B queues, wrap them with queue classes, create the orchestration service, inject it into the Growth worker, and add one `upsertJobScheduler` on the planning queue. The planning worker derives the current UTC date when it executes. Wrap both P9-B workers with `classifyOptimizationOrchestrationError`; call `job.discard()` for NON_RETRYABLE errors before rethrowing.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/worker-bootstrap.test.ts tests/unit/orchestration.queue.test.ts tests/unit/growth.worker.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/queue/worker-bootstrap.ts tests/unit/worker-bootstrap.test.ts
git commit -m "feat(p9-b): wire orchestration workers and reconciliation"
```

---

### Task 9: Strict manual run API

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/orchestration.api.test.ts`

**Interface:**

```ts
export interface OptimizationOrchestrationApiPort {
  triggerManual(input: {
    projectId: string
    manualRequestId: string
    requestedBy: string
  }): Promise<unknown>
}

const manualRunSchema = z.object({
  manualRequestId: z.string().uuid(),
}).strict()
```

- [ ] **Step 1: Write API RED**

Lock: STANDARD returns 403 before fake API call; ADVANCED/ENTERPRISE return exactly 202; invalid UUID/unknown fields return 400; `requestedBy` is server-derived as `project-api:${projectId}`; client-supplied actor/P8 risk/plan/Git/AI fields are rejected by strict schema; unrelated GET routes do not invoke the trigger API.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/integration/orchestration.api.test.ts
```

- [ ] **Step 3: Implement route and app injection**

Use `requireFeature('OPTIMIZATION_ORCHESTRATION')`, strict Zod parsing, `createApp({ optimizationOrchestrationApi })`, and mount under `/api/v1`. Do not add a dashboard or GET orchestration route in P9-B V1.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/integration/orchestration.api.test.ts tests/unit/feature-flags.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.routes.ts src/app.ts tests/integration/orchestration.api.test.ts
git commit -m "feat(p9-b): add manual orchestration trigger API"
```

---

### Task 10: Authority-boundary and end-to-end idempotency tests

**Files:**
- Create: `tests/unit/orchestration.boundary.test.ts`
- Modify: `tests/integration/orchestration.planning-worker.test.ts`
- Modify: `tests/integration/orchestration.advance-worker.test.ts`

- [ ] **Step 1: Write boundary RED**

Static-scan `src/modules/optimization-orchestration/**/*.ts` and reject imports from P7 detector/scoring modules, P8 publication/risk/approval/mutation/Git modules, P5/P6 raw-fact modules, and AI ranking/provider modules. Behavioral tests run a real planning+advance path and assert P7 snapshot/evidence/lifecycle values unchanged, P9-A immutable rows unchanged, P8 proposal/plan/execution counts unchanged, final item exactly `READY_FOR_POLICY/COMPLETED`, and no Git/deploy side effect.

- [ ] **Step 2: Verify RED or already-green boundary**

```bash
npx vitest run tests/unit/orchestration.boundary.test.ts tests/integration/orchestration.planning-worker.test.ts tests/integration/orchestration.advance-worker.test.ts
```

- [ ] **Step 3: Fix only evidence-backed leaks**

If already green, make no production change. If red, use systematic debugging and remove only the unauthorized dependency/side effect; do not widen P9-B scope.

- [ ] **Step 4: Focused GREEN**

```bash
npx vitest run \
  tests/unit/orchestration.identity.test.ts \
  tests/unit/orchestration.feature-gate.test.ts \
  tests/unit/orchestration.queue.test.ts \
  tests/unit/orchestration.reconciliation.test.ts \
  tests/unit/orchestration.boundary.test.ts \
  tests/unit/growth.worker.test.ts \
  tests/unit/worker-bootstrap.test.ts \
  tests/integration/orchestration.persistence.test.ts \
  tests/integration/orchestration.planning-worker.test.ts \
  tests/integration/orchestration.advance-worker.test.ts \
  tests/integration/orchestration.api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add tests/unit/orchestration.boundary.test.ts tests/integration/orchestration.planning-worker.test.ts tests/integration/orchestration.advance-worker.test.ts
git commit -m "test(p9-b): lock orchestration authority boundaries"
```

---

### Task 11: Development documentation and full regression

**Files:**
- Create: `docs/development/p9-b-workflow-orchestrator.md`
- Modify: `docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md` only to update status after implementation gates pass.

- [ ] **Step 1: Document the operational contract**

Document exact run/item states and counters, two queue names, retry/discard policy, `planningCompletedAt`, Growth at-least-once handoff, daily UTC reconciliation, manual 202 API, feature gate, zero-plan success, and P9-A/P9-C/P8 boundaries.

- [ ] **Step 2: Run Prisma gates**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

- [ ] **Step 3: Run full regression**

```bash
npm run typecheck
npm test
npm run build
```

- [ ] **Step 4: Commit docs**

```bash
git add docs/development/p9-b-workflow-orchestrator.md docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md
git commit -m "docs: document P9-B workflow orchestrator"
```

---

### Task 12: Draft PR, final exact-head CI, manual diff, Ready gate

**Files:**
- No planned production files.

- [ ] **Step 1: Open or keep a Draft PR**

Title: `P9-B: add workflow orchestrator`. Body must state base `main@28d1c7ee...`, exactly two queues, deterministic P9-A `useAi:false`, no P8/P9-C/Git/deploy authority, migration/feature gate, and Draft release rule.

- [ ] **Step 2: Verify exact-head CI**

Require on the exact PR head:

```text
verify = success
production-audit = success
e2e = success
```

Inside `verify`, independently confirm Prisma validate, Prisma generate, Prisma migrate deploy, Typecheck, full Test, and Build all succeed.

- [ ] **Step 3: Manual diff review against base**

Reject readiness if the diff introduces P7 scoring/detector changes, P9-A mutation APIs/trigger weakening, P8 artifact creation/risk/approval authority, Git/Draft-PR/merge/deploy/rollback code, a third orchestration/experiment queue, a generic event bus, async AI continuation orchestration, market-derived timezone inference, client-controlled actor/risk/fact fields, unrelated dependency/credential changes, or edits to applied P9-A migrations.

- [ ] **Step 4: Mark Ready only from fresh evidence**

Update the PR body with exact head SHA and CI run number, then mark Ready for Review.

- [ ] **Step 5: Stop at merge gate**

Do not merge or deploy. Wait for a separate explicit human `合并` instruction.
