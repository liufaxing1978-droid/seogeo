# P9-E Feedback Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded, deterministic P9-E feedback-learning layer that accepts at most one qualified terminal P9-D observation per experiment, materializes immutable rolling feedback profiles, and lets only new P9-A V2 plans freeze a small historical ranking adjustment without changing P7, P8, P9-D, or controlled-autopilot authority.

**Architecture:** Add one isolated `optimization-feedback` module with immutable evidence/profile persistence, deterministic scope/evidence/profile identities, terminal-observation eligibility, rolling-20 aggregation, scope-serialized profile materialization, one BullMQ queue with 90-day reconciliation, bounded observability, and persisted-read project APIs. P9-D hands persisted observations to P9-E only after durable observation persistence and treats queue delivery as best-effort. P9-A V1 remains behaviorally unchanged; P9-A V2 is explicit opt-in and freezes the exact feedback profile into deterministic or AI-backed new plans. AI remains limited to its existing ±2 advisory adjustment and cannot create, change, see, or reinterpret the historical feedback signal used by the V2 rank compositor.

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
- `INCONCLUSIVE`, `PARTIAL`, `INSUFFICIENT`, `UNKNOWN`, contamination, missing baseline, unsupported evaluator, missing/inconsistent P8 authority, or ambiguous scope produce no sample. They are never zero/negative samples.
- Feedback scope is exact `(projectId, marketScopeMode, marketCode, locale, recommendedActionType)`. No project or configured-market pooling.
- P9-E V1 rolling window is exactly 20 accepted experiments per scope. Fewer than 3 samples produces historical adjustment 0.
- Current feedback profile is resolved from the exact current deterministic last-20 evidence identity; SHA-256 lexical order is never treated as recency.
- Historical adjustment is deterministic, integer, clamped to `[-10,+10]`.
- Existing `OPTIMIZATION_PLAN_V1` rows and V1 planner behavior remain unchanged; they continue to freeze `historicalRankAdjustment = 0`.
- `OPTIMIZATION_PLAN_V2` is explicit opt-in. It may freeze a compatible latest feedback profile into a new immutable plan only.
- Existing AI adjustment authority remains integer `[-2,+2]`; AI output cannot edit feedback. V2 hides feedback fields from the DeepSeek prompt projection to prevent double-counting.
- V2 final ordering displacement from deterministic rank is bounded to 10. If historical feedback causes any candidate to exceed the bound, zero all historical adjustments for that materialization while preserving already-valid AI adjustments.
- P9-E owns exactly one queue: `optimization-feedback-materialization`, with attempts=2.
- Daily reconciliation scans only the previous 90 days, enqueues at most 100 terminal candidate observations per project per run, and provides no unlimited/public historical backfill.
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

**Shared P9-E constants/types:**

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

`tests/unit/feedback.feature-gate.test.ts`:

```ts
expect(hasFeature('STANDARD', 'OPTIMIZATION_FEEDBACK')).toBe(false);
expect(hasFeature('ADVANCED', 'OPTIMIZATION_FEEDBACK')).toBe(true);
expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_FEEDBACK')).toBe(true);
```

`tests/unit/feedback.identity.test.ts` proves:
- scope identity is stable under object-key ordering;
- `null` market/locale is explicit and distinct from configured scope;
- different project, market, locale, or action changes `scopeKey`;
- evidence key changes when observation changes;
- the same already-deterministically-ordered evidence-id sequence produces the same fingerprint/profile key;
- changing the ordered evidence-id sequence changes the fingerprint, so profile identity binds the exact frozen order rather than silently resorting IDs.

Run:

```bash
npx vitest run tests/unit/feedback.feature-gate.test.ts tests/unit/feedback.identity.test.ts
```

Expected RED: missing `OPTIMIZATION_FEEDBACK` and feedback identity module only.

- [ ] **Step 2: Add exact Prisma models and additive migration**

Create `prisma/models/optimization-feedback.prisma`:

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

Add Prisma reverse arrays:

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

Create migration `20260825010000_add_p9e_feedback_learning/migration.sql` with the enum/tables/indexes/FKs plus:

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

`feedback.identity.ts` exports:

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

Hash exactly:
- scope: feedbackScopeVersion + project + market mode + market + locale + action;
- evidence: feedbackEvidenceVersion + project + experiment + observation + scopeKey;
- inputFingerprint: feedbackProfileVersion + scopeKey + caller-supplied deterministic evidence-id order;
- profileKey: feedbackProfileVersion + projectId + scopeKey + inputFingerprint.

