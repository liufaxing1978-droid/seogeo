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
frozen baseline identity
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
- the execution is linked through its P8 publication plan/proposal provenance to the same P9 `OptimizationPlan`;
- execution status is `VERIFIED`;
- at least one persisted `PublicationVerification` for that execution has `status = VERIFIED`;
- the selected verification row has a non-null `observedAt`;
- the verified observed URL is present and consistent with the exact publication target identity.

P9-D stores the exact `publicationExecutionId` and `publicationVerificationId` used to start the experiment. Later P8 state is read for contamination checks but does not rewrite experiment history.

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

`KNOWN_EMPTY` may represent a known empty provider result only where the original Search Fact contract semantically supports that interpretation; P9-D must not generalize it into a numeric zero for unrelated metrics.

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

Do not add experiment fields to P7, P8, Search Facts, Visibility Metrics, or existing P9 tables except required reverse relations where Prisma requires them.

### 5.1 `OptimizationExperimentStatus`

```text
OBSERVING
EVALUATED
INCONCLUSIVE
CONTAMINATED
CANCELLED
```

`CANCELLED` is reserved for an explicit future/manual administrative stop. V1 runtime does not expose a generic cancel mutation unless required by existing project administrative patterns.

### 5.2 `OptimizationExperimentEffectState`

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

### 5.3 `OptimizationExperimentCoverageState`

```text
SUFFICIENT
PARTIAL
INSUFFICIENT
UNKNOWN
```

### 5.4 `OptimizationExperimentContaminationState`

```text
CLEAR
CONFLICTING_MUTATION
TARGET_REVISION_CHANGED
VERIFICATION_INVALIDATED
SOURCE_IDENTITY_CHANGED
UNKNOWN
```

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
baselineWindowStart
baselineWindowEnd
observationScheduleJson
baselineIdentityJson
expectedDirection
status
startedAt
createdAt
```

Design requirements:

- exactly one experiment identity for one verified execution + P9 plan + experiment version;
- immutable after creation;
- deterministic `experimentKey`;
- `baselineIdentityJson` stores bounded source identity only, never provider raw payloads;
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
windowStart
windowEnd
inputCutoffAt
searchSourceRefs
visibilitySourceRefs
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

Design requirements:

- immutable after creation;
- one deterministic identity per experiment/window/input-cutoff/evaluator version;
- observation records are append-only across later cutoffs;
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
baselineWindowStart
baselineWindowEnd
observation schedule
```

The repository uses create-or-get with exact collision verification. A unique-key collision with non-identical immutable data fails closed.

### 6.2 Observation identity

Use a versioned canonical hash over:

```text
EXPERIMENT_OBSERVATION_V1
experimentId
windowType
windowStart
windowEnd
inputCutoffAt
search source identity set
visibility source identity set
evaluatorVersion
```

Source identity arrays are normalized, deduplicated, and sorted before hashing.

## 7. Experiment start gate

The start service may create an experiment only when all required facts are current and exact.

Required gates:

1. feature `OPTIMIZATION_EXPERIMENTS` is enabled for the project plan level;
2. exact project match across OptimizationPlan, P8 proposal/plan/execution/verification;
3. P8 execution status is exactly `VERIFIED`;
4. exact persisted P8 verification status is `VERIFIED`;
5. verification `observedAt` exists;
6. target URL is bounded and consistent with the verified publication target;
7. intervention type maps deterministically from the immutable P9 action/P8 operations;
8. baseline window can be defined without crossing the verified intervention time;
9. no experiment identity collision with different immutable bindings.

A missing baseline does not necessarily block experiment creation. It may create an observing experiment with an explicit baseline-insufficiency identity so later observations can remain auditable. It must never invent a baseline.

## 8. Intervention classes and observation windows

V1 uses deterministic schedules based on the actual intervention class.

### 8.1 Snippet-oriented changes

For title/meta-related interventions:

```text
7D
14D
28D
```

### 8.2 Content/body/structured-content changes

For content creation, H1/FAQ, content refresh, ordinary on-page content changes, and structured-data/citability work:

```text
14D
28D
56D
```

### 8.3 AI visibility-oriented changes

Use provider sampling windows already represented by completed Visibility Metric snapshots. Scheduling still creates deterministic evaluation due dates, but the evaluator waits for a comparable completed metric window rather than causing sampling.

### 8.4 Window anchor

The intervention anchor is the authoritative P8 verified observation time, not PR creation time, commit time, merge time guessed by P9, or queue processing time.

## 9. Baseline resolver

The baseline resolver is read-only and deterministic.

### 9.1 Search baseline

Search baseline prefers comparable completed Search Fact facts strictly before the verified intervention anchor.

