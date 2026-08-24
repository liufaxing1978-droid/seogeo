# P9-E Feedback Learning Design

Date: 2026-08-25
Status: Approved design, implementation not started
Repository: `liufaxing1978-droid/seogeo`
Base dependency: P9-D exact head `d5b9b8fe42b926e42854e956d06fb45a6079c48a`
Branch: `feat/p9-e-feedback-learning`
Parent design: `docs/superpowers/specs/2026-08-22-p9-global-china-seogeo-controlled-autopilot-design.md`
P9-D design: `docs/superpowers/specs/2026-08-24-p9-d-experiment-engine-design.md`

## 1. Purpose

P9-E adds a bounded, deterministic feedback-learning layer over completed P9-D experiments.

Its job is to answer:

> For a given project, market/locale scope, and recommended action type, what small historical recommendation-order adjustment is justified by a bounded rolling set of prior conclusive experiments?

P9-E does not create experiments, does not reinterpret raw Search Facts or Visibility Metrics, does not claim causality, and does not mutate already-frozen optimization plans. It consumes persisted P9-D experiment observations and creates immutable feedback evidence/profile snapshots that future planner versions may read when freezing new plans.

The intended flow is:

```text
P9-D OptimizationExperiment
        ↓
terminal planned observation window
        ↓
eligibility gate
        ↓
OptimizationFeedbackEvidence
        ↓
rolling deterministic aggregation
        ↓
OptimizationFeedbackProfile
        ↓
future P9-A plan materialization only
        ↓
bounded historicalRankAdjustment
```

## 2. Hard authority boundaries

P9-E MUST NOT:

- update or delete any P9-D experiment or observation;
- update or delete existing `OptimizationPlan` rows;
- retroactively rewrite `historicalRankAdjustment` on `OPTIMIZATION_PLAN_V1`;
- change P7 Growth score, formula, evidence quality, evidence coverage, ranking eligibility, lifecycle, or opportunity identity;
- change P8 risk class, approvals, preview validity, execution, deployment, rollback, or VERIFIED semantics;
- change P9-C controlled-autopilot gates, quotas, allowlists, kill switches, stale-review handling, or safety thresholds;
- call Search providers, AI visibility providers, DeepSeek, Git, deployment systems, or external mutation adapters;
- enqueue new Search/Visibility sampling as a side effect of feedback materialization;
- treat `INCONCLUSIVE`, insufficient coverage, contamination, missing baseline, UNKNOWN, or unsupported data as negative evidence;
- merge feedback across projects;
- merge feedback across configured markets/locales;
- use raw article bodies, prompts, answers, provider reasoning, credentials, or raw provider payloads as profile inputs;
- claim causal lift from P9-D observational outcomes.

P9-E owns only P9 feedback records and a bounded recommendation-order adjustment consumed by future planner versions.

## 3. Chosen architecture

Use a frozen-evidence, versioned-profile design.

P9-E introduces one focused module:

```text
src/modules/optimization-feedback/
```

with responsibilities for:

- terminal observation selection;
- feedback eligibility;
- feedback scope identity;
- immutable accepted-evidence materialization;
- deterministic rolling aggregation;
- bounded historical adjustment calculation;
- idempotent queue/reconciliation;
- project-scoped persisted-read API;
- bounded observability;
- future P9-A V2 adapter.

P9-E does not create a second metric evaluator. P9-D remains authoritative for effect, coverage, contamination, source references, and experiment-window semantics.

## 4. Feedback scope

Feedback profiles are isolated by:

```text
projectId
marketScopeMode
marketCode
locale
recommendedActionType
```

### 4.1 Configured market

For a P9-D experiment with a configured market, the profile scope preserves the exact persisted market and locale.

No cross-market pooling is allowed. For example, `CN/zh-CN` outcomes cannot alter the profile used for `GLOBAL/en` plans.

### 4.2 Legacy unconfigured market

Legacy candidates/experiments with no configured market remain in a separate explicit legacy scope:

```text
marketScopeMode = UNCONFIGURED_LEGACY
marketCode = null
locale = null
```

They are never promoted to `GLOBAL` or another configured market.

### 4.3 Invalid provenance

`INVALID_PROVENANCE` planner candidates cannot have eligible P9-D experiments and therefore cannot contribute to feedback.

## 5. One experiment contributes at most once