Canonical JSON sorts object keys and preserves explicit nulls. `buildFeedbackProfileIdentity` must not independently sort evidence IDs; `calculateFeedbackProfile` owns chronological ordering.

- [ ] **Step 4: Add feature matrix and verify**

Add `'OPTIMIZATION_FEEDBACK'` to `Feature` and `advancedFeatures`; Enterprise inherits it, Standard does not.

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

**Stable reason-code contract:**

```ts
export type FeedbackEligibilityReasonCode =
  | 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
  | 'FEEDBACK_EFFECT_INCONCLUSIVE'
  | 'FEEDBACK_COVERAGE_INSUFFICIENT'
  | 'FEEDBACK_CONTAMINATED'
  | 'FEEDBACK_P8_AUTHORITY_MISSING'
  | 'FEEDBACK_SCOPE_INVALID'
  | 'FEEDBACK_EVALUATOR_UNSUPPORTED'
  | 'FEEDBACK_ALREADY_ACCEPTED'
  | 'FEEDBACK_FEATURE_DISABLED';
```

`FEEDBACK_FEATURE_DISABLED` is emitted by the service gate; the pure selector uses the other codes.

**Selector interface:**

```ts
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

- [ ] **Step 1: Write RED selector tests**

Cover exactly:
1. 7/14/28 schedule only permits 28D.
2. 14/28/56 schedule only permits 56D.
3. `dueAt` equals `verifiedAnchorAt + windowDays` exactly.
4. Earlier window POSITIVE never contributes.
5. Terminal candidates order by `inputCutoffAt ASC`, then id ASC.
6. Earliest terminal INCONCLUSIVE may be skipped and a later fully eligible terminal candidate may qualify.
7. Earliest contaminated terminal candidate may be skipped and a later fully eligible terminal candidate may qualify.
8. Existing accepted evidence always returns `FEEDBACK_ALREADY_ACCEPTED`.
9. PARTIAL/INSUFFICIENT/UNKNOWN never contribute.
10. Any contamination other than CLEAR never contributes.
11. Only `OPTIMIZATION_EXPERIMENT_EVALUATOR_V1` is supported in P9-E V1.
12. Missing/inconsistent P8 authority returns `FEEDBACK_P8_AUTHORITY_MISSING`.
13. Invalid scope returns `FEEDBACK_SCOPE_INVALID`.
14. Malformed/empty schedule or no exact terminal candidate returns `FEEDBACK_TERMINAL_OBSERVATION_PENDING`.
15. If terminal candidates exist but none qualify, return the first candidate's deterministic rejection reason after scanning all candidates; per-candidate rejection precedence is evaluator -> effect -> coverage -> contamination.

Run:

```bash
npx vitest run tests/unit/feedback.eligibility.test.ts
```

Expected RED: module missing.

- [ ] **Step 2: Implement deterministic selector**

Use fixed day map `{7D:7,14D:14,28D:28,56D:56}`. Parse the frozen schedule; require known type, matching day count, no duplicates, non-empty list. The terminal item is the last frozen item. Do not call `scheduleForIntervention()` to reconstruct history.

Selector algorithm:
1. acceptedExperimentId -> ALREADY_ACCEPTED;
2. invalid P8 -> P8_AUTHORITY_MISSING;
3. invalid scope -> SCOPE_INVALID;
4. derive exact terminal window/dueAt from frozen schedule;
5. filter exact matching terminal observations;
6. sort cutoff/id;
7. evaluate each candidate with the fixed rejection precedence;
8. accept the first fully eligible candidate;
9. if none qualifies, return the rejection reason captured from the first sorted candidate.

Effect mapping:

```ts
export function feedbackValueForEffect(effect: FeedbackEffect): -1 | 0 | 1 {
  if (effect === 'POSITIVE') return 1;
  if (effect === 'NEUTRAL') return 0;
  return -1;
}
```

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run tests/unit/feedback.eligibility.test.ts tests/unit/feedback.identity.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.eligibility.ts tests/unit/feedback.eligibility.test.ts
git commit -m "feat: add deterministic P9-E feedback eligibility"
```

Expected GREEN.

---

### Task 26: Repository persistence, exact authority reads, concurrency serialization, and DB immutability

