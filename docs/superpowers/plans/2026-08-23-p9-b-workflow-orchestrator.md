# P9-B Workflow Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable, idempotent BullMQ workflow layer that triggers deterministic P9-A planning from Growth completion, daily UTC reconciliation, or an explicit manual request, persists `OptimizationRun`/`OptimizationRunItem` state, and stops at `READY_FOR_POLICY` without taking P8 or P9-C authority.

**Architecture:** P9-B adds two queues (`optimization-planning`, `optimization-orchestration`) to the existing central BullMQ registry. A trigger service creates/reuses deterministic runs; the planning worker invokes P9-A with `useAi:false`, freezes/links plans, persists a durable `planningCompletedAt` checkpoint, and hands off to the orchestration worker; the orchestration worker validates frozen-plan ownership, advances items to `READY_FOR_POLICY`, and derives terminal counters from PostgreSQL. Growth handoff is at-least-once with deterministic dedupe; daily UTC reconciliation is the safety net for missed Redis handoffs.

**Tech Stack:** Node.js 22, TypeScript 5.9, Prisma 6.14/PostgreSQL, BullMQ 5.58, Zod 3.25, Express 5, Vitest 3.2, Supertest 7, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md`

## Global Constraints

- Base is `main@28d1c7ee8b812579b570cf476154e266f87abed1`; branch is `feat/p9-b-workflow-orchestrator`.
- Never implement directly on `main`.
- P7 remains authoritative for Growth identity, score, evidence, eligibility, lifecycle, and source provenance.
- P9-B must never call P7 detector/scoring functions or synthesize a second opportunity universe from P5/P6/provider facts.
- P9-A remains authoritative for candidate eligibility, recommended action, deterministic rank, market projection, bounded AI adjustment, and immutable `OptimizationPlan` payloads.
- P9-B V1 invokes `OptimizationService.materializeProject(projectId, { advisoryRootDir, useAi: false })`; it does not orchestrate the asynchronous P9-A AI continuation.
- P8 remains authoritative for risk, approval, `PublicationProposal`, `PublicationPlan`, preview, mutation, verification, rollback, Draft PR creation, merge, and deploy.
- P9-B V1 creates no P8 proposal/plan/execution foreign keys or side effects.
- `READY_FOR_POLICY` is only a P9-B routing checkpoint. It is not P9-C approval or autopilot eligibility.
- Add exactly two P9-B queues: `optimization-planning` and `optimization-orchestration`. Do not add an event bus or experiment queue.
- Feature entitlement is `OPTIMIZATION_ORCHESTRATION`: STANDARD=false, ADVANCED=true, ENTERPRISE=true, using the existing `src/auth/feature-flags.ts` matrix and `requireFeature` middleware.
- Manual V1 endpoint is `POST /api/v1/projects/:projectId/optimization/runs` with strict body `{ manualRequestId: uuid }`.
- Daily V1 uses UTC only; never infer a timezone from market/locale.
- Queue payloads contain IDs and bounded trigger data only; no provider body, raw P7 evidence, advisory Markdown, AI prompt/response, P8 patch content, Git credentials, or tokens.
- BullMQ retry policy follows existing repository practice: `attempts: 2`, exponential backoff `5_000ms`, bounded `removeOnComplete`/`removeOnFail`; deterministic contract errors are non-retryable and the worker bootstrap calls `job.discard()` before rethrowing.
- Run/item status changes use compare-and-set style `updateMany({ where: { id, status: expected }, ... })`; never force state over another worker.
- `planningCompletedAt` is a P9-B implementation checkpoint required for retry safety: it distinguishes “planning transaction durably completed with zero plans” from “RUNNING but planning has not completed”. It does not add new business authority.
- Migrations are additive and forward-only. Never edit P9-A migrations.
- PR remains Draft until exact-head `verify`, `production-audit`, and `e2e` are green plus manual diff review.
- Merge still requires separate explicit human `合并`; deployment requires separate explicit authorization.

## File Structure

Prisma:
- `prisma/models/optimization-orchestration.prisma` — P9-B enums and run/item models.
- `prisma/migrations/20260823021000_add_p9b_workflow_orchestrator/migration.sql` — additive tables/indexes/FKs only.

P9-B module:
- `src/modules/optimization-orchestration/orchestration.types.ts` — versions, reason codes, trigger input types.
- `src/modules/optimization-orchestration/orchestration.identity.ts` — canonical SHA-256 run/item identity builders.
- `src/modules/optimization-orchestration/orchestration.repository.ts` — run/item CRUD-by-transition, no destructive deletes.
- `src/modules/optimization-orchestration/orchestration.queue.ts` — two queue names, ports, job IDs/options, enqueue wrappers.
- `src/modules/optimization-orchestration/orchestration.service.ts` — trigger creation, feature-aware daily reconciliation, manual trigger.
- `src/modules/optimization-orchestration/orchestration.worker.ts` — planning/orchestration processors, error classification.
- `src/modules/optimization-orchestration/orchestration.routes.ts` — strict manual POST API.

Modified integration points:
- `src/auth/feature-flags.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`
- `src/modules/growth/growth.worker.ts`
- `src/app.ts`

Tests:
- `tests/unit/orchestration.identity.test.ts`
- `tests/unit/orchestration.queue.test.ts`
- `tests/unit/orchestration.feature-gate.test.ts`
- `tests/integration/orchestration.persistence.test.ts`
- `tests/integration/orchestration.planning-worker.test.ts`
- `tests/integration/orchestration.advance-worker.test.ts`
- `tests/unit/growth.worker.test.ts` (extend existing file)
- `tests/unit/orchestration.reconciliation.test.ts`
- `tests/integration/orchestration.api.test.ts`
- `tests/unit/worker-bootstrap.test.ts` (extend existing file)
- `tests/unit/orchestration.boundary.test.ts`

---

### Task 1: Lock P9-B identity contracts and feature entitlement

**Files:**
- Create: `tests/unit/orchestration.identity.test.ts`
- Create: `tests/unit/orchestration.feature-gate.test.ts`
- Create: `src/modules/optimization-orchestration/orchestration.types.ts`
- Create: `src/modules/optimization-orchestration/orchestration.identity.ts`
- Modify: `src/auth/feature-flags.ts`

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

- [ ] **Step 1: Write test-only RED**

Lock sorted/deduped Growth snapshot identity, project isolation, manual idempotency, daily UTC identity, item identity, and feature matrix:

```ts
it('dedupes and sorts Growth source ids before hashing', () => {
  const a = buildGrowthTriggerKey({ ...baseGrowth, selectedGscSnapshotIds: ['b', 'a', 'a'] })
  const b = buildGrowthTriggerKey({ ...baseGrowth, selectedGscSnapshotIds: ['a', 'b'] })
  expect(a).toBe(b)
  expect(a).toMatch(/^[a-f0-9]{64}$/)
})

