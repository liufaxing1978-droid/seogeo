# P9-E Feedback Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded, deterministic P9-E feedback-learning layer that accepts at most one qualified terminal P9-D observation per experiment, materializes immutable rolling feedback profiles, and lets only new P9-A V2 plans freeze a small historical ranking adjustment without changing P7, P8, P9-D, or controlled-autopilot authority.

**Architecture:** Add one isolated `optimization-feedback` module with immutable evidence/profile persistence, deterministic scope/evidence/profile identities, terminal-observation eligibility, rolling-20 aggregation, one BullMQ queue with 90-day reconciliation, bounded observability, and persisted-read project APIs. P9-D hands persisted observations to P9-E only after durable observation persistence and treats queue delivery as best-effort. P9-A V1 remains byte-for-behavior compatible; P9-A V2 is explicit opt-in and freezes the exact feedback profile into deterministic or AI-backed new plans. AI remains limited to its existing ±2 advisory adjustment and cannot create, change, or reinterpret feedback.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Prisma 6.14/PostgreSQL 17, BullMQ 5.58/Redis 7, Express 5, Zod 3.25, Vitest 3.2, Supertest 7, Playwright 1.55/Chromium.

**Spec:** `docs/superpowers/specs/2026-08-25-p9-e-feedback-learning-design.md`

## Global Constraints

- Implementation branch is `feat/p9-e-feedback-learning`, created from P9-D exact head `d5b9b8fe42b926e42854e956d06fb45a6079c48a`.
- PR #158 remains isolated on `feat/p9-d-experiment-engine`; no P9-E commit may be pushed to that branch or used to change its Draft/merge/deploy state.
- `OPTIMIZATION_FEEDBACK`: Standard=false, Advanced=true, Enterprise=true.
- P9-E reads persisted P9-A/P9-D/P8 facts only. It never calls Search providers, Visibility providers, DeepSeek, Git, deployment, rollback, community/entity publishing, or external mutation adapters.
- P9-E must never update/delete P7, P8, P9-A, P9-C, P9-D, Search Facts, or Visibility facts.
- `OptimizationFeedbackEvidence` and `OptimizationFeedbackProfile` are immutable with PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- One P9-D experiment contributes at most one accepted feedback evidence row for all time.
- Earlier planned experiment windows never contribute. For the terminal schedule, evaluate candidate observations by `inputCutoffAt ASC`, then `observationId ASC`; accept the first one satisfying every feedback gate.
- `INCONCLUSIVE`, `PARTIAL`, `INSUFFICIENT`, `UNKNOWN`, contamination, missing baseline, unsupported evaluator, invalid P8 authority, or ambiguous scope produce no sample. They are never zero/negative samples.
- Feedback scope is exact `(projectId, marketScopeMode, marketCode, locale, recommendedActionType)`. No project or configured-market pooling.
- P9-E V1 rolling window is exactly 20 accepted experiments per scope. Fewer than 3 samples produces historical adjustment 0.
- Historical adjustment is deterministic, integer, clamped to `[-10,+10]`.
- Existing `OPTIMIZATION_PLAN_V1` rows and V1 planner behavior remain unchanged; they continue to freeze `historicalRankAdjustment = 0`.
- `OPTIMIZATION_PLAN_V2` is explicit opt-in. It may freeze a compatible latest feedback profile into a new immutable plan only.
- Existing AI adjustment authority remains integer `[-2,+2]`; historical feedback cannot change AI output validation and AI cannot edit feedback.
- V2 final ordering displacement from deterministic rank is bounded to 10. If historical feedback causes any candidate to exceed the bound, zero all historical adjustments for that materialization while preserving already-valid AI adjustments.
- P9-E owns exactly one queue: `optimization-feedback-materialization`, with attempts=2.
- Daily reconciliation scans at most the previous 90 days, at most 100 candidate observations per project per run, and provides no unlimited/public historical backfill.
- Public P9-E V1 API is GET-only and persisted-read only. No GET may enqueue work or recalculate profiles.
- Existing `.github/workflows/ci.yml` remains authoritative. Do not weaken `verify`, `production-audit`, or `e2e`.
- No merge or deployment without a later separate explicit human authorization.

---

## File Structure

New P9-E files:

```text
prisma/models/optimization-feedback.prisma
prisma/migrations/20260825010000_add_p9e_feedback_learning/migration.sql
src/modules/optimization-feedback/
  feedback.types.ts
  feedback.identity.ts
  feedback.eligibility.ts
  feedback.profile.ts
  feedback.repository.ts
  feedback.service.ts
  feedback.observability.ts
  feedback.queue.ts
  feedback.worker.ts
  feedback.routes.ts
docs/development/p9-e-feedback-learning.md
```

Shared integration surfaces permitted to change:

```text
prisma/models/optimization.prisma
prisma/models/optimization-experiment.prisma
src/auth/feature-flags.ts
src/modules/optimization/optimization.types.ts
src/modules/optimization/optimization.ranking.ts
src/modules/optimization/optimization.service.ts
src/modules/ai/optimization-plan-ranking.ts
src/modules/ai/ai.worker.ts
src/modules/optimization-experiments/experiment.worker.ts
src/queue/queues.ts
src/queue/worker-bootstrap.ts
src/app.ts
```

Tests:

```text
tests/unit/feedback.feature-gate.test.ts
tests/unit/feedback.identity.test.ts
tests/unit/feedback.eligibility.test.ts
tests/unit/feedback.profile.test.ts
tests/unit/feedback.observability.test.ts
tests/unit/feedback.queue.test.ts
tests/unit/feedback.worker.test.ts
tests/unit/optimization.feedback-ranking.test.ts
tests/unit/experiment.worker.test.ts
tests/unit/queues.test.ts
tests/unit/worker-bootstrap.test.ts
tests/integration/feedback.persistence.test.ts
tests/integration/feedback.materialization.test.ts
tests/integration/feedback.routes.test.ts
tests/integration/feedback.authority.test.ts
tests/integration/optimization.feedback-v2.test.ts
tests/integration/optimization.ai-ranking.test.ts
```

---

### Task 24: Persistence schema, versions, identities, and feature gate

