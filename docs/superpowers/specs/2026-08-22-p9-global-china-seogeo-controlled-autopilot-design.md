# P9 Global + China SEO/GEO Controlled Autopilot Design

Date: 2026-08-22
Status: Proposed design, implementation not started
Repository: `liufaxing1978-droid/seogeo`

## 1. Purpose

P9 turns the existing deterministic SEO/GEO intelligence and safe publication control plane into a controlled optimization loop for both overseas and mainland-China markets.

The platform target becomes:

> Global + China SEO/GEO Platform — multi-market search intelligence, AI visibility, controlled optimization planning, safe Draft-PR execution, deterministic verification, and measured feedback.

P0-P8-C remain complete. P9 must not invalidate their historical milestones or rewrite their authority boundaries. Where prior phases are Google- or provider-specific, P9 adds backward-compatible provider abstractions and adapters.

## 2. Non-goals and hard safety boundaries

P9 is not a fully autonomous production self-modifying system.

P9 MUST NOT:

- write directly to the default Git branch;
- auto-merge pull requests;
- auto-deploy production;
- auto-rollback production;
- let AI change deterministic P7 scores, evidence quality, risk class, approval requirements, or VERIFIED semantics;
- represent a model API sample as consumer-product ranking unless the provider contract explicitly supports that interpretation;
- bypass P8 immutable plans, previews, stale-review protection, exact base SHA/target-blob validation, mutation adapter, or real-site verification;
- treat missing/unknown source data as zero;
- allow community or entity platforms to become unattended posting channels where P8-C currently requires manual/preparation-only behavior.

P9 may automatically create a Draft PR only for pre-authorized LOW-risk changes under the controlled-autopilot policy described below.

## 3. Architectural direction

Chosen approach: layered closed-loop architecture.

The major responsibility boundaries are:

1. Search and AI providers produce persisted observations.
2. Unified evidence adapters normalize those observations without erasing provider provenance.
3. P7 remains the authoritative Growth opportunity layer.
4. P9 decides what eligible optimization should happen next and orchestrates bounded work.
5. P8 remains the authoritative publication/mutation/verification control plane.
6. Experiment and feedback layers measure observed outcomes and may only adjust recommendation ordering within bounded limits.

High-level flow:

```text
Global + China Search / AI Providers
        ↓
Unified persisted evidence
        ↓
P7 Growth Intelligence
        ↓
P9 Optimization Planner
        ↓
Controlled Autopilot Policy
        ↓
P8 Proposal → Draft → PublicationPlan → Preview → Mutation
        ↓
Draft PR
        ↓
Human merge / deployment
        ↓
P8 real-site verification
        ↓
P9 Experiment / Feedback
```

## 4. P9-0 Global + China SEO/GEO Foundation

P9-0 is required before P9-A so P9 does not bake Google-only assumptions into the planner.

### P9-0A Market / locale foundation

Introduce a reusable market dimension capable of representing at least:

- `CN`
- `GLOBAL`
- `HK`
- `TW`
- `SG`
- `MY`

and locales such as `zh-CN`, `zh-Hant`, and `en`.

Project configuration may enable multiple markets and multiple providers per market.

### P9-0B Global search provider layer

Initial provider targets:

- Google Search Console
- Bing Webmaster Tools

Future-compatible providers:

- Yandex Webmaster
- Naver Search Advisor
- other providers only through explicit adapters.

Existing Google Search Console ingestion remains valid and is wrapped by the generalized provider model instead of being deleted or reinterpreted.

### P9-0C China search provider layer

Initial provider targets:

- Baidu Search Resource Platform
- 360 Search webmaster platform
- Sogou webmaster/search resources where an official usable interface exists
- Shenma webmaster platform

Provider adapters must expose only capabilities actually supported by each official platform. Unsupported data remains explicit `UNKNOWN`/`NOT_SUPPORTED`, never fabricated.

The generalized search evidence surface may include:

- query/page performance;
- clicks, impressions, CTR, average position where officially available;
- index coverage;
- crawl and robots observations;
- sitemap/URL submission results;
- provider-specific diagnostics.