it('separates project identities', () => {
  expect(buildManualTriggerKey({ projectId: PROJECT_A, manualRequestId: REQUEST_ID }))
    .not.toBe(buildManualTriggerKey({ projectId: PROJECT_B, manualRequestId: REQUEST_ID }))
})

it('gates orchestration to Advanced and Enterprise', () => {
  expect(hasFeature('STANDARD', 'OPTIMIZATION_ORCHESTRATION')).toBe(false)
  expect(hasFeature('ADVANCED', 'OPTIMIZATION_ORCHESTRATION')).toBe(true)
  expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_ORCHESTRATION')).toBe(true)
})
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/orchestration.identity.test.ts tests/unit/orchestration.feature-gate.test.ts
```

Expected: FAIL because P9-B modules/feature name do not exist.

- [ ] **Step 3: Implement minimal identity/types + feature matrix**

Canonicalize recursively with sorted object keys. Hash exact stable fields. Growth builder must normalize `selectedGscSnapshotIds` with `new Set(...).sort()` before hashing. Add `OPTIMIZATION_ORCHESTRATION` to `Feature`, only to `advancedFeatures` (Enterprise inherits it).

- [ ] **Step 4: Run GREEN**

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

### Task 2: Add durable OptimizationRun / OptimizationRunItem persistence

**Files:**
- Create: `prisma/models/optimization-orchestration.prisma`
- Create: `prisma/migrations/20260823021000_add_p9b_workflow_orchestrator/migration.sql`
- Create: `src/modules/optimization-orchestration/orchestration.repository.ts`
- Create: `tests/integration/orchestration.persistence.test.ts`

**Prisma shape:**

```prisma
enum OptimizationTriggerType { EVENT DAILY_RECONCILIATION MANUAL }
enum OptimizationTriggerSource { GROWTH_MATERIALIZATION DAILY_SCHEDULER MANUAL_REQUEST }
enum OptimizationRunStatus { QUEUED RUNNING SUCCEEDED FAILED }
enum OptimizationRunItemStage { PLANNED READY_FOR_POLICY }
enum OptimizationRunItemStatus { PENDING COMPLETED FAILED }

