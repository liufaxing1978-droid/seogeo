# P9-F Autonomous Operations Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped persisted-read Operations Center for P7→P9-E plus an immutable, optimistic-concurrency Autopilot Policy Revision command that cannot broaden P9-C safety authority.

**Architecture:** P9-F adds a new `optimization-operations` module that composes existing persisted authority at read time; it does not persist a second pipeline state. The only new business persistence is immutable `AutopilotPolicyRevision`, written atomically with the existing mutable `AutopilotPolicy`. SSR EJS renders the first view, bounded GET APIs provide refresh/detail data, the existing P9-B run POST remains the only manual optimization-run command, and policy mutation defaults fail-closed until a reliable server-side actor resolver is injected.

**Tech Stack:** TypeScript, Node.js, Express, EJS, Prisma/PostgreSQL, Vitest, Supertest, BullMQ only through the existing P9-B run command, plain browser JavaScript/CSS.

**Spec:** `docs/superpowers/specs/2026-08-25-p9-f-autonomous-operations-center-design.md`

## Global Constraints

- New branch is `feat/p9-f-autonomous-operations-center`, based exactly on P9-E final head `bf06abb110521765e5c7ca47562a46826f435437`.
- Add feature `OPTIMIZATION_OPERATIONS_CENTER`; only `ADVANCED` and `ENTERPRISE` have it.
- Operations GETs are persisted-read only: no queue enqueue, AI/provider call, Git mutation, publication execution, experiment evaluation, or feedback materialization.
- Reuse existing `POST /api/v1/projects/:projectId/optimization/runs`; do not create a second Optimization Run command.
- Client policy payload must never accept `actorId`, `allowedRiskClass`, or `allowedOperationClasses`.
- Server policy normalization remains `allowedRiskClass = LOW` and `allowedOperationClasses = [CREATE_CONTENT_PAGE]`.
- Policy Revision mutation is unavailable by default without a server-resolved actor and returns `503 OPERATIONS_ACTOR_UNAVAILABLE` before mutation repository calls.
- Global kill switch is read-only in P9-F V1.
- `AutopilotPolicyRevision` is immutable; PostgreSQL rejects UPDATE/DELETE and application code exposes no update/delete API.
- Pipeline items are counted in exactly one farthest confirmed stage.
- 7/30 day experiment windows use terminal observation business cutoff, not delayed worker creation time.
- Outcome counts and P9-E feedback acceptance remain separate.
- Pagination: default `50`, max `100`, offset max `100000`; policy revisions default `25`, max `100`.
- UI remains Express + EJS + existing sidebar/CSS system; no SPA framework, WebSocket, or SSE.
- Do not merge, deploy, or mark PR Ready without separate explicit authorization.

---

## File Structure

### New production files

- `src/modules/optimization-operations/operations.types.ts` — read-model types/constants.
- `src/modules/optimization-operations/operations.derive.ts` — pure state/pipeline/inbox/outcome/quota derivation.
- `src/modules/optimization-operations/operations.repository.ts` — persisted-read database queries only.
- `src/modules/optimization-operations/operations.service.ts` — bounded composition of overview/detail read models.
- `src/modules/optimization-operations/policy-revision.identity.ts` — canonical snapshots and revision SHA-256 identity.
- `src/modules/optimization-operations/policy-revision.repository.ts` — atomic current-policy + immutable revision transaction.
- `src/modules/optimization-operations/policy-revision.service.ts` — normalization, optimistic concurrency, idempotency semantics.
- `src/modules/optimization-operations/operations.actor.ts` — server actor resolver interface and fail-closed default.
- `src/modules/optimization-operations/operations.observability.ts` — allowlisted command events.
- `src/modules/optimization-operations/operations.routes.ts` — GET APIs + Policy Revision command.
- `src/modules/optimization-operations/operations.web.routes.ts` — SSR Operations page.
- `src/views/optimization-operations/index.ejs` — Operations Center UI.
- `src/public/js/optimization-operations.js` — page-scoped polling/run/policy interactions.
- `docs/development/p9-f-autonomous-operations-center.md` — implementation/authority guide.
- `prisma/migrations/20260825020000_add_p9f_autopilot_policy_revision/migration.sql` — table/indexes/immutability trigger.

### Modified production files