### P9-0D Global AI visibility providers

The existing P6 provider-neutral sampling layer remains authoritative. Expand it through explicit capabilities for providers such as:

- OpenAI / ChatGPT-related official APIs where supported;
- Google Gemini;
- Perplexity;
- Anthropic;
- Microsoft/Copilot-related official search-capable interfaces when suitable.

### P9-0E China AI visibility providers

Priority provider research/adapters:

- Baidu AI Search / Qianfan / ERNIE search-capable interfaces;
- Qwen / Model Studio web-search-capable interfaces;
- Tencent Hunyuan search-capable interfaces.

Secondary providers are enabled only when their official interfaces can support the required evidence semantics:

- DeepSeek;
- Doubao;
- Kimi;
- Yuanbao;
- Quark.

Every provider configuration declares capabilities, for example:

```text
MODEL_ONLY
WEB_GROUNDED
SEARCH_API
CITATION_NATIVE
CONSUMER_OBSERVATION
```

API sampling must never be labeled as consumer-app ranking unless the capability contract explicitly supports that claim.

### P9-0F Unified search facts

Add a provider-aware normalized fact layer that preserves:

- provider;
- market;
- locale;
- property/site identity;
- exact snapshot/cutoff;
- metric semantics;
- evidence state;
- source provenance.

The layer must not erase provider-specific facts. It supplies normalized inputs to P7 while preserving raw authoritative source references.

### P9-0G P7 multi-provider Growth adapter

P7 Growth identities, snapshots, score breakdowns, evidence, lifecycle, topic clustering, and UNKNOWN semantics remain authoritative.

Upgrade source ingestion so Growth can consume multiple provider facts instead of assuming GSC is the only search-performance source.

The upgrade must:

- preserve historical GSC-backed opportunities;
- attach provider/market provenance;
- avoid double-counting the same logical signal from multiple sources;
- keep deterministic Growth scoring versioned;
- never let AI merge or reinterpret authoritative facts.

### P9-0H Third-party Skill foundation

Prefer mature existing GitHub skills for SEO/GEO methods rather than reimplementing generic marketing knowledge.

Initial candidates include mature skills covering:

- SEO audit;
- AI SEO / GEO;
- schema;
- programmatic SEO;
- site architecture;
- content strategy;
- marketing loops;
- analytics;
- A/B testing;
- GEO content and quality evaluation.

Third-party skills MUST be treated as advisory method libraries, not authority or execution engines.

Vendor policy:

1. review repository maturity, maintenance, tests, and license;
2. pin an exact upstream commit SHA;
3. vendor the selected skill into this repository;
4. record source repository, license, upstream SHA, local version, and review date;
5. run compatibility/safety tests;
6. upgrades are explicit reviewed changes, never runtime pulls from upstream.

Third-party skills cannot own Git/provider credentials, risk classification, approvals, P7 facts, or P8 execution.

## 5. P9-A Optimization Planner

P9-A decides what eligible optimization should happen next. It does not execute website changes.

Suggested persisted entities:

### `OptimizationCandidate`

Key fields:

- projectId
- market / locale
- source type/id/snapshot id
- opportunity type
- canonical page/query
- deterministic score reference
- evidence quality/coverage
- risk class
- eligibility state
- eligibility reason codes
- createdAt

### `OptimizationPlan`

Key fields:

- candidateId
- planVersion
- recommended action type
- source fact references
- deterministic rank
- bounded AI rank adjustment
- bounded historical weight
- final rank
- automation eligibility
- explanation
- createdAt

Important distinction:

- P9 `OptimizationPlan` answers **what should be done and why**.
- P8 `PublicationPlan` answers **exactly what files/operations will change against which repository revision**.

P9 must never replace P8 PublicationPlan.

Planner pipeline:

```text
persisted P7/P6/P5 facts
→ deterministic eligibility
→ deterministic base rank
→ optional bounded DeepSeek ranking among already eligible candidates
→ frozen OptimizationPlan
```

AI may assist ordering and explanation only. It cannot change eligibility, risk, evidence quality, provider truth, or approval requirements.

