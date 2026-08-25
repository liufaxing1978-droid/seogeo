# P9-F Autonomous Operations Center Design

## Status

Approved design for P9-F V1.

P9-F is the final P9-stage operations surface. It composes persisted authority from P7 through P9-E into a single project-scoped operations view and exposes only a narrow, audited control plane.

It does **not** create a second execution engine, a second source of truth, or a privileged backdoor around P8/P9 safety boundaries.

## Context

The existing P9 chain already owns the business authority:

```text
P7 Growth
→ P9-A OptimizationCandidate / OptimizationPlan
→ P9-B OptimizationRun / OptimizationRunItem
→ P9-C Controlled Autopilot Decision + Reservation
→ P8 Publication Proposal / Plan / Preview / Execution / Verification
→ P9-D OptimizationExperiment / Observation
→ P9-E OptimizationFeedbackEvidence / OptimizationFeedbackProfile
```

P9-F must make this chain operable without copying its state into a second mutable status model.

The existing web application is Express + EJS with a project-scoped sidebar and server-rendered pages. P9-F V1 follows that architecture rather than introducing a separate SPA framework.

## Approaches considered

### A. Persisted-read composition + narrow control plane — selected

P9-F derives the operations UI directly from existing persisted authority tables. It adds only an immutable audit record for project-level Autopilot policy changes.

Benefits:

- no duplicate business state;
- no snapshot reconciliation problem;
- every count/item can link to the authority row that produced it;
- existing P8/P9 safety semantics remain authoritative;
- rollout is additive.

### B. Materialized Operations Snapshot table — rejected for V1

A periodically refreshed operations snapshot would speed reads but would create a second mutable representation that can go stale and requires its own reconciliation semantics.

### C. Full event-sourced operations ledger — rejected for V1

The platform does not need a new event-sourcing subsystem to build a project operations center. Existing immutable and timestamped authority records are sufficient.

## Goals

P9-F V1 must provide:

1. one project-scoped Operations Center page;
2. effective Autopilot state and quota visibility;
3. a non-duplicating pipeline projection;
4. a bounded human-attention inbox;
5. 7-day / 30-day P9-D outcome summaries;
6. P9-E feedback-weight visibility;
7. a persisted-source activity timeline;
8. navigation to existing P8/P9 detail surfaces;
9. reuse of the existing P9-B manual Optimization Run command;
10. an immutable, optimistic-concurrency policy-revision command;
11. no direct Merge / Deploy / Rollback / risk escalation authority.

## Non-goals

P9-F V1 does not:

- create a second OptimizationRun API;
- create a second experiment engine;
- create a second feedback engine;
- create or edit Growth scores;
- edit P9-E historical weights;
- mark experiments positive/negative manually;
- mark P8 execution/verification successful manually;
- merge pull requests;
- deploy changes;
- roll back publication;
- mutate the platform-wide global kill switch;
- broaden the P9-C automatic risk class beyond `LOW`;
- broaden the P9-C automatic operation class beyond `CREATE_CONTENT_PAGE`;
- call DeepSeek, Search providers, Visibility providers, Git/GitHub mutation adapters, publication execution, deployment, or rollback during GET rendering/refresh.

## Feature availability

Add capability:

```text
OPTIMIZATION_OPERATIONS_CENTER
```

Availability:

| Plan | Operations Center |
| --- | --- |
| STANDARD | No |
| ADVANCED | Yes |
| ENTERPRISE | Yes |

Feature gating happens before Operations read repositories or Policy Revision repositories are invoked.

## Source-of-truth rule

P9-F owns no mutable pipeline state.

Every Operations item must point back to a persisted authority record from P7/P8/P9. If two modules disagree, P9-F does not invent a tie-breaker that changes business authority; it uses the most downstream persisted fact only for presentation-stage projection.

Opening, refreshing, filtering, or paginating Operations pages must not:

- enqueue planning;
- enqueue Autopilot evaluation;
- enqueue experiment evaluation;
- enqueue feedback materialization;
- invoke AI;
- invoke provider sampling;
- invoke Git mutation;
- invoke publication execution.

