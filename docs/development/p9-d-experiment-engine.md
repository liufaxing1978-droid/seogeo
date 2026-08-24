# P9-D Experiment Engine

## Purpose

P9-D turns an exact, durable P8 `VERIFIED` publication outcome into an immutable observational experiment. It measures whether persisted Search Facts or persisted Visibility Metrics moved after the verified intervention window.

P9-D answers **what changed after the verified optimization, with what evidence quality, and whether the observation is interpretable**. It does not claim causality and it does not acquire publication, planning, approval, merge, deploy, rollback, or historical-ranking authority.

The authority chain is:

```text
P9-A OptimizationPlan
→ P8 PublicationProposal / PublicationPlan
→ P8 PublicationExecution
→ exact durable PublicationVerification(status = VERIFIED)
→ frozen P9-D OptimizationExperiment
→ persisted Search Facts / Visibility Metrics only
→ scheduled observation window
→ contamination check
→ deterministic evaluator
→ immutable OptimizationExperimentObservation
→ read-only API / UI
→ P9-E later, if historical feedback is authorized
```

The verification timestamp is the experiment anchor. P9-D never uses draft publication state, a queued deployment, or an inferred success signal as a substitute for exact P8 verification.

## Feature availability

| Plan | Optimization experiments |
| --- | --- |
| `STANDARD` | No |
| `ADVANCED` | Yes |
| `ENTERPRISE` | Yes |

The web/API boundary fails closed for plans without `OPTIMIZATION_EXPERIMENTS`.

## Authority boundaries

P9-D is intentionally read-only outside its own immutable experiment/observation records.

P8 remains authoritative for:

- publication proposal and exact publication plan;
- risk classification and approval;
- repository/file mutation;
- Draft PR lifecycle;
- merge and deploy;
- verification and rollback.

P9-D does not update P8 records and does not call Git, deployment, rollback, provider mutation, or publication mutation paths.

P7 and P9-A remain authoritative for growth/planning facts. P9-D does not rewrite:

- Growth opportunity identity, score, lifecycle, evidence quality, or ranking eligibility;
- `OptimizationCandidate`;
- `OptimizationPlan`;
- `historicalRankAdjustment`.

`historicalRankAdjustment` remains `0` in P9-A V1. Any future historical optimization weighting belongs to P9-E, not P9-D.

P9-D also does not call DeepSeek or any external Search/Visibility provider while evaluating an experiment. It reads only already-persisted facts/snapshots through repository ports.

## Exact start gate

An experiment may start only from an exact P8 verified execution. The gate requires all of the following:

- project identity matches the execution;
- the publication proposal source is exactly `P9_OPTIMIZATION_PLAN`;
- `sourceReferenceId` resolves to the exact persisted `OptimizationPlan` in the same project;
- the P8 execution status is exactly `VERIFIED`;
- a persisted publication verification exists with status exactly `VERIFIED`;
- `observedAt` is non-null;
- `observedUrl` is non-null and a valid HTTP(S) URL;
- normalized verification URL exactly matches the P8 target public URL;
- the intervention has a supported P9-D V1 schedule;
- a measurement scope can be frozen from persisted authority facts.

A failed prerequisite returns a stable deferred reason instead of manufacturing an experiment.

The experiment anchor is always:

```text
verifiedAnchorAt = PublicationVerification.observedAt
```

No later wall-clock time, deployment timestamp, or UI read timestamp replaces the anchor.

## Immutable experiment identity

`OptimizationExperiment` is append-only. Its immutable identity freezes the exact optimization/publication/verification relationship plus the measurement contract.

The persisted experiment includes:

- project;
- optimization plan;
- publication execution;
- publication verification;
- experiment version/key;
- intervention type;
- normalized target URL;
- market/locale when available;
- verification anchor;
- measurement scope JSON;
- observation schedule JSON;
- expected direction JSON.

Existing rows are reused only when the complete immutable payload matches. Identity collisions fail closed. PostgreSQL `BEFORE UPDATE OR DELETE` protection prevents rewriting experiment history.

## V1 intervention schedules

| Intervention | Windows | Primary measurement |
| --- | --- | --- |
| `SERP_SNIPPET_OPTIMIZATION` | 7D / 14D / 28D | Search `CTR`, higher is better |
| `ON_PAGE_OPTIMIZATION` | 14D / 28D / 56D | Search `CLICKS`, higher is better |
| `CONTENT_REFRESH` | 14D / 28D / 56D | Search `CLICKS`, higher is better |
| `CONTENT_CREATION` | 14D / 28D / 56D | query-level Search `IMPRESSIONS`, higher is better |
| `GEO_CITABILITY_IMPROVEMENT` | 14D / 28D / 56D | Visibility `CITATION_RATE`, higher is better |
| `AI_VISIBILITY_IMPROVEMENT` | 14D / 28D / 56D | frozen Visibility metric, higher is better |

`TECHNICAL_SEO_REMEDIATION` and `CANNIBALIZATION_REMEDIATION` are not supported experiment types in P9-D V1. They defer rather than receiving a guessed measurement contract.

For content creation, V1 uses query-level evidence. It does not invent a pre-existing page baseline for a page that did not exist.