**Files:**
- Create: `prisma/models/optimization-feedback.prisma`
- Create: `prisma/migrations/20260825010000_add_p9e_feedback_learning/migration.sql`
- Modify: `prisma/models/optimization.prisma`
- Modify: `prisma/models/optimization-experiment.prisma`
- Create: `src/modules/optimization-feedback/feedback.types.ts`
- Create: `src/modules/optimization-feedback/feedback.identity.ts`
- Modify: `src/auth/feature-flags.ts`
- Create: `tests/unit/feedback.feature-gate.test.ts`
- Create: `tests/unit/feedback.identity.test.ts`

**Interfaces produced:**

```ts
export const OPTIMIZATION_FEEDBACK_SCOPE_VERSION = 'OPTIMIZATION_FEEDBACK_SCOPE_V1' as const;
export const OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION = 'OPTIMIZATION_FEEDBACK_EVIDENCE_V1' as const;
export const OPTIMIZATION_FEEDBACK_PROFILE_VERSION = 'OPTIMIZATION_FEEDBACK_PROFILE_V1' as const;
export const OPTIMIZATION_FEEDBACK_WINDOW_LIMIT = 20 as const;

export type FeedbackMarketScopeMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY';
export type FeedbackEffect = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
```

- [ ] **Step 1: Write RED feature and identity tests**

`tests/unit/feedback.feature-gate.test.ts` must assert:

```ts
expect(hasFeature('STANDARD', 'OPTIMIZATION_FEEDBACK')).toBe(false);
expect(hasFeature('ADVANCED', 'OPTIMIZATION_FEEDBACK')).toBe(true);
expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_FEEDBACK')).toBe(true);
```

`tests/unit/feedback.identity.test.ts` must prove:
- scope identity is stable under object-key ordering;
- `null` market/locale is explicit and distinct from configured scope;
- different project, market, locale, or action changes `scopeKey`;
- evidence key changes when observation changes;
- profile fingerprint is invariant to the caller's unsorted evidence input because the builder sorts by the supplied deterministic order contract before hashing;
- profile key changes when the rolling evidence set changes.

Run:

```bash
npx vitest run tests/unit/feedback.feature-gate.test.ts tests/unit/feedback.identity.test.ts
```

Expected RED: missing `OPTIMIZATION_FEEDBACK` and missing feedback identity module only.

- [ ] **Step 2: Add exact Prisma models and forward migration**

Create `optimization-feedback.prisma` with:

```prisma
enum OptimizationFeedbackEffect {
  POSITIVE
  NEUTRAL
  NEGATIVE
}

model OptimizationFeedbackEvidence {
  id                      String                     @id @default(uuid()) @db.Uuid
  projectId               String                     @db.Uuid
  experimentId            String                     @unique @db.Uuid
  observationId           String                     @unique @db.Uuid
  optimizationPlanId      String                     @db.Uuid
  candidateId             String                     @db.Uuid
  feedbackEvidenceVersion String
  evidenceKey             String
  scopeKey                String
  marketScopeMode         OptimizationMarketScopeMode
  marketCode              MarketCode?
  locale                  String?
  recommendedActionType   RecommendedActionType
  effectState             OptimizationFeedbackEffect
  feedbackValue           Int
  terminalWindowType      String
  terminalWindowDays      Int
  inputCutoffAt           DateTime
  sourceEvaluatorVersion  String
  sourceObservationKey    String
  createdAt               DateTime                   @default(now())

  experiment       OptimizationExperiment            @relation(fields: [experimentId], references: [id], onDelete: Restrict)
  observation      OptimizationExperimentObservation @relation(fields: [observationId], references: [id], onDelete: Restrict)
  optimizationPlan OptimizationPlan                  @relation(fields: [optimizationPlanId], references: [id], onDelete: Restrict)
  candidate        OptimizationCandidate             @relation(fields: [candidateId], references: [id], onDelete: Restrict)

  @@unique([projectId, evidenceKey], map: "OptimizationFeedbackEvidence_project_key")
  @@index([projectId, scopeKey, inputCutoffAt], map: "OptimizationFeedbackEvidence_scope_cutoff_idx")
}

model OptimizationFeedbackProfile {
  id                       String                     @id @default(uuid()) @db.Uuid
  projectId                String                     @db.Uuid
  feedbackProfileVersion   String
  profileKey               String
  scopeKey                 String
  marketScopeMode          OptimizationMarketScopeMode
  marketCode               MarketCode?
  locale                   String?
  recommendedActionType    RecommendedActionType
  sampleCount              Int
  positiveCount            Int
  neutralCount             Int
  negativeCount            Int
  rollingEffectBalance     Float
  historicalRankAdjustment Int
  windowLimit              Int
  oldestEvidenceCutoffAt   DateTime
  newestEvidenceCutoffAt   DateTime
  inputEvidenceIdsJson     Json
  inputFingerprint         String
  createdAt                DateTime                   @default(now())

  @@unique([projectId, profileKey], map: "OptimizationFeedbackProfile_project_key")
  @@unique([projectId, inputFingerprint], map: "OptimizationFeedbackProfile_project_input")
  @@index([projectId, scopeKey, newestEvidenceCutoffAt], map: "OptimizationFeedbackProfile_scope_latest_idx")
}
```

Add reverse arrays only where Prisma requires them:

```prisma
// OptimizationCandidate
feedbackEvidence OptimizationFeedbackEvidence[]

// OptimizationPlan
feedbackEvidence OptimizationFeedbackEvidence[]

// OptimizationExperiment
feedbackEvidence OptimizationFeedbackEvidence[]

// OptimizationExperimentObservation
feedbackEvidence OptimizationFeedbackEvidence[]
```

The additive migration creates both tables, enum, exact indexes/FKs, plus:

```sql
CREATE OR REPLACE FUNCTION "reject_p9e_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-E immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationFeedbackEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationFeedbackEvidence"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9e_immutable_mutation"();

CREATE TRIGGER "OptimizationFeedbackProfile_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationFeedbackProfile"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9e_immutable_mutation"();
```

Do not edit any earlier migration.