- `prisma/models/optimization-autopilot.prisma` — add `AutopilotPolicyRevision`.
- `src/auth/feature-flags.ts` — add `OPTIMIZATION_OPERATIONS_CENTER` to Advanced/Enterprise.
- `src/app.ts` — mount API and web routes with injectable ports/actor resolver.
- `src/views/partials/sidebar.ejs` — add 自动优化中心 above 优化实验.
- `src/views/layout.ejs` — optional page-specific scripts.
- `src/public/css/app.css` — scoped Operations Center layout/drawer/pipeline styles.

### New/modified tests

- `tests/unit/operations.policy-revision-identity.test.ts`
- `tests/integration/operations.policy-revision.test.ts`
- `tests/unit/operations.derive.test.ts`
- `tests/integration/operations.repository.test.ts`
- `tests/integration/operations.routes.test.ts`
- `tests/integration/operations.web.routes.test.ts`
- `tests/integration/operations.authority.test.ts`
- existing feature-flag tests or a new `tests/unit/operations.feature-flag.test.ts`
- existing browser smoke/E2E coverage as needed for the rendered page.

---

### Task 33: Feature Gate + Immutable Policy Revision Persistence

**Files:**
- Modify: `src/auth/feature-flags.ts`
- Modify: `prisma/models/optimization-autopilot.prisma`
- Create: `prisma/migrations/20260825020000_add_p9f_autopilot_policy_revision/migration.sql`
- Create: `src/modules/optimization-operations/policy-revision.identity.ts`
- Create: `tests/unit/operations.policy-revision-identity.test.ts`
- Test: feature-gate unit coverage

**Interfaces:**
- Produces constant `AUTOPILOT_POLICY_REVISION_VERSION = 'AUTOPILOT_POLICY_REVISION_V1'`.
- Produces `buildAutopilotPolicyRevisionIdentity(input)` returning `{ revisionKey, commandFingerprint }` where both are canonical SHA-256 values and `revisionKey` is stable for exact retry.
- Produces Prisma model `AutopilotPolicyRevision` with unique `(projectId, requestId)` and `(projectId, revisionKey)`.

- [ ] **Step 1: Write feature-gate RED**

Add assertions equivalent to:

```ts
expect(hasFeature('STANDARD', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(false)
expect(hasFeature('ADVANCED', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(true)
expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_OPERATIONS_CENTER')).toBe(true)
```

Run:

```bash
npx vitest run tests/unit --reporter=verbose
```

Expected: fail because the feature union/matrix does not contain the capability.

- [ ] **Step 2: Add feature flag GREEN**

Add exactly:

```ts
| 'OPTIMIZATION_OPERATIONS_CENTER'
```

to `Feature`, and include it only in `advancedFeatures` (Enterprise inherits Advanced).

Run the focused feature test and expect PASS.

- [ ] **Step 3: Write Policy Revision identity RED**

Use exact command identity:

```ts
const input = {
  revisionVersion: 'AUTOPILOT_POLICY_REVISION_V1',
  projectId,
  requestId,
  expectedUpdatedAt: '2026-08-25T12:00:00.000Z',
  actorId: 'operator:fixture',
  normalizedPolicy: {
    enabled: true,
    allowedRiskClass: 'LOW',
    allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
    dailyDraftPrLimit: 3,
    maxConcurrentRuns: 1,
    requireFreshEvidence: true,
    minimumEvidenceCoverage: 70,
    pauseOnVerificationFailure: true,
    killSwitch: false,
  },
}
```

Assert:

- object-key order does not change hashes;
- changing `requestId`, actor, expected timestamp, or target policy changes `revisionKey`;
- output is lowercase 64-char hex;
- `-0`, undefined, and arbitrary JSON are not accepted into the normalized policy identity surface.

- [ ] **Step 4: Implement identity GREEN**

Create:

```ts
export const AUTOPILOT_POLICY_REVISION_VERSION = 'AUTOPILOT_POLICY_REVISION_V1' as const

export type PolicyRevisionIdentityInput = {
  revisionVersion: typeof AUTOPILOT_POLICY_REVISION_VERSION
  projectId: string
  requestId: string
  expectedUpdatedAt: string | null
  actorId: string
  normalizedPolicy: NormalizedAutopilotPolicy
}

export function buildAutopilotPolicyRevisionIdentity(
  input: PolicyRevisionIdentityInput,
): { revisionKey: string; commandFingerprint: string }
```

Use deterministic canonical JSON and Node `createHash('sha256')`.

- [ ] **Step 5: Add Prisma model + migration RED/GREEN**

Add model from the design spec with fields:

```prisma
id String @id @default(uuid()) @db.Uuid
projectId String @db.Uuid
policyId String @db.Uuid
revisionVersion String
requestId String @db.Uuid
revisionKey String
previousPolicyUpdatedAt DateTime?
appliedPolicyUpdatedAt DateTime
beforeSnapshotJson Json?
afterSnapshotJson Json
actorId String
createdAt DateTime @default(now())
```

Constraints:

```prisma
@@unique([projectId, requestId])
@@unique([projectId, revisionKey])
@@index([projectId, createdAt])
```

Migration must create a trigger function and trigger equivalent to:

```sql
CREATE OR REPLACE FUNCTION reject_autopilot_policy_revision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AutopilotPolicyRevision is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AutopilotPolicyRevision_immutable"
BEFORE UPDATE OR DELETE ON "AutopilotPolicyRevision"
FOR EACH ROW EXECUTE FUNCTION reject_autopilot_policy_revision_mutation();
```

- [ ] **Step 6: Verify persistence schema**

Run:

```bash
npx prisma validate
npx prisma generate
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 33**

```bash
git add src/auth/feature-flags.ts prisma src/modules/optimization-operations/policy-revision.identity.ts tests
git commit -m "feat: add P9-F policy revision persistence"
```

---

### Task 34: Atomic Policy Revision Command, Actor Gate, and Observability

**Files:**
- Create: `src/modules/optimization-operations/operations.actor.ts`
- Create: `src/modules/optimization-operations/operations.observability.ts`
- Create: `src/modules/optimization-operations/policy-revision.repository.ts`
- Create: `src/modules/optimization-operations/policy-revision.service.ts`
- Create: `tests/integration/operations.policy-revision.test.ts`

**Interfaces:**

```ts
export type OperationsActor = { actorId: string }

export interface OperationsActorResolver {
  resolve(req: Request): OperationsActor | null
}

export const unavailableOperationsActorResolver: OperationsActorResolver
```

```ts
export type PolicyRevisionTarget = {
  enabled: boolean
  dailyDraftPrLimit: number
  maxConcurrentRuns: number
  requireFreshEvidence: boolean
  minimumEvidenceCoverage: number
  pauseOnVerificationFailure: boolean
  killSwitch: boolean
}
```

```ts
export type ApplyPolicyRevisionInput = {
  projectId: string
  requestId: string
  expectedUpdatedAt: Date | null
  target: PolicyRevisionTarget
  actorId: string
}
```

```ts
export type ApplyPolicyRevisionResult =
  | { kind: 'APPLIED'; policy: AutopilotPolicy; revision: AutopilotPolicyRevision }
  | { kind: 'EXISTING'; policy: AutopilotPolicy; revision: AutopilotPolicyRevision }
```

- [ ] **Step 1: Write integration RED for first creation**

Create an Advanced project with no policy. Apply:

```ts
expectedUpdatedAt: null
requestId: stable UUID
actorId: 'operator:fixture'
```

Assert one `AutopilotPolicy` and one revision exist, and after snapshot contains forced:

```ts
allowedRiskClass: 'LOW'
allowedOperationClasses: ['CREATE_CONTENT_PAGE']
```

- [ ] **Step 2: Write RED for update + before/after audit**

Create policy, then apply a second revision using exact current `updatedAt`.

Assert revision freezes exact previous and new snapshots and actor.

- [ ] **Step 3: Write RED for optimistic conflict**

Use stale `expectedUpdatedAt` and assert rejection code:

```text
AUTOPILOT_POLICY_CONFLICT
```

Then assert policy and revision counts are unchanged.

- [ ] **Step 4: Write RED for request idempotency/collision**

Exact same request twice → `EXISTING` and one revision.

Same request id with changed target/expected timestamp/actor → throw:

```text
AUTOPILOT_POLICY_REQUEST_COLLISION
```

with no additional update.

- [ ] **Step 5: Write RED for concurrent competing revisions**

Run `Promise.all` with two different request ids sharing the same `expectedUpdatedAt`.

Assert exactly one applies and the other fails conflict; revision count increases by one.

- [ ] **Step 6: Write immutability RED**

Direct Prisma UPDATE and DELETE against a revision must reject with the database immutability trigger.

- [ ] **Step 7: Implement actor resolver**

```ts
export const unavailableOperationsActorResolver: OperationsActorResolver = {
  resolve: () => null,
}
```

No header/body/query fallback is allowed in this resolver.

- [ ] **Step 8: Implement repository transaction**

Repository method:

```ts
applyRevision(input: {
  projectId: string
  requestId: string
  expectedUpdatedAt: Date | null
  actorId: string
  normalizedPolicy: NormalizedAutopilotPolicy
  revisionKey: string
  commandFingerprint: string
}): Promise<ApplyPolicyRevisionResult>
```

Inside one Prisma transaction:

1. acquire a project-scoped PostgreSQL advisory transaction lock derived from `projectId`;
2. read existing revision by `(projectId, requestId)`;
3. if it exists, compare full immutable command identity and return EXISTING or collision;
4. read current policy;
5. compare exact `updatedAt` semantics;
6. compute before snapshot;
7. create/update current policy using the already-normalized target;
8. create revision with exact applied policy timestamp;
9. return both.

Do not call existing `upsertPolicy()` outside this transaction.

- [ ] **Step 9: Implement service normalization**

`PolicyRevisionService.apply(input)` calls existing `normalizeAutopilotPolicy` with only:

```ts
{
  enabled,
  dailyDraftPrLimit,
  maxConcurrentRuns,
  requireFreshEvidence,
  minimumEvidenceCoverage,
  pauseOnVerificationFailure,
  killSwitch,
}
```

Then builds identity and calls repository.

- [ ] **Step 10: Add bounded observability**

Allow events:

```text
optimization.operations.policy_revision.applied
optimization.operations.policy_revision.existing
optimization.operations.policy_revision.conflict
```

Metadata allowlist only:

```text
projectId policyId revisionId requestId actorId reasonCode
```

Strip control characters and truncate strings consistently with existing observability conventions.

- [ ] **Step 11: Verify Task 34**

```bash
npx vitest run tests/integration/operations.policy-revision.test.ts --reporter=verbose
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 12: Commit Task 34**