For an existing page optimization, page/query identities must match the experiment target scope.

For `CONTENT_CREATION`, page-level history for the new URL is normally absent. P9-D MUST NOT create a synthetic zero baseline. Allowed V1 outcomes are:

- use a truly comparable pre-existing query/market/provider baseline when the P9 source identity explicitly supplies that query scope; or
- record `NO_COMPARABLE_BASELINE` and keep effect state `INCONCLUSIVE` for metrics that require page-level before/after comparison.

### 9.2 Visibility baseline

Visibility baseline requires a completed snapshot whose window ends before the intervention anchor and whose metric identity is compatible with the observation metric identity.

No completed compatible snapshot means `NO_COMPARABLE_BASELINE`.

### 9.3 Baseline freezing

The experiment stores baseline source identities and bounded baseline metric projections at creation or the first deterministic resolution point. Later provider facts cannot silently replace the experiment baseline.

If baseline resolution is delayed because facts are not yet available, the resolver may create a new append-only observation attempt later; it must not mutate an existing immutable experiment identity to pretend the baseline existed earlier.

## 10. Observation resolver

The observation resolver reads only persisted completed snapshots whose windows satisfy the deterministic experiment schedule.

A candidate observation must:

- end no earlier than the due observation boundary;
- not use facts with cutoff earlier than the required observation window;
- match project/provider/market/locale/property and metric identities;
- preserve source version/formula/normalization semantics;
- reject incompatible or ambiguous identity changes.

P9-D does not pick a numerically favorable snapshot. Selection order must be deterministic, such as the earliest completed compatible snapshot that fully covers the due window and satisfies minimum coverage.

## 11. Comparable metric projection

P9-D persists bounded derived metric projections, not raw facts.

Example search projection fields may include:

```text
metricSemantic
provider
marketCode
locale
query/page identity
baselineValue nullable
observedValue nullable
absoluteDelta nullable
relativeDelta nullable
evidenceState
sourceSnapshotId
```

Example visibility projection fields may include:

```text
metricType
dimensionType
dimensionKey
actorKey
baselineNumerator
baselineDenominator
observedNumerator
observedDenominator
baselineRate nullable
observedRate nullable
absoluteDelta nullable
coverage counts
sourceSnapshotId
```

Relative delta is omitted when mathematically undefined or misleading, including zero/absent baseline cases.

## 12. Coverage policy

Effect classification requires sufficient evidence.

V1 default rules:

- all compared metric identities must be known and compatible;
- required observation window must be complete;
- search snapshots must be `COMPLETED`;
- visibility snapshots must be `COMPLETED`;
- visibility rows with `UNKNOWN`, `NO_DATA`, or `NOT_ELIGIBLE` cannot contribute a positive/negative conclusion;
- partial provider coverage yields `PARTIAL` and normally `INCONCLUSIVE` unless the experiment scope explicitly targets only the covered provider;
- zero eligible visibility denominator yields no rate conclusion;
- missing baseline yields `INSUFFICIENT`.

Threshold constants must be versioned in evaluator code and tested. They are not user-editable policy in P9-D V1.

## 13. Contamination detection

P9-D must be conservative about concurrent changes.

Before a conclusive observation, detect at least:

### `CONFLICTING_MUTATION`

Another P8 publication execution affecting the same canonical page/target during the experiment window makes attribution ambiguous.

### `TARGET_REVISION_CHANGED`

A relevant target identity changed outside the experiment's bound verified intervention in a way that prevents a clean comparison.

### `VERIFICATION_INVALIDATED`

Persisted P8 facts later show failure/rollback state that makes the intervention no longer a stable verified treatment.

### `SOURCE_IDENTITY_CHANGED`

Provider/property/market/locale/query/page identity changed in a way that breaks metric comparability.

Any material contamination forces effect state `INCONCLUSIVE` for that observation. P9-D does not attempt semantic adjustment or subtraction.

## 14. Effect evaluator

The evaluator is deterministic and versioned, initially:

```text
OPTIMIZATION_EXPERIMENT_EVALUATOR_V1
```

It first evaluates authority and evidence, then direction.

Order:

1. exact project/experiment bindings valid;
2. original P8 verified execution still suitable for observational evaluation;
3. no material contamination;
4. comparable baseline exists;
5. observation window complete;
6. coverage sufficient;
7. metric identities compatible;
8. calculate bounded deltas;
9. classify expected-direction consistency.

Possible result:

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

### 14.1 Direction semantics

Expected direction is explicit per metric:

- clicks/impressions/CTR: usually higher is favorable;
- provider-specific position metrics: lower numeric position is favorable;
- mention/citation/share-of-voice rates: higher is favorable.

P9-D must not compare unlike position semantics such as Google average position with Bing average-click position.