model OptimizationRun {
  id                  String                    @id @default(uuid()) @db.Uuid
  projectId           String                    @db.Uuid
  runVersion          String
  triggerType         OptimizationTriggerType
  triggerSource       OptimizationTriggerSource
  triggerKey          String
  triggerPayload      Json
  status              OptimizationRunStatus    @default(QUEUED)
  candidateCount      Int                       @default(0)
  plannedCount        Int                       @default(0)
  itemCount           Int                       @default(0)
  completedCount      Int                       @default(0)
  failureCount        Int                       @default(0)
  startedAt           DateTime?
  planningCompletedAt DateTime?
  completedAt         DateTime?
  lastErrorCode       String?
  createdAt           DateTime                  @default(now())
  updatedAt           DateTime                  @updatedAt
  items               OptimizationRunItem[]

  @@unique([projectId, triggerKey], map: "OptimizationRun_project_trigger_key")
  @@index([projectId, status, createdAt], map: "OptimizationRun_project_status_idx")
}

model OptimizationRunItem {
  id                 String                     @id @default(uuid()) @db.Uuid
  runId              String                     @db.Uuid
  projectId          String                     @db.Uuid
  optimizationPlanId String                     @db.Uuid
  itemKey            String
  currentStage       OptimizationRunItemStage   @default(PLANNED)
  status             OptimizationRunItemStatus  @default(PENDING)
  reasonCode         String?
  createdAt          DateTime                   @default(now())
  updatedAt          DateTime                   @updatedAt
  completedAt        DateTime?
  run                OptimizationRun            @relation(fields: [runId], references: [id], onDelete: Restrict)
  optimizationPlan   OptimizationPlan           @relation(fields: [optimizationPlanId], references: [id], onDelete: Restrict)

  @@unique([runId, optimizationPlanId], map: "OptimizationRunItem_run_plan")
  @@unique([runId, itemKey], map: "OptimizationRunItem_run_item_key")
  @@index([projectId, status, createdAt], map: "OptimizationRunItem_project_status_idx")
}
```

Add the reverse relation `runItems OptimizationRunItem[]` to `OptimizationPlan` in `prisma/models/optimization.prisma`; do not change any P9-A field or migration.

**Repository surface:**

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

No delete methods.

- [ ] **Step 1: Write persistence RED**

Tests must prove `(projectId,triggerKey)` reuse, different trigger keys create new rows, run-item idempotency, plan/project mismatch rejection, guarded transitions, and FK `RESTRICT` behavior.

```ts
const first = await repository.createOrGetRun(input)
const again = await repository.createOrGetRun(input)
expect(again.id).toBe(first.id)