A P9-D experiment may contain multiple planned observations, for example 7/14/28 or 14/28/56 days. Counting every conclusive observation would overweight one intervention.

P9-E therefore selects exactly one terminal planned observation for each experiment.

The terminal observation is the observation corresponding to the last server-derived entry in the experiment's frozen `observationScheduleJson`.

Eligibility requires that the persisted observation:

- belongs to the exact experiment;
- matches the terminal scheduled `windowType` and `windowDays`;
- has `dueAt` matching the frozen terminal schedule;
- was produced by a supported P9-D evaluator version;
- has a unique immutable observation identity.

Earlier windows remain visible in P9-D but cannot create P9-E evidence.

The accepted-evidence table enforces uniqueness by `observationId` and by `experimentId`, so retries and reconciliation cannot count an experiment twice.

## 6. Feedback eligibility

An experiment contributes only when all conditions are true:

1. terminal P9-D observation exists;
2. `effectState` is one of:
   - `POSITIVE`;
   - `NEUTRAL`;
   - `NEGATIVE`;
3. `coverageState = SUFFICIENT`;
4. `contaminationState = CLEAR`;
5. the experiment's exact frozen P8 `publicationExecutionId` still resolves to the same project and plan provenance;
6. the experiment's exact frozen P8 `publicationVerificationId` still exists and is a VERIFIED verification fact for that execution;
7. market/locale/action scope can be derived from persisted P9/P9-D facts without inference;
8. the experiment has not already produced accepted feedback evidence.

The following always produce no accepted evidence:

- `INCONCLUSIVE` effect;
- `PARTIAL`, `INSUFFICIENT`, or `UNKNOWN` coverage;
- any contamination other than `CLEAR`;
- missing baseline represented by P9-D as inconclusive;
- missing or inconsistent P8 frozen authority references;
- unsupported evaluator/profile versions;
- ambiguous scope.

Rejected/deferred inputs are not converted into a zero or negative sample.

## 7. Persistence model

Use a new Prisma model file:

```text
prisma/models/optimization-feedback.prisma
```

No P7, P8, Search, Visibility, or P9-D authority table receives mutable feedback fields.

### 7.1 `OptimizationFeedbackEffect`

Reuse the conclusive P9-D semantic states conceptually:

```text
POSITIVE
NEUTRAL
NEGATIVE
```

The feedback row stores a frozen copy of the accepted effect rather than a recalculated value.

### 7.2 `OptimizationFeedbackEvidence`

One row represents one accepted terminal experiment outcome.

Required fields:

```text
id
projectId
experimentId
observationId
optimizationPlanId
candidateId
feedbackEvidenceVersion
scopeKey
marketScopeMode
marketCode nullable
locale nullable
recommendedActionType
effectState
feedbackValue
terminalWindowType
terminalWindowDays
inputCutoffAt
sourceEvaluatorVersion
sourceObservationKey
createdAt
```

`feedbackValue` is deterministic:

```text
POSITIVE -> +1
NEUTRAL  ->  0
NEGATIVE -> -1
```

Design requirements:

- immutable after insert;
- exactly one accepted row per `experimentId`;
- exactly one accepted row per `observationId`;
- source IDs point to the frozen P9/P9-D chain;
- no Search/Visibility raw metric JSON is duplicated into P9-E;
- idempotent create-or-get must compare the full immutable payload and fail closed on mismatch.

Suggested uniqueness:

```text
@@unique([experimentId])
@@unique([observationId])
@@index([projectId, scopeKey, inputCutoffAt])
```

### 7.3 `OptimizationFeedbackProfile`

A profile is an immutable aggregation snapshot over a deterministic rolling evidence set.

Required fields:

```text
id
projectId
feedbackProfileVersion
profileKey
scopeKey
marketScopeMode
marketCode nullable
locale nullable
recommendedActionType
sampleCount
positiveCount
neutralCount
negativeCount
rollingEffectBalance
historicalRankAdjustment
windowLimit
oldestEvidenceCutoffAt
newestEvidenceCutoffAt
inputEvidenceIdsJson
inputFingerprint
createdAt
```

Profile requirements:

- immutable after insert;
- `windowLimit = 20` in V1;
- input evidence IDs are frozen in deterministic order;
- `inputFingerprint` is SHA-256 over canonical profile version/scope and ordered evidence identities;
- same evidence set produces the same profile identity;
- newer accepted evidence creates a new profile snapshot instead of mutating the previous one;
- latest profile is selected deterministically from the newest evidence cutoff, then creation identity as a stable tie breaker;
- profile history remains queryable for audit/P9-F.