```bash
git add src/modules/optimization-operations tests/integration/operations.policy-revision.test.ts
git commit -m "feat: add audited Autopilot policy revisions"
```

---

### Task 35: Pure Operations Projection Rules

**Files:**
- Create: `src/modules/optimization-operations/operations.types.ts`
- Create: `src/modules/optimization-operations/operations.derive.ts`
- Create: `tests/unit/operations.derive.test.ts`

**Interfaces:**

```ts
export type EffectiveAutopilotState =
  | 'GLOBAL_KILL_SWITCH'
  | 'PROJECT_KILL_SWITCH'
  | 'FEATURE_BLOCKED'
  | 'DISABLED'
  | 'ACTIVE'
```

```ts
export type OperationsPipelineStage =
  | 'DISCOVERED'
  | 'ELIGIBLE'
  | 'PLANNED'
  | 'AUTOPILOT_DECIDED'
  | 'P8_HANDOFF'
  | 'DRAFT_PR'
  | 'VERIFIED'
  | 'OBSERVING'
  | 'EVALUATED'
```

```ts
export type OperationsInboxCategory =
  | 'AWAITING_HUMAN_MERGE'
  | 'POLICY_BLOCKED'
  | 'P8_VALIDATION_BLOCKED'
  | 'VERIFICATION_FAILED'
  | 'STALE'
  | 'EXECUTION_FAILED'
```

- [ ] **Step 1: RED effective state precedence**

Table-test all combinations so priority is exactly:

```text
GLOBAL > PROJECT > FEATURE > DISABLED > ACTIVE
```

- [ ] **Step 2: RED farthest pipeline stage**

Feed one synthetic authority snapshot containing increasing facts and assert each additional downstream fact advances exactly one current stage; never return multiple stages.

Use exact P8 execution states including `PR_CREATED`, `VERIFIED`, `VERIFICATION_FAILED`, and `FAILED`.

- [ ] **Step 3: RED inbox mapping/sort**

Assert:

- Autopilot decision `POLICY_BLOCKED` → `POLICY_BLOCKED`;
- decision `P8_VALIDATION_BLOCKED` → same category;
- execution `VERIFICATION_FAILED` → `VERIFICATION_FAILED`;
- execution `FAILED` → `EXECUTION_FAILED`;
- stale review/stale decision → `STALE`;
- `PR_CREATED` requiring human merge → `AWAITING_HUMAN_MERGE`.

Assert severity/wait/stable-id ordering.

- [ ] **Step 4: RED outcome windows**

Given a fixed `now`, include terminal observations whose `inputCutoffAt` falls in previous 7/30 days; exclude based on cutoff even when `createdAt` is recent.

- [ ] **Step 5: RED quota calculation**

