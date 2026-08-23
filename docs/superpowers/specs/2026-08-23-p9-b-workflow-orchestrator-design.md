# P9-B Workflow Orchestrator Design

Date: 2026-08-23
Status: Draft spec pending user review
Repository: `liufaxing1978-droid/seogeo`
Base: `main@28d1c7ee8b812579b570cf476154e266f87abed1`
Branch: `feat/p9-b-workflow-orchestrator`

## 1. Purpose

P9-B adds the durable workflow layer that decides **when optimization planning runs and which bounded workflow step comes next**.

P9-A remains the authoritative optimization planner. P9-B does not create a second optimization policy, does not recalculate P7 opportunity facts, and does not own publication execution.

The V1 flow is:

```text
Growth materialization success / daily reconciliation / manual trigger
→ durable OptimizationRun
→ optimization-planning queue
→ deterministic P9-A materialization
→ frozen OptimizationPlan rows
→ durable OptimizationRunItem rows
→ optimization-orchestration queue
→ READY_FOR_POLICY routing state
```

`READY_FOR_POLICY` means only that the P9-B orchestration record is complete and may later be evaluated by P9-C. It is **not** an autopilot approval, risk decision, or P8 handoff.

## 2. Existing repository constraints

P9-B extends the existing BullMQ architecture rather than introducing a new event bus.

Current repository facts relevant to the design:

- queue names are centrally registered in `src/queue/queues.ts`;
- workers are bootstrapped centrally in `src/queue/worker-bootstrap.ts`;
- queue modules commonly define deterministic BullMQ job IDs and narrow queue ports;
- Growth materialization already runs through `growth-materialization`;
- Growth success emits an observability event after authoritative persistence, but there is no durable general-purpose event bus;
- P9-A `OptimizationService.materializeProject()` can freeze deterministic plans immediately or enqueue an optional AI ranking task.

P9-B V1 therefore uses explicit post-success queue handoff plus a daily reconciliation safety net.

## 3. Hard authority boundaries

P9-B MUST NOT:

- call P7 detectors or scoring functions;
- mutate P7 opportunity snapshots, evidence, score, priority, or lifecycle;
- alter P9-A candidate eligibility, recommended action, deterministic rank, AI rank adjustment, market scope, or immutable plans;
- classify P8 risk;
- create or approve P8 `PublicationProposal` / `PublicationPlan` in V1;
- preview or execute site mutation;
- write Git branches or Draft PRs;
- merge, deploy, verify production, or rollback;
- introduce a general event bus;
- infer P8 deployment or verification states;
- treat `READY_FOR_POLICY` as P9-C approval.

P9-B may:

- create and update its own workflow run state;
- enqueue its two owned BullMQ queues;
- invoke the existing P9-A service in deterministic mode;
- read persisted P9-A candidates/plans needed to build workflow items;
- explicitly trigger a run after successful Growth materialization;
- perform daily reconciliation;
- accept a project-scoped manual run request.

## 4. Why orchestrated planning is deterministic in V1

P9-A supports optional bounded DeepSeek reranking, but the AI path is asynchronous: `materializeProject({ useAi: true })` returns an AI task ID before `OptimizationPlan` rows exist.

P9-B V1 deliberately invokes:

```text
OptimizationService.materializeProject(projectId, {
  advisoryRootDir,
  useAi: false
})
```

This keeps each planning job transactionally simple: when the P9-A call returns, every eligible plan needed by the run is already frozen and can be linked immediately to `OptimizationRunItem`.

This does **not** remove or weaken P9-A bounded AI capability. It only means P9-B V1 does not orchestrate the asynchronous AI continuation yet. A later additive P9-B extension may add a durable AI continuation/outbox contract without changing V1 run identity or P9-A authority.

## 5. Persisted entities

### 5.1 OptimizationRun

Fields:

```text
id
projectId
runVersion = OPTIMIZATION_RUN_V1
triggerType
triggerSource
triggerKey
triggerPayload
status
candidateCount
plannedCount
itemCount
completedCount
failureCount
startedAt
completedAt
lastErrorCode
createdAt
updatedAt
```

Enums:

```text
OptimizationTriggerType
- EVENT
- DAILY_RECONCILIATION
- MANUAL

OptimizationTriggerSource
- GROWTH_MATERIALIZATION
- DAILY_SCHEDULER
- MANUAL_REQUEST

OptimizationRunStatus
- QUEUED
- RUNNING
- SUCCEEDED
- FAILED
```

`triggerPayload` is bounded first-party provenance only. It must not contain raw provider responses, raw vendor Markdown, credentials, prompts, or mutable P8 payloads.

Bounded payloads:

Growth event:

```json
{
  "version": "P9_B_GROWTH_TRIGGER_V1",
  "asOfDate": "2026-08-23T00:00:00.000Z",
  "growthMaterializationVersion": "GROWTH_MATERIALIZATION_V1",
  "growthFormulaVersion": "...",
  "growthState": "COMPLETED",
  "selectedGscSnapshotIds": ["..."]
}
```

Daily reconciliation:

```json
{
  "version": "P9_B_DAILY_TRIGGER_V1",
  "utcDate": "2026-08-23",
  "plannerVersion": "OPTIMIZATION_PLAN_V1"
}
```

Manual:

```json
{
  "version": "P9_B_MANUAL_TRIGGER_V1",
  "manualRequestId": "uuid",
  "requestedBy": "actor-id-or-system-identity"
}
```

Uniqueness:

```text
UNIQUE(projectId, triggerKey)
```

A duplicate trigger returns/reuses the existing run. It does not create a second workflow.

### 5.2 OptimizationRunItem

Each row links one frozen P9-A `OptimizationPlan` to one P9-B run.

Fields:

```text
id
runId
projectId
optimizationPlanId
itemKey
currentStage
status
reasonCode
createdAt
updatedAt
completedAt
```

Enums:

```text
OptimizationRunItemStage
- PLANNED
- READY_FOR_POLICY

OptimizationRunItemStatus
- PENDING
- COMPLETED
- FAILED
```

V1 normal transition:

```text
PLANNED / PENDING
→ READY_FOR_POLICY / COMPLETED
```

`READY_FOR_POLICY` is a routing checkpoint only. P9-C later decides whether a plan is blocked, manual-only, deferred, stale, conflicting, or eligible for controlled autopilot. P9-B V1 deliberately does not pre-create those policy states without an authoritative P9-C rule.

Uniqueness:

```text
UNIQUE(runId, optimizationPlanId)
UNIQUE(runId, itemKey)
```

`itemKey` is SHA-256 canonical JSON over:

```text
itemVersion
runId
optimizationPlanId
```

P9-B does not copy mutable P9-A facts into the item. The immutable plan foreign key is the authoritative reference.

## 6. Trigger identity

Canonical hashing uses sorted object keys and explicit null semantics, matching the deterministic identity style already used by P7/P9-A.

### 6.1 Growth materialization trigger

After `materializeGrowthWindow()` has committed authoritative Growth rows and returned successfully, the Growth worker may enqueue a P9-B planning trigger.

Identity input:

```text
runVersion
projectId
triggerType = EVENT
triggerSource = GROWTH_MATERIALIZATION
asOfDate
Growth materialization version
Growth formula version
Growth result state
sorted distinct selectedGscSnapshotIds
```

The trigger is emitted only after a successful materialization call. A thrown Growth materialization never creates a P9-B run.

`COMPLETED` and `INELIGIBLE` are both persisted successful Growth outcomes. Both may trigger reconciliation; an ineligible Growth result naturally produces zero P9-A plans.

### 6.2 Daily reconciliation trigger

The worker bootstrap owns one daily BullMQ scheduler for P9-B reconciliation.

Identity input:

