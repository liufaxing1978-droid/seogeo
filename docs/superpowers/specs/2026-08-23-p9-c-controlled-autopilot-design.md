# P9-C Controlled Autopilot Design

Date: 2026-08-23
Status: Approved design pending written-spec review
Repository: `liufaxing1978-droid/seogeo`
Base: `main@58d031cb07342a6655ae84093c00ce7bfaf6f0c2`
Branch: `feat/p9-c-controlled-autopilot`

## 1. Purpose

P9-C adds the policy authority that decides whether a completed P9-B optimization item may enter a controlled automatic path toward a P8 Draft PR.

P9-C does not replace P8. It cannot classify exact publication risk independently, generate an authoritative file mutation independently, bypass P8 validation or current-revision checks, write Git directly, merge, deploy, or rollback production.

The V1 flow is:

```text
P9-A immutable OptimizationPlan
        ↓
P9-B READY_FOR_POLICY item
        ↓
P9-C optimization-autopilot queue
        ↓
project policy + deterministic gate evaluation
        ↓
immutable OptimizationAutopilotDecision
        ↓
P8 proposal/draft/PublicationPlan/Preview
        ↓
P8 authoritative LOW-risk + validation gates
        ↓
P8 PublicationAutomationAuthorization
        ↓
PublicationExecution = AUTOMATION_AUTHORIZED
        ↓
existing P8 execution queue/worker
        ↓
Draft PR only
        ↓
human merge / human deployment
```

Authority remains split as follows:

```text
P9-A: what optimization should be considered
P9-B: when planning runs and durable workflow position
P9-C: whether controlled policy permits an automatic P8 handoff
P8: exact content mutation, risk, validation, preview, execution and verification
```

## 2. Existing constraints carried forward

P9-C inherits the current P9/P8 boundaries.

P9-A already guarantees:

- immutable candidates and plans;
- deterministic eligibility and action mapping;
- AI cannot change eligibility, action, market, source facts, risk, or approvals;
- `automationEligibility=false` in P9-A V1 because P9-C owns automation policy.

P9-B already guarantees:

- durable `OptimizationRun` / `OptimizationRunItem` state;
- deterministic P9-A materialization with `useAi:false`;
- no P8 proposal/risk/approval/execution authority;
- a normal item completes at `READY_FOR_POLICY / COMPLETED`.

P8 already guarantees:

- immutable exact `PublicationPlan` / `PublicationPreview`;
- authoritative `PublicationRiskClass`;
- deterministic validation;
- exact plan/content/preview/base-SHA/blob binding;
- mutation only through configured P8 adapters;
- Draft PR rather than default-branch mutation;
- no auto-merge or auto-deploy;
- real-site verification owns VERIFIED semantics.

P9-C extends these contracts; it does not reinterpret them.

## 3. Hard non-goals

P9-C MUST NOT:

- modify P7 Growth identity, score, evidence, ranking eligibility, lifecycle or provenance;
- modify P9-A immutable candidate/plan rows;
- infer LOW risk from a P9 recommended action;
- classify P8 risk from P9 data alone;
- fabricate a human `PublicationApproval` with a system actor;
- use the human execution state `APPROVED` for machine authorization;
- bypass P8 plan/preview/validation/current-revision checks;
- import or call the GitHub mutation adapter directly from P9-C;
- write the default branch;
- merge a pull request;
- deploy production;
- automatically rollback production;
- automatically execute MEDIUM/HIGH risk plans;
- auto-confirm warnings that P8 defines as human-review requirements;
- let AI enable autopilot, change risk, raise quotas, disable kill switches, approve execution, merge or deploy;
- create a second publication execution worker;
- introduce a general event bus;
- create unattended community/entity publishing paths that violate P8-C.

## 4. Selected architecture

Three approaches were considered.

### 4.1 Synthetic `PublicationApproval` — rejected

P8 approval has explicit human approver and warning/risk acknowledgement semantics. A `system` approver would make machine authorization appear human-reviewed and corrupt audit meaning.

### 4.2 Direct P9-C Git/P8 adapter execution — rejected

This would create a second mutation authority and bypass P8 exact bindings.

### 4.3 Separate P9 decision + P8 machine authorization — selected