Suggested uniqueness:

```text
@@unique([projectId, profileKey])
@@unique([projectId, inputFingerprint])
@@index([projectId, scopeKey, newestEvidenceCutoffAt])
```

### 7.4 Database immutability

Both feedback tables receive PostgreSQL `BEFORE UPDATE OR DELETE` triggers, following existing P9 immutable-table practice.

Production repositories expose create/get/list operations only. No update/delete methods are added.

## 8. Deterministic identity

### 8.1 Scope key

`scopeKey` is SHA-256 over canonical JSON containing exactly:

```text
feedbackScopeVersion
projectId
marketScopeMode
marketCode
locale
recommendedActionType
```

Keys are sorted and nullable values are explicit.

### 8.2 Evidence identity

Evidence identity is bound to the immutable terminal observation and feedback version. It does not include timestamps generated by P9-E.

### 8.3 Profile identity

Profile input evidence is selected as follows:

1. all accepted evidence for the exact scope;
2. sort by `inputCutoffAt` ascending;
3. tie break by immutable `observationId` ascending;
4. retain the last 20 rows;
5. freeze the ordered evidence IDs;
6. hash them with profile version and scope key.

This makes retries and daily reconciliation converge on the same profile rather than generating duplicate semantic snapshots.

## 9. Rolling aggregation and weighting

V1 uses at most the latest 20 accepted experiments in the exact scope.

Let:

```text
p = positiveCount
u = neutralCount
n = negativeCount
sampleCount = p + u + n
```

If `sampleCount < 3`:

```text
rollingEffectBalance = 0
historicalRankAdjustment = 0
```

If `sampleCount >= 3`:

```text
rollingEffectBalance = (p - n) / sampleCount
shrinkage = sampleCount / (sampleCount + 5)
rawAdjustment = -10 * rollingEffectBalance * shrinkage
historicalRankAdjustment = round(rawAdjustment)
```

The persisted adjustment is clamped to:

```text
[-10, +10]
```

Interpretation follows existing P9-A rank direction:

- negative adjustment improves ordering;
- positive adjustment worsens ordering;
- zero is neutral/no usable historical preference.

Examples:

```text
3 positive, 0 neutral, 0 negative -> about -4
5 positive, 0 neutral, 0 negative -> -5
10 positive, 0 neutral, 0 negative -> about -7
20 positive, 0 neutral, 0 negative -> -8
```

The rolling-20 bound prevents indefinite accumulation and allows newer outcomes to replace very old evidence without rewriting history.

The formula is first-party deterministic policy. DeepSeek and third-party skills cannot change it at runtime.

## 10. Planner integration: P9-A V2 only

P9-E must not mutate existing `OPTIMIZATION_PLAN_V1` rows.

Introduce a future planner version:

```text
OPTIMIZATION_PLAN_V2
```

When P9-A V2 freezes a new plan, it may read the latest compatible feedback profile for the exact candidate scope and deterministic recommended action.

The plan freezes:

```text
historicalRankAdjustment = compatibleProfile?.historicalRankAdjustment ?? 0
```

It also records bounded feedback provenance in first-party explanation/advisory metadata:

```text
feedbackProfileId
feedbackProfileVersion
feedbackInputFingerprint
feedbackSampleCount
historicalRankAdjustment
```

No raw P9-D metrics or article/provider payloads are copied.

### 10.1 Ranking composition

The conceptual ordering signal becomes:

```text
rankSignal = deterministicRank
           + aiRankAdjustment
           + historicalRankAdjustment
```

Existing AI authority stays unchanged:

- AI can adjust only already-eligible candidates;
- AI cannot alter the feedback profile or historical adjustment;
- feedback cannot alter eligibility, action type, market truth, P7 facts, P8 risk, or approval.

### 10.2 Bounded displacement safeguard

A historical signal must not create unbounded rank jumps after sorting.

For V2, after composing the deterministic, AI, and historical signals, the final ordering must satisfy:

```text
abs(finalRank - deterministicRank) <= 10
```

If application of historical feedback would cause any candidate to exceed this displacement bound, the planner retries the ordering for that materialization with all historical adjustments set to zero while preserving the already-valid AI adjustment contract. The fallback is recorded in the frozen explanation.