- [ ] **Step 3: Implement canonical identities**

`feedback.identity.ts` owns its own canonical JSON/hash functions and exports:

```ts
export function buildFeedbackScopeKey(input: {
  projectId: string;
  marketScopeMode: FeedbackMarketScopeMode;
  marketCode: string | null;
  locale: string | null;
  recommendedActionType: string;
}): string;

export function buildFeedbackEvidenceKey(input: {
  projectId: string;
  experimentId: string;
  observationId: string;
  scopeKey: string;
}): string;

export function buildFeedbackProfileIdentity(input: {
  projectId: string;
  scopeKey: string;
  orderedEvidenceIds: readonly string[];
}): { inputFingerprint: string; profileKey: string };
```

Hash exactly the version fields from the design; sorted object keys and explicit `null` are mandatory.

- [ ] **Step 4: Add feature matrix entry and verify**

Add `'OPTIMIZATION_FEEDBACK'` to `Feature` and `advancedFeatures`; Enterprise inherits it, Standard does not.

Run:

```bash
npx prisma validate
npx prisma generate
npx vitest run tests/unit/feedback.feature-gate.test.ts tests/unit/feedback.identity.test.ts
npm run typecheck
```

Expected GREEN.

- [ ] **Step 5: Commit Task 24**

```bash
git add prisma src/auth src/modules/optimization-feedback tests/unit/feedback.feature-gate.test.ts tests/unit/feedback.identity.test.ts
git commit -m "feat: add P9-E feedback persistence foundation"
```

---

### Task 25: Terminal observation selection and feedback eligibility

**Files:**
- Create: `src/modules/optimization-feedback/feedback.eligibility.ts`
- Create: `tests/unit/feedback.eligibility.test.ts`

**Interfaces:**

```ts
export type FeedbackEligibilityReasonCode =
  | 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
  | 'FEEDBACK_EFFECT_INCONCLUSIVE'
  | 'FEEDBACK_COVERAGE_INSUFFICIENT'
  | 'FEEDBACK_CONTAMINATED'
  | 'FEEDBACK_P8_AUTHORITY_INVALID'
  | 'FEEDBACK_SCOPE_INVALID'
  | 'FEEDBACK_EVALUATOR_UNSUPPORTED'
  | 'FEEDBACK_ALREADY_ACCEPTED';

export type FeedbackTerminalCandidate = {
  id: string;
  experimentId: string;
  observationKey: string;
  windowType: string;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  effectState: string;
  coverageState: string;
  contaminationState: string;
  evaluatorVersion: string;
};

export function selectFeedbackObservation(input: {
  experimentId: string;
  verifiedAnchorAt: Date;
  observationScheduleJson: unknown;
  observations: readonly FeedbackTerminalCandidate[];
  acceptedExperimentId: string | null;
  p8AuthorityValid: boolean;
  scopeValid: boolean;
}):
  | { kind: 'ACCEPT'; observation: FeedbackTerminalCandidate }
  | { kind: 'DEFER'; reasonCode: FeedbackEligibilityReasonCode };
```

- [ ] **Step 1: Write RED selection tests**

Cover exactly:
1. 7/14/28 schedule only permits 28D.
2. 14/28/56 schedule only permits 56D.
3. `dueAt` must equal `verifiedAnchorAt + windowDays` exactly.
4. Earlier window with POSITIVE can never contribute.
5. Two terminal observations are sorted by `inputCutoffAt ASC`, then id ASC.
6. Earliest terminal `INCONCLUSIVE` is skipped; later SUFFICIENT+CLEAR+POSITIVE may qualify.
7. Earliest terminal contaminated is skipped; later clean conclusive may qualify.
8. Once `acceptedExperimentId` exists, every candidate defers `FEEDBACK_ALREADY_ACCEPTED`.
9. `PARTIAL`, `INSUFFICIENT`, `UNKNOWN` never contribute.
10. Any contamination other than CLEAR never contributes.
11. Unsupported evaluator never contributes; accepted evaluator is exactly `OPTIMIZATION_EXPERIMENT_EVALUATOR_V1` for P9-E V1.
12. Invalid P8 authority and invalid scope defer with exact stable codes.
13. Malformed/empty frozen schedule fails closed with `FEEDBACK_TERMINAL_OBSERVATION_PENDING` rather than inventing a terminal window.

Run:

```bash
npx vitest run tests/unit/feedback.eligibility.test.ts
```

Expected RED: missing module.

- [ ] **Step 2: Implement pure deterministic eligibility**

Use a fixed day map `{7D:7,14D:14,28D:28,56D:56}`. Parse every frozen schedule entry, require known window type, matching days, no duplicates, and non-empty list. The terminal item is the last frozen item; do not call `scheduleForIntervention()` to reconstruct history.

For matching terminal observations:
- require exact experiment id/window type/window days/dueAt;
- sort `inputCutoffAt`, then `id`;
- walk in order until the first fully eligible observation;
- never translate an ineligible observation into a numeric sample.

Effect-to-feedback mapping is owned here:

```ts
export function feedbackValueForEffect(effect: FeedbackEffect): -1 | 0 | 1 {
  if (effect === 'POSITIVE') return 1;
  if (effect === 'NEUTRAL') return 0;
  return -1;
}
```

- [ ] **Step 3: Run focused tests and commit**

```bash
npx vitest run tests/unit/feedback.eligibility.test.ts tests/unit/feedback.identity.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.eligibility.ts tests/unit/feedback.eligibility.test.ts
git commit -m "feat: add deterministic P9-E feedback eligibility"
```

Expected GREEN.

---

### Task 26: Repository persistence, authority reads, and database immutability

**Files:**
- Create: `src/modules/optimization-feedback/feedback.repository.ts`
- Create: `tests/integration/feedback.persistence.test.ts`

**Repository API:**

