# P9-E Feedback Learning

## Purpose

P9-E converts qualified, completed P9-D experiment observations into bounded historical ranking evidence for **new** P9-A V2 optimization plans.

P9-E is a deterministic learning layer, not a causal inference engine. It answers:

- which completed experiment observations are eligible to become historical feedback;
- which exact project / market / locale / action scope that feedback belongs to;
- what bounded historical rank adjustment follows from the latest qualified evidence;
- which immutable feedback profile a later P9-A V2 plan froze at materialization time.

P9-E does **not** rewrite P7, P8, P9-A V1, P9-C, or P9-D authority.

The authority chain is:

```text
P7 Growth facts
→ immutable P9-A OptimizationCandidate / OptimizationPlan V1
→ exact P8 PublicationProposal(source=P9_OPTIMIZATION_PLAN)
→ exact P8 PublicationExecution(status=VERIFIED)
→ exact P8 PublicationVerification(status=VERIFIED)
→ frozen P9-D OptimizationExperiment
→ immutable P9-D OptimizationExperimentObservation
→ P9-E terminal/eligibility policy
→ immutable OptimizationFeedbackEvidence
→ immutable versioned OptimizationFeedbackProfile
→ optional new P9-A OptimizationPlan V2
```

Existing source rows remain unchanged throughout this chain.

## Feature availability

| Plan | Feedback learning |
| --- | --- |
| `STANDARD` | No |
| `ADVANCED` | Yes |
| `ENTERPRISE` | Yes |

The exact capability is `OPTIMIZATION_FEEDBACK`.

The service and API fail closed for plans without the capability. Standard-plan materialization is rejected before the restricted feedback context read, and Standard API requests are rejected before the feedback API port is invoked.

## Authority boundaries

P9-E owns only its own immutable evidence/profile records and a bounded read-only audit API.

P9-E does not:

- mutate `GrowthOpportunity*` records;
- mutate `OptimizationCandidate`;
- mutate an existing `OptimizationPlan`;
- mutate `OptimizationExperiment` or `OptimizationExperimentObservation`;
- mutate P8 publication proposal, plan, approval, execution, verification, or rollback state;
- change P8 risk class or approval requirements;
- change P9-C autopilot safety policy, kill switches, or quotas;
- call DeepSeek, `AiGateway`, Search providers, Visibility providers, Git/GitHub mutation adapters, deployment, or rollback APIs;
- enqueue Search or Visibility sampling;
- turn missing/unknown/inconclusive evidence into a numeric negative sample;
- claim that a measured before/after effect is causal.

Static authority tests scan the entire `src/modules/optimization-feedback` module and reject direct imports or mutations that would cross these boundaries.

## One experiment, one sample

An `OptimizationExperiment` can contribute **at most one** `OptimizationFeedbackEvidence` row.

Uniqueness is protected by immutable identity and database uniqueness across the experiment and accepted observation identities. Re-running materialization returns the existing evidence only when the full immutable payload matches. Identity mismatch fails closed.

Once one observation for an experiment has been accepted, later observations for the same experiment cannot create another feedback sample.

## Deterministic terminal observation selection

P9-E learns only from the **terminal window** in the P9-D frozen schedule.

The terminal window is the final valid schedule entry stored in the immutable experiment schedule. P9-E does not recompute a new schedule from current configuration.

A single terminal window may have more than one immutable P9-D observation because the input cutoff or source references can change between evaluations. Candidate terminal observations are evaluated deterministically in:

```text
inputCutoffAt ASC
observationId ASC
```

The first terminal observation satisfying every feedback eligibility gate becomes the sole accepted evidence.

Consequences:

- an earlier non-terminal observation is never a sample;
- an earlier terminal `INCONCLUSIVE`, insufficient, or contaminated observation is not converted into negative feedback;
- such an earlier rejected terminal observation does not permanently poison the experiment;
- a later terminal observation may qualify if it independently satisfies all gates;
- selection is based on eligibility/order, never on choosing the most favorable outcome.

## Eligibility gates

A feedback sample is accepted only when all required persisted authority facts agree.

The accepted observation must have:

- terminal frozen schedule identity;
- effect state `POSITIVE`, `NEUTRAL`, or `NEGATIVE`;
- coverage `SUFFICIENT`;
- contamination `CLEAR`;
- a supported evaluator/profile version;
- a valid exact feedback scope;
- no already accepted feedback evidence for the experiment.

The P8 authority chain must also be exact:

- experiment, optimization plan, candidate, execution, verification, and proposal belong to the same project;
- experiment references the exact optimization plan;
- experiment references the exact execution;
- experiment references the exact verification;
- execution status is `VERIFIED`;
- verification status is `VERIFIED`;
- verification references that exact execution;
- publication proposal source is exactly `P9_OPTIMIZATION_PLAN`;
- proposal `sourceReferenceId` equals the exact optimization plan id.

Missing or inconsistent authority never falls back to inference.

## Deferred reason codes

Stable P9-E deferred reason codes include:

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

A deferred result creates no numeric sample.

## Exact scope isolation

Feedback is isolated by the exact tuple:

```text
projectId
marketScopeMode
marketCode
locale
recommendedActionType
```

`CONFIGURED_MARKET` requires a non-null market and non-empty locale.

Legacy data remains:

```text
marketScopeMode = UNCONFIGURED_LEGACY
marketCode = null
locale = null
```

Legacy scope is never promoted to global scope. Configured and legacy scopes never pool. Different projects, markets, locales, or recommended action types cannot enter one another's profile.

The deterministic `scopeKey` is derived from the exact normalized tuple and is also the serialization boundary for profile materialization.

## Immutable feedback evidence

`OptimizationFeedbackEvidence` is append-only. It freezes the accepted experiment/observation and all ranking-relevant provenance, including:

- project;
- experiment;
- observation;
- optimization plan;
- candidate;
- feedback evidence version/key;
- exact scope key and market identity;
- recommended action type;
- effect state and numeric feedback value;
- terminal window type/days;
- input cutoff;
- source evaluator version;
- source observation key.

Effect mapping is deterministic:

```text
POSITIVE → +1
NEUTRAL  →  0
NEGATIVE → -1
```

The numeric value is a feedback-learning input, not a rewrite of P9-D's observation.

PostgreSQL `BEFORE UPDATE OR DELETE` protection rejects mutation of feedback evidence.

## Immutable versioned profiles

`OptimizationFeedbackProfile` is an immutable snapshot of the exact evidence set used for a scope.

It stores:

- profile version/key;
- exact scope;
- sample and effect counts;
- rolling effect balance;
- bounded historical rank adjustment;
- window limit;
- oldest/newest evidence cutoff;
- ordered evidence ids;
- input fingerprint.

A newer evidence set creates a new profile. Older profiles remain unchanged.

PostgreSQL `BEFORE UPDATE OR DELETE` protection rejects profile mutation.

## Rolling evidence window and profile formula

Only the latest **20** accepted evidence rows in the exact scope contribute to the current profile.

Evidence identity order is deterministic:

```text
inputCutoffAt ASC
observationId ASC
```

After choosing the latest 20, their ordered evidence ids form the profile input fingerprint.

For:

```text
p = positive count
u = neutral count
n = negative count
sampleCount = p + u + n
```

When `sampleCount < 3`:

```text
rollingEffectBalance = 0
historicalRankAdjustment = 0
```

When `sampleCount >= 3`:

```text
rollingEffectBalance = (p - n) / sampleCount
shrinkage = sampleCount / (sampleCount + 5)
rawAdjustment = -10 * rollingEffectBalance * shrinkage
historicalRankAdjustment = round(rawAdjustment)
```

The final historical adjustment is clamped to:

```text
[-10, +10]
```

Negative ranking adjustments improve ordering; positive adjustments worsen ordering.

The profile is descriptive historical weighting. It does not change P7 Growth score, evidence quality, or P8 safety classification.

## Current-profile lookup

P9-A V2 does not select a profile by lexically sorting profile hashes or by trusting a mutable pointer.

The repository first derives the **current persisted last-20 evidence identity** for the exact scope, calculates the expected input fingerprint, and then looks up a matching immutable profile with:

- exact project;
- exact profile version;
- exact scope key;
- exact calculated input fingerprint.

If no compatible profile exists, P9-A V2 freezes historical adjustment `0`.

This prevents an old profile with a lexically larger hash from becoming "latest".

## Concurrency and serialization

Same-scope materialization is serialized with a PostgreSQL transaction-level advisory lock derived from the deterministic scope key.

Inside the lock P9-E:

1. checks whether the experiment already has evidence;
2. creates or reuses the exact immutable evidence;
3. reads the exact scope evidence set;
4. calculates the rolling profile;
5. creates or reuses the exact immutable profile.

Concurrent experiments in the same scope therefore converge on deterministic evidence/profile history instead of racing to overwrite mutable state.

## P9-A V1 remains unchanged

`OPTIMIZATION_PLAN_V1` is preserved as the historical compatibility contract:

```text
historicalRankAdjustment = 0
```

Default P9-A materialization remains V1. It does not read P9-E feedback.

Existing V1 plans are immutable and are never upgraded in place.

## P9-A V2 opt-in

P9-E introduces an opt-in plan version:

```text
OPTIMIZATION_PLAN_V2
```

Only creation of a **new** V2 plan may freeze a compatible feedback profile.

A V2 plan freezes bounded feedback provenance in its explanation, including:

- feedback profile id;
- feedback profile version;
- feedback input fingerprint;
- feedback sample count;
- frozen historical rank adjustment;
- whether historical fallback was applied.

A newer feedback profile created later cannot change an already-created V2 plan.

## AI authority and prompt isolation

AI ranking authority remains bounded to its existing small adjustment:

```text
aiRankAdjustment ∈ [-2, +2]
```

For V2 AI ranking, the durable AI task fact snapshot freezes the compatible feedback provenance and historical adjustment. This ensures asynchronous completion uses the exact feedback facts available when the task was enqueued.

However, those feedback fields are **not visible to DeepSeek**.

Before building the user prompt, the worker projects V2 ranking facts and removes:

- feedback object;
- profile id;
- input fingerprint;
- sample count;
- historical rank adjustment.

The AI request identity still hashes the complete frozen task fact snapshot. Therefore two tasks with different frozen feedback have different durable request identity even though DeepSeek receives the same ranking-visible facts.

AI cannot choose, modify, or override historical feedback.

## V2 rank composition and displacement fallback

V2 ranking composes:

```text
deterministicRank
+ aiRankAdjustment
+ historicalRankAdjustment
```

Historical feedback is bounded `[-10,+10]`; AI remains independently bounded `[-2,+2]`.

The final safety invariant is:

```text
abs(finalRank - deterministicRank) <= 10
```

If applying historical feedback would make any candidate violate that overall displacement bound, the materialization performs a deterministic **whole-set historical fallback**:

- every historical adjustment in that set becomes `0`;
- already-valid bounded AI adjustments are preserved;
- fallback is frozen in the V2 explanation.

This avoids per-candidate clipping that could silently distort rank ordering.

## Queue and P9-D handoff

The feedback queue is:

```text
optimization-feedback-materialization
```

Observation job identity includes:

```text
projectId
experimentId
observationId
feedbackEvidenceVersion
```

Queue attempts are bounded to `2`, with bounded retry/backoff settings.

After P9-D persists an observation, the experiment worker may perform a best-effort P9-E handoff.

The ordering is deliberate:

```text
P9-D evaluateWindow
→ durable observation result
→ best-effort feedback enqueue
```

If feedback enqueue fails, the P9-D worker catches that handoff error. The already-persisted P9-D observation remains authoritative and the P9-D evaluation job still resolves successfully.

P9-E never makes P9-D persistence dependent on Redis/queue availability.

## Daily reconciliation

P9-E daily reconciliation repairs missed best-effort handoffs.

V1 reconciliation is intentionally bounded:

```text
lookback = previous 90 days
max terminal candidates = 100 per eligible project per run
eligible projects = ADVANCED / ENTERPRISE
```