const moved = await repository.transitionRun({ runId: first.id, from: 'QUEUED', to: 'RUNNING', patch: {} })
expect(moved).toBe(true)
expect(await repository.transitionRun({ runId: first.id, from: 'QUEUED', to: 'RUNNING', patch: {} })).toBe(false)
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/orchestration.persistence.test.ts
```

Expected: Prisma/model/repository missing.

- [ ] **Step 3: Add additive schema + migration + repository**

Migration SQL must add Project/run/plan FKs with `ON DELETE RESTRICT ON UPDATE CASCADE`. P9-B tables are mutable; do not add P9-A immutable triggers. Repository must re-read on P2002 collision and verify project/trigger or run/plan identity before reuse.

- [ ] **Step 4: Verify Prisma and GREEN**

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

### Task 3: Add the two bounded BullMQ queue adapters

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.queue.ts`
- Create: `tests/unit/orchestration.queue.test.ts`
- Modify: `src/queue/queues.ts`

**Interfaces:**

```ts
export const OPTIMIZATION_PLANNING_QUEUE_NAME = 'optimization-planning' as const
export const OPTIMIZATION_ORCHESTRATION_QUEUE_NAME = 'optimization-orchestration' as const
export const OPTIMIZATION_QUEUE_ATTEMPTS = 2

export type OptimizationPlanningJobData =
  | { kind: 'MATERIALIZE_RUN'; runId: string; projectId: string }
  | { kind: 'RECONCILE_DAILY'; utcDate: string }

export type OptimizationOrchestrationJobData = { runId: string; projectId: string }

export class OptimizationPlanningQueue {
  enqueueRun(runId: string, projectId: string): Promise<unknown>
  enqueueDailyReconciliation(utcDate: string): Promise<unknown>
}

export class OptimizationOrchestrationQueue {
  enqueueRun(runId: string, projectId: string): Promise<unknown>
}
```

The `RECONCILE_DAILY` internal job is an implementation detail that keeps the approved “exactly two queues” contract while giving the existing BullMQ scheduler a processor target.

- [ ] **Step 1: Write RED**

Lock exact queue names, deterministic job IDs, `attempts:2`, exponential `5_000ms`, and sanitized bounded IDs.

```ts
expect(buildPlanningRunJobOptions(RUN_ID)).toMatchObject({
  jobId: `optimization-planning-${RUN_ID}`,
  attempts: 2,
  backoff: { type: 'exponential', delay: 5_000 }
})
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/orchestration.queue.test.ts
```

- [ ] **Step 3: Implement queue wrappers and add both names to `QUEUE_NAMES`**

Use narrow `Pick<Queue<...>, 'add'>` ports. Do not instantiate Redis inside pure queue classes.

- [ ] **Step 4: Run GREEN**

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

### Task 4: Implement trigger service and deterministic run creation

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.service.ts`
- Create: `tests/unit/orchestration.reconciliation.test.ts`

**Interfaces:**

```ts
export class OptimizationOrchestrationService {
  triggerGrowth(input: GrowthTriggerInput): Promise<OptimizationRun>
  triggerManual(input: { projectId: string; manualRequestId: string; requestedBy: string }): Promise<OptimizationRun>
  reconcileUtcDate(utcDate: string): Promise<{ considered: number; queued: number }>
  requeueRun(runId: string): Promise<OptimizationRun>
}
```

Dependencies are injected:

```ts
constructor(
  repository = optimizationOrchestrationRepository,
  planningQueue: Pick<OptimizationPlanningQueue, 'enqueueRun'>,
  projects: Pick<ProjectRepository, 'list' | 'findById'> = projectRepository,
)
```

- [ ] **Step 1: Write RED**

Use fake repository/queue/projects to lock:
- same manual request reuses one trigger identity and re-enqueues same run safely;
- Growth payload stores sorted distinct snapshot IDs only;
- daily reconciliation filters with `hasFeature(project.planLevel, 'OPTIMIZATION_ORCHESTRATION')`;
- STANDARD projects are skipped;
- UTC date must match `YYYY-MM-DD` exactly;
- service never invokes P9-A or P8.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/orchestration.reconciliation.test.ts
```