P9-C persists an immutable policy decision. P8 then issues a separate immutable `PublicationAutomationAuthorization` after the exact P8 plan/preview passes every controlled-autopilot gate.

`PublicationExecution` explicitly distinguishes the two entry states:

```text
Human path:   PublicationApproval              → APPROVED
Machine path: PublicationAutomationAuthorization → AUTOMATION_AUTHORIZED
```

Both then enter the same existing P8 queue/worker:

```text
APPROVED / AUTOMATION_AUTHORIZED
→ QUEUED
→ EXECUTING
→ PR_CREATED
```

This preserves one mutation execution authority without conflating human and machine authorization.

## 5. Feature entitlement

Add:

```text
CONTROLLED_AUTOPILOT
```

Matrix:

```text
STANDARD   false
ADVANCED   true
ENTERPRISE true
```

Entitlement only exposes the capability. It never enables it automatically.

All automatic entry points must fail before restricted reads/writes, queue operations, AI preparation, provider work or Git work when entitlement is absent.

## 6. Project policy

### 6.1 `AutopilotPolicy`

One mutable policy row per project.

Fields:

```text
id
projectId
enabled
policyVersion
allowedRiskClass
allowedOperationClasses
dailyDraftPrLimit
maxConcurrentRuns
requireFreshEvidence
minimumEvidenceCoverage
pauseOnVerificationFailure
killSwitch
enabledBy
enabledAt
updatedBy
createdAt
updatedAt
```

V1 defaults/constants:

```text
policyVersion = CONTROLLED_AUTOPILOT_POLICY_V1
enabled = false
allowedRiskClass = LOW
allowedOperationClasses = [CREATE_CONTENT_PAGE]
dailyDraftPrLimit = 3
maxConcurrentRuns = 1
requireFreshEvidence = true
minimumEvidenceCoverage = 70
pauseOnVerificationFailure = true
killSwitch = false
```

Bounds:

```text
dailyDraftPrLimit: 1..10
maxConcurrentRuns: 1..3
minimumEvidenceCoverage: 70..100
```

`allowedRiskClass` is stored for audit clarity, but V1 accepts only `LOW`. MEDIUM/HIGH are invalid policy input.

Policy updates use authenticated server-derived actor identity. Clients cannot set `enabledBy`, `enabledAt`, `updatedBy`, policy version, timestamps or audit identity.

Historical decisions/authorizations are never rewritten when policy changes.

### 6.2 Operation allowlist

P8 remains authoritative for exact operation classification.

The policy stores P8 operation names, not P9 recommendation names.

Server-owned LOW vocabulary remains:

```text
CREATE_CONTENT_PAGE
SET_TITLE
SET_META_DESCRIPTION
SET_H1
ADD_INTERNAL_LINK
UPSERT_JSON_LD
```

V1 **automatic execution is limited to exact `CREATE_CONTENT_PAGE` plans only**.

The other LOW operation names remain reserved vocabulary but cannot enter automatic execution until the P8 exact-plan representation for those changes is separately specified and tested.

A broad P8 operation such as `UPDATE_CONTENT_PAGE`, or any unknown operation, fails automatic eligibility even if the P9 recommendation sounds low risk.

## 7. Global kill switch

Runtime setting:

```text
CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
```

Fail-closed semantics:

- only an explicitly parsed OFF value permits automatic execution;
- missing, malformed, unknown or unparseable value is treated as ON;
- ON blocks new machine authorizations and automatic execution enqueue;
- ON does not delete decisions, reservations, Draft PRs or audit history;
- ON does not disable normal human P8 workflows.

The switch is evaluated both during policy decision and immediately before machine authorization/execution enqueue.

## 8. P9-C queue architecture

P9-C adds exactly one owned BullMQ queue:

```text
optimization-autopilot
```

Job name:

```text
evaluate-run-item
```

Payload:

```text
runItemId
projectId
```

No policy snapshot, source facts, content, hashes, tokens or provider payloads are carried in the job. Workers reload authoritative records by ID.

BullMQ job identity is deterministic from the run-item ID.

### 8.1 P9-B handoff

After P9-B has durably moved an item to `READY_FOR_POLICY / COMPLETED`, its orchestration worker may call an injected P9-C queue port:

```text
enqueueRunItem(runItemId, projectId)
```

This port has no policy authority. It only hands off a durable ID.

