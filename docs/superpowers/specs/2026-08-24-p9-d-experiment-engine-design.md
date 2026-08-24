# P9-D Experiment Engine Design

Date: 2026-08-24
Status: Approved design, implementation not started
Repository: `liufaxing1978-droid/seogeo`
Base: `main@5fac353d0e5e8c4bd5c187e4318bd1c7e4490d4e`
Branch: `feat/p9-d-experiment-engine`
Parent design: `docs/superpowers/specs/2026-08-22-p9-global-china-seogeo-controlled-autopilot-design.md`

## 1. Purpose

P9-D adds a bounded experiment and outcome-measurement layer after P9-C controlled autopilot.

Its job is to answer:

> After an optimization was actually deployed and independently VERIFIED by P8, what measurable search or AI-visibility outcome was observed over defined windows?

P9-D does not decide whether a publication was deployed successfully, does not collect provider data directly, does not claim causal impact, and does not feed weights back into planning. It records immutable experiment identity, immutable observations, bounded effect classifications, and explicit insufficiency/contamination states for later P9-E feedback use.

The intended flow is:

```text
P9 OptimizationPlan
        ↓
P8 PublicationExecution
        ↓
P8 PublicationVerification = VERIFIED
        ↓
P9-D OptimizationExperiment
        ↓
deterministic observation schedule
        ↓
window evaluation from persisted completed facts
        ↓
OptimizationExperimentObservation
        ↓
POSITIVE | NEUTRAL | NEGATIVE | INCONCLUSIVE
        ↓
P9-E Feedback Loop (future phase)
```

## 2. Hard authority boundaries

P9-D MUST NOT:

- assert or mutate P8 deployment, execution, verification, approval, risk, rollback, merge, or publication state;
- create experiments for unverified publication executions;
- call search providers, AI visibility providers, DeepSeek, Git, deployment systems, or external mutation adapters;
- enqueue provider collection or AI sampling as a side effect of experiment evaluation;
- recalculate P7 Growth scores or reinterpret P7 evidence authority;
- rewrite Search Facts, Visibility Metrics, OptimizationPlan, OptimizationCandidate, OptimizationRun, OptimizationRunItem, Autopilot decisions, or P8 facts;
- treat missing, `UNKNOWN`, `NOT_SUPPORTED`, or incompatible facts as zero;
- manufacture a zero baseline for newly created content pages;
- claim causal lift from observational before/after data;
- update `OptimizationPlan.historicalRankAdjustment`; that belongs to P9-E;
- auto-merge, auto-deploy, auto-rollback, or create a second publication execution path.

P9-D may only read persisted authoritative facts and persist P9-owned experiment records.

## 3. Source-of-truth contracts

### 3.1 P9 planner identity

`OptimizationPlan` remains the source of the recommended action and intervention identity. P9-D references one exact immutable plan.

Relevant planner fields include:

- `projectId`;
- `recommendedActionType`;
- source fact references;
- deterministic rank;
- AI adjustment;
- historical adjustment placeholder;
- final rank.

P9-D never edits the plan.

### 3.2 P8 execution and verification authority

An experiment can start only when all of the following are true:

- `PublicationExecution.projectId` equals the experiment project;
- the execution is linked through its P8 publication proposal provenance to the same P9 `OptimizationPlan`;
- proposal `sourceType = P9_OPTIMIZATION_PLAN`;
- proposal `sourceReferenceId` equals the exact `OptimizationPlan.id`;
- execution status is `VERIFIED`;
- at least one persisted `PublicationVerification` for that execution has `status = VERIFIED`;
- the selected verification row has a non-null `observedAt`;
- the selected verification row has a bounded HTTP(S) `observedUrl` consistent with the exact P8 target URL.

P9-D stores the exact `publicationExecutionId` and `publicationVerificationId` used to start the experiment. Later P8 facts are read for contamination checks but do not rewrite experiment history.

P9-D must not infer VERIFIED from a Draft PR, commit SHA, deployment marker, HTTP success, or any non-P8 source.