```ts
configuredLimit = 3
reserved = count(status === RESERVED)
consumed = count(status === CONSUMED)
remaining = Math.max(0, configuredLimit - reserved - consumed)
```

Assert no negative remaining.

- [ ] **Step 6: Implement pure derivation GREEN**

Functions:

```ts
deriveEffectiveAutopilotState(input): EffectiveAutopilotState
derivePipelineStage(input): OperationsPipelineStage
deriveInboxItems(input): OperationsInboxItem[]
deriveOutcomeSummary(input): OperationsOutcomeSummary
deriveQuota(input): OperationsQuota
sortActivity(items): OperationsActivityItem[]
```

Keep these functions DB/provider-free.

- [ ] **Step 7: Verify Task 35**

```bash
npx vitest run tests/unit/operations.derive.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 8: Commit Task 35**

```bash
git add src/modules/optimization-operations/operations.types.ts src/modules/optimization-operations/operations.derive.ts tests/unit/operations.derive.test.ts
git commit -m "feat: add P9-F operations projections"
```

---

### Task 36: Persisted-Read Operations Repository and Service

**Files:**
- Create: `src/modules/optimization-operations/operations.repository.ts`
- Create: `src/modules/optimization-operations/operations.service.ts`
- Create: `tests/integration/operations.repository.test.ts`

**Interfaces:**

Repository read methods are project-scoped and bounded:

```ts
getCurrentPolicy(projectId)
countTodayRuns(projectId, utcDayStart, utcDayEnd)
listPipelineAuthority(projectId, limit, offset)
listInboxAuthority(projectId, limit, offset)
listTerminalObservations(projectId, cutoffStart, cutoffEnd)
listFeedbackEvidence(projectId, cutoffStart, cutoffEnd)
listFeedbackProfiles(projectId, limit, offset)
listReservations(projectId, utcDate)
listRecentActivityAuthority(projectId, limit)
listPolicyRevisions(projectId, limit, offset)
```

Service:

```ts
getOverview(projectId, now): Promise<OperationsOverview>
listPipeline(projectId, pagination)
listInbox(projectId, pagination)
listExperiments(projectId, pagination)
listFeedback(projectId, pagination)
getPolicy(projectId)
listPolicyRevisions(projectId, pagination)
```

- [ ] **Step 1: Build real Prisma fixture RED**

Persist a small linked chain with:

- P7 Growth opportunity;
- P9-A candidate/plan;
- P9-B run/item;
- P9-C decision/reservation;
- P8 proposal/plan/execution/verification;
- P9-D experiment/terminal observation;
- P9-E feedback evidence/profile.

Also create a second project with similar rows.

- [ ] **Step 2: RED project isolation**

Every repository method called for project A must exclude project B ids/data.

- [ ] **Step 3: RED non-duplicating pipeline**

A fully advanced plan appears exactly once as `EVALUATED`, not in upstream counts.

Add separate fixtures stopped at `ELIGIBLE`, `PLANNED`, `PR_CREATED`, and `VERIFIED` to assert counts.

- [ ] **Step 4: RED inbox authority**

Persist representative decision/execution statuses and assert category/reason/authority links are derived from the exact authority rows.

- [ ] **Step 5: RED outcome/feedback windows**

Use terminal `inputCutoffAt` around 7/30-day boundaries. Assert P9-E accepted count comes from evidence rows and is not inferred from positive outcome.

- [ ] **Step 6: RED quota**

Persist RESERVED, CONSUMED, RELEASED reservations for the UTC day. Assert RELEASED does not consume current remaining quota and remaining is clamped at zero.

- [ ] **Step 7: RED activity semantics**

Assert activity is sorted by semantic `occurredAt`, not blindly by row `createdAt`; include at least P9-B, P9-C, P8, P9-D, P9-E.

- [ ] **Step 8: Implement repository GREEN**

Use Prisma `select` to read only fields needed by the read model. No `create`, `update`, `delete`, queue, provider, or Git dependencies in this file.

Do not use one unbounded mega-query. Keep list limits at or below API max and activity bounded.

- [ ] **Step 9: Implement service GREEN**

Compose repository rows through `operations.derive.ts`. Read global kill switch from configuration/environment through a tiny injected function:

```ts
type GlobalKillSwitchReader = () => boolean
```

Default must use the same canonical boolean interpretation as P9-C, not a second incompatible parser.

- [ ] **Step 10: Verify Task 36**

```bash
npx vitest run tests/integration/operations.repository.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 11: Commit Task 36**