If Redis enqueue fails after P9-B state commits, P9-B facts are not rolled back.

### 8.2 P9-C reconciliation safety net

P9-C registers one UTC daily reconciliation scheduler.

It scans bounded `READY_FOR_POLICY` items that have no effective P9-C decision for their current immutable inputs and enqueues deterministic jobs.

The scheduler:

- does not run P9-A;
- does not modify P9-B run/item state;
- does not create P8 work directly;
- is idempotent;
- exists only to repair a missed queue handoff.

## 9. Immutable policy decision

### 9.1 `OptimizationAutopilotDecision`

Fields:

```text
id
projectId
runId
runItemId
optimizationPlanId
policyId
policyVersion
policySnapshot
sourceSnapshot
status
reasonCodes
p8PlanId nullable
p8PreviewId nullable
decisionKey
createdAt
```

Status enum:

```text
AUTOPILOT_READY
P8_PREPARATION_REQUIRED
MANUAL_REQUIRED
POLICY_BLOCKED
DEFERRED_QUOTA
DEFERRED_CONFLICT
STALE
P8_VALIDATION_BLOCKED
```

Rows are immutable after insert.

### 9.2 Decision identity

`decisionKey` is SHA-256 canonical JSON over exactly:

```text
decisionVersion
projectId
runItemId
optimizationPlanId
policyVersion
policySnapshotHash
sourceSnapshotHash
p8PlanId
p8PreviewId
```

Before exact P8 artifacts exist, `p8PlanId` / `p8PreviewId` are explicit null and the result may be `P8_PREPARATION_REQUIRED`.

After exact P8 artifacts exist, a new decision identity binds those immutable IDs. Historical decisions remain unchanged.

### 9.3 Bounded policy snapshot

Persist only:

```text
version
enabled
allowedRiskClass
allowedOperationClasses
dailyDraftPrLimit
maxConcurrentRuns
requireFreshEvidence
minimumEvidenceCoverage
pauseOnVerificationFailure
killSwitch
```

### 9.4 Bounded source snapshot

Persist only the facts required to reproduce the policy decision:

```text
optimizationPlanId
candidateId
growthOpportunityIdentityId
growthSnapshotId
marketScopeMode
marketCode
locale
recommendedActionType
growthEvidenceCoverage
growthScoreState
growthRankingEligible
growthLifecycleStatus
candidateCreatedAt
planCreatedAt
```

When exact P8 artifacts exist also bind:

```text
publicationPlanId
publicationPlanHash
publicationPreviewId
publicationPreviewHash
publicationRiskClass
publicationBaseSha
publicationTargetRepository
publicationTargetBranch
publicationOperationTypes
```

No raw P7/provider payload, article body, prompt, model response, Git token or credential is stored in these snapshots.

## 10. Deterministic gate order

Evaluation order is fixed so reason codes are stable:

1. project exists;
2. `CONTROLLED_AUTOPILOT` entitlement exists;
3. policy exists;
4. policy `enabled=true`;
5. project kill switch OFF;
6. global kill switch OFF;
7. run item belongs to project/run and is `READY_FOR_POLICY`;
8. P9-A plan/candidate belong to project and exist;
9. candidate/source projection is structurally valid;
10. recommended action is supported for V1 automatic preparation;
11. evidence coverage meets threshold;
12. source freshness passes when required;
13. verification-failure pause is clear;
14. no active conflict exists;
15. quota capacity appears available;
16. concurrency capacity appears available;
17. exact P8 plan/preview exist, otherwise `P8_PREPARATION_REQUIRED`;
18. P8 artifacts belong to the same project and P9 preparation identity;
19. P8 risk is exactly LOW;
20. every exact P8 operation is `CREATE_CONTENT_PAGE` and allowlisted;
21. P8 deterministic validation is clear;
22. no unresolved human-only warning remains;
23. site/channel is enabled with `GIT_DRAFT_PR` capability;
24. exact plan/preview/base/blob bindings are current;
25. quota/concurrency reservation succeeds atomically;
26. global/project kill switches are rechecked;
27. P8 machine authorization is created;
28. automation-authorized P8 execution is created/enqueued.

Any deterministic gate failure stops the automatic path. It is not retried as infrastructure failure.

## 11. Evidence freshness