This is an ordering safety bound, not a new Growth score.

## 11. Queue and reconciliation

P9-E uses one bounded BullMQ queue:

```text
optimization-feedback-materialization
```

Primary handoff may be triggered after P9-D persists a terminal observation.

Job identity is deterministic over:

```text
projectId
experimentId
observationId
feedbackEvidenceVersion
```

Retries must not duplicate accepted evidence or profiles.

A bounded daily reconciliation scans only eligible recent terminal P9-D observations that have no corresponding feedback evidence. It does not rescan unbounded history.

Suggested bounds:

- project batch size: 100 terminal observations;
- attempts: 2;
- no paid/external provider calls;
- no catch-up beyond an explicit finite age limit in V1 unless manually requested by a future administrative backfill command.

## 12. API and UI boundary

P9-E V1 exposes project-scoped persisted-read surfaces only.

Suggested routes:

```text
GET /api/projects/:projectId/optimization-feedback/profiles
GET /api/projects/:projectId/optimization-feedback/profiles/:profileId
GET /api/projects/:projectId/optimization-feedback/evidence
```

Optional explicit POST materialization/reconciliation operations, if exposed, must be authorization-checked and feature-gated before repository/queue side effects.

P9-E does not introduce a new large workspace. P9-F `自动优化中心` owns the eventual user-facing outcome/weight-history dashboard.

Existing or small planner detail surfaces may show bounded feedback provenance only when it helps audit a V2 plan.

GET rendering must remain persisted-read only and must not enqueue feedback work, recalculate profiles, call DeepSeek, providers, Git, or publication services.

## 13. Feature gates and tenancy

P9-E reuses the optimization product boundary:

- Standard: denied;
- Advanced: allowed for project-scoped feedback;
- Enterprise: allowed for project-scoped feedback and future portfolio consumption.

A dedicated internal feature capability may be named `OPTIMIZATION_FEEDBACK` if the existing feature-gate model requires explicit separation.

All reads/writes are project-scoped. Cross-project IDs return the existing hidden/not-found behavior rather than leaking existence.

Feature denial must occur before restricted repository reads, queue operations, or mutation side effects.

## 14. Observability

Use a bounded allowlisted event catalog:

```text
optimization.feedback.accepted
optimization.feedback.deferred
optimization.feedback.profile.created
optimization.feedback.reconciled
```

Allowed metadata may include:

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

Do not log:

- article/body content;
- prompt/answer bodies;
- provider reasoning;
- raw Search/Visibility metrics JSON;
- raw source URLs unless already represented by a safe bounded identifier;
- credentials/tokens;
- raw provider payloads.

`accepted` emits only after evidence persistence. `profile.created` emits only after immutable profile persistence. Reused existing rows remain silent for create-specific events.

## 15. Stable defer/rejection reason codes

Suggested V1 codes:

```text
FEEDBACK_TERMINAL_OBSERVATION_PENDING
FEEDBACK_EFFECT_INCONCLUSIVE
FEEDBACK_COVERAGE_INSUFFICIENT
FEEDBACK_CONTAMINATED
FEEDBACK_P8_AUTHORITY_MISSING
FEEDBACK_SCOPE_INVALID
FEEDBACK_EVALUATOR_UNSUPPORTED
FEEDBACK_ALREADY_ACCEPTED
FEEDBACK_FEATURE_DISABLED
```

These are diagnostic only and do not become negative samples.

## 16. Failure behavior

P9-E fails closed.

- Missing P9-D terminal observation -> defer, no evidence.
- P9-D inconclusive/contaminated -> no evidence.
- Missing/inconsistent exact P8 frozen authority -> no evidence.
- Duplicate delivery -> reuse immutable evidence/profile.
- Immutable payload mismatch -> error; never update the prior row.
- Redis/BullMQ transient failure -> bounded retry/reconciliation.
- Database failure before evidence/profile commit -> no success event.
- Planner cannot resolve a compatible profile -> historical adjustment 0.
- Invalid/out-of-range profile data -> planner ignores it and records bounded fallback metadata.

No feedback failure may block existing P7/P8 authority or rewrite previously frozen plans.

## 17. Testing strategy

Implementation follows TDD.

### 17.1 Unit contracts

Cover:

- terminal schedule selection;
- earlier windows cannot contribute;
- each experiment contributes at most once;
- effect mapping +1/0/-1;
- INCONCLUSIVE rejected;
- insufficient/partial/unknown coverage rejected;
- every contamination state except CLEAR rejected;
- scope identity preserves project/market/locale/action;
- legacy scope remains isolated;
- rolling last-20 selection is deterministic;
- same input set produces same fingerprint;
- fewer than 3 samples produces 0;
- positive history yields negative rank adjustment;
- negative history yields positive rank adjustment;
- clamp stays within [-10,+10];
- observability allowlist drops unsafe fields.

### 17.2 Integration contracts

Use real Prisma to prove:

- accepted evidence is immutable;
- feedback profiles are immutable;
- duplicate observation/experiment cannot double count;
- retry creates/reuses the same rows;
- new accepted evidence creates a new profile snapshot and leaves old profile unchanged;
- exact market scopes do not contaminate each other;
- P9-D experiment/observation rows remain unchanged;
- P8 execution/verification rows remain unchanged;
- static/runtime authority tests show no P7/P8/P9-D update/delete path.

### 17.3 P9-A V2 contracts

Prove:

- `OPTIMIZATION_PLAN_V1` remains historical adjustment 0 and immutable;
- V2 freezes the latest exact-scope compatible profile;
- absent profile -> 0;
- cross-market/cross-project/action-mismatched profile ignored;
- profile value outside valid contract ignored/fails closed;
- AI cannot change historical adjustment;
- combined ordering uses deterministic + AI + historical signals;
- displacement >10 causes historical-only fallback while preserving valid AI behavior;
- frozen V2 plan never changes after a newer feedback profile is created.

### 17.4 Queue/reconciliation contracts

Prove:

- deterministic job identity;
- duplicate delivery does not duplicate evidence/profile;
- reconciliation is bounded;
- reconciliation makes zero provider/DeepSeek/Git/publication calls;
- Standard denial occurs before enqueue/read side effects.

### 17.5 API/E2E contracts

Cover:

- project profile list/detail read-only behavior;
- evidence list read-only behavior;
- Standard denied;
- cross-project hidden;
- opening GET surfaces does not change P9-E/P9-D/P8 row counts;
- profile provenance/sample counts/adjustment render correctly where surfaced.

## 18. Migration and rollout

Use additive forward migrations only.

Do not rewrite existing P9-A or P9-D migrations.

Rollout sequence:

1. add P9-E enums/tables/triggers/indexes;
2. deploy code with feedback feature gate disabled by default if a new explicit gate is used;
3. materialize feedback only from newly eligible terminal observations or an explicitly reviewed bounded backfill;
4. verify profile calculation independently before P9-A V2 consumes it;
5. enable P9-A V2 consumption only after feedback persistence/identity tests are stable;
6. keep P9-A V1 records untouched.

Application rollback disables new feedback materialization/consumption while preserving historical rows. Database rollback, if required, is a separately reviewed forward migration preserving audit history.

## 19. Explicit non-goals for V1

P9-E V1 does not provide:

- causal A/B testing;
- Bayesian or ML model training;
- cross-project/global learning;
- user-specific personalization;
- automated modification of P7 scores or formulas;
- automated modification of P8 risk/approval rules;
- automatic rollback or repair execution;
- autonomous policy tuning;
- AI-generated feedback weights;
- live provider sampling;
- a standalone operations-center UI;
- unlimited historical backfill.

Those require separate future designs.

## 20. Release gates

P9-E is complete only when the exact PR head proves:

- terminal-window one-experiment-one-sample semantics;
- conclusive + sufficient + clear-only eligibility;
- no missing/unknown/inconclusive state becomes negative or zero evidence;
- immutable evidence/profile persistence and idempotency;
- strict project/market/locale/action isolation;
- deterministic rolling-20 profile identity;
- deterministic bounded [-10,+10] weighting;
- P9-A V1 historical rows remain untouched;
- P9-A V2 freezes historical feedback only into newly created plans;
- displacement safety fallback works;
- no P7/P8/P9-D authority writes;
- no provider/DeepSeek/Git/deploy/rollback side effects;
- Standard and cross-project boundaries fail closed;
- GET surfaces are persisted-read only;
- bounded observability excludes sensitive/raw content;
- exact-head GitHub Actions `verify`, `e2e`, and `production-audit` all succeed;
- within `verify`, Prisma validate/generate/migrate, Typecheck, full Vitest, and Build all succeed.

Implementation completion does not authorize merge or deployment.