**Files:**
- Create: `src/modules/optimization-feedback/feedback.repository.ts`
- Create: `tests/integration/feedback.persistence.test.ts`

**Exact input types:**

```ts
export type CreateFeedbackEvidenceInput = {
  projectId: string;
  experimentId: string;
  observationId: string;
  optimizationPlanId: string;
  candidateId: string;
  feedbackEvidenceVersion: string;
  evidenceKey: string;
  scopeKey: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  recommendedActionType: RecommendedActionType;
  effectState: OptimizationFeedbackEffect;
  feedbackValue: number;
  terminalWindowType: string;
  terminalWindowDays: number;
  inputCutoffAt: Date;
  sourceEvaluatorVersion: string;
  sourceObservationKey: string;
};

export type CreateFeedbackProfileInput = {
  projectId: string;
  feedbackProfileVersion: string;
  profileKey: string;
  scopeKey: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  recommendedActionType: RecommendedActionType;
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  windowLimit: number;
  oldestEvidenceCutoffAt: Date;
  newestEvidenceCutoffAt: Date;
  inputEvidenceIdsJson: Prisma.InputJsonValue;
  inputFingerprint: string;
};

export type CreateOrGetFeedbackEvidenceResult =
  | { kind: 'CREATED'; evidence: OptimizationFeedbackEvidence }
  | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence };

export type CreateOrGetFeedbackProfileResult =
  | { kind: 'CREATED'; profile: OptimizationFeedbackProfile }
  | { kind: 'EXISTING'; profile: OptimizationFeedbackProfile };
```

**Repository API:**

```ts
export class OptimizationFeedbackRepository {
  loadExperimentFeedbackContext(input: { projectId: string; experimentId: string }): Promise<FeedbackMaterializationContext | null>;
  findEvidenceForExperiment(experimentId: string): Promise<OptimizationFeedbackEvidence | null>;
  createOrGetEvidence(input: CreateFeedbackEvidenceInput): Promise<CreateOrGetFeedbackEvidenceResult>;
  listEvidenceForScope(input: { projectId: string; scopeKey: string }): Promise<OptimizationFeedbackEvidence[]>;
  createOrGetProfile(input: CreateFeedbackProfileInput): Promise<CreateOrGetFeedbackProfileResult>;
  findLatestProfileForScope(input: FeedbackScopeLookup): Promise<OptimizationFeedbackProfile | null>;
  listRecentTerminalCandidates(input: { projectId: string; createdAtGte: Date; limit: number }): Promise<readonly FeedbackReconcileCandidate[]>;
  listFeedbackEnabledProjectIds(): Promise<readonly string[]>;
  withScopeLock<T>(scopeKey: string, run: (repository: OptimizationFeedbackRepository) => Promise<T>): Promise<T>;
}
```

`FeedbackMaterializationContext` selects only:
- exact experiment + observations ordered cutoff/id;
- optimization plan + candidate market scope/action;
- frozen execution id/status/project;
- frozen verification id/status/execution/project;
- execution's publication proposal provenance requiring `P9_OPTIMIZATION_PLAN` and exact OptimizationPlan id.

Do not select Search/Visibility raw metrics or content bodies.

- [ ] **Step 1: Write real-Prisma RED persistence tests**

Using transaction rollback fixtures, assert:
- evidence insert persists exact source IDs/value/scope;
- retry returns EXISTING without duplicate row;
- conflicting immutable payload fails `FEEDBACK_EVIDENCE_IDENTITY_COLLISION`;
- second observation for same experiment cannot become a second evidence row;
- profile retry is idempotent; conflict fails `FEEDBACK_PROFILE_IDENTITY_COLLISION`;
- current-profile lookup derives the exact current fingerprint from persisted scope evidence rather than profile-row ordering;
- invalid scope, no evidence, or a missing exact current profile snapshot fails closed;
- update/delete on both feedback tables are rejected by DB triggers;
- OptimizationPlan, experiment, observation, P8 execution/verification source rows remain unchanged;
- two concurrent `withScopeLock` operations for one scope serialize rather than calculate overlapping profile snapshots concurrently.

Run:

```bash
npx vitest run tests/integration/feedback.persistence.test.ts
```

Expected RED: repository missing.

- [ ] **Step 2: Implement collision-safe repository**

Create-or-get sequence:
1. exact identity lookup;
2. compare every immutable scalar/date/JSON field;
3. create;
4. on P2002, re-read exact identity;
5. return EXISTING only on full match;
6. otherwise throw the exact collision error.