```ts
export type CreateFeedbackEvidenceInput = { /* every persisted evidence field except id/createdAt */ };
export type CreateFeedbackProfileInput = { /* every persisted profile field except id/createdAt */ };

export type CreateOrGetFeedbackEvidenceResult =
  | { kind: 'CREATED'; evidence: OptimizationFeedbackEvidence }
  | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence };

export type CreateOrGetFeedbackProfileResult =
  | { kind: 'CREATED'; profile: OptimizationFeedbackProfile }
  | { kind: 'EXISTING'; profile: OptimizationFeedbackProfile };

export class OptimizationFeedbackRepository {
  loadExperimentFeedbackContext(input: { projectId: string; experimentId: string }): Promise<FeedbackMaterializationContext | null>;
  findEvidenceForExperiment(experimentId: string): Promise<OptimizationFeedbackEvidence | null>;
  createOrGetEvidence(input: CreateFeedbackEvidenceInput): Promise<CreateOrGetFeedbackEvidenceResult>;
  listEvidenceForScope(input: { projectId: string; scopeKey: string }): Promise<OptimizationFeedbackEvidence[]>;
  createOrGetProfile(input: CreateFeedbackProfileInput): Promise<CreateOrGetFeedbackProfileResult>;
  findLatestProfileForScope(input: FeedbackScopeLookup): Promise<OptimizationFeedbackProfile | null>;
  listRecentTerminalCandidates(input: { projectId: string; createdAtGte: Date; limit: number }): Promise<readonly FeedbackReconcileCandidate[]>;
  listFeedbackEnabledProjectIds(): Promise<readonly string[]>;
}
```

`FeedbackMaterializationContext` must fetch in one bounded authority graph:
- exact experiment + all observations ordered by cutoff/id;
- experiment plan + candidate market scope/action;
- frozen publication execution id/status/project;
- frozen publication verification id/status/execution/project;
- publication proposal provenance through execution plan proposal, requiring `P9_OPTIMIZATION_PLAN` and exact `OptimizationPlan.id`.

Do not select Search/Visibility raw metrics or content bodies.

- [ ] **Step 1: Write real-Prisma RED persistence tests**

Use the existing transaction-rollback fixture pattern. Seed an Advanced project with one OptimizationCandidate/Plan, exact VERIFIED P8 execution+verification, one P9-D experiment, and terminal observation.

Assert:
- evidence insert persists exact source IDs/value/scope;
- retry returns EXISTING without a second row;
- a conflicting same identity payload throws a collision error;
- two different observations for the same experiment cannot create two evidence rows;
- profile retry is idempotent; conflicting payload fails closed;
- `UPDATE` and `DELETE` on both feedback tables fail with PostgreSQL immutable trigger error;
- source OptimizationPlan, experiment, observation, P8 execution and verification rows are byte-for-field unchanged after feedback writes.

Run:

```bash
npx vitest run tests/integration/feedback.persistence.test.ts
```

Expected RED: repository missing.

- [ ] **Step 2: Implement create-or-get collision-safe persistence**

Follow P9-D repository semantics:
1. exact identity lookup;
2. full immutable payload comparison using canonical JSON for JSON fields and millisecond equality for dates;
3. create;
4. on Prisma P2002, re-read exact identity;
5. return EXISTING only when full payload matches;
6. otherwise throw `FEEDBACK_EVIDENCE_IDENTITY_COLLISION` or `FEEDBACK_PROFILE_IDENTITY_COLLISION`.

No update/delete methods.

`findLatestProfileForScope()` must order:

```ts
orderBy: [
  { newestEvidenceCutoffAt: 'desc' },
  { inputFingerprint: 'desc' }
]
```

and match every scope component plus exact P9-E profile version.

`listFeedbackEnabledProjectIds()` selects only projects with planLevel `ADVANCED` or `ENTERPRISE`, ordered id ASC.

`listRecentTerminalCandidates()` must:
- constrain `projectId`;
- constrain observation `createdAt >= createdAtGte`;
- exclude experiments already having feedback evidence;
- return at most caller limit;
- return durable ids only; the service revalidates all eligibility.

- [ ] **Step 3: Verify Prisma behavior and commit**

```bash
npx prisma validate
npx prisma generate
npx vitest run tests/integration/feedback.persistence.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.repository.ts tests/integration/feedback.persistence.test.ts
git commit -m "feat: persist immutable P9-E feedback evidence"
```

Expected GREEN.

---

### Task 27: Rolling profile aggregation and deterministic weighting

**Files:**
- Create: `src/modules/optimization-feedback/feedback.profile.ts`
- Create: `tests/unit/feedback.profile.test.ts`

**Interface:**

```ts
export type FeedbackProfileCalculation = {
  orderedEvidenceIds: string[];
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  oldestEvidenceCutoffAt: Date;
  newestEvidenceCutoffAt: Date;
};

export function calculateFeedbackProfile(
  evidence: readonly Pick<OptimizationFeedbackEvidence,
    'id' | 'observationId' | 'effectState' | 'inputCutoffAt'>[]
): FeedbackProfileCalculation;
```

- [ ] **Step 1: Write RED profile tests**

Assert exact formula and ordering:
- 1 or 2 samples => balance=0, adjustment=0;
- 3 positive => `-4`;
- 5 positive => `-5`;
- 10 positive => `-7` using JavaScript `Math.round` on the exact raw value;
- 20 positive => `-8`;
- symmetric negative history creates positive adjustment;
- equal positive/negative history gives 0;
- neutral rows count toward sample/shrinkage but not numerator;
- >20 rows retains last 20 after `(inputCutoffAt ASC, observationId ASC)` ordering;
- duplicate evidence id or observation id throws instead of double counting;
- result adjustment is always integer and within [-10,+10].

Run:

```bash
npx vitest run tests/unit/feedback.profile.test.ts
```

Expected RED: module missing.

- [ ] **Step 2: Implement exact first-party formula**

```ts
const sampleCount = p + u + n;
if (sampleCount < 3) return balance=0/adjustment=0;
const balance = (p - n) / sampleCount;
const shrinkage = sampleCount / (sampleCount + 5);
const raw = -10 * balance * shrinkage;
const adjustment = Math.max(-10, Math.min(10, Math.round(raw)));
```

Do not introduce time decay, provider weighting, confidence multipliers, AI, or cross-scope pooling.

- [ ] **Step 3: Run and commit**