- [ ] **Step 3: Implement minimal trigger service**

Create/reuse run first, then enqueue `{runId,projectId}`. If queue add fails, leave the persisted run `QUEUED` and rethrow to explicit callers; Growth integration in Task 7 will catch that failure so successful Growth facts remain successful. Daily reconciliation should also re-enqueue existing nonterminal `QUEUED` runs before creating/reusing the date-specific run for eligible projects.

- [ ] **Step 4: Run GREEN**

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

### Task 5: Implement planning worker with durable planning checkpoint

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.worker.ts`
- Create: `tests/integration/orchestration.planning-worker.test.ts`

**Interfaces:**

```ts
export class OptimizationOrchestrationWorkerError extends Error {
  constructor(public readonly code: string, message: string)
}

export function classifyOptimizationOrchestrationError(code: string): 'RETRYABLE' | 'NON_RETRYABLE'

export async function processOptimizationPlanningJob(
  job: { name: string; data: OptimizationPlanningJobData },
  deps?: PlanningWorkerDeps,
): Promise<void>
```

`PlanningWorkerDeps` exposes injected `repository`, `optimizationService`, `orchestrationQueue`, `orchestrationService`, `advisoryRootDir`, and `now`.

- [ ] **Step 1: Write RED for normal materialization**

Create an ADVANCED project/run and inject a fake P9-A materializer returning two persisted/fake-plan-shaped results. Lock:

```ts
expect(materializeProject).toHaveBeenCalledWith(project.id, {
  advisoryRootDir,
  useAi: false
})
expect(run.status).toBe('RUNNING')
expect(run.planningCompletedAt).not.toBeNull()
expect(run.candidateCount).toBe(2)
expect(run.plannedCount).toBe(2)
expect(run.itemCount).toBe(2)
expect(orchestrationQueue.enqueueRun).toHaveBeenCalledWith(run.id, project.id)
```

Also compare counts of P8 `publicationProposal`, `publicationPlan`, `publicationExecution` before/after and assert unchanged.

- [ ] **Step 2: Write RED for zero-plan and retry checkpoint**

Zero plan must still set `planningCompletedAt` and enqueue orchestration. A second processing attempt with `status=RUNNING` and `planningCompletedAt != null` must skip P9-A and only retry orchestration enqueue.

```ts
expect(materializeProject).toHaveBeenCalledTimes(1)
await processOptimizationPlanningJob(job, deps)
expect(materializeProject).toHaveBeenCalledTimes(1)
expect(orchestrationQueue.enqueueRun).toHaveBeenCalledTimes(2)
```

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/integration/orchestration.planning-worker.test.ts
```

- [ ] **Step 4: Implement guarded planning flow**

