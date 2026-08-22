# P9-A Optimization Planner Design

Date: 2026-08-22
Status: Approved design
Repository: `liufaxing1978-droid/seogeo`
Base: `main@60c9dbf56c23d4b7644913e123383538d6f8699c`
Branch: `feat/p9-a-optimization-planner`

## 1. Purpose

P9-A introduces the first planning layer after P7 Growth Intelligence and before P8 publication/mutation control.

P9-A answers one bounded question:

> Given already-persisted authoritative Growth opportunities, what optimization should be considered next, in what deterministic order, and with what bounded advisory context?

P9-A does not execute website changes. It creates immutable optimization candidates and immutable optimization plans that later phases may consume.

The selected architecture is a **P7-authoritative-entry planner**. P9-A consumes P7 `GrowthOpportunitySnapshot` data and its persisted evidence/provenance rather than rebuilding opportunity facts independently from P5, P6, Search Facts, or third-party skills.

## 2. Hard authority boundaries

P9-A MUST NOT:

- change P7 Growth opportunity identities, scoring, priorities, evidence quality, evidence coverage, lifecycle semantics, or UNKNOWN behavior;
- recalculate or reinterpret provider facts already normalized into P7;
- treat missing/unknown data as zero, false, success, failure, or an inferred market;
- let AI create or delete candidates, change eligibility, change action type, change P7 score, change evidence, change market/locale, or manufacture facts;
- let third-party advisory skills own facts, scores, risk, approvals, execution, credentials, merge, deploy, rollback, or VERIFIED semantics;
- assign authoritative P8 risk class or approval requirements;
- create P8 `PublicationProposal`, `PublicationPlan`, preview, mutation execution, Draft PR, merge, deployment, or rollback;
- write directly to the default Git branch;
- auto-merge or auto-deploy;
- read or execute raw vendored third-party Markdown as runtime instructions;
- introduce a second provider normalization layer or a second Growth scoring formula.

P7 remains authoritative for facts/opportunities. P8 remains authoritative for mutation safety, risk/approval, execution, and verification.

## 3. Chosen architecture

High-level data flow:

```text
P5 / P6 / Search Facts
        ↓
P7 Growth Intelligence
(authoritative opportunity snapshot)
        ↓
P9-A Candidate Materializer
        ↓
Deterministic Eligibility Gate
        ↓
Deterministic Action Mapping
        ↓
Deterministic Base Rank
        ↓
P9-0H Advisory Projection Packaging
(ADVISORY_ONLY context)
        ↓
Optional DeepSeek Bounded Re-rank
(adjustment only, fail-open to 0)
        ↓
Frozen OptimizationPlan
        ↓
P9-B Workflow Orchestrator (future)
```

P9-A stops at the frozen `OptimizationPlan` boundary.

## 4. Candidate source contract

P9-A V1 consumes the latest persisted P7 Growth opportunity snapshot for each Growth opportunity identity.

The planner does not independently query P5/P6/Search Facts to synthesize additional opportunities. Those sources remain represented through P7 evidence/provenance.

A candidate source projection must retain references to at least:

- Growth opportunity identity id;
- Growth opportunity snapshot id;
- Growth snapshot/formula version;
- Growth opportunity type;
- normalized query;
- canonical page when present;
- P7 score and score state;
- P7 priority;
- P7 evidence quality and coverage;
- P7 ranking eligibility;
- P7 lifecycle state;
- P7 source provenance reference/normalized planner projection.

The planner must not copy arbitrary raw provider payloads into candidate rows.

## 5. Persisted entities

### 5.1 `OptimizationCandidate`

Required conceptual fields:

- `id`
- `projectId`
- `growthOpportunityIdentityId`
- `growthSnapshotId`
- `candidateVersion`
- `candidateKey`
- `marketScopeMode`
- `marketCode` nullable
- `locale` nullable
- `opportunityType`
- `normalizedQuery`
- `canonicalPage` nullable
- `growthScore` nullable
- `growthScoreState`
- `growthPriority`
- `growthEvidenceQuality`
- `growthEvidenceCoverage`
- `growthRankingEligible`
- `growthLifecycleStatus`
- `sourceProvenance`
- `eligibilityState`
- `eligibilityReasonCodes`
- `createdAt`

Candidate rows are immutable after creation.

### 5.2 `OptimizationPlan`

Required conceptual fields:

- `id`
- `candidateId`
- `projectId`
- `planVersion`
- `recommendedActionType`
- `sourceFactReferences`
- `deterministicRank`
- `aiRankAdjustment`
- `historicalRankAdjustment`
- `finalRank`
- `advisoryContext`
- `automationEligibility`
- `explanation`
- `createdAt`

Plan rows are immutable after creation.

P9-A V1 sets `automationEligibility = false` for every plan. P9-C owns controlled-autopilot policy later.

## 6. Stable candidate identity

Candidate identity must be deterministic and idempotent.

`candidateKey` is SHA-256 over canonical JSON containing only stable identity fields:

```text
candidateVersion
projectId
growthOpportunityIdentityId
growthSnapshotId
marketScopeMode
marketCode
locale
```

Rules:

- canonical object keys are sorted before hashing;
- nullable values remain explicit `null` when part of the identity contract;
- duplicate materialization of the same source/scope returns the same candidate identity;
- a new Growth snapshot creates a new candidate identity;
- historical candidate rows are never rewritten to point at newer Growth snapshots.

## 7. Market and locale projection

P9-A consumes the P9-0G `GROWTH_SEARCH_PROVENANCE_V1` semantics from P7 `sourceProvenance`.

### 7.1 Configured-market mode

When Growth provenance exposes:

```text
mode = CONFIGURED_MARKET
```

P9-A materializes one candidate per distinct valid `(marketCode, locale)` projection represented by the Growth scoring-lane provenance.

Rules:

- market/locale values must come from persisted provenance, never Project defaults guessed by P9-A;
- duplicate identical market/locale projections are deduped deterministically;
- contradictory malformed provenance fails closed for planning of that snapshot;
- P9-A does not merge multiple market scopes into a synthetic GLOBAL candidate.

### 7.2 Legacy mode

When Growth provenance exposes:

```text
mode = UNCONFIGURED_LEGACY
```

P9-A creates a single legacy candidate with:

```text
marketScopeMode = UNCONFIGURED_LEGACY
marketCode = null
locale = null
```

It must not invent `GLOBAL`, `CN`, `zh-CN`, `en`, or any other value.

### 7.3 Unknown/malformed provenance

If a Growth snapshot lacks the minimum market provenance required by the supported P9-0G contract, P9-A records a deterministic ineligible/no-plan reason rather than filling defaults.

## 8. Deterministic eligibility policy

Eligibility is a planner gate, not a new Growth score.

An OptimizationCandidate is eligible only when all V1 conditions pass:

- `growthRankingEligible === true`;
- `growthScoreState === KNOWN`;
- `growthScore !== null` and is finite;
- lifecycle state is not terminal for planning;
- opportunity type has an explicit supported action mapping;
- market provenance is valid for its declared mode;
- required source references/provenance are present and structurally valid.

Terminal lifecycle states for P9-A V1:

- `DONE`
- `DISMISSED`
- `RESOLVED`

Other states remain potentially plan-eligible if the rest of the gate passes.

Eligibility states:

```text
ELIGIBLE
INELIGIBLE
```

Reason codes must be deterministic, stable strings. Initial required reasons include:

```text
GROWTH_NOT_RANKING_ELIGIBLE
GROWTH_SCORE_UNKNOWN
GROWTH_SCORE_MISSING
GROWTH_LIFECYCLE_TERMINAL
UNSUPPORTED_OPPORTUNITY_TYPE
INVALID_MARKET_PROVENANCE
SOURCE_PROVENANCE_MISSING
```

Unknown data never becomes an inferred pass.

## 9. Deterministic action mapping

AI cannot choose the action class.

V1 action mapping is fixed:

| P7 GrowthOpportunityType | P9-A RecommendedActionType |
| --- | --- |
| `RANKING_UPSIDE` | `ON_PAGE_OPTIMIZATION` |
| `CTR_UNDERPERFORMANCE` | `SERP_SNIPPET_OPTIMIZATION` |
| `CONTENT_GAP` | `CONTENT_CREATION` |
| `NEW_CONTENT_OPPORTUNITY` | `CONTENT_CREATION` |
| `SEO_GAP` | `TECHNICAL_SEO_REMEDIATION` |
| `GEO_CITABILITY_GAP` | `GEO_CITABILITY_IMPROVEMENT` |
| `AI_VISIBILITY_GAP` | `AI_VISIBILITY_IMPROVEMENT` |
| `KEYWORD_CANNIBALIZATION` | `CANNIBALIZATION_REMEDIATION` |
| `DECLINING_PERFORMANCE` | `CONTENT_REFRESH` |

Changes to this table require an explicit versioned planner change.