```text
runVersion
projectId
triggerType = DAILY_RECONCILIATION
triggerSource = DAILY_SCHEDULER
utcDate
OptimizationPlan version
```

Daily V1 uses UTC because the current project model does not expose an authoritative project timezone. No locale-derived timezone inference is allowed.

The scheduler enumerates eligible projects and enqueues one deterministic daily planning job per project. Duplicate scheduler execution on the same UTC date is idempotent.

### 6.3 Manual trigger

Manual V1 requires a caller-provided UUID `manualRequestId`.

Identity input:

```text
runVersion
projectId
triggerType = MANUAL
triggerSource = MANUAL_REQUEST
manualRequestId
```

Retrying the same request ID reuses the same run. A new request ID intentionally creates a new run.

## 7. Queue architecture

P9-B adds exactly two queues to the central queue registry:

```text
optimization-planning
optimization-orchestration
```

It does not add `optimization-experiment-evaluation` in P9-B; that belongs to P9-D.

### 7.1 optimization-planning

Job name:

```text
materialize-run
```

Job data:

```text
runId
projectId
```

BullMQ job ID is derived from the persisted run ID, so duplicate enqueue attempts address the same logical planning job.

Responsibilities:

1. validate job/run/project identity;
2. atomically transition `QUEUED → RUNNING` with guarded state update;
3. invoke deterministic P9-A materialization;
4. create idempotent `OptimizationRunItem` rows for returned frozen plans;
5. persist counters;
6. enqueue one `optimization-orchestration` continuation for the run;
7. on non-retryable contract failure, persist `FAILED` and bounded `lastErrorCode`;
8. on retryable infrastructure failure, preserve retry semantics and never duplicate items.

### 7.2 optimization-orchestration

Job name:

```text
advance-run
```

Job data:

```text
runId
projectId
```

Responsibilities:

1. load the run and all linked items;
2. validate every item still references the same project and a real frozen P9-A plan;
3. move valid `PLANNED/PENDING` items to `READY_FOR_POLICY/COMPLETED`;
4. derive run counters from persisted rows rather than trusting job payload counters;
5. mark the run `SUCCEEDED` when every item is `COMPLETED` and no failure exists;
6. on a deterministic item validation failure, mark the affected item `FAILED`, mark the run `FAILED`, and persist bounded reason/error codes;
7. produce no P8 side effects.

A zero-plan run is valid and completes `SUCCEEDED` with zero items. This preserves auditable reconciliation without fabricating work.

## 8. Retry and failure semantics

Retryability follows existing bounded BullMQ practices.

Retryable examples:

- Redis/BullMQ transient error;
- transient database connectivity failure;
- temporary advisory registry filesystem/read failure if classified infrastructure-related.

Non-retryable examples:

- run/project identity mismatch;
- missing project;
- malformed persisted trigger payload;
- plan/project mismatch;
- invalid state transition;
- P9-A immutable payload conflict;
- advisory integrity failure caused by a deterministic repository mismatch.

Workers must never reset a failed P9-A/P7 fact or synthesize replacement inputs.

Persisted error state contains stable first-party codes, not raw stack traces, provider bodies, credentials, or AI responses.

## 9. State transition guards

Workflow rows are intentionally mutable state machines, unlike immutable P9-A candidates/plans.

Every transition must be guarded by current state in the database, for example conceptually:

```text
UPDATE OptimizationRun
SET status = RUNNING
WHERE id = ? AND status = QUEUED
```

A zero-row transition means another worker already advanced the run or the state is invalid; the caller reloads and handles the persisted state rather than forcing an update.

Run completion counters are recomputed from persisted candidates/plans/items at stable checkpoints. Job payloads are never authoritative counters.

No UPDATE/DELETE operation is allowed against P9-A candidate/plan tables from P9-B repositories.

## 10. Reconciliation behavior

Daily reconciliation is a safety net, not a second planner universe.

For each eligible project it:

1. creates/reuses the deterministic daily run;
2. invokes P9-A against the latest persisted P7 snapshots;
3. relies on P9-A candidate/plan idempotency to reuse unchanged immutable artifacts;
4. creates run items only for the plans returned by that run;
5. advances them to `READY_FOR_POLICY`.

It does not inspect raw P5/P6/provider data to discover opportunities independently.

## 11. Growth handoff

P9-B integrates with `processGrowthMaterializationJob()` through an optional injected queue dependency, preserving testability.

Conceptual dependency:

```ts
interface OptimizationPlanningTriggerPort {
  enqueueGrowthMaterialization(input: {
    projectId: string
    asOfDate: string
    materializationVersion: string
    formulaVersion: string
    state: 'COMPLETED' | 'INELIGIBLE'
    selectedGscSnapshotIds: readonly string[]
  }): Promise<unknown>
}
```

The production worker injects the P9-B trigger queue. Unit tests can inject a fake.

The enqueue occurs only after `materialize()` returns. Queue enqueue failure must not roll back already committed Growth facts. The failure is observable and daily reconciliation repairs the missed handoff.

This is intentional at-least-once orchestration with deterministic deduplication, not a distributed transaction between PostgreSQL and Redis.

## 12. Manual API

P9-B V1 exposes one authenticated project-scoped mutation endpoint:

```text
POST /projects/:projectId/optimization/runs
```

Request:

```json
{
  "manualRequestId": "uuid"
}
```

Behavior:

- requires normal project authorization;
- requires `OPTIMIZATION_ORCHESTRATION` feature entitlement;
- creates/reuses the deterministic MANUAL run;
- enqueues planning;
- returns persisted run identity/status;
- does not synchronously call P9-A, AI, Git, or P8.

No P9-B dashboard/UI is added in V1; that belongs to P9-F.

## 13. Feature gate

Add/use the P9 master feature gate:

```text
OPTIMIZATION_ORCHESTRATION
Standard: false
Advanced: true
Enterprise: true
```

Automatic Growth handoff and daily scheduler must skip projects without the entitlement.

Feature gating does not delete historical run rows. If entitlement is later removed, persisted history remains readable by authorized internal code while new automatic/manual runs are blocked.

## 14. Counters

V1 `OptimizationRun` counters have exact stored semantics:

```text
candidateCount = number of P9-A candidates returned for this planning call
plannedCount   = number of frozen P9-A plans returned
itemCount      = number of persisted run items
completedCount = number of run items in COMPLETED
failureCount   = number of run items in FAILED, or 1 when the run fails before any item-level failure can be persisted
```

Counters default to zero. `completedCount` and `failureCount` are recomputed from persisted item rows at orchestration checkpoints, except the explicit pre-item run failure case above.

V1 does not store `deferredCount` or `executedCount` because P9-B V1 neither owns policy deferral nor executes P8 work.

## 15. No P8 handoff in P9-B V1

The P9 master design eventually allows run items to reference P8 proposal/execution IDs, but the approved P9-B V1 boundary intentionally stops before that.

Therefore V1 schema does not add P8 proposal/execution foreign keys. P9-C will add the controlled policy/handoff contract in a separate reviewed migration.

This keeps the ownership split explicit:

```text
P9-A: what should be done
P9-B: when to run and durable workflow position
P9-C: whether controlled autopilot may hand work to P8
P8: exact publication/mutation/verification authority
```

## 16. Security and data minimization

Queue payloads carry only IDs and small bounded trigger facts.

Do not place in queue payloads or run payloads:

- Git tokens;
- provider credentials;
- raw Search Console/provider responses;
- raw P7 evidence bodies;
- raw advisory/vendor Markdown;
- AI prompt/response bodies;
- P8 patch bodies or generated file content.

Workers reload authoritative persisted state using IDs.

Manual routes use existing authorization/security middleware and project scope checks.

## 17. Migration strategy