### 3.3 Search evidence authority

P9-D reads only completed `SearchFactSnapshot` rows and their normalized facts/metrics.

Comparability requires exact or explicitly allowed matching of:

- project;
- provider;
- market;
- locale;
- property identity;
- fact kind;
- canonical page and/or normalized query identity, depending on intervention scope;
- metric semantic;
- normalization version compatibility;
- source cutoff/window relationship.

Evidence states remain authoritative:

```text
KNOWN_PRESENT
KNOWN_EMPTY
UNKNOWN
NOT_SUPPORTED
```

`UNKNOWN` and `NOT_SUPPORTED` never become numeric zero.

`KNOWN_EMPTY` may represent a known empty provider result only where the original Search Fact contract semantically supports that interpretation; P9-D must not generalize it into numeric zero for unrelated metrics.

`SearchFactCompleteness = COMPLETE` is conclusive-compatible. `TOP_ROWS_ONLY` is usable only when the exact target fact exists in both baseline and observation windows; absence from a top-rows-only snapshot is never interpreted as zero. `PROVIDER_UNSPECIFIED` and `UNKNOWN` completeness are insufficient for a conclusive effect.

### 3.4 AI visibility evidence authority

P9-D reads only completed `VisibilityMetricSnapshot` rows and bounded `VisibilityMetricRow` values.

Allowed V1 metric types are existing first-party metrics:

- `MENTION_RATE`;
- `CITATION_RATE`;
- `MENTION_SHARE_OF_VOICE`.

Comparability requires compatible:

- project;
- subject identity/scope;
- metric type;
- dimension type/key;
- actor identity;
- formula version;
- extractor version;
- provider/prompt-set dimension when applicable;
- snapshot window/cutoff.

Metric status remains authoritative. `UNKNOWN`, `NO_DATA`, and `NOT_ELIGIBLE` do not become zero.

## 4. Chosen architecture

Use a frozen-fact experiment engine rather than a new sampling subsystem.

P9-D introduces one P9-owned module:

```text
src/modules/optimization-experiments/
```

with focused responsibilities:

- identity and deterministic window planning;
- eligibility/start gate;
- baseline resolver;
- observation resolver;
- comparable metric projection;
- contamination detection;
- deterministic effect evaluator;
- persistence repository/service;
- one BullMQ evaluation queue;
- project-scoped API and persisted-read UI projection;
- bounded observability.

P9-D reuses existing Search Facts and Visibility Metrics rather than adding provider-specific adapters.

## 5. Persistence model

Use a new Prisma model file:

```text
prisma/models/optimization-experiment.prisma
```

Do not add experiment-owned lifecycle fields to P7, P8, Search Facts, Visibility Metrics, or existing P9 tables except required reverse relations where Prisma requires them.

### 5.1 `OptimizationExperimentEffectState`

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

### 5.2 `OptimizationExperimentCoverageState`

```text
SUFFICIENT
PARTIAL
INSUFFICIENT
UNKNOWN
```

### 5.3 `OptimizationExperimentContaminationState`

```text
CLEAR
CONFLICTING_MUTATION
TARGET_REVISION_CHANGED
VERIFICATION_INVALIDATED
SOURCE_IDENTITY_CHANGED
UNKNOWN
```

### 5.4 Derived experiment view state

Experiment lifecycle state is NOT stored as a mutable field. It is derived at read time from the immutable experiment plus its immutable observations and deterministic due schedule.

Derived view values are:

```text
OBSERVING
EVALUATED
INCONCLUSIVE
CONTAMINATED
```

This preserves immutable experiment identity while still giving API/UI consumers a useful current projection.

### 5.5 `OptimizationExperiment`

Required fields:

```text
id
projectId
optimizationPlanId
publicationExecutionId
publicationVerificationId
experimentVersion
experimentKey
interventionType
targetUrl
marketCode nullable
locale nullable
verifiedAnchorAt
measurementScopeJson
observationScheduleJson
expectedDirectionJson
createdAt
```