## 10. Deterministic base ranking

P9-A does not calculate a second opportunity score. It uses P7 values to establish an ordering among already-eligible candidates.

V1 ordering inputs, in order:

1. P7 `growthScore` descending;
2. P7 priority ordinal (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `MONITOR`, `UNKNOWN`), with eligible candidates expected to have known ranking semantics;
3. evidence coverage descending;
4. deterministic candidate key ascending as final tiebreak.

The persisted `deterministicRank` is a 1-based ordinal after this ordering within one planner materialization scope.

P9-A does not change the stored P7 score or priority.

## 11. Historical adjustment

P9-A V1 defines the field but does not yet learn from outcome history.

```text
historicalRankAdjustment = 0
```

A later experiment/feedback phase may introduce a bounded versioned adjustment. P9-A V1 must not invent historical weighting before the outcome data contract exists.

## 12. Third-party advisory skill handoff

P9-0H remains advisory-only.

P9-A may attach bounded advisory projections to a plan according to deterministic action-to-method mapping. It may consume only `LoadedAdvisoryMethod` from `createAdvisorySkillRegistry({ rootDir })`.

It must never consume raw upstream Markdown bodies or execute vendor content.

Initial advisory mapping:

| RecommendedActionType | Advisory method keys |
| --- | --- |
| `ON_PAGE_OPTIMIZATION` | `ON_PAGE_SEO_CHECK`, `SEO_AUDIT` |
| `SERP_SNIPPET_OPTIMIZATION` | `ON_PAGE_SEO_CHECK`, `ANALYTICS` |
| `CONTENT_CREATION` | `CONTENT_STRATEGY`, `CONTENT_QUALITY_AUDIT` |
| `TECHNICAL_SEO_REMEDIATION` | `TECHNICAL_SEO_CHECK`, `SEO_AUDIT` |
| `GEO_CITABILITY_IMPROVEMENT` | `AI_SEO`, `CONTENT_QUALITY_AUDIT` |
| `AI_VISIBILITY_IMPROVEMENT` | `AI_SEO`, `CONTENT_QUALITY_AUDIT` |
| `CANNIBALIZATION_REMEDIATION` | `SITE_ARCHITECTURE`, `SEO_AUDIT` |
| `CONTENT_REFRESH` | `CONTENT_QUALITY_AUDIT`, `CONTENT_STRATEGY` |

Persisted advisory context stores bounded provenance, not arbitrary vendor data. At minimum:

- `skillId`
- `methodKey`
- `projectionSha256`
- `sourceRepo`
- `upstreamCommit`
- `localVersion`

The authority value remains `ADVISORY_ONLY` in first-party code.

If the advisory registry fails integrity validation, P9-A fails closed for advisory packaging of the affected planning execution. It must not fetch replacement skills from the network or silently bypass the hash chain.

## 13. Optional DeepSeek bounded re-ranking

P9-A may use DeepSeek only after deterministic candidate eligibility, action mapping, and base ranking are complete.

Introduce a dedicated AI task contract such as:

```text
AiTaskType = OPTIMIZATION_PLAN_RANKING
promptVersion = optimization-plan-ranking-v1
```

The model receives only bounded planner facts and supplied candidate/source references.

Allowed model output per candidate:

```text
candidateId
adjustment
explanation
sourceReferences
```

Validation rules:

- every returned candidate id must be in the supplied eligible candidate set;
- no candidate may appear twice;
- `adjustment` must be an integer in `[-2, -1, 0, 1, 2]`;
- model output cannot add fields that alter eligibility, score, action, market, risk, approval, evidence, or source facts;
- all returned source references must be a subset of supplied source references;
- structured output is strict and rejects unknown fields;
- malformed/invalid output is rejected.

AI failure semantics:

- provider unavailable, task failure, invalid structured output, or rejected source references must not make deterministic planning unavailable;
- fallback is `aiRankAdjustment = 0` for all candidates;
- the failure is observable/auditable;
- AI failure cannot change candidate eligibility.

`finalRank` is recalculated deterministically from bounded adjustments with a stable tie-break. The model cannot directly return final ordinal rank.

## 14. Plan explanation

Each frozen plan contains a first-party deterministic explanation summary including:

- source Growth opportunity type;
- P7 score/priority/evidence state references;
- deterministic action mapping reason;
- market scope;
- advisory method identities selected;
- whether AI adjustment was applied or defaulted to zero.

DeepSeek may provide a bounded explanatory annotation, but first-party code must distinguish model commentary from authoritative source facts.