```bash
npx vitest run tests/unit/feedback.profile.test.ts tests/unit/feedback.identity.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.profile.ts tests/unit/feedback.profile.test.ts
git commit -m "feat: add bounded P9-E feedback profiles"
```

Expected GREEN.

---

### Task 28: Feedback materialization service and observability

**Files:**
- Create: `src/modules/optimization-feedback/feedback.service.ts`
- Create: `src/modules/optimization-feedback/feedback.observability.ts`
- Create: `tests/unit/feedback.observability.test.ts`
- Create: `tests/integration/feedback.materialization.test.ts`

**Service result:**

```ts
export type FeedbackMaterializationResult =
  | { kind: 'ACCEPTED'; evidence: OptimizationFeedbackEvidence; profile: OptimizationFeedbackProfile }
  | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence; profile: OptimizationFeedbackProfile | null }
  | { kind: 'DEFERRED'; reasonCode: FeedbackEligibilityReasonCode };
```

- [ ] **Step 1: Write RED materialization tests**

Cover:
- Standard project is rejected before loading feedback authority context;
- Advanced/Enterprise proceed;
- exact terminal observation becomes one evidence row and one profile snapshot;
- earlier conclusive window does not materialize;
- earliest eligible terminal observation wins deterministically;
- inconclusive/insufficient/contaminated terminal candidates create no evidence/profile;
- broken P8 execution/verification/proposal provenance creates no evidence/profile;
- CONFIGURED_MARKET and UNCONFIGURED_LEGACY produce separate scope keys;
- second accepted experiment in same scope creates a new immutable profile while preserving old profile;
- repeated materialization returns existing evidence/profile and does not emit create-only events;
- service makes no Search/Visibility/AI/Git/provider calls.

- [ ] **Step 2: Implement bounded observability first**

Event union exactly:

```text
optimization.feedback.accepted
optimization.feedback.deferred
optimization.feedback.profile.created
optimization.feedback.reconciled
```

Allow only:

```text
projectId
experimentId
observationId
feedbackEvidenceId
feedbackProfileId
recommendedActionType
marketCode
locale
sampleCount
historicalRankAdjustment
reasonCode
```

Rebuild a fresh allowlisted event object; never spread arbitrary input. Strip CR/LF/tab and truncate strings to 160 chars. `accepted` emits only for CREATED evidence; `profile.created` only for CREATED profile.

- [ ] **Step 3: Implement service flow**

Exact order:
1. `projectRepository.findById(projectId)` and `hasFeature(planLevel, 'OPTIMIZATION_FEEDBACK')`; Standard/missing project returns DEFERRED before feedback authority/context reads.
2. Load exact experiment context and any already-accepted evidence.
3. Validate market mode; `INVALID_PROVENANCE` or unsupported scope returns `FEEDBACK_SCOPE_INVALID`.
4. Validate exact P8 frozen authority/provenance.
5. Run pure terminal selector.
6. Build scope/evidence identities and immutable evidence input.
7. Persist evidence with CREATED/EXISTING outcome.
8. Load exact-scope accepted evidence, calculate rolling-20 profile, build profile identity.
9. Persist immutable profile with CREATED/EXISTING outcome.
10. Emit bounded events only after durable persistence.

If evidence is EXISTING, do not switch the accepted observation even if a later observation looks better.

- [ ] **Step 4: Run focused suite and commit**

```bash
npx vitest run \
  tests/unit/feedback.observability.test.ts \
  tests/unit/feedback.eligibility.test.ts \
  tests/unit/feedback.profile.test.ts \
  tests/integration/feedback.materialization.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.service.ts src/modules/optimization-feedback/feedback.observability.ts tests/unit/feedback.observability.test.ts tests/integration/feedback.materialization.test.ts
git commit -m "feat: materialize P9-E feedback profiles"
```

Expected GREEN.

---

### Task 29: Queue, worker, 90-day reconciliation, and best-effort P9-D handoff

**Files:**
- Create: `src/modules/optimization-feedback/feedback.queue.ts`
- Create: `src/modules/optimization-feedback/feedback.worker.ts`
- Modify: `src/modules/optimization-experiments/experiment.worker.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Create: `tests/unit/feedback.queue.test.ts`
- Create: `tests/unit/feedback.worker.test.ts`
- Modify: `tests/unit/experiment.worker.test.ts`
- Modify: `tests/unit/queues.test.ts`
- Modify: `tests/unit/worker-bootstrap.test.ts`

**Queue contract:**

```ts
export const OPTIMIZATION_FEEDBACK_QUEUE_NAME = 'optimization-feedback-materialization' as const;
export const OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS = 2;

export type OptimizationFeedbackJobData =
  | { kind: 'MATERIALIZE_OBSERVATION'; projectId: string; experimentId: string; observationId: string }
  | { kind: 'RECONCILE_DAILY' };