## 6. P9-B Workflow Orchestrator

P9-B decides when planning runs and which durable step comes next.

Suggested entities:

### `OptimizationRun`

- projectId
- triggerType (`EVENT`, `DAILY_RECONCILIATION`, `MANUAL`)
- triggerKey
- status
- started/completed timestamps
- candidate/planned/executed/deferred/failure counters

### `OptimizationRunItem`

- runId
- optimizationPlanId
- currentStage
- status
- reasonCode
- linked P8 proposal/execution ids

New queues:

- `optimization-planning`
- `optimization-orchestration`
- `optimization-experiment-evaluation`

Use existing BullMQ rather than introducing a new general event bus in P9 V1.

### Hybrid triggers

Event-driven runs may follow persisted completion events such as:

- search-provider sync completed;
- Growth materialization completed;
- visibility metrics completed;
- visibility alert created;
- publication verification completed.

A daily reconciliation run provides a safety net for missed handoffs.

Trigger identity must be deterministic and idempotent, for example:

```text
sha256(projectId + triggerType + triggerSourceId + triggerVersion)
```

Daily reconciliation uses project + date + planner version.

## 7. P9-C Controlled Autopilot Policy

Chosen automation level: controlled autopilot.

P9 may automatically prepare work and create Draft PRs for eligible LOW-risk changes. It does not auto-merge or auto-deploy.

### Project-level explicit opt-in

Autopilot is OFF by default.

Suggested `AutopilotPolicy` fields:

- projectId
- enabled
- allowedRiskClass = LOW
- allowedOperationClasses[]
- dailyDraftPrLimit
- maxConcurrentRuns
- requireFreshEvidence
- minimumEvidenceCoverage
- pauseOnVerificationFailure
- killSwitch
- enabledBy/enabledAt
- updatedBy/updatedAt

Daily Draft PR quota defaults to 3 and is configurable from 1 to 10 per project.

### LOW-risk standard allowlist

The standard LOW-risk automatic preparation scope may include P8-defined LOW-risk operations such as:

- new single content page;
- Title/Meta Description;
- H1/FAQ;
- JSON-LD;
- ordinary internal links;

only if the resulting P8 validation still classifies the exact plan as LOW and all other gates pass.

### Required gates before automatic Draft PR execution

All must be true:

1. project autopilot enabled;
2. project/global kill switches off;
3. feature gate allows controlled autopilot;
4. candidate/current source versions are still current;
5. evidence freshness and coverage satisfy policy;
6. P8 risk is exactly LOW;
7. operations are allowlisted;
8. daily quota is available;
9. no conflicting active mutation exists for the canonical page;
10. no conflicting optimization plan exists;
11. deterministic P8 validation passes;
12. exact plan/preview exists;
13. base SHA and touched target blobs remain unchanged;
14. no stale review/revision state exists;
15. site/channel capability allows `GIT_DRAFT_PR`.

Any failed gate degrades to advisory/manual handling. P9 must not attempt a workaround.

### Kill switches

Two levels:

- project `AutopilotPolicy.killSwitch`;
- global `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH`.

When active, new automatic P8 executions are blocked. Existing Draft PRs/audit history are retained.

## 8. Optimization state machine

Recommended P9 states:

```text
DISCOVERED
→ ELIGIBLE
→ RANKED
→ PLANNED
→ READY_FOR_AUTOPILOT
→ HANDED_TO_P8
→ DRAFT_PR_CREATED
→ AWAITING_HUMAN_MERGE
→ DEPLOYED
→ OBSERVING
→ EVALUATED
```

Exceptional/deferred states:

```text
INELIGIBLE
DEFERRED_QUOTA
DEFERRED_CONFLICT
STALE
POLICY_BLOCKED
P8_VALIDATION_BLOCKED
EXECUTION_FAILED
VERIFICATION_FAILED
REPAIR_PROPOSED
CANCELLED
```

P9 status transitions dependent on publication/deployment/verification must be derived from persisted P8 facts. P9 cannot assert them independently.

## 9. Conflict, stale revision, and retry behavior