Rules:
1. `MATERIALIZE_RUN` validates persisted run/project.
2. Terminal `SUCCEEDED/FAILED` is a no-op.
3. `QUEUED` uses CAS to `RUNNING` and sets `startedAt`.
4. `RUNNING + planningCompletedAt` skips P9-A and retries orchestration handoff.
5. Otherwise call deterministic P9-A exactly with `useAi:false`.
6. In one DB transaction create/reuse run items for returned plans, verify each `plan.projectId === run.projectId`, persist counters and `planningCompletedAt`.
7. Redis orchestration enqueue happens after the DB checkpoint.
8. Deterministic contract errors persist bounded `lastErrorCode`, `failureCount=1`, `status=FAILED`, `completedAt`; infrastructure errors throw retryably without raw error text in DB.
9. `RECONCILE_DAILY` delegates to `orchestrationService.reconcileUtcDate()` and never calls P9-A directly.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/orchestration.planning-worker.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.worker.ts tests/integration/orchestration.planning-worker.test.ts
git commit -m "feat(p9-b): materialize durable optimization runs"
```

---

### Task 6: Implement orchestration advance worker and terminal counters

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

- [ ] **Step 1: Write RED for valid items**

Persist a RUNNING run with `planningCompletedAt`, two PENDING items linked to same-project frozen P9-A plans. After processing:

```ts
expect(items.every((item) =>
  item.currentStage === 'READY_FOR_POLICY' && item.status === 'COMPLETED'
)).toBe(true)
expect(run).toMatchObject({
  status: 'SUCCEEDED',
  completedCount: 2,
  failureCount: 0,
  itemCount: 2,
})
```

- [ ] **Step 2: Write RED for plan/project mismatch and zero-plan run**

A forged/mismatched run item must fail closed with stable `PLAN_PROJECT_MISMATCH`, item `FAILED`, run `FAILED`, no P8 writes. A run with zero items and non-null `planningCompletedAt` completes `SUCCEEDED` with all counters zero.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/integration/orchestration.advance-worker.test.ts
```

- [ ] **Step 4: Implement minimal advance logic**

For each PENDING item, load the referenced `OptimizationPlan` and verify both plan and item project IDs match the run. Use CAS item transitions. Recompute `itemCount`, `completedCount`, `failureCount` from persisted rows after transitions. Mark run `SUCCEEDED` only when all items are COMPLETED; otherwise `FAILED` when any item is FAILED. Never inspect P8 risk or create P8 objects.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/orchestration.advance-worker.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/optimization-orchestration/orchestration.worker.ts tests/integration/orchestration.advance-worker.test.ts
git commit -m "feat(p9-b): advance runs to policy checkpoint"
```

---

### Task 7: Add Growth completion handoff without changing Growth success semantics

**Files:**
- Modify: `src/modules/growth/growth.worker.ts`
- Modify: `tests/unit/growth.worker.test.ts`

**Interface:**

Extend deps with:

```ts
optimizationTrigger?: {
  triggerGrowth(input: GrowthTriggerInput): Promise<unknown>
}
```

- [ ] **Step 1: Write RED**

Lock order and failure semantics:

```ts
const order: string[] = []
const materialize = vi.fn(async () => { order.push('materialized'); return successResult })
const triggerGrowth = vi.fn(async () => { order.push('triggered') })
await processGrowthMaterializationJob(job, { materialize, optimizationTrigger: { triggerGrowth } })
expect(order).toEqual(['materialized', 'triggered'])
```

Add cases for both `COMPLETED` and `INELIGIBLE`. For thrown Growth materialization, `triggerGrowth` is never called. For trigger queue failure, Growth worker still emits bounded `growth.materialization.completed` and does not rewrite/re-run authoritative Growth persistence; emit an additional safe handoff observability record only if existing Growth observability contract supports a new event, otherwise swallow the handoff error after the completed event and rely on daily reconciliation.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/growth.worker.test.ts
```

- [ ] **Step 3: Implement minimal optional handoff**

Call trigger after `materialize()` returns and after the completed event payload is constructed. Pass exact `asOfDate`, `GROWTH_MATERIALIZATION_VERSION`, `GROWTH_SCORE_VERSION`, state, and selected snapshot IDs. Do not pass raw evidence/provider payloads.

- [ ] **Step 4: Run GREEN**

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

### Task 8: Wire workers and daily UTC scheduler into the existing bootstrap

**Files:**
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `tests/unit/worker-bootstrap.test.ts`

**Implementation constants:**

```ts
export const OPTIMIZATION_PLANNING_WORKER_CONCURRENCY = 1
export const OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY = 2
export const OPTIMIZATION_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000
```

- [ ] **Step 1: Write bootstrap RED**