No update/delete methods.

`findLatestProfileForScope()` does not infer “latest” from profile-row ordering or SHA lexical order. It:

1. validates exact scope:
   - `CONFIGURED_MARKET` requires non-null `marketCode` and nonblank `locale`;
   - `UNCONFIGURED_LEGACY` requires `marketCode = null` and `locale = null`;
   - any other/ambiguous scope returns `null`;
2. derives the exact `scopeKey` from project + market mode + market + locale + action;
3. reads accepted evidence for `{ projectId, scopeKey }` ordered by:
   - `inputCutoffAt DESC`;
   - `observationId DESC`;
4. takes exactly `OPTIMIZATION_FEEDBACK_WINDOW_LIMIT` rows (20 in V1);
5. returns `null` when there is no evidence;
6. reverses the selected evidence IDs back to the canonical chronological ASC order used by profile creation;
7. recomputes the exact current `inputFingerprint` with `buildFeedbackProfileIdentity`;
8. reads the immutable profile by exact:
   - `projectId`;
   - `feedbackProfileVersion`;
   - `scopeKey`;
   - `inputFingerprint`;
9. returns `null` if the exact current immutable profile snapshot is missing.

Never use `inputFingerprint DESC` as a recency proxy. SHA-256 lexical order has no temporal meaning, and this exact-identity lookup remains correct when the rolling window reaches 20 rows and multiple historical profiles share the same sample count/newest cutoff.

`withScopeLock()` uses one PostgreSQL transaction and a transaction-scoped advisory lock derived from the 64-char SHA-256 `scopeKey`. Use a deterministic 64-bit integer derived from the first 16 hex characters and `pg_advisory_xact_lock`; create the callback repository bound to that transaction. This lock protects only P9-E evidence/profile materialization for the same scope and performs no source mutation.

`listFeedbackEnabledProjectIds()` returns only Advanced/Enterprise ids sorted ASC.

`listRecentTerminalCandidates()` remains bounded:
- DB query filters project, observation `createdAt >= createdAtGte`, and experiments with no accepted evidence;
- order observation createdAt/id ASC;
- read at most 500 recent observation rows per project;
- include only experiment id/project/verifiedAnchorAt/frozen schedule and observation id/window/dueAt/cutoff needed to test terminal identity;
- filter exact terminal candidates in process using the frozen schedule contract;
- return at most caller `limit` (100 in worker).

- [ ] **Step 3: Verify and commit**

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

Assert:
- 1 or 2 samples => balance=0, adjustment=0;
- 3 positive => -4;
- 5 positive => -5;
- 10 positive => -7 under JavaScript `Math.round`;
- 20 positive => -8;
- symmetric negative history produces positive adjustment;
- equal positive/negative gives 0;
- neutral rows count toward sample/shrinkage but not numerator;
- >20 rows retains last 20 after `(inputCutoffAt ASC, observationId ASC)`;
- duplicate evidence id or observation id throws;
- output adjustment is integer within [-10,+10];
- returned orderedEvidenceIds are exactly the chronological rolling set consumed by `buildFeedbackProfileIdentity`.

- [ ] **Step 2: Implement exact formula**

```ts
const sampleCount = p + u + n;
if (sampleCount < 3) {
  rollingEffectBalance = 0;
  historicalRankAdjustment = 0;
} else {
  rollingEffectBalance = (p - n) / sampleCount;
  const shrinkage = sampleCount / (sampleCount + 5);
  const raw = -10 * rollingEffectBalance * shrinkage;
  historicalRankAdjustment = Math.max(-10, Math.min(10, Math.round(raw)));
}
```

No time decay, provider weighting, AI, confidence multiplier, or cross-scope pooling.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run tests/unit/feedback.profile.test.ts tests/unit/feedback.identity.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.profile.ts tests/unit/feedback.profile.test.ts
git commit -m "feat: add bounded P9-E feedback profiles"
```

Expected GREEN.

---

### Task 28: Feedback materialization service and bounded observability

**Files:**
- Create: `src/modules/optimization-feedback/feedback.service.ts`
- Create: `src/modules/optimization-feedback/feedback.observability.ts`
- Create: `tests/unit/feedback.observability.test.ts`
- Create: `tests/integration/feedback.materialization.test.ts`

**Service result:**

```ts
export type FeedbackMaterializationResult =
  | { kind: 'ACCEPTED'; evidence: OptimizationFeedbackEvidence; profile: OptimizationFeedbackProfile }
  | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence; profile: OptimizationFeedbackProfile }
  | { kind: 'DEFERRED'; reasonCode: FeedbackEligibilityReasonCode };