## Web information architecture

Main page:

```text
GET /projects/:projectId/optimization
```

Sidebar, Growth group:

```text
Growth Center
Topic Clusters
Cannibalization
New Content
自动优化中心  高级版
优化实验      高级版
```

`activeNav`:

```text
optimization-operations
```

Existing P9-D page remains separate:

```text
/projects/:projectId/optimization/experiments
```

P9-F does not absorb experiment detail pages into a new parallel hierarchy.

## Main page layout

The page is server-rendered on first load and contains:

1. page header + explicit persisted-read description;
2. effective Autopilot status card;
3. five additional metric cards;
4. pipeline stage projection;
5. human-attention inbox;
6. 7-day / 30-day outcome summary;
7. historical feedback-weight panel;
8. recent activity timeline;
9. Autopilot policy drawer/read panel;
10. links to existing P8/P9 detail surfaces.

Top-right actions are limited to:

```text
刷新
立即运行优化
Autopilot 设置
```

`刷新` is GET/read-only.

`立即运行优化` reuses the existing P9-B command:

```text
POST /api/v1/projects/:projectId/optimization/runs
```

P9-F does not create another run endpoint.

## Effective Autopilot state

Display one of:

```text
GLOBAL_KILL_SWITCH
PROJECT_KILL_SWITCH
FEATURE_BLOCKED
DISABLED
ACTIVE
```

Priority:

```text
GLOBAL_KILL_SWITCH
> PROJECT_KILL_SWITCH
> FEATURE_BLOCKED
> DISABLED
> ACTIVE
```

Inputs:

- platform global kill-switch configuration — read-only;
- project feature capability;
- current `AutopilotPolicy.killSwitch`;
- current `AutopilotPolicy.enabled`.

The UI must never show `ACTIVE` merely because `policy.enabled = true` when a higher-priority block is active.

The global kill switch remains read-only in P9-F V1.

## Top metric cards

The first viewport contains six cards:

1. effective Autopilot state;
2. today's Optimization Runs;
3. human-attention inbox count;
4. Draft PR count;
5. observing experiments count;
6. current feedback sample count.

Counts are project-scoped and derived from persisted authority.

## Pipeline projection

P9-F projects each optimization plan/run item into exactly one **current farthest confirmed stage**.

Stages:

```text
DISCOVERED
ELIGIBLE
PLANNED
AUTOPILOT_DECIDED
P8_HANDOFF
DRAFT_PR
VERIFIED
OBSERVING
EVALUATED
```

Rules:

### DISCOVERED

Current P7 Growth opportunity exists but no current persisted P9-A candidate/plan authority has advanced it.

### ELIGIBLE

Persisted `OptimizationCandidate.eligibilityState = ELIGIBLE` and no later confirmed stage exists.

### PLANNED

Persisted immutable `OptimizationPlan` exists and no later confirmed stage exists.

### AUTOPILOT_DECIDED

Persisted `OptimizationAutopilotDecision` exists. The projection preserves the real decision status/reason codes.

### P8_HANDOFF

The exact plan has persisted P8 proposal/plan/preview authority, but no Draft PR/verification has advanced it.

### DRAFT_PR

The exact P8 execution has created a Draft PR / equivalent persisted PR-created execution state and has not reached `VERIFIED`.

### VERIFIED

The exact P8 execution and exact P8 verification are both `VERIFIED`, with no downstream P9-D experiment state taking precedence.

### OBSERVING

A persisted P9-D experiment exists and terminal evaluation has not reached the evaluated projection.

### EVALUATED

A terminal P9-D observation exists. P9-E acceptance/defer is displayed as secondary learning metadata and does not replace the experiment result.

A plan must not be counted in more than one pipeline stage.

Tie-breaking within a list is deterministic: stage-specific authority time ascending/descending as defined by the API plus stable id.

## Human-attention inbox

V1 inbox categories:

```text
AWAITING_HUMAN_MERGE
POLICY_BLOCKED
P8_VALIDATION_BLOCKED
VERIFICATION_FAILED
STALE
EXECUTION_FAILED
```