```

- [ ] **Step 1: Write RED queue/worker tests**

Queue tests assert:
- materialize job name `materialize-observation`;
- deterministic SHA-256 job id over exact project/experiment/observation/evidence-version input;
- attempts=2, exponential backoff 5s, removeOnComplete=true, bounded removeOnFail;
- reconciliation payload contains no date/content/provider data.

Worker tests assert:
- materialize job calls service once using durable ids;
- daily reconcile calculates `createdAtGte = now - 90 days`;
- gets enabled projects in stable order;
- requests limit=100 for each project;
- enqueues each candidate observation, not direct materialization in reconciliation path;
- emits bounded reconciled count only after enqueue loop;
- no external services exist in worker deps.

- [ ] **Step 2: Add P9-D post-persistence handoff RED tests**

Extend `OptimizationExperimentWorkerDeps` with optional:

```ts
feedbackHandoff?: {
  onObservationPersisted(input: {
    projectId: string;
    experimentId: string;
    observationId: string;
  }): Promise<void>;
};
```

Test EVALUATE_WINDOW behavior:
- if `evaluateWindow()` returns null, no handoff;
- if it returns persisted observation, call handoff after evaluation resolves;
- if handoff rejects, `processOptimizationExperimentJob()` still resolves successfully so a feedback queue outage cannot reclassify P9-D evaluation as failed;
- existing P9-D start/reconcile behavior remains unchanged.

- [ ] **Step 3: Implement feedback queue and worker**

Worker constants:

```ts
export const OPTIMIZATION_FEEDBACK_RECONCILE_DAYS = 90;
export const OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT = 100;
```

Use repository only to enumerate enabled projects/recent durable ids. Call `OptimizationFeedbackService.materializeObservation()` for MATERIALIZE jobs.

- [ ] **Step 4: Wire registry/bootstrap**

Insert `optimization-feedback-materialization` immediately after `optimization-experiment-evaluation` in `QUEUE_NAMES`.

In worker bootstrap add:

```ts
export const OPTIMIZATION_FEEDBACK_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-feedback-daily-reconcile',
  repeat: { every: OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS },
  job: { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' as const } }
} as const;
```

Create one support queue and one `OptimizationFeedbackQueue`. Inject a handoff into the P9-D experiment worker:

```ts
const experimentFeedbackHandoff = {
  onObservationPersisted: ({ projectId, experimentId, observationId }) =>
    optimizationFeedbackQueue.enqueueObservation(projectId, experimentId, observationId)
};
```

Do not couple Feedback into `OptimizationExperimentService`; the worker boundary keeps durable observation persistence authoritative.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run \
  tests/unit/feedback.queue.test.ts \
  tests/unit/feedback.worker.test.ts \
  tests/unit/experiment.worker.test.ts \
  tests/unit/queues.test.ts \
  tests/unit/worker-bootstrap.test.ts
npm run typecheck
git add src/modules/optimization-feedback src/modules/optimization-experiments/experiment.worker.ts src/queue tests/unit
git commit -m "feat: wire P9-E feedback processing"
```

Expected GREEN.

---

### Task 30: P9-A V2 feedback-aware deterministic and AI ranking, with V1 unchanged

**Files:**
- Modify: `src/modules/optimization/optimization.types.ts`
- Modify: `src/modules/optimization/optimization.ranking.ts`
- Modify: `src/modules/optimization/optimization.service.ts`
- Modify: `src/modules/ai/optimization-plan-ranking.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Create: `tests/unit/optimization.feedback-ranking.test.ts`
- Create: `tests/integration/optimization.feedback-v2.test.ts`
- Modify: `tests/integration/optimization.ai-ranking.test.ts`

**Version contract:**

Keep:

```ts
export const OPTIMIZATION_PLAN_VERSION = 'OPTIMIZATION_PLAN_V1' as const;
```

Add:

```ts
export const OPTIMIZATION_PLAN_V2 = 'OPTIMIZATION_PLAN_V2' as const;
export type OptimizationPlanVersion =
  | typeof OPTIMIZATION_PLAN_VERSION
  | typeof OPTIMIZATION_PLAN_V2;
```

Default materialization stays V1:

```ts
export type MaterializeOptimizationOptions = {
  advisoryRootDir: string;
  useAi?: boolean;
  planVersion?: OptimizationPlanVersion;
};
```

- [ ] **Step 1: Write RED feedback-aware ranking tests**

Add a new helper rather than changing existing `applyBoundedRankAdjustments()`:

```ts
export function applyFeedbackAwareRankAdjustments(
  ranked: readonly BoundedRankSeed[],
  aiAdjustments: readonly { candidateId: string; adjustment: number }[],
  historicalAdjustments: readonly { candidateId: string; adjustment: number }[]
): FeedbackAwareRankResult[];
```

Tests prove:
- current `applyBoundedRankAdjustments` still accepts only AI [-2,+2] and still enforces its existing ±2 displacement behavior;
- historical inputs must be integer [-10,+10];
- composed signal = deterministic + valid AI + historical;
- tie order = signal, deterministicRank, candidateKey;
- if composed final displacement <=10, historical values are preserved;
- if any displacement >10, all historical values become 0, valid AI adjustments remain, and ranks are recomputed from deterministic+AI;
- fallback marks `historicalFallback=true` for the materialization;
- unknown/duplicate candidate IDs fail closed.

Run:

```bash
npx vitest run tests/unit/optimization.ranking.test.ts tests/unit/optimization.feedback-ranking.test.ts
```

Expected RED only for missing V2 helper.

- [ ] **Step 2: Add V2 profile read adapter to planner**

Inject a narrow read port into `OptimizationService`:

```ts
export type OptimizationFeedbackProfileReadPort = {
  findLatestProfileForScope(input: {
    projectId: string;
    marketScopeMode: string;
    marketCode: string | null;
    locale: string | null;
    recommendedActionType: RecommendedActionType;
  }): Promise<OptimizationFeedbackProfile | null>;
};
```

For V1:
- never call this port;
- `historicalRankAdjustment=0`;
- existing explanation shape and AI task V1 identity stay unchanged.

For V2:
- read one exact-scope latest profile per ranked candidate/action;
- freeze bounded provenance:

```text
feedbackProfileId
feedbackProfileVersion
feedbackInputFingerprint
feedbackSampleCount
historicalRankAdjustment
historicalFallback
```

- if no compatible profile: historical=0 and null profile provenance;
- use feedback-aware rank helper across the whole materialization before persisting deterministic V2 plans.

- [ ] **Step 3: Freeze feedback inside V2 AI task facts**

Extend `OptimizationPlanRankingSeed` with:

```ts
feedback: {
  profileId: string;
  profileVersion: string;
  inputFingerprint: string;
  sampleCount: number;
  historicalRankAdjustment: number;
} | null;
```

Change builder signature:

```ts
buildOptimizationPlanRankingTaskInput(
  projectId,
  seeds,
  options?: { planVersion?: OptimizationPlanVersion }
)
```

Rules:
- omitted/V1 option returns the exact current `OPTIMIZATION_PLAN_RANKING_FACTS_V1` shape and request-key behavior;
- V2 uses strict `OPTIMIZATION_PLAN_RANKING_FACTS_V2`, includes `planVersion:'OPTIMIZATION_PLAN_V2'` and frozen feedback per candidate;
- AI output schema stays unchanged: candidateId, integer adjustment [-2,+2], explanation, supplied source refs only;
- V2 materialization must use the frozen task feedback. It must not query a newer profile when the async AI job completes.

Prevent double-counting by keeping feedback out of the text shown to DeepSeek. Export a prompt projection helper that strips each V2 candidate's `feedback` object before `prompt.buildUserMessage(...)`. `ai.worker.ts` uses this projection only for `OPTIMIZATION_PLAN_RANKING`; task persistence/requestHash still includes the full frozen V2 fact snapshot so the durable request identity remains feedback-bound.

- [ ] **Step 4: Implement AI success and failure contracts**

AI success V2:
1. parse V2 frozen facts;
2. validate AI output exactly as V1;
3. call feedback-aware ranking with AI output + frozen historical values;
4. create immutable `OPTIMIZATION_PLAN_V2` rows;
5. explanation records AI adjustment plus frozen feedback provenance/fallback.

AI failure V2:
1. AI run/task is durably FAILED under existing worker semantics;
2. call V2 fallback materializer;
3. set AI adjustment to 0;
4. retain frozen historical adjustments subject to the <=10 displacement guard;
5. create no P8 artifacts and do not read a newer feedback profile.

V1 success/failure functions must remain behaviorally identical: historical=0, planVersion V1, existing fact schema/request identity.

- [ ] **Step 5: Write integration tests**

`optimization.feedback-v2.test.ts` covers deterministic V2:
- V1 default never queries feedback and persists historical=0;
- V2 exact market/action reads matching profile and freezes it;
- different market/action profile is ignored;
- no profile => 0;
- V1 row stays unchanged after V2 plan creation;
- displacement fallback zeros all historical but not deterministic authority.

Extend `optimization.ai-ranking.test.ts`:
- V1 requestKey/fact shape snapshot remains current;
- V2 task has strict V2 facts and frozen feedback;
- DeepSeek prompt projection does not contain `historicalRankAdjustment`, profile id/fingerprint, or feedback object;
- AI output still cannot exceed ±2 or edit feedback;
- V2 success uses frozen historical values;
- V2 provider/validation failure fallback retains frozen historical values with AI=0;
- newer profile created after task enqueue cannot affect V2 completion.

- [ ] **Step 6: Run full planner/AI regression and commit**

```bash
npx vitest run \
  tests/unit/optimization.ranking.test.ts \
  tests/unit/optimization.feedback-ranking.test.ts \
  tests/integration/optimization.service.test.ts \
  tests/integration/optimization.ai-ranking.test.ts \
  tests/integration/optimization.feedback-v2.test.ts