Use one additive forward migration for P9-B V1, after all P9-A migrations.

It adds:

- trigger/status/stage enums;
- `OptimizationRun`;
- `OptimizationRunItem`;
- indexes and foreign keys.

Foreign-key rules preserve audit history:

- Project → run: `ON DELETE RESTRICT`;
- run → items: `ON DELETE RESTRICT`;
- OptimizationPlan → run item: `ON DELETE RESTRICT`.

P9-B rows are mutable state machines, so they do not use P9-A's UPDATE immutability trigger. Production repositories expose no destructive delete API for run history.

Never edit the already-applied P9-A migrations.

## 18. Testing contract

### Deterministic identity

Tests must prove:

- Growth selected snapshot ordering does not change trigger key;
- duplicate Growth snapshot IDs are deduplicated;
- same manualRequestId reuses one run;
- different manualRequestId creates another run;
- same project/date/planner version reuses one daily run;
- different projects never share trigger keys.

### Persistence

Tests must prove:

- `(projectId, triggerKey)` uniqueness;
- run-item idempotency;
- plan/project mismatch fails closed;
- P9-A candidates/plans remain unchanged after orchestration;
- no P8 proposal/plan/execution rows are created.

### Planning worker

Tests must prove:

- `QUEUED → RUNNING` guarded transition;
- P9-A is invoked once per effective run execution;
- deterministic plans create run items;
- zero-plan run is successful;
- retry does not duplicate plans or items;
- deterministic failure persists stable failure code.

### Orchestration worker

Tests must prove:

- only P9-B state changes;
- every valid item becomes `READY_FOR_POLICY/COMPLETED`;
- deterministic invalid item becomes `FAILED` and fails the run;
- run counters are derived from persisted rows;
- run becomes `SUCCEEDED` only after all items are completed;
- no P8/Git side effects.

### Growth handoff

Tests must prove:

- no P9-B enqueue before Growth materialization returns;
- successful COMPLETED/INELIGIBLE Growth result may enqueue;
- failed Growth materialization never creates a trigger;
- queue handoff failure does not rewrite successful Growth persistence semantics.

### Scheduler/manual trigger

Tests must prove:

- daily UTC identity is stable;
- scheduler is idempotent;
- feature-ineligible projects are skipped;
- manual route requires project authorization and feature gate;
- HTTP GET/render paths never enqueue work.

### Full gates

Final exact PR head must pass:

```text
Prisma validate
Prisma generate
Prisma migrate deploy
Typecheck
full Vitest
Build
production-audit
e2e
```

## 19. Expected implementation surface

Likely new files:

```text
prisma/models/optimization-orchestration.prisma
prisma/migrations/<timestamp>_add_p9b_workflow_orchestrator/migration.sql
src/modules/optimization-orchestration/orchestration.types.ts
src/modules/optimization-orchestration/orchestration.identity.ts
src/modules/optimization-orchestration/orchestration.repository.ts
src/modules/optimization-orchestration/orchestration.queue.ts
src/modules/optimization-orchestration/orchestration.service.ts
src/modules/optimization-orchestration/orchestration.worker.ts
src/modules/optimization-orchestration/orchestration.routes.ts
```

Likely modified files:

```text
src/queue/queues.ts
src/queue/worker-bootstrap.ts
src/modules/growth/growth.worker.ts
feature-gate/entitlement source files
src/app.ts                 # only if route registration follows current app pattern
```

The exact file list is finalized by the implementation plan after repository-level inspection.

## 20. Release gate

P9-B V1 is complete only when:

1. exact-head CI is fully green;
2. manual diff review shows no P7/P9-A/P8 authority leak;
3. no generic event bus, auto-PR, merge, deploy, or experiment code was introduced;
4. migrations are additive only;
5. run identity and queue idempotency are covered by tests;
6. PR remains Draft until those gates pass;
7. merge still requires a separate explicit human `合并` instruction;
8. deployment remains a separate explicit authorization.