### Conflicts

- Same canonical page with active mutation → `DEFERRED_CONFLICT`.
- Two plans propose incompatible values for the same semantic field → regenerate from current facts; no automatic semantic merge.
- Changed P8 base SHA/target blob → `STALE`; regenerate exact preview, never fuzzy patch.

P9 V1 does not automatically merge otherwise-compatible plans.

### Retryable failures

Examples:

- Redis/BullMQ transient failure;
- bounded AI rate limit/transient provider error;
- Git provider transient error;
- temporary network failure.

Use bounded existing queue retry practices.

### Non-retryable failures

Examples:

- policy/risk/feature block;
- stale SHA/blob;
- insufficient evidence;
- invalid validation;
- unsupported operation;
- quota exhaustion for the current run.

These stop the automatic path.

### Verification failure

If P8 real-site verification fails:

1. persist failure as authoritative P8 evidence;
2. P9 may generate a repair/rollback Proposal + Preview;
3. stop automatic execution;
4. require human review/approval;
5. never auto-rollback production.

## 10. P9-D Experiment Engine

Experiments begin only after the corresponding P8 execution is observed as deployed and VERIFIED.

Suggested entities:

### `OptimizationExperiment`

- optimizationPlanId
- publicationExecutionId
- market/provider scope
- target URL
- intervention type
- baseline window
- observation windows
- baseline metrics
- expected direction
- verification status

### `OptimizationExperimentObservation`

- experimentId
- window type/day
- observedAt
- metrics
- effect state
- confidence/data-coverage state
- source snapshot references

Observation windows:

- Title/Meta: 7 / 14 / 28 days
- H1/FAQ/content page: 14 / 28 / 56 days
- AI visibility/entity work: provider sampling cadence

Effect states:

- `POSITIVE`
- `NEUTRAL`
- `NEGATIVE`
- `INCONCLUSIVE`

V1 reports observed association, not guaranteed causation, unless a future explicit controlled experiment design supports causal inference.

## 11. P9-E Feedback Learning

Suggested `OptimizationFeedbackProfile` tracks action-level outcome history such as:

- sample count;
- positive/neutral/negative counts;
- rolling observed effect score;
- bounded recommendation weight;
- last updated time.

Final recommendation order may conceptually combine:

```text
deterministicRank
+ boundedAIAdjustment
+ boundedHistoricalWeight
```

Historical weighting should remain small, for example constrained to `[-10, +10]` relative units.

Feedback MUST NOT change:

- P7 Growth score/formula;
- P8 risk class;
- evidence quality;
- approval requirement;
- VERIFIED semantics;
- Autopilot safety thresholds.

Only experiments with complete baseline, sufficient observation coverage, VERIFIED execution, no material conflicting mutation, and a conclusive effect state may update feedback.

## 12. P9-F Autonomous Operations Center

Add a top-level persisted-read workspace named `自动优化中心`.

Key views:

- opportunities discovered today;
- eligible/ineligible reasons;
- waiting for human review;
- auto-created Draft PRs;
- deployed/awaiting observation;
- experiments in progress;
- verification failures / repair proposals;
- quota use;
- Autopilot status;
- kill switch;
- 7/30-day outcome summary;
- recommendation-weight history.

GET rendering remains persisted-read only. Opening a dashboard must not enqueue work, call AI, execute Git, or recalculate facts.

Mutations use explicit project-scoped POST operations with existing authorization, security middleware, feature gates, and append-only audit evidence.

## 13. Feature gates

Proposed gates:

| Feature | Standard | Advanced | Enterprise |
| --- | --- | --- | --- |
| `OPTIMIZATION_PLANNER` | No | Yes | Yes |
| `OPTIMIZATION_ORCHESTRATION` | No | Yes | Yes |
| `CONTROLLED_AUTOPILOT` | No | Yes | Yes |
| `OPTIMIZATION_EXPERIMENTS` | No | Yes | Yes |
| `OPTIMIZATION_PORTFOLIO` | No | No | Yes |

`CONTROLLED_AUTOPILOT` availability never implies automatic enablement; project opt-in remains required.