The repository reads persisted P9-D observations only. It selects terminal observations whose experiment has no accepted feedback evidence and whose stored terminal window/due time matches the frozen experiment schedule.

Reconciliation enqueues the normal idempotent observation job. It does not directly create feedback, call providers, or mutate P9-D.

There is no public unlimited historical backfill endpoint in V1.

## GET-only audit API

P9-E exposes exactly:

```text
GET /api/projects/:projectId/optimization-feedback/profiles
GET /api/projects/:projectId/optimization-feedback/profiles/:profileId
GET /api/projects/:projectId/optimization-feedback/evidence
```

There are no public P9-E `POST`, `PUT`, `PATCH`, or `DELETE` routes.

Pagination is bounded:

```text
limit: default 50, range 1..100
offset: default 0, range 0..100000
```

The API returns persisted audit/provenance fields only. It does not expose raw P9-D metric JSON, prompts, model reasoning, provider payloads, credentials, or a mutation control surface.

A profile id is always queried together with the route project id. A foreign-project profile therefore returns not-found rather than leaking the row.

## Observability

P9-E observability is allowlisted and bounded.

Events include:

```text
optimization.feedback.accepted
optimization.feedback.deferred
optimization.feedback.profile.created
optimization.feedback.reconciled
```

Metadata is restricted to operational identifiers and bounded learning state, such as project/experiment/observation/evidence/profile ids, action type, market/locale when present, sample count, historical adjustment, and stable reason codes.

Raw prompts, answers, provider payloads, credentials, raw metric JSON, and arbitrary source content are not observability metadata.

## Idempotency and failure semantics

P9-E is fail-closed and append-only.

- duplicate exact evidence returns the existing row;
- duplicate exact profile returns the existing row;
- a uniqueness race is re-read and accepted only if the complete immutable payload matches;
- evidence/profile identity collisions throw instead of rewriting history;
- incomplete P8 authority defers;
- invalid scope defers;
- unsupported/inconclusive/insufficient/contaminated observations defer;
- missing profile for an already-created evidence can be deterministically repaired from persisted evidence;
- UNKNOWN is never converted into zero or negative feedback.

## Rollout and rollback

P9-E migrations are additive.

Application rollback must **not** rewrite or delete feedback history. Immutable feedback rows remain valid historical records even if a previous application version no longer consumes them.

If database removal is ever required, it must be performed by a separate reviewed forward migration with explicit data-retention and authority analysis. Application rollback is not permission to bypass immutability triggers.

P9-A V2 is opt-in, so disabling V2 consumption does not require mutating V1 plans or historical feedback.

## Verification expectations

Release verification must include:

- Prisma schema validation;
- Prisma client generation;
- migration deploy on a clean database;
- TypeScript typecheck;
- full Vitest suite;
- production build;
- browser E2E;
- deployable production dependency audit.

Focused P9-E regression covers:

- feature gate;
- identity and scope hashing;
- terminal eligibility;
- profile formula/latest-20 behavior;
- observability allowlist;
- queue identity/retry bounds;
- materialization worker and reconciliation;
- P9-D handoff resilience;
- immutable persistence/idempotency;
- real persisted P8/P9-A/P9-D authority checks;
- read-only API tenancy;
- V2 deterministic ranking and whole-set fallback;
- V2 AI frozen facts and prompt isolation;
- static forbidden-authority scanning.

Expected negative-test database errors from immutability or uniqueness constraints are acceptable only when the corresponding passing test explicitly asserts fail-closed behavior.

## Non-authorities summary

P9-E is intentionally narrow. It has **zero runtime authority** to:

- call DeepSeek or another AI provider;
- call Search or Visibility providers;
- sample external metrics;
- write Git/GitHub;
- create/approve/execute publication changes;
- merge or deploy;
- rollback publication;
- modify P7 scores/evidence;
- modify P8 safety or verification;
- modify P9-C autopilot safety;
- rewrite P9-D experiments/observations;
- rewrite P9-A V1.

Its only learning write authority is to append exact immutable P9-E feedback evidence/profile records, after strict persisted authority checks, for bounded use by future opt-in P9-A V2 plans.