```bash
git add src/modules/optimization-operations/operations.repository.ts src/modules/optimization-operations/operations.service.ts tests/integration/operations.repository.test.ts
git commit -m "feat: add persisted P9-F operations read model"
```

---

### Task 37: Operations API + Fail-Closed Policy Mutation Route

**Files:**
- Create: `src/modules/optimization-operations/operations.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/operations.routes.test.ts`

**Interfaces:**

```ts
export interface OptimizationOperationsApiPort {
  getOverview(projectId: string): Promise<OperationsOverview>
  listPipeline(projectId: string, limit: number, offset: number): Promise<unknown>
  listInbox(projectId: string, limit: number, offset: number): Promise<unknown>
  listExperiments(projectId: string, limit: number, offset: number): Promise<unknown>
  listFeedback(projectId: string, limit: number, offset: number): Promise<unknown>
  getPolicy(projectId: string): Promise<unknown>
  listPolicyRevisions(projectId: string, limit: number, offset: number): Promise<unknown>
}
```

Command port:

```ts
export interface PolicyRevisionCommandPort {
  apply(input: ApplyPolicyRevisionInput): Promise<ApplyPolicyRevisionResult>
}
```

- [ ] **Step 1: Write GET route RED**

Test all seven GET endpoints. Advanced/Enterprise return 200 from injected fake read port; Standard returns 403 **before fake read calls**.

Test project UUID validation and pagination bounds.

- [ ] **Step 2: RED mutation forbidden fields**

POST strict body containing any of:

```text
actorId
allowedRiskClass
allowedOperationClasses
```

must return `400 POLICY_MUTATION_FIELD_FORBIDDEN` and never invoke command port.

- [ ] **Step 3: RED actor unavailable**

With default/unavailable resolver, a valid Policy Revision body returns:

```text
503 OPERATIONS_ACTOR_UNAVAILABLE
```

and command port call count remains zero.

- [ ] **Step 4: RED actor injection**

Inject resolver returning:

```ts
{ actorId: 'operator:fixture' }
```

Assert command receives this server actor and no client actor field exists.

- [ ] **Step 5: RED command status mapping**

- `APPLIED` → 201 response;
- `EXISTING` → 200 response;
- service conflict → 409 `AUTOPILOT_POLICY_CONFLICT`;
- request collision → 409 `AUTOPILOT_POLICY_REQUEST_COLLISION`.

- [ ] **Step 6: Implement API GREEN**

All project routes use:

```ts
requireFeature('OPTIMIZATION_OPERATIONS_CENTER')
```

before read/command ports.

Strict policy schema accepts exactly:

```ts
requestId
expectedUpdatedAt
policy.enabled
policy.dailyDraftPrLimit
policy.maxConcurrentRuns
policy.requireFreshEvidence
policy.minimumEvidenceCoverage
policy.pauseOnVerificationFailure
policy.killSwitch
```

- [ ] **Step 7: Mount in app**

Extend `AppOptions` with injectable Operations read API, policy command, and actor resolver. Mount routes under `/api/v1`.

Do not modify the existing P9-B run route.

- [ ] **Step 8: Verify Task 37**

```bash
npx vitest run tests/integration/operations.routes.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 9: Commit Task 37**

```bash
git add src/modules/optimization-operations/operations.routes.ts src/app.ts tests/integration/operations.routes.test.ts
git commit -m "feat: expose bounded P9-F operations API"
```

---

### Task 38: SSR Operations Center UI + Safe Client Interactions

**Files:**
- Create: `src/modules/optimization-operations/operations.web.routes.ts`
- Create: `src/views/optimization-operations/index.ejs`
- Create: `src/public/js/optimization-operations.js`
- Modify: `src/views/layout.ejs`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/public/css/app.css`
- Modify: `src/app.ts`
- Create: `tests/integration/operations.web.routes.test.ts`

**Interfaces:**

SSR route:

```text
GET /projects/:id/optimization
```

It renders one persisted overview snapshot and `policyMutationAvailable = Boolean(actorResolver.resolve(req))`.

- [ ] **Step 1: RED SSR feature gate**

Advanced/Enterprise render 200; Standard returns feature denial before Operations read port.

- [ ] **Step 2: RED persisted content + empty states**

Injected model must render:

- effective state;
- six metric cards;
- pipeline counts;
- inbox item;
- 7/30 outcome values;
- feedback sample/adjustment;
- activity timeline;
- empty-state copy when collections are empty.

- [ ] **Step 3: RED no privileged controls**