P9-C does not define a new Growth freshness formula.

When `requireFreshEvidence=true`, the P9-A candidate must still reference the latest authoritative P7 Growth snapshot for its underlying Growth opportunity identity.

The path becomes `STALE` when:

- a newer authoritative Growth snapshot exists for the same identity;
- market provenance no longer matches the candidate scope;
- the current Growth lifecycle is terminal;
- required source state becomes UNKNOWN/invalid.

P9-C never updates the old P9-A plan. A later P9-B cycle handles current planning.

## 12. Verification-failure pause

When `pauseOnVerificationFailure=true`, authoritative P8 verification history is checked before a machine authorization is created.

A latest unresolved P8 execution/verification state of `VERIFICATION_FAILED` blocks new automatic execution with `AUTOPILOT_VERIFICATION_PAUSED`.

The pause clears only when authoritative P8 state records a later successful `VERIFIED` result or a human-controlled resolution explicitly removes the failure condition.

P9-C never auto-rolls back.

## 13. Conflict policy

Automatic work is deferred when any of these exist:

- same canonical public URL under active non-terminal P8 mutation;
- same target repository path under active non-terminal P8 mutation;
- same P9 candidate/source identity under another active automatic handoff;
- same P9 run item already bound to an effective machine authorization/execution.

Ambiguous compatibility is treated as conflict. P9-C V1 never merges plans automatically.

Result:

```text
DEFERRED_CONFLICT
AUTOPILOT_CONFLICT
```

## 14. Quota and concurrency

### 14.1 Daily quota

Quota is project-scoped and UTC-day scoped.

Default:

```text
3 automatic Draft-PR reservations / project / UTC day
```

Only machine-authorized executions consume this quota. Human P8 approvals do not.

### 14.2 `AutopilotExecutionReservation`

Fields:

```text
id
projectId
decisionId
utcDate
reservationKey
status
createdAt
releasedAt nullable
```

Reservation status:

```text
RESERVED
CONSUMED
RELEASED
```

Uniqueness:

```text
UNIQUE(decisionId)
UNIQUE(projectId, reservationKey)
```

The service takes a database serialization lock scoped to `(projectId, utcDate)` before counting and inserting the reservation. Two workers cannot both claim the final slot.

A repeated decision reuses the existing reservation and cannot consume a second slot.

### 14.3 Concurrency

`maxConcurrentRuns` counts machine-authorized P8 executions in these active states:

```text
AUTOMATION_AUTHORIZED
QUEUED
EXECUTING
```

The slot is released for concurrency accounting once the execution reaches any other state, including `PR_CREATED`.

Quota remains consumed after `PR_CREATED`; releasing a concurrency slot does not refund daily quota.

Quota and concurrency checks/reservation occur in one database transaction under the project/day serialization guard.

## 15. P8 preparation boundary

P9-C does not construct authoritative file diffs.

V1 supports exactly one automatic recommendation mapping:

```text
P9-A CONTENT_CREATION
→ P8 CREATE_CONTENT_PAGE preparation
```

Every other P9 action type produces `MANUAL_REQUIRED` until separately specified and tested.

### 15.1 P8 proposal provenance

Extend P8 enum:

```text
PublicationProposalSourceType += P9_OPTIMIZATION_PLAN
```

For a P9-C generated proposal:

```text
sourceType        = P9_OPTIMIZATION_PLAN
sourceReferenceId = optimizationPlanId
sourceSnapshotId  = runItemId
```

Bounded `sourceMetadata` contains only:

```text
optimizationCandidateId
growthOpportunityIdentityId
growthSnapshotId
recommendedActionType
marketScopeMode
marketCode
locale
autopilotDecisionId
```

No raw P7/P9 source payload is copied.

### 15.2 Preparation idempotency

Add a partial unique database index for P9-origin proposals over:

```text
(projectId, sourceType, sourceReferenceId, sourceSnapshotId)
WHERE sourceType = 'P9_OPTIMIZATION_PLAN'
```

The P8 repository exposes `createOrGetP9OptimizationProposal()` and verifies identity on collision.

Repeated P9-C handoff therefore reuses one proposal even across process crashes/races.

Draft/content generation continues through existing P8/P4 contracts. P9-C does not call DeepSeek transport directly.