```

An existing evidence row must still ensure the corresponding current profile snapshot exists; a prior profile-write failure cannot leave feedback permanently unaggregated.

- [ ] **Step 1: Write RED materialization/observability tests**

Cover:
- Standard returns `FEEDBACK_FEATURE_DISABLED` before loading experiment/P8 context;
- Advanced/Enterprise proceed;
- exact terminal observation creates one evidence + one profile;
- earlier conclusive window does not contribute;
- earliest eligible terminal candidate wins;
- inconclusive/insufficient/contaminated candidates create no sample;
- missing/inconsistent P8 execution/verification/proposal provenance returns `FEEDBACK_P8_AUTHORITY_MISSING`;
- configured and legacy scopes remain separate;
- second experiment in same scope creates new immutable profile while preserving old profile;
- retry with existing evidence still creates a missing profile if the earlier attempt stopped after evidence persistence;
- repeated complete materialization emits no duplicate create events;
- concurrent same-scope materialization produces a final latest profile whose evidence set contains both accepted experiments, proving the scope lock closes the race;
- no Search/Visibility/AI/Git/provider calls are available in service deps.

- [ ] **Step 2: Implement observability**

Events:

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

Reconstruct a fresh allowlisted payload, strip CR/LF/tab, truncate strings to 160 chars. `accepted` only after CREATED evidence. `profile.created` only after CREATED profile. Existing rows are silent for create-specific events.

- [ ] **Step 3: Implement service flow**

Exact order:
1. `projectRepository.findById(projectId)`; missing/feature-disabled => `FEEDBACK_FEATURE_DISABLED` without restricted feedback context read;
2. load experiment context and existing accepted evidence;
3. derive exact candidate scope; INVALID_PROVENANCE/ambiguous => SCOPE_INVALID;
4. validate frozen P8 execution, exact verification, project, proposal type/source id;
5. run terminal selector;
6. build scope key and selected evidence input;
7. enter `repository.withScopeLock(scopeKey, ...)`;
8. re-read accepted evidence inside lock to close races; if none, create selected evidence;
9. list exact-scope accepted evidence, calculate rolling-20, build identity;
10. create-or-get immutable profile inside same lock;
11. emit create events only after transaction commits;
12. return ACCEPTED when evidence was newly created, otherwise EXISTING.

If evidence already exists, never switch to a later observation; recalculate/ensure profile from the already-frozen evidence set.

- [ ] **Step 4: Verify and commit**

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

### Task 29: Queue, worker, reconciliation, and best-effort P9-D handoff

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

Queue tests:
- name `materialize-observation`;
- job id is SHA-256 of canonical `{projectId,experimentId,observationId,feedbackEvidenceVersion}` with a fixed `optimization-feedback-` prefix;
- attempts=2, exponential 5s, removeOnComplete=true, bounded removeOnFail;
- reconciliation payload has no prompt/content/provider/date payload.

Worker tests:
- materialize job calls service once with durable ids;
- daily reconciliation computes cutoff exactly now-90 days;
- enabled project ids are processed stable ASC;
- repository receives limit=100 and returns at most 100 terminal candidates per project;
- reconciliation enqueues candidates instead of materializing inline;
- bounded reconciled event occurs after enqueue loop;
- worker deps expose no external provider/AI/Git service.

- [ ] **Step 2: Add P9-D handoff RED tests**

Extend `OptimizationExperimentWorkerDeps`:

```ts
feedbackHandoff?: {
  onObservationPersisted(input: {
    projectId: string;
    experimentId: string;
    observationId: string;
  }): Promise<void>;
};
```

Assert:
- evaluateWindow null => no handoff;
- returned persisted observation => handoff after evaluation resolves;
- handoff rejection is swallowed by the experiment worker so durable P9-D evaluation stays successful;
- existing start/reconcile behavior is unchanged.

- [ ] **Step 3: Implement feedback queue/worker**

```ts
export const OPTIMIZATION_FEEDBACK_RECONCILE_DAYS = 90;
export const OPTIMIZATION_FEEDBACK_PROJECT_RECONCILE_LIMIT = 100;
```

MATERIALIZE calls `OptimizationFeedbackService.materializeObservation`. RECONCILE enumerates only feedback-enabled projects, asks repository for terminal candidates in the finite cutoff, and enqueues each durable id.

- [ ] **Step 4: Wire queue registry and worker bootstrap**

Insert `optimization-feedback-materialization` immediately after `optimization-experiment-evaluation` in `QUEUE_NAMES`.

Add:

```ts
export const OPTIMIZATION_FEEDBACK_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-feedback-daily-reconcile',
  repeat: { every: OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS },
  job: { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' as const } }
} as const;
```

Create one support Queue and one `OptimizationFeedbackQueue`. Inject into the P9-D worker:

```ts
const experimentFeedbackHandoff = {
  onObservationPersisted: ({ projectId, experimentId, observationId }) =>
    optimizationFeedbackQueue.enqueueObservation(projectId, experimentId, observationId)
};
```

Do not put Feedback into `OptimizationExperimentService`.

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

### Task 30: P9-A V2 feedback-aware deterministic and AI ranking, V1 unchanged

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

Default remains V1:

```ts
export type MaterializeOptimizationOptions = {
  advisoryRootDir: string;
  useAi?: boolean;
  planVersion?: OptimizationPlanVersion;
};
```

- [ ] **Step 1: Write RED feedback-aware rank tests**

Do not change current `applyBoundedRankAdjustments()`. Add:

```ts
export type FeedbackAwareRankResult = {
  candidateId: string;
  deterministicRank: number;
  aiRankAdjustment: number;
  historicalRankAdjustment: number;
  finalRank: number;
  historicalFallback: boolean;
};