Design requirements:

- exactly one experiment identity for one verified execution + P9 plan + experiment version;
- immutable after creation;
- deterministic `experimentKey`;
- `measurementScopeJson` stores bounded normalized query/page/provider/market/locale scope only;
- `observationScheduleJson` is server-derived from intervention class;
- no article body, diff, prompt, model answer, credentials, token, or raw upstream data.

### 5.6 `OptimizationExperimentObservation`

Required fields:

```text
id
projectId
experimentId
observationVersion
observationKey
windowType
windowDays
dueAt
inputCutoffAt
baselineSearchSourceRefs
observedSearchSourceRefs
baselineVisibilitySourceRefs
observedVisibilitySourceRefs
baselineMetricsJson
observedMetricsJson
deltaMetricsJson
coverageState
contaminationState
effectState
reasonCodes
evaluatorVersion
createdAt
```

Each bounded metric projection carries its own actual baseline and observation source windows, so Search Facts and Visibility Metrics do not have to pretend to share identical source-window shapes.

Design requirements:

- immutable after creation;
- one deterministic identity per experiment/window/input-cutoff/source-set/evaluator version;
- observation records are append-only across later cutoffs;
- baseline selection is frozen inside each observation record;
- source refs are bounded IDs/versions only;
- no provider raw payloads;
- no mutation/update of older observations when new facts arrive.

### 5.7 Database immutability

Add PostgreSQL `BEFORE UPDATE OR DELETE` triggers for:

- `OptimizationExperiment`;
- `OptimizationExperimentObservation`.

Migrations are additive and forward-only. No P8/P9-A/P9-B/P9-C applied migration may be modified.

## 6. Deterministic identities

### 6.1 Experiment identity

Use a versioned canonical hash over:

```text
EXPERIMENT_IDENTITY_V1
projectId
optimizationPlanId
publicationExecutionId
publicationVerificationId
interventionType
targetUrl
marketCode
locale
verifiedAnchorAt
measurement scope
observation schedule
expected-direction map
```

The repository uses create-or-get with exact collision verification. A unique-key collision with non-identical immutable data fails closed.

### 6.2 Observation identity

Use a versioned canonical hash over:

```text
EXPERIMENT_OBSERVATION_V1
experimentId
windowType
windowDays
dueAt
inputCutoffAt
baseline search source identity set
observed search source identity set
baseline visibility source identity set
observed visibility source identity set
evaluatorVersion
```

Source identity arrays are normalized, deduplicated, and sorted before hashing.

## 7. Experiment start gate

The start service may create an experiment only when all required facts are current and exact.

Required gates:

1. feature `OPTIMIZATION_EXPERIMENTS` is enabled for the project plan level;
2. exact project match across OptimizationPlan, P8 proposal/plan/execution/verification;
3. P8 proposal source identity is exactly the OptimizationPlan;
4. P8 execution status is exactly `VERIFIED`;
5. exact persisted P8 verification status is `VERIFIED`;
6. verification `observedAt` exists;
7. verification `observedUrl` is bounded HTTP(S) and matches the publication target identity;
8. intervention type is supported in P9-D V1;
9. measurement scope can be derived deterministically from immutable P9 source facts and P8 target identity;
10. no experiment identity collision with different immutable bindings.

A missing comparable baseline does not block experiment creation. The experiment records the measurement policy and schedule; each due observation later resolves and freezes its own baseline source set. It must never invent a baseline.

## 8. Supported intervention classes and observation windows

P9-D V1 only produces conclusive evaluations for actions supported by current persisted fact semantics.

### 8.1 `SERP_SNIPPET_OPTIMIZATION`

Schedule:

```text
7D
14D
28D
```

Primary metric family: CTR.
Secondary metric families: clicks, impressions, provider-specific position.

### 8.2 `ON_PAGE_OPTIMIZATION`

Schedule:

```text
14D
28D
56D
```