P8 validation, `PublicationPlan`, preview and exact target snapshot remain authoritative.

## 16. P8 machine authorization

### 16.1 `PublicationAutomationAuthorization`

Add an immutable P8 entity with fields:

```text
id
projectId
planId
planVersion
planHash
contentVersion
contentHash
previewHash
baseSha
targetRepository
targetBranch
targetBlobHashes
authorizedRiskClass
automationDecisionId
automationPolicyVersion
automationPolicyHash
automationSource
expiresAt
createdAt
```

Constants:

```text
authorizedRiskClass = LOW
automationSource = CONTROLLED_AUTOPILOT
```

Creation requires:

- exact project match;
- exact plan/preview/content hash match;
- P8 risk exactly LOW;
- exact operations are only `CREATE_CONTENT_PAGE`;
- deterministic validation clear;
- no human-only warnings;
- source decision is `AUTOPILOT_READY` and references the same exact P8 plan/preview;
- policy snapshot permits the operation;
- reservation belongs to the decision and remains valid;
- global/project kill switches currently OFF;
- authorization expiry is in the future.

The creation API is internal-service-only. No generic client endpoint can manufacture this record.

## 17. `PublicationExecution` dual authorization

Current `approvalId` becomes nullable.

Add:

```text
automationAuthorizationId nullable
```

Database check constraint:

```text
exactly one of approvalId / automationAuthorizationId is non-null
```

Add execution status:

```text
AUTOMATION_AUTHORIZED
```

Add event type:

```text
AUTOMATION_AUTHORIZED
```

Human execution creation remains:

```text
PublicationApproval
→ status APPROVED
→ event APPROVED
```

Machine execution creation is:

```text
PublicationAutomationAuthorization
→ status AUTOMATION_AUTHORIZED
→ event AUTOMATION_AUTHORIZED
```

Repository/service APIs remain explicit:

```text
createHumanApprovedExecution(...)
createAutomationAuthorizedExecution(...)
```

No untyped generic authorization ID is accepted.

## 18. Existing P8 execution worker reuse

There is still one publication execution worker.

Refactor authorization loading behind a narrow P8-owned union:

```text
HUMAN_APPROVAL
AUTOPILOT_AUTHORIZATION
```

Both validate identical immutable bindings:

- project;
- plan ID/version/hash;
- content version/hash;
- preview hash;
- base SHA;
- target repository/branch;
- touched blob hashes;
- risk binding.

Autopilot authorization additionally validates:

- LOW only;
- decision/policy identity;
- current kill switches;
- valid reservation.

Worker starting transitions become:

```text
APPROVED → QUEUED
AUTOMATION_AUTHORIZED → QUEUED
```

After `QUEUED`, existing adapter resolution, live target read, target-revision checks, execution transitions and Draft-PR logic remain shared.

The worker must never merge or deploy.

## 19. No explicit policy-evaluation HTTP trigger in V1

P9-C V1 exposes no generic POST endpoint for arbitrary policy evaluation.

Evaluation is triggered only by:

- durable P9-B `READY_FOR_POLICY` queue handoff; and
- P9-C daily reconciliation of missed handoffs.

This avoids creating a client-controlled path that can spam or reorder automatic work.

## 20. Policy API

Authenticated project-scoped endpoints:

```text
GET /projects/:projectId/optimization/autopilot-policy
PUT /projects/:projectId/optimization/autopilot-policy
```

GET is persisted-read only.

PUT strictly validates:

- project authorization;
- `CONTROLLED_AUTOPILOT` feature entitlement before restricted write;
- `enabled` boolean;
- `allowedRiskClass` omitted or exactly LOW;
- operation list subset of server LOW vocabulary;
- V1 enablement requires `CREATE_CONTENT_PAGE` and no unsupported automatic operation;
- numeric bounds;
- actor identity server-derived.

Client cannot set policy version, audit fields, decision fields, hashes, reservation identity or execution state.

## 21. Reason codes

Stable first-party codes:

```text
AUTOPILOT_FEATURE_NOT_AVAILABLE
AUTOPILOT_POLICY_MISSING
AUTOPILOT_DISABLED
AUTOPILOT_PROJECT_KILL_SWITCH
AUTOPILOT_GLOBAL_KILL_SWITCH
AUTOPILOT_ACTION_NOT_SUPPORTED
AUTOPILOT_SOURCE_STALE
AUTOPILOT_EVIDENCE_INSUFFICIENT
AUTOPILOT_VERIFICATION_PAUSED
AUTOPILOT_CONFLICT
AUTOPILOT_DAILY_QUOTA_EXHAUSTED
AUTOPILOT_CONCURRENCY_LIMIT
AUTOPILOT_P8_PREPARATION_REQUIRED
AUTOPILOT_P8_PLAN_MISMATCH
AUTOPILOT_P8_RISK_NOT_LOW
AUTOPILOT_OPERATION_NOT_ALLOWED
AUTOPILOT_P8_VALIDATION_BLOCKED
AUTOPILOT_P8_WARNING_REQUIRES_HUMAN
AUTOPILOT_GIT_DRAFT_PR_UNAVAILABLE
AUTOPILOT_TARGET_REVISION_CHANGED
AUTOPILOT_AUTHORIZATION_STALE
AUTOPILOT_POLICY_BLOCKED
```

Unknown deterministic state maps to `AUTOPILOT_POLICY_BLOCKED` and stops automation.

## 22. Retry semantics

Retryable infrastructure errors:

- temporary database connectivity failure;
- Redis/BullMQ transient failure;
- retryable existing P4/P8 AI/provider preparation error;
- retryable Git provider error inside existing P8 execution logic.

Non-retryable automatic outcomes:

- entitlement missing;
- policy missing/disabled;
- kill switch active;
- unsupported action;
- stale source;
- insufficient evidence;
- unresolved verification failure;
- conflict;
- quota/concurrency block;
- P8 risk not LOW;
- operation not exact/allowlisted;
- validation blocked;
- human-warning confirmation required;
- Git Draft PR capability unavailable.

Retries cannot duplicate decisions, proposals, reservations, authorizations, executions or Draft PRs.

## 23. Observability and audit

Add bounded events:

```text
optimization.autopilot.decision.created
optimization.autopilot.deferred
optimization.autopilot.authorization.created
optimization.autopilot.execution.queued
```

Allowlisted metadata:

```text
projectId
runId
runItemId
optimizationPlanId
decisionId
decisionStatus
reasonCode
policyVersion
publicationPlanId
publicationExecutionId
riskClass
operationCount
utcDate
```

Never emit article/draft bodies, prompts/model responses, raw provider data, credentials, Git tokens, unified diff bodies or arbitrary snapshot JSON.

P8 execution events remain authoritative for mutation lifecycle.

## 24. Schema and migrations

Use additive forward migrations only.

New P9 model file:

```text
prisma/models/optimization-autopilot.prisma
```

Add:

- `AutopilotPolicy`;
- `OptimizationAutopilotDecision`;
- `AutopilotExecutionReservation`.

P8 `publication.prisma` adds:

- `P9_OPTIMIZATION_PLAN` proposal source enum value;
- `PublicationAutomationAuthorization`;
- nullable automation authorization relation on `PublicationExecution`;
- `AUTOMATION_AUTHORIZED` execution status/event values.

Migration also adds:

- exact-one-authorization check constraint;
- P9 proposal partial unique index;
- required indexes/uniqueness;
- immutability triggers for decisions and automation authorizations.

Never modify already-applied P8/P9-A/P9-B migrations.

## 25. Immutability

Database-immutable after creation:

- `OptimizationAutopilotDecision`;
- `PublicationAutomationAuthorization`.

Reservation identity/history is append-preserving; reservation status may transition only through guarded repository operations.

`AutopilotPolicy` is mutable configuration and records authenticated actor/timestamps.

Existing P9-A immutable rows and P8 immutable plans/previews/approvals/events remain unchanged.

## 26. Security model

### Credentials

P9-C stores no Git/provider credentials. P8 adapter configuration remains the only mutation credential boundary.

### Human vs machine integrity

Human policy updates use authenticated server actor identity.

Machine authorization explicitly records `CONTROLLED_AUTOPILOT` and never writes a fake human approver.

### Cross-project isolation

Every run item, P9 plan/candidate, decision, reservation, P8 proposal/plan/preview, authorization and execution is checked for project equality before side effects.

Public APIs fail closed on cross-project IDs without leaking unrelated resource existence.