Rendered HTML must not contain buttons/forms labelled or targeting:

```text
Merge
Deploy
Rollback
force verified
risk class editor
historical weight editor
```

It must visibly show locked `LOW` and `CREATE_CONTENT_PAGE`.

- [ ] **Step 4: RED actor availability UI**

Default resolver → policy Save disabled and copy explains authenticated operator identity is unavailable.

Injected actor resolver → Save control is enabled.

- [ ] **Step 5: Implement web route/template GREEN**

Render using existing `layout`, `activeNav = 'optimization-operations'`, project breadcrumb, and existing visual tokens.

Add sidebar link before 优化实验.

- [ ] **Step 6: Add page-specific script support**

In `layout.ejs` render optional script paths only when supplied:

```ejs
<% if (typeof pageScripts !== 'undefined') { %>
  <% for (const src of pageScripts) { %>
    <script src="<%= src %>" defer></script>
  <% } %>
<% } %>
```

P9-F supplies `/assets/js/optimization-operations.js`.

- [ ] **Step 7: Implement safe client refresh**

Client script is gated by a root data attribute. It polls overview every 30 seconds only while `document.visibilityState === 'visible'`.

Refresh calls GET only.

If policy form has `data-dirty=true`, refresh must not replace policy input values.

- [ ] **Step 8: Implement existing P9-B Run button**

Generate `crypto.randomUUID()` and POST only:

```text
/api/v1/projects/:projectId/optimization/runs
```

with:

```json
{ "manualRequestId": "..." }
```

On 202 show accepted Run id/message; do not increment pipeline optimistically.

- [ ] **Step 9: Implement Policy Revision UI**

POST only to P9-F revision endpoint with current `expectedUpdatedAt` and editable safe fields.

Before enabling Autopilot or disabling an active project kill switch, require `window.confirm` with safety-bound copy.

On 409 display stale-policy message and require refresh. Never expose a force-overwrite action.

- [ ] **Step 10: Add scoped CSS**

Add `.operations-*` styles for pipeline, two-column panels, timeline, policy drawer, warning states, responsive breakpoints, reusing existing CSS variables/colors.

- [ ] **Step 11: Verify Task 38**

```bash
npx vitest run tests/integration/operations.web.routes.test.ts --reporter=verbose
npm run typecheck
npm run build
```

- [ ] **Step 12: Commit Task 38**

```bash
git add src/modules/optimization-operations/operations.web.routes.ts src/views src/public src/app.ts tests/integration/operations.web.routes.test.ts
git commit -m "feat: add P9-F autonomous operations center UI"
```

---

### Task 39: Authority Hardening + Full Persisted Chain + Development Documentation

**Files:**
- Create: `tests/integration/operations.authority.test.ts`
- Extend: `tests/integration/operations.repository.test.ts` if a chain assertion is missing
- Create: `docs/development/p9-f-autonomous-operations-center.md`

**Interfaces:** none new; this task locks boundaries.

- [ ] **Step 1: Static authority scan RED/GREEN**

Scan the entire `src/modules/optimization-operations` tree and Operations client JS.

Reject direct imports/runtime tokens for:

```text
DeepSeek
AiGateway
Search providers
Visibility providers
GitHub/Git mutation
publication execution service
deploy
rollback
experiment evaluator
feedback materializer
```

Allow Prisma persisted reads and the Policy Revision repository only.

- [ ] **Step 2: GET side-effect audit**

With injected spies/fakes, call every Operations GET + SSR route and assert:

```text
no queue add
autopilot policy mutation count unchanged
revision count unchanged
P7/P8/P9 authority row payloads unchanged
```

- [ ] **Step 3: Full persisted chain assertion**

Using real Prisma linked fixture:

```text
P7 opportunity
→ P9-A plan
→ P9-B run/item
→ P9-C decision/reservation
→ P8 PR_CREATED/VERIFIED
→ P9-D observation
→ P9-E evidence/profile
→ P9-F EVALUATED projection/activity
```

Assert P9-F links/reads the exact persisted ids and does not create copied pipeline rows.

- [ ] **Step 4: Global kill switch non-authority**

Search/route test must prove there is no POST/PUT/PATCH/DELETE endpoint for the platform global kill switch.

- [ ] **Step 5: Actor rollout-gate test**

Default `createApp()` must leave Policy Revision mutation unavailable. Confirm read-only Operations page still works for an eligible plan.

- [ ] **Step 6: Write development guide**

Document:

- source-of-truth chain;
- stage mapping;
- inbox semantics;
- 7/30 cutoff semantics;
- quota calculation;
- activity timestamps;
- Policy Revision transaction/idempotency/concurrency;
- actor fail-closed rollout gate;
- locked LOW/CREATE_CONTENT_PAGE safety;
- API/UI paths;
- no Merge/Deploy/Rollback authority;
- rollback/data-retention behavior;
- verification commands.

No placeholders.

- [ ] **Step 7: Focused verification**

```bash
npx vitest run tests/unit/operations.derive.test.ts tests/integration/operations.policy-revision.test.ts tests/integration/operations.repository.test.ts tests/integration/operations.routes.test.ts tests/integration/operations.web.routes.test.ts tests/integration/operations.authority.test.ts --reporter=verbose
npm run typecheck
```

- [ ] **Step 8: Commit Task 39**

```bash
git add tests docs/development/p9-f-autonomous-operations-center.md
git commit -m "test: harden P9-F operations authority"
```

---

### Task 40: Exact-Head Release Verification and Draft PR

**Files:**
- No business-code changes expected.
- Update design/plan/development docs only if verification exposes an actual contract correction.

**Interfaces:** release gate only.

- [ ] **Step 1: Fresh exact-head verification**

Run/require the repository CI gates on the exact final P9-F head:

```text
production-audit
e2e
verify
```

`verify` must include:

```text
Prisma validate
Prisma generate
migration deploy
Typecheck
Full Vitest
Build
```

- [ ] **Step 2: Inspect full test totals and expected negative DB errors**

Do not claim completion from job status alone. Read verify logs and record exact passing file/test totals.

Any immutability/unique constraint errors in logs are acceptable only when the corresponding test passes by asserting fail-closed behavior.

- [ ] **Step 3: Confirm branch/authority boundaries**

Verify:

- branch is `feat/p9-f-autonomous-operations-center`;
- base exact commit is P9-E final `bf06abb110521765e5c7ca47562a46826f435437` unless explicitly rebased by an approved workflow;
- P9-E PR #159 head was not mutated by P9-F work;
- no merge/deploy occurred.

- [ ] **Step 4: Create Draft PR only**

If no PR exists for P9-F, create a Draft PR targeting the P9-E branch (stacked PR) with summary/security/test sections.

Do **not** mark Ready, merge, or deploy.

- [ ] **Step 5: Final completion report**

Report:

- exact P9-F head SHA;
- Draft PR number/status/base;
- exact CI run id;
- all three gate statuses;
- exact Full Vitest file/test totals;
- actor mutation rollout gate status;
- confirmation that Merge/Deploy/Global Kill Switch authority was not added.

---

## Self-Review

### Spec coverage

- Persisted-read architecture → Tasks 35–39.
- Effective Autopilot state → Tasks 35–38.
- Pipeline/current-farthest stage → Tasks 35–36.
- Inbox → Tasks 35–38.
- 7/30 outcomes → Tasks 35–36.
- Feedback weights → Tasks 36–38.
- Quota → Tasks 35–36.
- Activity timeline → Tasks 35–38.
- Feature gate → Task 33 + routes/web tests.
- Existing P9-B run reuse → Task 38.
- Policy Revision persistence → Task 33.
- Atomic command/concurrency/idempotency → Task 34.
- Actor fail-closed gate → Tasks 34, 37, 38, 39.
- Locked LOW/CREATE_CONTENT_PAGE → Tasks 34, 37, 38.
- Global kill switch read-only → Tasks 35, 39.
- SSR/polling/UI → Task 38.
- Static authority hardening → Task 39.
- Docs/release CI → Tasks 39–40.

No uncovered design requirement remains.

### Placeholder scan

The plan contains no `TBD`, `TODO`, `implement later`, unspecified error handling, or unnamed test requirement. Every task specifies concrete files, interfaces, RED expectations, GREEN behavior, and verification commands.

### Type consistency

- `OPTIMIZATION_OPERATIONS_CENTER` is the single feature name everywhere.
- `AUTOPILOT_POLICY_REVISION_V1` is the single revision version.
- `OperationsActorResolver.resolve(req)` is the only actor source for the public mutation route.
- `ApplyPolicyRevisionInput` always receives server-resolved `actorId` and safe target fields.
- `OperationsPipelineStage`, `OperationsInboxCategory`, and `EffectiveAutopilotState` names match the design spec.
- API pagination uses `limit/offset` everywhere.
- Existing P9-B run command path is reused exactly and is not redefined.