## 15. Persistence and immutability

P9-A introduces a dedicated Prisma model file and migration.

Requirements:

- candidate uniqueness is enforced with `candidateKey` plus project identity as appropriate;
- plan uniqueness is versioned per candidate/planner materialization contract;
- candidate and plan rows cannot be updated or deleted through normal repository APIs;
- database migration should add protective immutability triggers following existing project conventions where used by P7/P8 immutable artifacts;
- repository APIs expose create/get/list operations only for immutable artifacts;
- planner retries are idempotent.

A P9-A rollback is a normal additive schema rollback by reverting the PR/migration only under the repository's established migration policy; historical rows must not be silently rewritten.

## 16. Service boundary

Expected first-party module boundary:

```text
src/modules/optimization/
```

Suggested responsibilities:

- `optimization.types.ts` — planner enums/contracts;
- `optimization.policy.ts` — eligibility, action map, ranking and advisory map constants;
- `optimization.provenance.ts` — strict Growth market/source provenance projection;
- `optimization.candidate.ts` — candidate identity/materialization functions;
- `optimization.ranking.ts` — deterministic rank and bounded adjustment application;
- `optimization.repository.ts` — immutable persistence;
- `optimization.service.ts` — orchestration of candidate/plan materialization;
- optional `optimization.routes.ts` only if a read/manual-trigger API is required by implementation scope;
- AI-specific builder/parser remains under `src/modules/ai/` following current project patterns.

P9-A V1 does not add BullMQ optimization orchestration queues. P9-B owns durable workflow orchestration.

## 17. Runtime triggering scope

P9-A V1 should expose an explicit service/manual materialization entrypoint that P9-B can call later.

It must not independently add:

- cron scheduling;
- event bus infrastructure;
- daily reconciliation;
- optimization orchestration queues.

This prevents P9-A from pre-implementing P9-B.

## 18. API scope

If an HTTP surface is added in P9-A, it is limited to authenticated project-scoped read/manual-planning operations and must follow existing route/service patterns.

No P9-A endpoint may:

- execute publication;
- mutate site content;
- create or merge PRs;
- change P8 approval state;
- change P7 Growth source facts or lifecycle as a side effect of merely reading a plan.

An HTTP route is not required if tests/service integration prove the planner boundary without it.

## 19. Testing strategy

P9-A requires TDD coverage for at least:

1. deterministic candidate key generation;
2. configured-market candidate fan-out;
3. legacy market candidate with null market/locale;
4. malformed/unknown provenance fail-closed behavior;
5. eligibility reason codes;
6. complete opportunity-to-action mapping;
7. deterministic ranking/tiebreaks;
8. bounded `[-2,+2]` AI adjustment validation;
9. invalid/duplicate/unknown AI candidate id rejection;
10. AI failure fallback to zero adjustment;
11. advisory action-to-method mapping and exact provenance packaging;
12. no raw vendor body exposure;
13. idempotent candidate/plan persistence;
14. immutability of frozen candidate/plan artifacts;
15. P7 score/evidence/lifecycle authority isolation;
16. P8 risk/approval/mutation/verification authority isolation;
17. no automatic Draft PR/merge/deploy path from P9-A;
18. migration validation;
19. full existing Vitest regression;
20. TypeScript typecheck and build.

## 20. Release gate

Before P9-A may be marked complete:

- Prisma schema validates;
- Prisma client generates;
- migrations apply on clean CI database;
- P9-A focused unit/integration tests pass;
- full Vitest suite passes;
- Typecheck passes;
- Build passes;
- `production-audit` passes;
- Chromium `e2e` passes;
- exact final PR head is the head verified by all required CI jobs;
- manual diff review confirms no P7 scoring change, no P8 safety authority change, no direct default-branch write, no auto-merge/deploy, no raw third-party execution, and no unrelated dependency changes.

Do not merge without a separate explicit human `合并` instruction.

## 21. Future handoffs

P9-A deliberately leaves these to later phases:

- **P9-B Workflow Orchestrator:** triggers, durable run/item state, queues, retries, daily reconciliation;
- **P9-C Controlled Autopilot:** project opt-in, operation allowlists, authoritative automation eligibility/risk policy, automatic Draft PR preparation for allowed LOW-risk changes;
- **P9-D/P9-E Experiment & Feedback:** observed outcomes and bounded historical rank adjustment.

P9-A produces the immutable planner artifacts those phases can consume without weakening P7/P8 authority boundaries.