Every item includes:

```text
id
authorityType
authorityId
category
severity
reasonCode
optimizationPlanId?
targetUrl?
updatedAt
authorityUrl
```

Severity order:

```text
HIGH
MEDIUM
LOW
```

Sort:

```text
severity DESC
updatedAt ASC
stable id ASC
```

Allowed item actions are navigation or existing bounded commands only, for example:

- view P8 Preview;
- view Draft PR;
- view Verification;
- view Experiment;
- view Policy;
- trigger an existing P9-B manual run.

No inbox action may force success or bypass safety.

## 7-day / 30-day outcomes

Windows are based on P9-D terminal observation business cutoff, not delayed worker `createdAt`.

Primary counts:

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

Secondary learning counts:

```text
FEEDBACK_ACCEPTED
FEEDBACK_DEFERRED
```

P9-F must not label this a causal `success rate`.

A P9-D `NEGATIVE`/`POSITIVE` observation and P9-E acceptance are separate facts. Contaminated or insufficient observations may remain unaccepted.

## Feedback-weight view

P9-F reads persisted immutable `OptimizationFeedbackProfile` snapshots.

Exact scope fields:

```text
marketScopeMode
marketCode
locale
recommendedActionType
```

Display:

```text
sampleCount
positiveCount
neutralCount
negativeCount
rollingEffectBalance
historicalRankAdjustment
newestEvidenceCutoffAt
```

Historical chart X-axis:

```text
newestEvidenceCutoffAt
```

Y-axis:

```text
historicalRankAdjustment [-10,+10]
```

Required copy:

> 历史效果权重只参与未来 P9-A V2 排序，不改变 Growth Score、自动发布风险等级或审批要求。

## Quota view

Display separately:

```text
configuredLimit
reserved
consumed
remaining
```

The calculation uses persisted P9-C reservation/decision data. It must not infer remaining capacity merely from created PR count.

## Operations Activity timeline

P9-F V1 does not persist a new unified event table.

Read model type:

```ts
export type OperationsActivityItem = {
  occurredAt: Date;
  sourceModule: 'P9_A' | 'P9_B' | 'P9_C' | 'P8' | 'P9_D' | 'P9_E' | 'P9_F';
  eventType: string;
  title: string;
  summary: string;
  authorityId: string;
  authorityUrl: string | null;
  severity: 'INFO' | 'WARNING' | 'ERROR';
};
```

`occurredAt` comes from the semantic source event time:

- Optimization Run → created/completed time;
- Autopilot Decision → decision created time;
- P8 execution/verification → persisted execution/verification time;
- P9-D observation → input cutoff or persisted observation time according to event meaning;
- P9-E feedback → input cutoff/profile evidence time;
- P9-F Policy Revision → revision created time.

Timeline composition is read-only and bounded.

## Operations API

### Overview

```text
GET /api/v1/projects/:projectId/optimization/operations
```

Response:

```ts
{
  data: {
    effectiveAutopilotState,
    quota,
    pipelineCounts,
    inboxCounts,
    experimentSummary,
    feedbackSummary,
    recentActivity,
    generatedAt
  }
}
```

`generatedAt` is response-generation time only, not a business timestamp.

### Detail reads

```text
GET /api/v1/projects/:projectId/optimization/operations/pipeline
GET /api/v1/projects/:projectId/optimization/operations/inbox
GET /api/v1/projects/:projectId/optimization/operations/experiments
GET /api/v1/projects/:projectId/optimization/operations/feedback
GET /api/v1/projects/:projectId/optimization/autopilot-policy
GET /api/v1/projects/:projectId/optimization/autopilot-policy/revisions
```

All GET endpoints are persisted-read only.

Pagination:

```text
limit default 50, min 1, max 100
offset default 0, min 0, max 100000
```

Policy revisions default to `limit=25` and share max `100`.

## Existing Optimization Run command

P9-F reuses:

```text
POST /api/v1/projects/:projectId/optimization/runs
```