Primary metric family: clicks.
Secondary metric families: CTR, impressions, provider-specific position.

### 8.3 `CONTENT_REFRESH`

Schedule:

```text
14D
28D
56D
```

Primary metric family: clicks.
Secondary metric families: CTR, impressions, provider-specific position.

### 8.4 `CONTENT_CREATION`

Schedule:

```text
14D
28D
56D
```

A new page has no valid page-level pre-intervention zero baseline. P9-D therefore uses a query-level comparison only when the immutable P9 source identity supplies an exact comparable normalized query/market/provider scope. Primary metric family is query-level impressions; secondary is query-level clicks.

If no comparable query baseline exists, the effect remains `INCONCLUSIVE / NO_COMPARABLE_BASELINE`. Page-level absence before creation is never converted to zero.

### 8.5 `GEO_CITABILITY_IMPROVEMENT`

Schedule:

```text
14D
28D
56D
```

Primary metric family: `CITATION_RATE`.
Secondary metric families: `MENTION_RATE`, `MENTION_SHARE_OF_VOICE`.

### 8.6 `AI_VISIBILITY_IMPROVEMENT`

Schedule:

```text
14D
28D
56D
```

Primary metric family: `MENTION_RATE` unless the immutable P9 source scope explicitly targets citation, in which case `CITATION_RATE` is primary.
Secondary metric families: the remaining compatible visibility rates.

### 8.7 Unsupported V1 interventions

The current persisted fact model does not provide sufficiently exact outcome semantics for automatic conclusive evaluation of:

```text
TECHNICAL_SEO_REMEDIATION
CANNIBALIZATION_REMEDIATION
```

P9-D V1 does not start experiments for these actions. It records a deterministic deferred/not-supported result at the handoff boundary rather than inventing a proxy metric.

### 8.8 Window anchor

The intervention anchor is the authoritative P8 verification `observedAt`, not PR creation time, commit time, merge time guessed by P9, or queue processing time.

## 9. Baseline resolver

The baseline resolver is read-only and deterministic. Baselines are resolved per observation window and frozen in the resulting immutable observation.

### 9.1 Search baseline

For a scheduled N-day observation, the search baseline uses the exact N calendar days immediately preceding `verifiedAnchorAt` and the observed search window uses the exact N calendar days beginning at `verifiedAnchorAt`.

Daily Search Facts are aggregated only across exact compatible metric identities.

For an existing page optimization, page/query identities must match the experiment measurement scope.

For `CONTENT_CREATION`, page-level history for the new URL is normally absent. P9-D MUST NOT create a synthetic zero baseline. Allowed V1 outcomes are:

- use the exact query-level baseline when the P9 source identity explicitly supplies that normalized query scope; or
- record `NO_COMPARABLE_BASELINE` and keep effect state `INCONCLUSIVE`.

### 9.2 Visibility baseline

Visibility Metric snapshots are not forced into synthetic daily buckets.

For each due window, select:

- baseline: the latest completed compatible snapshot ending at or before `verifiedAnchorAt`;
- observation: the earliest completed compatible snapshot ending at or after the due boundary;
- both snapshots must have equal window duration;
- both snapshots must have identical formula version, extractor version, subject/scope identity, metric identity, dimension identity, and actor identity.

If no such pair exists, record `NO_COMPARABLE_BASELINE` or `NO_COMPARABLE_OBSERVATION` and classify the result `INCONCLUSIVE`.

### 9.3 Late-arriving historical facts

A later evaluation attempt may use historical Search Facts or Visibility Metric snapshots that were persisted after experiment creation but whose source windows are valid for the required baseline/observation periods.

This does not mutate older observations. A later source cutoff creates a new immutable observation identity.

## 10. Observation resolver

The observation resolver reads only persisted completed snapshots whose source windows satisfy the deterministic experiment schedule.

A candidate observation must:

- satisfy the due boundary for its window;
- match project/provider/market/locale/property and metric identities;
- preserve source version/formula/normalization semantics;
- reject incompatible or ambiguous identity changes;
- use deterministic selection order, never the numerically most favorable snapshot.