Extend `workerDefinitionForQueue()` assertions:

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

Also extract/test a pure `utcDateString(now)` helper or scheduler job builder to prove the scheduler uses UTC `YYYY-MM-DD` and the job name/data are `reconcile-daily` / `{ kind:'RECONCILE_DAILY', utcDate }`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/worker-bootstrap.test.ts tests/unit/orchestration.queue.test.ts
```

- [ ] **Step 3: Wire real queues/workers**

Create support Queue instances for the two P9-B queues so production can inject:
- `OptimizationPlanningQueue`
- `OptimizationOrchestrationQueue`
- `OptimizationOrchestrationService`

Inject the trigger service into Growth worker production wiring. Add one `upsertJobScheduler` on the planning queue for daily reconciliation. The scheduled worker derives UTC date at processing time rather than pinning the bootstrap date forever; scheduler payload should be `{ kind:'RECONCILE_DAILY' }` and the worker uses injected `now()` to produce current UTC date.

Use the existing worker-bootstrap pattern: catch P9-B worker errors, call `classifyOptimizationOrchestrationError`, `job.discard()` for NON_RETRYABLE, then rethrow.

- [ ] **Step 4: Run GREEN**

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

### Task 9: Add strict manual run API and AppOptions injection

**Files:**
- Create: `src/modules/optimization-orchestration/orchestration.routes.ts`
- Create: `tests/integration/orchestration.api.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

```ts
export interface OptimizationOrchestrationApiPort {
  triggerManual(input: {
    projectId: string
    manualRequestId: string
    requestedBy: string
  }): Promise<unknown>
}

export function createOptimizationOrchestrationRoutes(
  api?: OptimizationOrchestrationApiPort,
): Router
```

Strict request:

```ts
const manualRunSchema = z.object({
  manualRequestId: z.string().uuid(),
}).strict()
```

- [ ] **Step 1: Write API RED**

Use Supertest + real Project rows + fake API. Lock:
- STANDARD returns 403 before fake API is touched;
- ADVANCED/ENTERPRISE return 202 or 201 with persisted run identity/status;
- malformed UUID/unknown fields return 400 `VALIDATION_ERROR`;
- requested actor is server-derived as `project-api:${projectId}`;
- route does not accept `requestedBy`, P8 fields, risk, plan IDs, Git fields, or AI flags from client;
- opening unrelated GET routes does not invoke the trigger API.

```ts
await request(app)
  .post(`/api/v1/projects/${standard.id}/optimization/runs`)
  .send({ manualRequestId: crypto.randomUUID() })
  .expect(403)
expect(fake.calls).toHaveLength(0)
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/orchestration.api.test.ts
```

- [ ] **Step 3: Implement route + app wiring**

Use `requireFeature('OPTIMIZATION_ORCHESTRATION')`, `routeParam`, strict Zod validation, and `createApp({ optimizationOrchestrationApi })` injection pattern. Mount with `/api/v1`. Do not add a GET dashboard or web route.

- [ ] **Step 4: Run GREEN**

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

### Task 10: Lock authority boundaries and end-to-end idempotency

**Files:**
- Create: `tests/unit/orchestration.boundary.test.ts`
- Extend: `tests/integration/orchestration.planning-worker.test.ts`
- Extend: `tests/integration/orchestration.advance-worker.test.ts`

- [ ] **Step 1: Write boundary RED**

Static source scan `src/modules/optimization-orchestration/**/*.ts` and assert it does not import:
- P7 detector/scoring modules (`growth-detectors`, `growth-score`, `new-content`, `cannibalization`);
- P8 publication service/approval/risk/mutation/Git adapters;
- GitHub adapters;
- AI ranking task builder/provider client;
- P5/P6 raw fact modules.

Allow only P9-A `optimization.service`, P9-A/P9-B Prisma models, project repository/feature matrix, queue primitives, and core errors.