export function applyFeedbackAwareRankAdjustments(
  ranked: readonly BoundedRankSeed[],
  aiAdjustments: readonly { candidateId: string; adjustment: number }[],
  historicalAdjustments: readonly { candidateId: string; adjustment: number }[]
): FeedbackAwareRankResult[];
```

Tests prove:
- old helper remains AI-only [-2,+2] with old ±2 displacement fallback;
- historical input integer [-10,+10];
- signal = deterministic + valid AI + historical;
- tie = signal, deterministicRank, candidateKey;
- <=10 displacement keeps historical;
- >10 on any candidate recomputes with all historical=0 while preserving the valid AI result from the old helper;
- all rows mark historicalFallback consistently for a fallback materialization;
- duplicate/unknown ids fail closed.

- [ ] **Step 2: Add exact profile read port to OptimizationService**

```ts
export type OptimizationFeedbackProfileReadPort = {
  findLatestProfileForScope(input: {
    projectId: string;
    marketScopeMode: OptimizationMarketScopeMode;
    marketCode: MarketCode | null;
    locale: string | null;
    recommendedActionType: RecommendedActionType;
  }): Promise<OptimizationFeedbackProfile | null>;
};
```

V1:
- never invokes this port;
- historical=0;
- existing explanation and V1 AI fact/request identity unchanged.

V2:
- read exact compatible profile per candidate/action;
- freeze profile id/version/fingerprint/sample count/adjustment;
- no profile => null provenance + 0;
- run whole-set feedback-aware ranking before deterministic V2 plan persistence.

- [ ] **Step 3: Freeze feedback in V2 AI task facts but hide it from the prompt**

Extend ranking seed:

```ts
feedback: {
  profileId: string;
  profileVersion: string;
  inputFingerprint: string;
  sampleCount: number;
  historicalRankAdjustment: number;
} | null;
```

Builder:

```ts
buildOptimizationPlanRankingTaskInput(
  projectId: string,
  seeds: readonly OptimizationPlanRankingSeed[],
  options?: { planVersion?: OptimizationPlanVersion }
): CreateAiTaskInput;
```

Rules:
- omitted/V1 returns exact existing `OPTIMIZATION_PLAN_RANKING_FACTS_V1` shape and request-key behavior;
- V2 uses strict `OPTIMIZATION_PLAN_RANKING_FACTS_V2`, `planVersion:'OPTIMIZATION_PLAN_V2'`, frozen feedback per candidate;
- AI output schema remains exactly candidate id + [-2,+2] adjustment + explanation + supplied refs;
- async V2 completion reads frozen task facts only, never current profile state.

Export `projectOptimizationRankingPromptFacts(factSnapshot)` that removes V2 `feedback` fields before the prompt message is built. `ai.worker.ts` uses this projection only for OPTIMIZATION_PLAN_RANKING. `requestHash()` still hashes the full persisted fact snapshot, keeping request identity feedback-bound.

- [ ] **Step 4: Implement V2 success/fallback**

V2 AI success:
1. parse strict V2 facts;
2. validate output under existing AI rules;
3. compose valid AI + frozen historical;
4. enforce <=10 displacement;
5. create immutable V2 plans with bounded feedback provenance.

V2 AI failure:
1. existing AI task/run failure persists first;
2. V2 fallback uses AI=0;
3. frozen historical remains subject to <=10 guard;
4. no newer profile read;
5. no P8 artifacts.

V1 success/fallback remain historical=0 and behaviorally unchanged.

- [ ] **Step 5: Integration tests**

`optimization.feedback-v2.test.ts`:
- V1 default never reads feedback and historical=0;
- V2 reads exact scope/action profile;
- other market/action ignored;
- no profile => 0;
- existing V1 row unchanged after V2 plan;
- deterministic displacement fallback zeros historical across set.

Extend `optimization.ai-ranking.test.ts`:
- exact V1 fact shape/request identity regression;
- V2 strict frozen feedback facts;
- prompt projection contains no profile id/fingerprint/sample/history adjustment/feedback object;
- AI still cannot exceed ±2 or alter feedback;
- V2 success uses frozen values;
- V2 provider/validation failure uses frozen values with AI=0;
- a profile created after enqueue cannot affect completion.

- [ ] **Step 6: Verify and commit**

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

Expected GREEN with V1 regressions intact.

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

No public POST/PUT/PATCH/DELETE P9-E route in V1.

- [ ] **Step 1: Write RED route tests**

Assert:
- Standard 403 before injected API-port call;
- Advanced/Enterprise list profiles/evidence;
- limit default=50, range 1..100; offset default=0, range 0..100000;
- foreign profile id under another project returns 404 and no payload leak;
- response contains bounded feedback fields only, no raw observation metric JSON/content/prompts/answers/provider payload/credentials/reasoning;
- GET has no queue/service/provider/Git dependency.

- [ ] **Step 2: Implement API port/routes**

```ts
export interface OptimizationFeedbackApiPort {
  listProfiles(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getProfile(projectId: string, profileId: string): Promise<unknown | null>;
  listEvidence(projectId: string, limit: number, offset: number): Promise<unknown[]>;
}
```

Route order:
1. validate project UUID;
2. `requireFeature('OPTIMIZATION_FEEDBACK')`;
3. validate profile UUID/pagination;
4. project-scoped persisted read.

Default Prisma selects feedback audit fields/source IDs only; never raw P9-D metric JSON.

Add `optimizationFeedbackApi?: OptimizationFeedbackApiPort` to AppOptions and mount:

```ts
app.use('/api', createOptimizationFeedbackRoutes(options.optimizationFeedbackApi));
```

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run tests/integration/feedback.routes.test.ts tests/unit/feedback.feature-gate.test.ts
npm run typecheck
git add src/modules/optimization-feedback/feedback.routes.ts src/app.ts tests/integration/feedback.routes.test.ts
git commit -m "feat: expose read-only P9-E feedback API"
```

Expected GREEN.

---

### Task 32: Authority hardening, persisted-chain integration, docs, and release gate

**Files:**
- Create: `tests/integration/feedback.authority.test.ts`
- Extend: `tests/integration/feedback.materialization.test.ts`
- Create: `docs/development/p9-e-feedback-learning.md`

- [ ] **Step 1: Static forbidden-authority test**

Recursively scan `src/modules/optimization-feedback` and reject imports/references that create direct authority over:
- DeepSeek/AiGateway/provider adapters;
- Git/GitHub mutation adapters;
- publication execution/mutation/rollback services;
- Search/Visibility sampling/enqueue APIs;
- update/delete writes to non-feedback facts;
- direct writes to OptimizationPlan, OptimizationExperiment/Observation, publication execution/verification, Growth, Search Facts, Visibility.

Allow only feedback creates and persisted reads. Also assert `feedback.routes.ts` registers no post/put/patch/delete route.

- [ ] **Step 2: Real authority-chain integration**

Seed in rollback transaction:
- Advanced project;
- P7 candidate + immutable V1 optimization plan;
- exact P8 proposal source=P9_OPTIMIZATION_PLAN/reference exact plan;
- VERIFIED execution + exact VERIFIED verification;
- P9-D experiment/frozen terminal schedule;
- earlier terminal observation ineligible;
- later terminal observation SUFFICIENT+CLEAR+conclusive.

Assert:
- later observation accepted because earlier fails policy, never because result is more favorable;
- one evidence row per experiment;
- exact scope/profile counts/adjustment;
- retry identity stable;
- all source P7/P8/P9-A/P9-D rows unchanged;
- second project/market evidence cannot enter first profile.

- [ ] **Step 3: P9-D handoff resilience**

Prove:
- P9-D observation persists;
- feedback enqueue throws;
- experiment worker still resolves;
- observation remains durable;
- later 90-day reconciliation discovers/enqueues the missing candidate.

- [ ] **Step 4: Write `docs/development/p9-e-feedback-learning.md`**

Document:
- P9-D -> P9-E -> new P9-A V2 authority chain;
- one-experiment-one-sample and deterministic terminal selection;
- exact reason codes including FEATURE_DISABLED and P8_AUTHORITY_MISSING;
- scope isolation;
- rolling 20/minimum 3/formula/[-10,+10];
- exact current-profile lookup from persisted last-20 evidence identity, never hash lexical order;
- scope serialization/concurrency behavior;
- V1 immutable/unchanged and V2 opt-in;
- AI ±2 + feedback-hidden prompt projection;
- <=10 historical displacement fallback preserving valid AI;
- immutable persistence/idempotency;
- queue attempts=2, best-effort P9-D handoff, 90-day/100-candidate reconciliation;
- GET-only API, Standard denial, cross-project hiding;
- observability allowlist;
- rollout/rollback: app rollback never rewrites feedback history; DB removal only by separate reviewed forward migration;
- zero provider/DeepSeek/Git/deploy/rollback side effects.

- [ ] **Step 5: Focused P9-E regression**

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

Expected all GREEN.

- [ ] **Step 6: Local release verification**

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

All commands must succeed before completion. Negative-test DB logs are acceptable only when the corresponding passing test explicitly asserts fail-closed behavior.

- [ ] **Step 7: Commit final hardening/docs**

```bash
git add tests/integration/feedback.authority.test.ts tests/integration/feedback.materialization.test.ts docs/development/p9-e-feedback-learning.md
git commit -m "docs: complete P9-E feedback learning release guidance"
```

- [ ] **Step 8: Separate Draft PR and exact-head CI**

Create a separate Draft PR for `feat/p9-e-feedback-learning`. Never retarget/modify PR #158.

Exact P9-E PR head requires:

```text
verify = success
e2e = success
production-audit = success
```

Within verify:

```text
Prisma validate = success
Prisma generate = success
Prisma migrate deploy = success
Typecheck = success
Full Vitest = success
Build = success
```

Do not mark Ready, merge, or deploy without later separate authorization.

---

## Release Rejection Conditions

Reject completion if final diff introduces:
- mutation of P9-D experiment/observation;
- mutation of existing V1 OptimizationPlan;
- non-zero V1 historical adjustment;
- P7 score/evidence/lifecycle mutation;
- P8 risk/approval/execution/verification/rollback mutation;
- P9-C autopilot policy/kill-switch/quota mutation;
- feedback from non-terminal windows;
- >1 sample per experiment;
- INCONCLUSIVE/UNKNOWN/insufficient/contaminated/missing fact converted to numeric sample;
- cross-project or configured-market pooling;
- runtime DeepSeek/provider/Search/Visibility/Git/deployment calls from optimization-feedback;
- AI authority over feedback or feedback exposed to ranking prompt;
- V2 AI completion reading newer feedback than frozen task facts;
- profile selection that treats SHA-256 lexical order as recency instead of exact current evidence identity;
- >10 historical rank displacement without historical-zero fallback;
- public feedback mutation route;
- unbounded reconciliation/history scan;
- raw metrics/content/prompts/answers/provider payload/credentials/reasoning in feedback observability;
- weakened CI gates;
- merge/deployment without separate authorization.

## Completion Definition

P9-E implementation is complete only when Tasks 24-32 are checked off, the separate P9-E Draft PR exact head passes all three CI jobs, final authority review is clean, and `docs/development/p9-e-feedback-learning.md` matches shipped contracts. Completion does not authorize Ready-for-review, merge, or deployment.