Search selection uses the exact scheduled daily interval. Visibility selection uses the baseline/observation pair rules in section 9.2.

## 11. Comparable metric projection

P9-D persists bounded derived metric projections, not raw facts.

Example search projection fields:

```text
metricSemantic
provider
marketCode
locale
factKind
normalizedQuery nullable
canonicalPage nullable
baselineWindowStart
baselineWindowEnd
observedWindowStart
observedWindowEnd
baselineValue nullable
observedValue nullable
absoluteDelta nullable
relativeDelta nullable
evidenceState
sourceSnapshotIds
```

Clicks and impressions are compared as per-day normalized values when the source window contains multiple daily facts. CTR and provider-specific position are compared using deterministic weighted aggregation defined by source semantics; unlike position semantics are never fused.

Example visibility projection fields:

```text
metricType
dimensionType
dimensionKey
actorKey
baselineWindowStart
baselineWindowEnd
observedWindowStart
observedWindowEnd
baselineNumerator
baselineDenominator
observedNumerator
observedDenominator
baselineRate nullable
observedRate nullable
absoluteDelta nullable
sourceSnapshotIds
```

Relative delta is omitted when mathematically undefined or misleading, including zero/absent baseline cases.

## 12. Coverage policy

Effect classification requires sufficient evidence.

V1 deterministic rules:

- all compared metric identities must be known and compatible;
- required search observation interval must be complete for the exact target fact identity;
- search snapshots must be `COMPLETED`;
- `SearchFactCompleteness = COMPLETE` is sufficient;
- `TOP_ROWS_ONLY` is sufficient only when the exact target fact exists in both baseline and observed windows;
- absence from `TOP_ROWS_ONLY` never becomes zero;
- `PROVIDER_UNSPECIFIED` or `UNKNOWN` search completeness yields `INSUFFICIENT`;
- visibility snapshots must be `COMPLETED`;
- visibility rows with `UNKNOWN`, `NO_DATA`, or `NOT_ELIGIBLE` cannot contribute a positive/negative conclusion;
- visibility baseline and observation denominators must each be at least 10 eligible observations;
- partial provider coverage yields `PARTIAL` and `INCONCLUSIVE` unless the experiment scope explicitly targets only the covered provider;
- zero eligible visibility denominator yields no rate conclusion;
- missing baseline yields `INSUFFICIENT`.

These constants are first-party evaluator semantics and are not user-editable policy in P9-D V1.

## 13. Contamination detection

P9-D must be conservative about concurrent changes.

Before a conclusive observation, detect at least:

### `CONFLICTING_MUTATION`

Another persisted P8 publication execution affecting the same target URL/canonical page during the experiment window makes attribution ambiguous.

### `TARGET_REVISION_CHANGED`

Persisted P8 execution/event evidence shows a relevant target revision change outside the experiment's bound verified intervention. P9-D does not query Git directly to discover this state.

### `VERIFICATION_INVALIDATED`

Persisted P8 facts show a later rollback/failure state that makes the intervention no longer a stable verified treatment.

### `SOURCE_IDENTITY_CHANGED`

Provider/property/market/locale/query/page identity changed in a way that breaks metric comparability.

Any material contamination forces effect state `INCONCLUSIVE` for that observation. P9-D does not attempt semantic adjustment or subtraction.

## 14. Effect evaluator

The evaluator is deterministic and versioned:

```text
OPTIMIZATION_EXPERIMENT_EVALUATOR_V1
```

It first evaluates authority and evidence, then direction.

Order:

1. exact project/experiment bindings valid;
2. original P8 verified execution remains suitable for observational evaluation;
3. no material contamination;
4. comparable baseline exists;
5. observation window complete;
6. coverage sufficient;
7. metric identities compatible;
8. calculate bounded deltas;
9. classify primary metric;
10. check secondary metrics for material contradiction.

Possible result:

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

### 14.1 Direction semantics