Behavior assertions around a real planning+advance run:
- P7 latest snapshots/evidence/lifecycle are byte-for-byte unchanged;
- P9-A candidate/plan rows are not UPDATEd or DELETEd by P9-B;
- P8 proposal/plan/execution counts unchanged;
- final run item is exactly `READY_FOR_POLICY/COMPLETED`;
- no `automationEligibility` mutation;
- no Draft PR/Git/deploy side effect.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/orchestration.boundary.test.ts tests/integration/orchestration.planning-worker.test.ts tests/integration/orchestration.advance-worker.test.ts
```

- [ ] **Step 3: Fix only real boundary leaks**

If the tests are already green, make no production change. If they find a leak, use systematic debugging and remove the smallest unauthorized dependency/side effect. Do not expand P9-B scope to satisfy a failing test.

- [ ] **Step 4: Run focused GREEN**

```bash
npx vitest run \
  tests/unit/orchestration.identity.test.ts \
  tests/unit/orchestration.queue.test.ts \
  tests/unit/orchestration.feature-gate.test.ts \
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

### Task 11: Document P9-B operational contract and run full regression

**Files:**
- Create: `docs/development/p9-b-workflow-orchestrator.md`
- Modify: `docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md` only to change status to `Approved / Implemented` after code gates pass; do not rewrite design history.

- [ ] **Step 1: Write development documentation**

Document exact run/item states, identities, two queue names, retry/discard behavior, `planningCompletedAt` checkpoint, Growth at-least-once handoff, UTC daily reconciliation, manual API, feature gate, counter semantics, zero-plan success, and P9-A/P9-C/P8 authority boundaries.

- [ ] **Step 2: Run Prisma gates**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Expected: all exit 0; only the new P9-B migration is applied after existing migrations.

- [ ] **Step 3: Run full regression**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all exit 0.

- [ ] **Step 4: Commit docs/final local fixes**

```bash
git add docs/development/p9-b-workflow-orchestrator.md docs/superpowers/specs/2026-08-23-p9-b-workflow-orchestrator-design.md
git commit -m "docs: document P9-B workflow orchestrator"
```

---

### Task 12: Final exact-head CI, manual diff review, and PR Ready gate

**Files:**
- No planned production changes. Only test/docs fix commits if verification produces concrete evidence.

- [ ] **Step 1: Open/keep P9-B PR as Draft**

PR title: `P9-B: add workflow orchestrator`

PR body must state:
- base `main@28d1c7ee...`;
- two queues only;
- deterministic P9-A `useAi:false` orchestration;
- no P8/P9-C/Git/deploy authority;
- exact migration and feature gate;
- Draft until final gates.

- [ ] **Step 2: Run/fetch exact-head GitHub Actions**

Required jobs:

```text
verify = success
production-audit = success
e2e = success
```

Within `verify`, confirm individually:

```text
Prisma validate = success
Prisma generate = success
Prisma migrate deploy = success
Typecheck = success
Test = success
Build = success
```

Do not claim completion from an older commit or partially green run.

- [ ] **Step 3: Manual diff review against base**

Reject readiness if the diff contains:
- P7 scoring/detector/formula modifications;
- P9-A candidate/plan mutation APIs or immutable-trigger weakening;
- P8 risk/approval/proposal/plan/execution creation;
- Git write/Draft PR/merge/deploy/rollback code;
- third orchestration/experiment queue or a generic event bus;
- async AI continuation orchestration;
- project timezone inference from market/locale;
- client-controlled actor/risk/plan/fact fields;
- dependency/credential changes unrelated to P9-B;
- edits to applied P9-A migrations.

- [ ] **Step 4: Mark Ready only after fresh evidence**

Update PR body with exact head SHA and CI run number, then mark Ready for Review. Stop at the merge gate.

- [ ] **Step 5: Do not merge/deploy**

Wait for a separate explicit human `合并` instruction. Deployment remains separately authorized.