### 14.2 Neutral band

V1 should use a small versioned deterministic neutral band to avoid classifying noise as lift/decline. The exact constants belong in the implementation plan and tests, not runtime user policy.

### 14.3 Multi-metric aggregation

V1 is conservative:

- any authority/coverage/identity blocker => `INCONCLUSIVE`;
- otherwise a clearly favorable primary metric with no materially contradictory protected metric => `POSITIVE`;
- clearly unfavorable primary metric => `NEGATIVE`;
- small or mixed changes inside the neutral band => `NEUTRAL`;
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

Recommended job types:

```text
START_EXPERIMENT
EVALUATE_WINDOW
RECONCILE_DAILY
```

### 16.1 Start handoff

A P8 verification completion integration may enqueue a durable `START_EXPERIMENT` request only after persisted VERIFIED state exists.

The handoff itself does not create provider work.

### 16.2 Daily reconciliation

A UTC daily reconciliation scans for:

- eligible verified P9-linked executions with no experiment;
- due experiment windows without an effective observation;
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
- incompatible metric identity;
- no comparable baseline;
- insufficient coverage;
- contamination;
- unsupported intervention/metric semantics.

Non-retryable evidence outcomes should normally materialize an auditable `INCONCLUSIVE` observation or explicit start-deferred reason rather than repeatedly throwing infrastructure retries.

Retries must not duplicate experiments or observations.

## 18. Feature gate

Add/activate:

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

P9-D API is project scoped.

Recommended read routes:

```text
GET /api/v1/projects/:projectId/optimization/experiments
GET /api/v1/projects/:projectId/optimization/experiments/:experimentId
```

GET is persisted-read only. It must not:

- enqueue work;
- recalculate facts;
- call providers;
- call AI;
- mutate experiment status;
- create missing observations.

A narrow explicit administrative/manual evaluation trigger may be added only if existing project patterns require it, and must enqueue a durable experiment ID/window request rather than execute evaluation inline. P9-D V1 does not expose arbitrary client-supplied metrics, effect states, source refs, or evaluator outputs.

Cross-project IDs fail closed without revealing unrelated resource existence.

## 20. UI surface

Add a persisted-read experiment view that can later be embedded in P9-F `自动优化中心`.

For each experiment show bounded fields:

- optimization action;
- target URL;
- market/locale;
- verified intervention time;
- baseline availability;
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

Add bounded events such as:

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
- search query collections unless a specifically bounded normalized identifier is already approved for observability.

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
- create-or-get collision protection.

### Task 20 — Baseline and comparable-source resolver

Deliver:

- Search Facts baseline resolver;
- Visibility Metrics baseline resolver;
- no-zero-baseline behavior;
- CONTENT_CREATION no-history safeguards;
- bounded source projections;
- compatibility/version checks.

### Task 21 — Observation evaluator, contamination, queue and reconciliation

Deliver:

- deterministic observation windows;
- due-window resolver;
- coverage classification;
- contamination detection;
- deterministic effect evaluator;
- one experiment evaluation queue;
- VERIFIED handoff and UTC reconciliation;
- idempotent retry behavior.

### Task 22 — Project-scoped API and persisted-read UI

Deliver:

- Advanced/Enterprise API feature gate;
- experiment list/detail API;
- persisted-read experiment workspace;
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
- duplicate start is idempotent;
- experiment and observation rows reject UPDATE/DELETE;
- new content page does not receive a fabricated zero baseline;
- `UNKNOWN`/`NOT_SUPPORTED` do not become zero;
- incompatible provider/market/locale/metric semantics do not compare;
- Google position is not fused with Bing position semantics;
- Visibility Metric formula/extractor mismatch fails comparability;
- incomplete windows or insufficient coverage become `INCONCLUSIVE`;
- conflicting mutation contamination becomes `INCONCLUSIVE`;
- no AI/provider/Git/deploy/rollback call exists in P9-D evaluation;
- GET API/UI paths have no side effects;
- retries do not duplicate experiments/observations;
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
2. freeze or explicitly fail to obtain a comparable baseline without fabricating zero;
3. evaluate due windows only from persisted completed Search Facts and Visibility Metrics;
4. preserve provider, market, locale, property, metric, normalization/formula, and cutoff semantics;
5. detect contamination rather than over-attribute outcomes;
6. classify bounded observational outcomes as POSITIVE/NEUTRAL/NEGATIVE/INCONCLUSIVE without AI;
7. expose project-scoped persisted-read experiment history with zero GET side effects;
8. remain idempotent, immutable, fail-closed, auditable, and exact-source bound;
9. provide clean, qualifying P9-D evidence for a future P9-E bounded feedback layer without itself changing planning weights.