## Frozen measurement scope

Measurement scope is fixed when the experiment starts. Later configuration changes do not silently rewrite the experiment.

### Search scope

A Search scope freezes the relevant persisted identity, including:

- provider;
- market and locale;
- Search property reference;
- normalized query;
- canonical page where the intervention requires page-level measurement;
- aggregation scope (`QUERY` or `QUERY_PAGE`).

The evaluator never broadens a frozen page-level experiment into a query-only experiment merely because page facts are missing.

### Visibility scope

A Visibility scope freezes compatibility fields needed to compare persisted metric snapshots, including:

- metric type;
- subject-set hash;
- scope hash;
- formula version;
- extractor version;
- dimension type/key;
- actor type/key.

Those fields are measurement identity, not display hints.

## Search observation windows

For an N-day Search experiment:

```text
baseline = the exact N days immediately before verifiedAnchorAt
observed = the exact N days beginning at verifiedAnchorAt
```

The resolver reads completed persisted Search Facts only. It does not call Google Search Console, Bing, Baidu, or another provider during evaluation.

### Completeness semantics

`COMPLETE` evidence can support a conclusive comparison when all other rules pass.

`TOP_ROWS_ONLY` is usable only when the exact required fact exists in both compared windows. Absence from a truncated/top-rows source is **not zero** and cannot be interpreted as loss of traffic.

`PROVIDER_UNSPECIFIED`, unknown completeness, missing required days, incompatible source identity, or unresolved facts produce insufficient coverage.

UNKNOWN, NO_DATA, NOT_ELIGIBLE, or missing facts are never coerced into `0`, `false`, `PASS`, or a positive/negative lift.

## Visibility snapshot pairing

Visibility evaluation uses only compatible completed persisted snapshots.

The baseline side is the latest compatible completed snapshot whose window ends no later than the verification anchor. The observed side is the earliest compatible completed snapshot whose window ends at or after the observation due time.

A pair must remain compatible on the frozen measurement identity, including:

- equal measurement-window duration;
- formula version;
- extractor version;
- subject-set hash;
- scope hash;
- metric type;
- dimension type/key;
- actor type/key.

P9-D preserves the numerator and denominator beside rate values. It does not fabricate Search rank data for Visibility experiments.

For rate-based Visibility evaluation, V1 requires a denominator of at least 10 on both baseline and observed sides. Insufficient denominator coverage yields an inconclusive result rather than a forced effect label.

## Missing baselines

Missing baseline evidence is not a zero baseline.

If no comparable baseline exists, the observation carries insufficient coverage and materializes as `INCONCLUSIVE`. This is especially important for new-content and truncated-source cases where a synthetic zero would create a false improvement claim.

The read-only UI displays persisted null/unknown evidence rather than replacing it with zero.

## Deterministic effect evaluator

P9-D classifies observations as:

```text
POSITIVE
NEUTRAL
NEGATIVE
INCONCLUSIVE
```

The evaluator is deterministic and versioned. It uses the frozen primary metric/direction, persisted comparison facts, coverage state, and contamination state.

V1 neutral bands are:

| Metric family | Neutral band |
| --- | --- |
| count/rate relative movement | ±5% relative |
| Search CTR | ±0.005 absolute |
| Search position | ±0.5 absolute |
| Visibility rate | ±0.05 absolute |

Search position is explicitly **lower-is-better**: a numeric position decrease is favorable; a numeric increase is unfavorable.

Secondary metrics may be displayed as evidence but do not silently replace the frozen primary metric. Missing primary evidence cannot be rescued by a favorable secondary metric.

## Contamination

P9-D checks whether another material mutation makes the before/after observation unsafe to interpret.

V1 contamination states include:

```text
CLEAR
CONFLICTING_MUTATION
TARGET_REVISION_CHANGED
VERIFICATION_INVALIDATED
SOURCE_IDENTITY_CHANGED
```

A material contamination state forces the experiment observation to `INCONCLUSIVE` even when the raw metric movement looks favorable.

The real integration path is:

```text
persisted P8 PublicationExecutionEvent
→ Prisma contamination read port
→ deterministic contamination detector
→ evaluator
→ immutable OptimizationExperimentObservation
```

The detector never changes either the original P8 execution or the later conflicting execution.

## Immutable observations and idempotency

`OptimizationExperimentObservation` is append-only and contains:

- experiment/project identity;
- observation version/key;
- frozen window type/days and due time;
- input cutoff;
- baseline/observed Search source refs;
- baseline/observed Visibility source refs;
- baseline/observed metric JSON;
- delta metric JSON;
- coverage state;
- contamination state;
- effect state;
- stable reason codes;
- evaluator version.

PostgreSQL triggers reject UPDATE and DELETE.

Persistence distinguishes the outcome of an idempotent write:

```text
CREATED   = this call inserted the immutable observation
EXISTING  = an identical immutable observation already existed
```

A unique-key race (`P2002`) is re-read and classified as `EXISTING` when identity matches. It is not reported as a new observation.

The legacy repository method remains available for compatibility, but lifecycle observability uses the explicit outcome contract to avoid false `observation.created` events.