### Client authority

Clients cannot override:

- decision status/reason codes/key;
- P8 risk;
- policy version;
- plan/preview/content hashes;
- base SHA/blob hashes;
- reservation keys/status;
- automation source;
- execution status;
- machine authorization identity.

## 27. TDD contract

Implementation proceeds RED → minimal GREEN task by task.

### Policy and feature tests

Prove:

- Standard=false, Advanced/Enterprise=true for `CONTROLLED_AUTOPILOT`;
- no policy row means automatic path unavailable;
- default created policy is disabled;
- MEDIUM/HIGH policy input rejected;
- quota 1..10 and evidence/concurrency bounds enforced;
- unsupported operation policy input rejected;
- actor identity server-derived.

### Kill-switch tests

Prove:

- missing global setting blocks;
- malformed global setting blocks;
- global/project ON blocks before machine authorization/execution enqueue;
- kill switch does not delete history;
- manual P8 workflows remain available.

### Queue/reconciliation tests

Prove:

- P9-B enqueue occurs only after `READY_FOR_POLICY` is persisted;
- duplicate enqueue uses one deterministic job identity;
- queue failure does not roll back P9-B state;
- daily reconciliation enqueues missed items only;
- GET/API reads never enqueue policy work.

### Decision tests

Prove:

- same immutable inputs reuse one decision;
- changed policy snapshot creates new decision identity;
- changed P8 plan/preview creates new decision identity;
- unsupported action becomes manual;
- stale Growth source blocks;
- insufficient evidence blocks;
- terminal lifecycle blocks;
- decision never mutates P7/P9-A facts;
- reason-code ordering deterministic.

### Preparation tests

Prove:

- only `CONTENT_CREATION` enters automatic P8 preparation;
- P9 proposal uses `P9_OPTIMIZATION_PLAN` provenance;
- repeated/racing preparation creates one effective proposal;
- P9-C never writes an authoritative diff;
- P9-C never imports DeepSeek transport;
- P8/P4 existing content-generation boundaries remain authoritative.

### P8 boundary tests

Prove:

- exact P8 plan/preview required;
- exact P8 risk must be LOW;
- exact operation must be only `CREATE_CONTENT_PAGE`;
- MEDIUM/HIGH never receive machine authorization;
- broad/unknown operations block;
- human-only warnings cannot be auto-confirmed;
- site requires `GIT_DRAFT_PR`;
- P9 action alone never proves LOW risk.

### Authorization tests

Prove:

- machine authorization is not `PublicationApproval`;
- no fake human approver is written;
- plan/content/preview/base/blob bindings are frozen;
- decision/policy identity is frozen;
- authorization immutable;
- stale/expired authorization fails before adapter work;
- kill switches rechecked at authorization/execution boundary.

### Execution regression tests

Prove:

- execution has exactly one authorization source;
- human execution remains `APPROVED` and regression stays green;
- machine execution begins `AUTOMATION_AUTHORIZED`;
- both converge to existing `QUEUED → EXECUTING` worker logic;
- live target revision checks remain active;
- duplicate delivery creates at most one Draft PR;
- no default-branch write, merge, deploy or rollback.

### Quota/concurrency tests

Prove:

- quota deterministic per project/UTC date;
- projects do not share quota;
- race cannot overrun final slot;
- repeated decision consumes one slot;
- only `AUTOMATION_AUTHORIZED|QUEUED|EXECUTING` consume concurrency;
- `PR_CREATED` releases concurrency but not daily quota;
- human approvals consume neither automatic quota nor automatic concurrency.

### Conflict tests

Prove:

- same canonical URL active mutation defers;
- same repository path active mutation defers;
- same plan cannot receive duplicate automatic handoff;
- ambiguity never auto-merges.

### API tests

Prove:

- authorization/feature gate before restricted reads/writes;
- GET policy route is persisted-read only;
- PUT input strict/bounded;
- cross-project IDs do not leak;
- client cannot write system-owned fields.

### Full release gates

Exact final PR head must pass:

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

## 28. Authority-boundary static scans

P9-C implementation source must not import:

- GitHub mutation adapter implementation;
- merge/deploy/rollback code;
- P7 scoring/detector functions;
- raw provider adapters;
- DeepSeek transport directly.