The UI generates a UUID `manualRequestId` and displays the accepted Run id/state. It never optimistically advances pipeline counts.

## Autopilot Policy read

```text
GET /api/v1/projects/:projectId/optimization/autopilot-policy
```

The response includes the current persisted policy, exact `updatedAt`, and effective block state.

The UI visibly marks these locked fields:

```text
allowedRiskClass = LOW
allowedOperationClasses = [CREATE_CONTENT_PAGE]
```

They are never editable.

## Policy Revision command

Command endpoint:

```text
POST /api/v1/projects/:projectId/optimization/autopilot-policy/revisions
```

Body:

```ts
{
  requestId: string; // UUID
  expectedUpdatedAt: string | null; // exact ISO timestamp; null only when creating the first policy
  policy: {
    enabled: boolean;
    dailyDraftPrLimit: number;
    maxConcurrentRuns: number;
    requireFreshEvidence: boolean;
    minimumEvidenceCoverage: number;
    pauseOnVerificationFailure: boolean;
    killSwitch: boolean;
  };
}
```

The public schema is strict. The following client fields are forbidden rather than ignored:

```text
actorId
allowedRiskClass
allowedOperationClasses
```

Supplying restricted policy fields returns:

```text
400 POLICY_MUTATION_FIELD_FORBIDDEN
```

Server normalization always freezes:

```text
allowedRiskClass = LOW
allowedOperationClasses = [CREATE_CONTENT_PAGE]
```

## Actor identity rollout gate

Current application auth only provides plan feature gating; it does not provide a reliable authenticated principal.

P9-F must not accept a client-provided actor id or silently treat an arbitrary request string as human identity.

Define:

```ts
export type OperationsActor = { actorId: string };

export interface OperationsActorResolver {
  resolve(req: Express.Request): OperationsActor | null;
}
```

Production default for V1 is fail-closed until a reliable authenticated actor resolver is wired:

```text
503 OPERATIONS_ACTOR_UNAVAILABLE
```

when invoking the Policy Revision command without a resolved actor.

Read-only Operations Center and the pre-existing P9-B manual run remain available under their existing authority contracts.

Tests inject a deterministic actor resolver to validate the complete mutation contract.

The UI must disable policy Save when actor mutation authority is unavailable and display that policy changes require authenticated operator identity.

## AutopilotPolicyRevision data model

Add immutable model:

```prisma
model AutopilotPolicyRevision {
  id                      String   @id @default(uuid()) @db.Uuid
  projectId               String   @db.Uuid
  policyId                String   @db.Uuid
  revisionVersion         String
  requestId               String   @db.Uuid
  revisionKey             String
  previousPolicyUpdatedAt DateTime?
  appliedPolicyUpdatedAt  DateTime
  beforeSnapshotJson      Json?
  afterSnapshotJson       Json
  actorId                 String
  createdAt               DateTime @default(now())

  @@unique([projectId, requestId])
  @@unique([projectId, revisionKey])
  @@index([projectId, createdAt])
}
```

Revision version:

```text
AUTOPILOT_POLICY_REVISION_V1
```

`revisionKey` is SHA-256 over canonical immutable command identity:

```text
revisionVersion
projectId
requestId
expectedUpdatedAt
normalized target policy
actorId
```

PostgreSQL `BEFORE UPDATE OR DELETE` rejects revision mutation.

Revision rows have no update/delete application API.

## Policy revision transaction

One database transaction performs:

1. re-read current `AutopilotPolicy`;
2. validate `expectedUpdatedAt`;
3. normalize requested target policy;
4. freeze `LOW + CREATE_CONTENT_PAGE`;
5. compute canonical before/after snapshot and revision key;
6. check `(projectId, requestId)` idempotency;
7. create/update current policy;
8. create immutable `AutopilotPolicyRevision`;
9. commit.

Current policy mutation and revision audit must never commit separately.

## Optimistic concurrency

Existing policy:

```text
expectedUpdatedAt must exactly equal current policy.updatedAt
```

First policy creation:

```text
expectedUpdatedAt = null
```

Mismatch returns:

```text
409 AUTOPILOT_POLICY_CONFLICT
```

Conflict creates no revision and performs no update.

The client receives no `force overwrite` option.

## Request idempotency

Same `(projectId, requestId)` and same immutable command identity:

```text
200 EXISTING
```

Return the existing revision/current-policy result without another update.

Same `(projectId, requestId)` with a different command identity:

```text
409 AUTOPILOT_POLICY_REQUEST_COLLISION
```

No update and no additional revision.

## Policy normalization bounds

The existing P9-C normalization remains authoritative:

```text
dailyDraftPrLimit: 1..10
maxConcurrentRuns: 1..3
minimumEvidenceCoverage: 70..100
allowedRiskClass: LOW only
allowedOperationClasses: CREATE_CONTENT_PAGE only
```

P9-F does not broaden these values.

## Project and global kill switches

Project kill switch:

```text
AutopilotPolicy.killSwitch
```

may be changed through a Policy Revision command.

Global kill switch:

```text
CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH
```

is visible but read-only in P9-F V1.

## Policy UI

Autopilot settings are shown in a drawer/panel, not as uncontrolled inline fields across the overview.

Editable:

```text
enabled
dailyDraftPrLimit
maxConcurrentRuns
requireFreshEvidence
minimumEvidenceCoverage
pauseOnVerificationFailure
killSwitch
```

Locked and visible:

```text
Risk Class: LOW
Operation: CREATE_CONTENT_PAGE
```

Require explicit confirmation before:

- enabling Autopilot;
- turning an active project kill switch off.

Safety actions such as disabling Autopilot or turning the project kill switch on do not need an extra confirmation barrier.

A `409 AUTOPILOT_POLICY_CONFLICT` forces refresh and re-confirmation. There is no overwrite button.

## Policy revision history UI

Revision history displays:

```text
createdAt
actorId
before → after summary
requestId
revisionId
```

Revision history itself cannot be edited, deleted, or rolled back.

Restoring an old configuration in the future means issuing a new revision with that desired target state.

## Refresh strategy

Initial page is SSR EJS.

Visible browser tabs may poll:

```text
GET /api/v1/projects/:projectId/optimization/operations
```

at approximately 30-second intervals.

Polling pauses when:

```text
document.visibilityState !== 'visible'
```

Manual Refresh is the same persisted-read operation.

If the Policy form is dirty, background refresh may update operational panels but must not overwrite form fields. If the server policy changed, show a stale-policy warning; final save still relies on `expectedUpdatedAt`.

No WebSocket/SSE subsystem is required for V1.

## Responsive behavior

Desktop-first:

- `>=1280px`: six metric cards and two-column content regions;
- `768..1279px`: three cards per row, major panels collapse to one column;
- `<768px`: single-column cards, horizontal pipeline scroll, full-width policy drawer.

The existing visual system, EJS layout, sidebar, colors, badges, tables, and CSS variables remain authoritative. P9-F adds scoped CSS classes rather than a new design framework.

## Empty states

No run history:

```text
自动优化中心尚无运行记录
```

No experiments:

```text
暂无观察中实验。只有经过 P8 VERIFIED 的优化才会进入实验观察。
```

No feedback:

```text
暂无历史效果权重。需要合格的 P9-D terminal observations 后 P9-E 才会形成历史反馈。
```

## UI authority boundary

Operations web routes/templates/client JS may use only:

- P9-F Operations read port;
- existing P9-B manual run command endpoint;
- P9-F policy revision endpoint;
- navigation links.

Static hardening rejects direct Operations UI imports/dependencies on:

- DeepSeek / AI gateway;
- provider sampling;
- Git/GitHub mutation;
- deployment;
- rollback;
- P9-D evaluator;
- P9-E materializer;
- P8 execution service.

## Error semantics

Stable command/read errors include:

```text
FEATURE_NOT_AVAILABLE
PROJECT_NOT_FOUND
OPERATIONS_ACTOR_UNAVAILABLE
POLICY_MUTATION_FIELD_FORBIDDEN
AUTOPILOT_POLICY_CONFLICT
AUTOPILOT_POLICY_REQUEST_COLLISION
AUTOPILOT_POLICY_NOT_FOUND
```

Validation errors remain standard 400 input errors.

Cross-project resource ids return not-found rather than leaking foreign project state.

## Observability

P9-F may emit bounded operational events for policy commands only:

```text
optimization.operations.policy_revision.applied
optimization.operations.policy_revision.existing
optimization.operations.policy_revision.conflict
```

Allowlisted metadata:

```text
projectId
policyId
revisionId
requestId
actorId
reasonCode
```

No before/after full JSON, credentials, prompts, provider payloads, content bodies, or Git data in observability metadata.

Read-only GET refreshes do not emit noisy business events.

## Data retention and rollback

P9-F migration is additive.

Application rollback:

- must not delete or rewrite `AutopilotPolicyRevision` history;
- may stop rendering/consuming P9-F read models;
- may leave current `AutopilotPolicy` as the existing P9-C source of truth.

Dropping revision history requires a separately reviewed forward migration.

## Testing requirements

P9-F release verification must cover:

### Feature gate

- Standard denied before Operations repository reads;
- Advanced/Enterprise allowed.

### Read-only operations

- overview reads persisted state only;
- GET routes do not enqueue or mutate;
- pipeline current-stage projection is non-duplicating;
- cross-project ids are hidden;
- pagination is bounded.

### Effective state

- global kill switch overrides all;
- project kill switch overrides enabled;
- feature block overrides enabled;
- disabled vs active is deterministic.

### Pipeline and inbox

- exact farthest-stage mapping;
- exact inbox category mapping;
- deterministic severity/wait ordering;
- no force-success action surface.

### Outcome/feedback

- 7/30-day windows use terminal observation business cutoff;
- outcome and feedback-acceptance counts remain distinct;
- feedback weight is persisted profile state only.

### Quota

- configured/reserved/consumed/remaining are based on persisted reservations;
- remaining never becomes negative.

### Policy revision persistence

- immutable revision trigger;
- create/update transaction atomicity;
- exact before/after snapshot;
- no update/delete repository API.

### Concurrency and idempotency

- stale `expectedUpdatedAt` returns 409 with no update/revision;
- exact retry returns EXISTING;
- same request id with changed command returns collision;
- concurrent competing revisions serialize/fail closed.

### Actor authority

- client cannot submit `actorId`;
- missing server actor resolver returns `OPERATIONS_ACTOR_UNAVAILABLE` before mutation repository calls;
- injected server actor is frozen into revision.

### Safety fields

- client cannot submit `allowedRiskClass` or `allowedOperationClasses`;
- server always freezes `LOW + CREATE_CONTENT_PAGE`;
- global kill switch has no mutation route.

### UI

- SSR page renders persisted values;
- sidebar/navigation state correct;
- refresh GET is side-effect free;
- Run button calls existing P9-B endpoint;
- policy save requires actor availability and exact updatedAt;
- conflict cannot force overwrite;
- locked safety fields are visible but not editable;
- responsive/empty-state coverage.

### Static authority hardening

- Operations module/UI has no provider, AI, Git, deploy, rollback, P9-D evaluator, P9-E materializer, or P8 execution-service authority.

### Final gates

- Prisma validate/generate/migrate deploy;
- Typecheck;
- full Vitest;
- production build;
- browser E2E;
- production dependency audit.

## Release boundary

P9-F V1 is complete when:

1. Operations read model/API/UI is persisted-read only and fully gated;
2. pipeline/inbox/outcome/feedback/quota/activity projections pass deterministic tests;
3. Policy Revision persistence and command semantics pass concurrency/idempotency tests;
4. default production policy mutation fails closed without a reliable actor resolver;
5. all existing P7/P8/P9 authority rows remain authoritative and unmodified by Operations GETs;
6. exact-head release CI is green;
7. PR remains Draft/unmerged/undeployed until separately authorized.