## Queue and worker model

P9-D uses one bounded queue:

```text
optimization-experiment-evaluation
```

Job kinds are:

```text
START_EXPERIMENT
EVALUATE_WINDOW
RECONCILE_DAILY
```

Starting an experiment schedules only its frozen observation windows. Daily reconciliation repairs missed handoffs and missed due windows with bounded limits; it does not create an unbounded future-timer explosion.

The P8 handoff is narrow: after a durable exact `VERIFIED` result, P8 may enqueue the P9-D start intent. P8 does not call P9-D persistence directly, and P9-D never changes P8 state.

Transient infrastructure failures can be retried by the queue. Deterministic evidence outcomes such as unresolved scope, insufficient coverage, missing baseline, or contamination are represented as deferred/`INCONCLUSIVE` facts rather than infinite retries.

## Observability

P9-D emits bounded lifecycle events:

```text
optimization.experiment.started
optimization.experiment.deferred
optimization.experiment.observation.created
optimization.experiment.evaluated
optimization.experiment.inconclusive
```

Allowed event metadata is intentionally small and may include:

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

The observability emitter constructs a fresh allowlisted payload. It does not spread arbitrary runtime objects.

Do not put any of the following into P9-D lifecycle events:

- article/content bodies;
- prompt text;
- raw provider payloads;
- credentials;
- API tokens or secrets.

`observation.created` is emitted only for a real `CREATED` persistence outcome and only after durable persistence. Reusing an existing observation does not emit another created event. Evaluated/inconclusive events are also emitted only after the observation persistence call succeeds.

## Read-only API and UI

The P9-D workspace is observational and read-only.

Derived display states are:

```text
OBSERVING
EVALUATED
INCONCLUSIVE
CONTAMINATED
```

These are read-model projections, not mutable stored experiment statuses.

The list/detail surfaces expose:

- target/intervention identity;
- verification anchor;
- frozen measurement scope;
- frozen expected directions;
- observation windows;
- persisted source references;
- baseline/observed/delta metrics;
- coverage and contamination states;
- evaluator version and reason codes;
- the warning that observed association is not proof of causality.

GET list/detail routes do not create experiments, create observations, enqueue evaluation, alter P8 rows, or trigger publication/provider actions.

Cross-project experiment identifiers are hidden by project-scoped queries. Unsupported plan levels receive `403`. A foreign experiment ID under another Advanced project returns `404` rather than disclosing the foreign record.

The UI has no Start, Evaluate, Publish, Merge, Deploy, or Rollback controls.

## Safety invariants

The following invariants are required for every P9-D change:

1. No P7/P8/P9-A planning or publication authority mutation.
2. No `historicalRankAdjustment` write.
3. No provider/DeepSeek/Git/deploy/rollback side effects in experiment evaluation.
4. UNKNOWN or absence is never converted to zero.
5. Position direction remains lower-is-better.
6. Visibility rate observations retain numerator/denominator evidence.
7. Contamination forces inconclusive interpretation.
8. Experiment and observation history remains immutable.
9. Web/API reads remain side-effect free and project scoped.
10. Observability remains bounded and secret-free.
11. P9-D language remains observational, not causal.

## Operational controls and rollback posture

The P9-D schema is additive and its experiment history is immutable. Production rollback must not rewrite historical experiment/observation rows.

If the capability must be disabled operationally:

- disable the feature/worker path;
- stop enqueueing new P9-D work;
- preserve existing immutable experiment evidence;
- do not bypass database immutability triggers;
- do not mutate P8/P9 authority to make old P9-D rows disappear.

Database migrations are forward-oriented. Historical rows remain auditable even when a later evaluator version or policy is introduced.

## Testing and release gate

P9-D release evidence includes:

- identity/idempotency and immutability tests;
- exact VERIFIED start-gate tests;
- Search and Visibility resolver tests;
- missing-baseline and incomplete-source tests;
- lower-is-better position tests;
- Visibility numerator/denominator persistence tests;
- contamination unit and real Prisma integration coverage;
- queue/worker/reconciliation tests;
- P8 handoff boundary tests;
- bounded observability tests;
- authority/static forbidden-write tests;
- read-only API/UI integration tests;
- Playwright E2E for GET side-effect freedom, missing baseline, contamination, visibility coverage, Standard denial, and cross-project hiding.

Before a P9-D implementation is treated as release-ready, run the exact current PR head through the repository CI gates:

```text
production-audit
e2e
verify
  - Prisma validation / migration
  - Typecheck
  - Full Vitest
  - Build
```

A green older head is not evidence for a newer documentation/code commit.

## Known limitation and P9-E boundary

P9-D measures observational association after a verified intervention. It does not prove that the intervention caused the observed movement. Search demand, competitors, seasonality, algorithm changes, provider sampling, and other unobserved factors may still contribute.

P9-D therefore persists evidence and classification, not a causal attribution score.

If experiment history is later used to influence optimization ranking, that feedback loop belongs to P9-E. P9-E must define its own versioned aggregation, eligibility, weighting, recency, contamination handling, and authority boundaries before it can change historical ranking adjustments.