## 14. Data model placement

Prefer a new Prisma model file:

```text
prisma/models/optimization.prisma
```

Ownership boundaries:

- P7 owns Growth intelligence truth.
- P8 owns publication/mutation/verification truth.
- P9 owns optimization decision/orchestration/experiment/feedback truth.

P9 may reference P7/P8 records but must not duplicate or overwrite their authoritative lifecycle state.

## 15. Audit and observability

Use append-only bounded events such as:

- `optimization.run.started`
- `optimization.candidate.discovered`
- `optimization.candidate.eligible`
- `optimization.plan.created`
- `optimization.plan.ranked`
- `optimization.autopilot.deferred`
- `optimization.p8.handoff.created`
- `optimization.draft_pr.created`
- `optimization.verification.failed`
- `optimization.repair.proposed`
- `optimization.experiment.started`
- `optimization.experiment.evaluated`
- `optimization.feedback.updated`

Observability payloads must remain allowlisted and exclude credentials, prompt/answer bodies, provider reasoning, article bodies, raw provider payloads, and other unnecessary sensitive content.

## 16. CI and release gates

Every P9 sub-phase follows the existing exact-head discipline.

### `verify`

Must cover:

- Prisma validate/generate/migrate;
- TypeScript;
- full Vitest;
- build.

### `e2e`

Full Chromium Playwright, including relevant P9 flows.

### `production-audit`

Keep the deployable-runtime dependency audit requirement.

### P9-specific release assertions

CI must prove at minimum:

- AI cannot override risk;
- AI cannot override deterministic eligibility;
- P9 cannot merge PRs;
- P9 cannot deploy production;
- P9 cannot automatically rollback production;
- GET routes have no side effects;
- MEDIUM/HIGH cannot enter automatic mutation;
- Autopilot is disabled by default;
- project quota enforcement is deterministic;
- stale revisions fail closed;
- unverified executions cannot enter feedback;
- provider capability labels prevent model-only samples from being represented as consumer search ranking;
- P7/P8 historical facts remain backward compatible.

## 17. Proposed delivery sequence

### P9-0 Foundation

- Market/locale model
- Global search providers
- China search providers
- Global AI visibility expansion
- China AI visibility expansion
- Unified search facts
- P7 multi-provider adapters
- third-party Skill registry/vendor/safety tests

### P9-A Planner

Tasks 1-6: models, eligibility, deterministic ranking, bounded DeepSeek advisor, APIs, UI.

### P9-B Orchestrator

Tasks 7-11: run models, queues, hybrid triggers, idempotency, retry/reconciliation.

### P9-C Controlled Autopilot

Tasks 12-18: policy, feature gates, opt-in, LOW allowlist, quota/concurrency, P8 handoff, Draft-PR E2E.

### P9-D Experiment Engine

Tasks 19-23: experiment model, baseline, scheduling, evaluator, UI.

### P9-E Feedback Loop

Tasks 24-27: feedback profiles, bounded weighting, contamination guards, audit/UI.

### P9-F Operations Center

Tasks 28-32: dashboard, policy controls, kill switch, failure/deferred/stale views, effectiveness report.

The exact P9-0 task count and final Task 1-32 numbering are intentionally deferred to the implementation plan because provider capability research may change how P9-0 decomposes without changing this design.

## 18. Success criteria

P9 design is successful when the platform can:

1. represent domestic and overseas search/AI providers without provider-specific logic leaking into Growth or publication control;
2. preserve P0-P8 historical data and safety semantics;
3. derive deterministic, source-backed optimization eligibility from persisted evidence;
4. use AI only for bounded advisory ranking/explanation/drafting;
5. automatically create only pre-authorized LOW-risk Draft PRs under explicit project policy and quota;
6. keep production merge/deploy/rollback human-controlled;
7. measure verified changes against provider-specific baselines;
8. use outcomes only to adjust recommendation ordering, never deterministic authority;
9. reuse mature third-party SEO/GEO Skills where safe instead of duplicating generic methods;
10. remain fully auditable, fail-closed, idempotent, and exact-revision bound.