P9-C may call only narrow first-party P8 services for preparation and authorization/execution creation.

Tests also scan that no automatic path invokes a PR merge API.

## 29. Likely implementation surface

New P9-C files:

```text
src/modules/optimization-autopilot/autopilot.types.ts
src/modules/optimization-autopilot/autopilot.config.ts
src/modules/optimization-autopilot/autopilot.policy.ts
src/modules/optimization-autopilot/autopilot.identity.ts
src/modules/optimization-autopilot/autopilot.repository.ts
src/modules/optimization-autopilot/autopilot.queue.ts
src/modules/optimization-autopilot/autopilot.worker.ts
src/modules/optimization-autopilot/autopilot.service.ts
src/modules/optimization-autopilot/autopilot.routes.ts
```

P8 additive/refactor surface:

```text
src/modules/publication/publication-automation-authorization.ts
src/modules/publication/publication.repository.ts
src/modules/publication/publication-execution.worker.ts
src/modules/publication/publication-execution.queue.ts
```

Integration surface:

```text
src/modules/optimization-orchestration/orchestration.worker.ts
src/auth/feature-flags.ts
src/queue/queues.ts
src/queue/worker-bootstrap.ts
src/app.ts
```

Schema:

```text
prisma/models/optimization-autopilot.prisma
prisma/models/publication.prisma
prisma/migrations/<timestamp>_add_p9c_controlled_autopilot/migration.sql
```

The implementation plan may add focused tests/docs files but may not broaden the V1 authority described here.

## 30. Delivery decomposition

Recommended implementation tasks:

1. feature gate, config parser and policy persistence/API;
2. queue + deterministic identity + immutable decision persistence;
3. freshness, verification-pause and conflict readers;
4. race-safe quota/concurrency reservation;
5. P9-B → P9-C durable handoff + daily reconciliation;
6. P9 `CONTENT_CREATION` → idempotent P8 proposal/preparation bridge;
7. P8 machine authorization model/validator;
8. dual authorization-source `PublicationExecution` refactor;
9. automatic LOW `CREATE_CONTENT_PAGE` Draft-PR flow;
10. boundary/security/idempotency regression suite;
11. development/release documentation and exact-head CI gate.

Each task uses RED → minimal GREEN and remains independently reviewable.

## 31. V1 supported automatic path

The only V1 automatic path is:

```text
P9-A CONTENT_CREATION
→ P9-B READY_FOR_POLICY
→ optimization-autopilot queue
→ policy gates
→ P8 P9_OPTIMIZATION_PLAN proposal/draft preparation
→ exact P8 CREATE_CONTENT_PAGE plan
→ P8 risk LOW
→ validation clean with no human-warning requirement
→ race-safe reservation
→ PublicationAutomationAuthorization
→ PublicationExecution AUTOMATION_AUTHORIZED
→ existing P8 execution worker
→ Draft PR
```

Every other P9 recommended action remains manual.

## 32. Release gate

P9-C is Ready for Review only when:

1. exact PR head passes `verify`, `production-audit`, and `e2e`;
2. migrations are additive only;
3. Standard cannot use controlled autopilot;
4. policy is disabled by default;
5. global kill-switch parsing fails closed;
6. only `CONTENT_CREATION → CREATE_CONTENT_PAGE` can auto-execute in V1;
7. MEDIUM/HIGH cannot receive machine authorization;
8. machine authorization cannot be represented as human approval or `APPROVED` entry state;
9. automatic execution reuses P8 exact plan/preview/current-target validation;
10. P9-C has no direct Git adapter, merge, deploy or rollback authority;
11. daily quota/concurrency are race-safe and idempotent;
12. P9/P8 handoff is idempotent under duplicate delivery/crash races;
13. human P8 approval/execution regression remains green;
14. unresolved review threads are zero before merge;
15. merge requires a separate explicit human `合并` instruction;
16. deployment remains separately authorized.

## 33. Success criteria

P9-C V1 succeeds when an explicitly opted-in Advanced/Enterprise project can automatically produce a Draft PR only when every authoritative persisted gate proves the exact change is eligible, LOW risk, exact-revision-bound and conflict/quota-safe, while human approval remains semantically distinct from machine authorization.

Safe work may proceed automatically to Draft PR. Ambiguous work must be impossible to auto-execute.