npm run typecheck
git add src/modules/optimization src/modules/ai tests/unit/optimization.feedback-ranking.test.ts tests/integration/optimization.ai-ranking.test.ts tests/integration/optimization.feedback-v2.test.ts
git commit -m "feat: add feedback-aware P9-A V2 ranking"
```

Expected GREEN with V1 regression assertions intact.

---

### Task 31: Persisted-read API, tenancy, and feature-gate behavior

**Files:**
- Create: `src/modules/optimization-feedback/feedback.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/feedback.routes.test.ts`

**Exact public routes:**

```text
GET /api/projects/:projectId/optimization-feedback/profiles
GET /api/projects/:projectId/optimization-feedback/profiles/:profileId
GET /api/projects/:projectId/optimization-feedback/evidence
```

No POST route exists in V1.

- [ ] **Step 1: Write RED route tests**

Use an injected API port and Supertest. Assert:
- Standard project gets 403 before API-port method call;
- Advanced and Enterprise can list profiles/evidence;
- pagination defaults limit=50 offset=0;
- limit 1..100, offset 0..100000; invalid values return validation error;
- profile lookup uses both projectId and profileId; foreign-project profile returns 404 without leaking its payload;
- responses expose bounded feedback/profile fields only and no Search/Visibility raw metrics, article content, prompt/answer, provider payload, credentials, P8 mutation state, or reasoning;
- no GET invokes queue/service/AI/provider/Git dependencies because none are present on the route port.

Run:

```bash
npx vitest run tests/integration/feedback.routes.test.ts
```

Expected RED: route module/app injection missing.

- [ ] **Step 2: Implement route port and default persisted-read adapter**

```ts
export interface OptimizationFeedbackApiPort {
  listProfiles(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getProfile(projectId: string, profileId: string): Promise<unknown | null>;
  listEvidence(projectId: string, limit: number, offset: number): Promise<unknown[]>;
}
```

Every route order:
1. validate UUID project id;
2. `requireFeature('OPTIMIZATION_FEEDBACK')`;
3. validate remaining params/query;
4. call project-scoped read port.

Default Prisma selects only feedback audit fields and bounded source IDs. Do not include raw observation metric JSON.

In `AppOptions` add `optimizationFeedbackApi?: OptimizationFeedbackApiPort`. Mount:

```ts
app.use('/api', createOptimizationFeedbackRoutes(options.optimizationFeedbackApi));
```

Do not mount under `/api/v1`; the approved P9-E route contract is `/api/projects/...`.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run tests/integration/feedback.routes.test.ts tests/unit/feedback.feature-gate.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.routes.ts src/app.ts tests/integration/feedback.routes.test.ts
git commit -m "feat: expose read-only P9-E feedback API"
```

Expected GREEN.

---

### Task 32: Authority hardening, end-to-end persisted chain, documentation, and release gate

**Files:**
- Create: `tests/integration/feedback.authority.test.ts`
- Extend where required: `tests/integration/feedback.materialization.test.ts`
- Create: `docs/development/p9-e-feedback-learning.md`

- [ ] **Step 1: Add static forbidden-authority test**

Following `experiment.authority.test.ts`, recursively scan `src/modules/optimization-feedback` and fail if production files contain imports/references that create direct authority over:
- DeepSeek/AiGateway/provider adapters;
- GitHub/Git mutation adapters;
- publication execution/mutation/rollback services;
- Search/Visibility sampling/enqueue APIs;
- Prisma `.update`, `.updateMany`, `.delete`, `.deleteMany` on non-feedback facts;
- direct writes to `optimizationPlan`, `optimizationExperiment`, `optimizationExperimentObservation`, publication execution/verification, Growth, Search Facts, or Visibility tables.

Allow feedback repository creates and persisted reads only.

Also assert public route source contains no `.post(`, `.put(`, `.patch(`, or `.delete(` registration.

- [ ] **Step 2: Add real persisted authority-chain integration**

Inside transaction rollback seed:
- Advanced project;
- P7-derived candidate and immutable `OPTIMIZATION_PLAN_V1`;
- exact P8 proposal with `sourceType=P9_OPTIMIZATION_PLAN` and sourceReferenceId exact plan id;
- VERIFIED execution and exact VERIFIED verification;
- P9-D experiment with frozen terminal schedule;
- earlier terminal observation that is INCONCLUSIVE or contaminated;
- later terminal observation that is SUFFICIENT+CLEAR+conclusive.

Run P9-E materialization and assert:
- later eligible terminal observation is accepted only because earlier candidate is ineligible, not because outcome is preferred;
- exactly one evidence row for the experiment;
- exact scope/profile counts and adjustment;
- retry stays one evidence/profile identity;
- all P7/P8/P9-A/P9-D source rows unchanged before/after.

Add a second project/market fixture and prove its evidence cannot enter the first project's profile.

- [ ] **Step 3: Prove queue handoff does not reverse P9-D**

Integration or worker-level final assertion:
- P9-D observation persists successfully;
- injected P9-E enqueue throws;
- experiment job still resolves;
- observation remains persisted;
- subsequent P9-E reconciliation can discover and enqueue the missing feedback candidate.

- [ ] **Step 4: Write operational documentation**

`docs/development/p9-e-feedback-learning.md` must document:
- authority chain P9-D -> P9-E -> future/new P9-A V2 only;
- one-experiment-one-sample rule;
- terminal observation deterministic selection;
- exact eligibility/defer codes;
- project/market/locale/action isolation;
- rolling 20 and minimum 3 samples;
- exact shrinkage formula and [-10,+10] bound;
- V1 planner immutability and V2 opt-in behavior;
- AI ±2 boundary and feedback-hidden AI prompt projection;
- V2 <=10 displacement fallback preserving valid AI;
- immutable persistence/idempotency;
- queue attempts=2, best-effort P9-D handoff, 90-day/100-per-project reconciliation;
- GET-only API and Standard denial/cross-project hiding;
- observability allowlist;
- rollout/rollback: application rollback never deletes/rewrites feedback history; DB rollback requires a separately reviewed forward migration;
- no provider/DeepSeek/Git/deploy/rollback side effects.

- [ ] **Step 5: Run focused P9-E regression**

```bash
npx vitest run \
  tests/unit/feedback.feature-gate.test.ts \
  tests/unit/feedback.identity.test.ts \
  tests/unit/feedback.eligibility.test.ts \
  tests/unit/feedback.profile.test.ts \
  tests/unit/feedback.observability.test.ts \
  tests/unit/feedback.queue.test.ts \
  tests/unit/feedback.worker.test.ts \
  tests/unit/optimization.feedback-ranking.test.ts \
  tests/unit/experiment.worker.test.ts \
  tests/unit/queues.test.ts \
  tests/unit/worker-bootstrap.test.ts \
  tests/integration/feedback.persistence.test.ts \
  tests/integration/feedback.materialization.test.ts \
  tests/integration/feedback.routes.test.ts \
  tests/integration/feedback.authority.test.ts \
  tests/integration/optimization.feedback-v2.test.ts \
  tests/integration/optimization.ai-ranking.test.ts
```

Expected: all focused tests GREEN.

- [ ] **Step 6: Run local release verification**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

All commands must succeed before implementation is called complete. Expected negative-test database error logs are acceptable only when the test itself passes and asserts the fail-closed behavior.

- [ ] **Step 7: Commit documentation/final hardening**

```bash
git add tests/integration/feedback.authority.test.ts tests/integration/feedback.materialization.test.ts docs/development/p9-e-feedback-learning.md
git commit -m "docs: complete P9-E feedback learning release guidance"
```

- [ ] **Step 8: Open/update P9-E Draft PR and require exact-head CI**

Create a separate Draft PR for `feat/p9-e-feedback-learning`. Do not retarget or modify PR #158.

The exact P9-E PR head must pass GitHub Actions:

```text
verify = success
e2e = success
production-audit = success
```

Within `verify`, require:

```text
Prisma validate = success
Prisma generate = success
Prisma migrate deploy = success
Typecheck = success
Full Vitest = success
Build = success
```

Do not mark the P9-E PR Ready, merge it, or deploy it without later separate authorization.

---

## Release Rejection Conditions

Reject P9-E completion if the final diff introduces any of the following:

- any mutation of existing P9-D experiment/observation rows;
- any mutation of existing `OPTIMIZATION_PLAN_V1` rows;
- any non-zero V1 `historicalRankAdjustment`;
- any P7 score/formula/evidence/lifecycle mutation;
- any P8 risk/approval/execution/verification/rollback mutation;
- any P9-C autopilot policy/kill-switch/quota mutation;
- feedback from non-terminal experiment windows;
- more than one feedback sample per experiment;
- conversion of INCONCLUSIVE/UNKNOWN/insufficient/contaminated/missing facts into zero or negative samples;
- cross-project or configured-market profile pooling;
- runtime DeepSeek/provider/Search/Visibility/Git/deployment calls from `optimization-feedback`;
- AI output authority over historical feedback;
- V2 AI completion reading a newer profile than the one frozen at task creation;
- historical ranking displacement over 10 without deterministic historical-zero fallback;
- public feedback POST/PUT/PATCH/DELETE routes;
- unbounded reconciliation/history scan;
- observability containing raw metrics, article/prompt/answer/provider payloads, credentials, or reasoning;
- weakened CI/release gates;
- merge/deployment activity without separate authorization.

## Completion Definition

P9-E implementation is complete only when Tasks 24-32 are checked off, the separate P9-E Draft PR exact head passes all three CI jobs, final diff authority review is clean, and `docs/development/p9-e-feedback-learning.md` matches the shipped contracts. Completion does not authorize Ready-for-review, merge, or deployment.