Expected direction is explicit per metric:

- clicks/impressions: higher is favorable;
- CTR: higher is favorable;
- provider-specific position metrics: lower numeric position is favorable;
- mention/citation/share-of-voice rates: higher is favorable.

P9-D must not compare unlike position semantics such as Google average position with Bing average-click position.

### 14.2 V1 neutral bands

Use these deterministic evaluator constants:

```text
SEARCH_COUNT_RATE_RELATIVE_NEUTRAL_BAND = 0.05
CTR_ABSOLUTE_NEUTRAL_BAND = 0.005
POSITION_ABSOLUTE_NEUTRAL_BAND = 0.5
VISIBILITY_RATE_ABSOLUTE_NEUTRAL_BAND = 0.05
MIN_VISIBILITY_ELIGIBLE_DENOMINATOR = 10
```

Interpretation:

- normalized clicks/impressions change inside ±5% is neutral;
- CTR change inside ±0.5 percentage points is neutral;
- provider-specific position change inside ±0.5 positions is neutral;
- visibility rate change inside ±5 percentage points is neutral.

Changing these constants requires a new evaluator version and reviewed migration/compatibility decision; old observations are never rewritten.

### 14.3 Multi-metric aggregation

V1 is conservative:

- any authority/coverage/identity blocker => `INCONCLUSIVE`;
- primary metric clearly favorable beyond its neutral band, with no materially contradictory secondary metric => `POSITIVE`;
- primary metric clearly unfavorable beyond its neutral band => `NEGATIVE`;
- primary metric inside its neutral band and no material contradiction => `NEUTRAL`;
- materially contradictory metrics => `INCONCLUSIVE` rather than arbitrary averaging.

No AI participates in effect classification.

## 15. Causality language

P9-D reports observational association only.

Allowed wording:

- "observed positive association";
- "observed negative association";
- "no material observed change";
- "inconclusive due to insufficient/contaminated evidence".

Disallowed V1 wording:

- "this change caused X% growth";
- "proven causal lift";
- "guaranteed improvement".

A future causal experiment design would require an explicit control/randomization methodology and is outside P9-D V1.

## 16. Queue and scheduling

Add exactly one P9-D BullMQ queue:

```text
optimization-experiment-evaluation
```

Do not introduce another general event bus.

Allowed job payloads contain durable IDs and dates only.

Job types:

```text
START_EXPERIMENT
EVALUATE_WINDOW
RECONCILE_DAILY
```

### 16.1 Start handoff

After a P8 verification transaction has durably persisted VERIFIED state, a narrow injected P9-D queue port may enqueue `START_EXPERIMENT` using execution/project IDs only.

P8 does not call P9-D persistence directly and P9-D does not alter P8 verification semantics.

### 16.2 Daily reconciliation

A UTC daily reconciliation scans for:

- eligible verified P9-linked executions with no experiment;
- due experiment windows without an effective observation at the current source cutoff;
- retryable missed handoffs.

Reconciliation derives current UTC date at processing time and uses deterministic identities.

### 16.3 No future-timer explosion

Do not schedule long-lived one-job-per-window delayed jobs months in advance. Prefer bounded daily reconciliation plus idempotent due-window evaluation.

## 17. Retry semantics

Retryable infrastructure failures include:

- transient PostgreSQL connectivity failure;
- Redis/BullMQ transient failure;
- transient internal read failure.

Non-retryable deterministic outcomes include:

- unverified execution;
- cross-project mismatch;
- invalid P9/P8 provenance;
- unsupported V1 intervention;
- incompatible metric identity;
- no comparable baseline;
- insufficient coverage;
- contamination.

Non-retryable evidence outcomes materialize an auditable `INCONCLUSIVE` observation or deterministic deferred-start reason where appropriate rather than repeatedly throwing infrastructure retries.

Retries must not duplicate experiments or observations.

## 18. Feature gate

Use:

```text
OPTIMIZATION_EXPERIMENTS
```

Availability:

| Plan | Available |
| --- | --- |
| STANDARD | No |
| ADVANCED | Yes |
| ENTERPRISE | Yes |

Feature availability does not create experiments from unverified data and does not enable P9-C autopilot.

## 19. API surface

P9-D V1 API is project scoped and read-only:

```text
GET /api/v1/projects/:projectId/optimization/experiments
GET /api/v1/projects/:projectId/optimization/experiments/:experimentId
```

GET is persisted-read only. It must not:

- enqueue work;
- recalculate facts;
- call providers;
- call AI;
- create experiments;
- create observations;
- mutate any lifecycle state.

P9-D V1 exposes no public POST/PUT/PATCH/DELETE experiment endpoint. Experiment creation/evaluation is internal queue/reconciliation work derived from persisted authoritative facts.

Cross-project IDs fail closed without revealing unrelated resource existence.

## 20. UI surface

Add a persisted-read experiment view that can later be embedded in P9-F `自动优化中心`.

For each experiment show bounded fields:

- optimization action;
- target URL;
- market/locale;
- verified intervention time;
- derived experiment state;
- baseline availability per observation;
- observation schedule;
- latest due/completed window;
- effect state;
- coverage state;
- contamination state;
- reason codes;
- source provider labels;
- explicit "observational, not causal" wording.

Do not expose raw provider payloads, raw source JSON, article bodies, prompts, tokens, credentials, or arbitrary internal metadata.

Opening the UI must have zero side effects.

## 21. Observability

Add bounded events:

```text
optimization.experiment.started
optimization.experiment.deferred
optimization.experiment.observation.created
optimization.experiment.evaluated
optimization.experiment.inconclusive
```

Allowlisted metadata:

```text
projectId
optimizationPlanId
publicationExecutionId
experimentId
observationId
windowType
effectState
coverageState
contaminationState
reasonCode
marketCode
provider
```

Never emit:

- article/draft bodies;
- prompts/model outputs;
- provider raw data;
- credentials/tokens;
- unified diffs;
- arbitrary source JSON;
- unbounded search query collections.

## 22. Security and isolation

Every read and write validates project equality across all linked P9/P8/source records.

Client authority cannot set:

- effect state;
- coverage state;
- contamination state;
- baseline values;
- observed values;
- source refs;
- evaluator version;
- P8 verification identity;
- project identity;
- experiment/observation keys.

These are server-derived from persisted authoritative facts.

## 23. P9-E boundary

P9-D stops after immutable outcome classification.

It does not update recommendation weights.

P9-E may later consume only qualifying P9-D observations that meet all of:

- source execution VERIFIED;
- complete comparable baseline;
- sufficient observation coverage;
- contamination `CLEAR`;
- conclusive effect state;
- evaluator version accepted by P9-E;
- no material conflicting mutation.

P9-E remains responsible for bounded historical weighting and for writing future feedback-profile records. P9-D never writes `OptimizationPlan.historicalRankAdjustment`.

## 24. Proposed implementation tasks

P9-D maps to Tasks 19-23 in the parent P9 design.

### Task 19 — Persistence, feature gate, identities, start eligibility

Deliver:

- experiment/observation enums and models;
- additive migration;
- immutability triggers;
- `OPTIMIZATION_EXPERIMENTS` entitlement;
- canonical experiment/observation identities;
- exact P9/P8 VERIFIED start gate;
- supported-intervention gate;
- create-or-get collision protection.

### Task 20 — Baseline and comparable-source resolver

Deliver:

- Search Facts baseline/observation resolver;
- Visibility Metrics baseline/observation resolver;
- per-window baseline freezing in immutable observations;
- no-zero-baseline behavior;
- CONTENT_CREATION query-baseline safeguards;
- bounded source projections;
- compatibility/version checks.

### Task 21 — Effect evaluator, contamination, queue and reconciliation

Deliver:

- deterministic observation windows;
- coverage classification;
- V1 neutral-band evaluator;
- contamination detection;
- one experiment evaluation queue;
- post-VERIFIED handoff and UTC reconciliation;
- idempotent retry behavior.

### Task 22 — Project-scoped API and persisted-read UI

Deliver:

- Advanced/Enterprise API feature gate;
- experiment list/detail API;
- persisted-read experiment workspace;
- derived lifecycle projection;
- observational/non-causal wording;
- cross-project isolation;
- GET side-effect tests.

### Task 23 — Authority scans, E2E, docs, exact-head release gate

Deliver:

- static boundary tests;
- Chromium E2E experiment review flow;
- operator/development documentation;
- queue/worker bootstrap regression;
- full exact-head CI gate;
- manual changed-file authority review;
- unresolved review threads = 0 before Ready for review.

## 25. TDD contract

Implementation proceeds task by task using RED -> minimal GREEN -> refactor only while green.

Tests must prove at minimum:

- unverified P8 execution cannot create an experiment;
- missing verification row cannot create an experiment;
- cross-project P9/P8 identity fails closed;
- proposal source identity must match the exact OptimizationPlan;
- unsupported V1 interventions do not start experiments;
- duplicate start is idempotent;
- experiment and observation rows reject UPDATE/DELETE;
- derived experiment state requires no experiment mutation;
- new content page does not receive a fabricated page-level zero baseline;
- `UNKNOWN`/`NOT_SUPPORTED` do not become zero;
- missing target in TOP_ROWS_ONLY does not become zero;
- incompatible provider/market/locale/metric semantics do not compare;
- Google position is not fused with Bing position semantics;
- Visibility Metric formula/extractor mismatch fails comparability;
- visibility denominator below 10 is insufficient;
- incomplete windows or insufficient coverage become `INCONCLUSIVE`;
- conflicting mutation contamination becomes `INCONCLUSIVE`;
- no AI/provider/Git/deploy/rollback call exists in P9-D evaluation;
- GET API/UI paths have no side effects;
- retries do not duplicate experiments/observations;
- later source cutoffs append observations rather than rewriting old ones;
- P9-D never updates P7 score, P8 risk/verification, or P9 plan historical adjustment.

## 26. CI and release gate

Every final P9-D PR head must pass the existing three-job exact-head gate:

```text
verify            ✅
production-audit  ✅
e2e               ✅
```

`verify` includes:

- Prisma validate;
- Prisma generate;
- Prisma migrate deploy;
- Typecheck;
- full Vitest;
- Build.

P9-D-specific authority review must confirm:

- no provider transport imports;
- no DeepSeek/AI gateway execution dependency;
- no Git mutation imports;
- no merge/deploy/rollback path;
- no P7 score mutation;
- no P8 authority mutation;
- no `OptimizationPlan.historicalRankAdjustment` mutation;
- only one new P9-D queue;
- GET routes are persisted-read only;
- experiments require exact VERIFIED P8 evidence;
- observations are append-only and source-bound;
- conclusions remain observational, not causal.

PR remains Draft until exact-head CI is green, manual authority review is complete, and unresolved review threads are zero.

Merge requires a separate explicit human `合并`. Deployment requires separate explicit authorization.

## 27. Success criteria

P9-D V1 is complete when the system can:

1. deterministically create one immutable experiment from an exact P9 plan and exact P8 VERIFIED execution;
2. resolve and freeze a comparable baseline per observation window without fabricating zero;
3. evaluate due windows only from persisted completed Search Facts and Visibility Metrics;
4. preserve provider, market, locale, property, metric, normalization/formula, and cutoff semantics;
5. detect contamination rather than over-attribute outcomes;
6. classify bounded observational outcomes as POSITIVE/NEUTRAL/NEGATIVE/INCONCLUSIVE without AI;
7. expose project-scoped persisted-read experiment history with zero GET side effects;
8. remain idempotent, immutable, fail-closed, auditable, and exact-source bound;
9. provide clean, qualifying P9-D evidence for a future P9-E bounded feedback layer without itself changing planning weights.