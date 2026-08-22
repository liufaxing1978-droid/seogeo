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
(adjustment only; deterministic fallback = 0)
        ↓
Frozen OptimizationPlan
        ↓
P9-B Workflow Orchestrator (future)
```

P9-A stops at the frozen `OptimizationPlan` boundary.

## 4. Candidate source contract

P9-A V1 consumes the latest persisted P7 Growth opportunity snapshot for each Growth opportunity identity.

The planner does not independently query P5/P6/Search Facts to synthesize additional opportunities. Those sources remain represented through P7 evidence/provenance.

A candidate source projection retains references to:

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
- bounded P7 source provenance projection.

The planner must not copy arbitrary raw provider payloads into candidate rows.

## 5. Persisted entities

### 5.1 `OptimizationCandidate`

Required fields:

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

Required fields:

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

`candidateKey` is SHA-256 over canonical JSON containing exactly:

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
- nullable values remain explicit `null`;
- repeated materialization of the same source/scope returns the same candidate identity;
- a new Growth snapshot creates a new candidate identity;
- historical candidate rows are never rewritten to point at newer Growth snapshots;
- malformed/missing market provenance uses the explicit `INVALID_PROVENANCE` scope mode, never a guessed valid market.

## 7. Market and locale projection

P9-A consumes P9-0G `GROWTH_SEARCH_PROVENANCE_V1` semantics from P7 `sourceProvenance`.

The V1 scope modes are exactly:

```text
CONFIGURED_MARKET
UNCONFIGURED_LEGACY
INVALID_PROVENANCE
```

### 7.1 Configured-market mode

For:

```text
mode = CONFIGURED_MARKET
```

P9-A materializes one candidate per distinct valid `(marketCode, locale)` projection in Growth scoring-lane provenance.

Rules:

- values come from persisted Growth provenance, never guessed from project defaults;
- duplicate identical projections are deduped deterministically;
- P9-A never merges scopes into a synthetic GLOBAL candidate.

### 7.2 Legacy mode

For:

```text
mode = UNCONFIGURED_LEGACY
```

P9-A materializes one candidate with:

```text
marketScopeMode = UNCONFIGURED_LEGACY
marketCode = null
locale = null
```

It must not invent `GLOBAL`, `CN`, `zh-CN`, `en`, or another scope.

### 7.3 Invalid or missing provenance

If the Growth snapshot lacks the minimum supported P9-0G provenance, or configured-market projections are malformed/contradictory, P9-A persists exactly one auditable ineligible candidate with:

```text
marketScopeMode = INVALID_PROVENANCE
marketCode = null
locale = null
eligibilityState = INELIGIBLE
```

The candidate receives one or both deterministic reason codes:

```text
INVALID_MARKET_PROVENANCE
SOURCE_PROVENANCE_MISSING
```

This row makes the rejection idempotent and inspectable without inventing market truth. It is included in candidate persistence/audit results but excluded from deterministic ranking and **never produces an `OptimizationPlan`**. Retrying unchanged input returns the same candidate identity and reason codes.

## 8. Deterministic eligibility policy

Eligibility is a planner gate, not a new Growth score.

A persisted OptimizationCandidate is eligible only when all conditions pass:

- `marketScopeMode !== INVALID_PROVENANCE`;
- `growthRankingEligible === true`;
- `growthScoreState === KNOWN`;
- `growthScore !== null` and is finite;
- lifecycle state is not terminal for planning;
- opportunity type has an explicit supported action mapping.

Terminal lifecycle states:

```text
DONE
DISMISSED
RESOLVED
```

Eligibility states:

```text
ELIGIBLE
INELIGIBLE
```

Candidate reason codes are stable strings:

```text
INVALID_MARKET_PROVENANCE
SOURCE_PROVENANCE_MISSING
GROWTH_NOT_RANKING_ELIGIBLE
GROWTH_SCORE_UNKNOWN
GROWTH_SCORE_MISSING
GROWTH_LIFECYCLE_TERMINAL
UNSUPPORTED_OPPORTUNITY_TYPE
```

An eligible candidate has an empty reason-code array. Unknown data never becomes an inferred pass.

## 9. Deterministic action mapping

AI cannot choose the action class.

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

This mapping is versioned as `OPTIMIZATION_ACTION_MAP_V1`.

## 10. Deterministic base ranking

P9-A does not calculate a second opportunity score. It establishes ordering among already-eligible candidates.

V1 ordering inputs:

1. P7 `growthScore` descending;
2. priority ordinal `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `MONITOR`, `UNKNOWN`;
3. evidence coverage descending;
4. `candidateKey` ascending as final tiebreak.

`deterministicRank` is a 1-based ordinal within one planner materialization scope.

P9-A never changes the P7 score or priority.

## 11. Historical adjustment

P9-A V1 does not learn from outcome history:

```text
historicalRankAdjustment = 0
```

Outcome-derived weighting belongs to a later experiment/feedback phase.

## 12. Third-party advisory skill handoff

P9-0H remains advisory-only.

P9-A consumes only `LoadedAdvisoryMethod` returned by:

```ts
createAdvisorySkillRegistry({ rootDir })
```

It never consumes raw upstream Markdown bodies or executes vendor content.

Action-to-method mapping:

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

Persisted advisory context stores only:

- `skillId`
- `methodKey`
- `authority = ADVISORY_ONLY`
- `projectionSha256`
- `sourceRepo`
- `upstreamCommit`
- `localVersion`

If advisory-registry integrity validation fails, planning fails closed before plan persistence. P9-A must not fetch replacement skills from the network or bypass the hash chain.

## 13. Optional DeepSeek bounded re-ranking

P9-A introduces the exact AI task contract:

```text
AiTaskType = OPTIMIZATION_PLAN_RANKING
promptVersion = optimization-plan-ranking-v1
```

DeepSeek runs only after deterministic eligibility, action mapping, advisory packaging, and base ranking are complete.

Allowed output per supplied candidate:

```text
candidateId
adjustment
explanation
sourceReferences
```

Validation rules:

- candidate id must be in the supplied eligible candidate set;
- candidate ids cannot repeat;
- `adjustment` is an integer in `[-2, -1, 0, 1, 2]`;
- negative means preference upward; positive means preference downward;
- returned source references must be a subset of supplied source references;
- structured output is strict and rejects unknown fields;
- output cannot alter eligibility, score, action, market, risk, approval, evidence, or facts.

Rank application is deterministic:

```text
adjustedRankSignal = deterministicRank + aiRankAdjustment
```

Candidates are sorted by:

1. `adjustedRankSignal` ascending;
2. `deterministicRank` ascending;
3. `candidateKey` ascending.

`finalRank` is then assigned sequentially as a 1-based ordinal. The model never returns `finalRank` directly.

The resulting ordinal displacement must remain bounded: for every candidate, `abs(finalRank - deterministicRank) <= 2`. If an otherwise-valid adjustment set would violate this invariant, reject the entire set and use zero adjustments for all candidates.

AI failure semantics:

- provider unavailable, task failure, invalid output, rejected references, or displacement-bound rejection does not block deterministic planning;
- every candidate receives `aiRankAdjustment = 0`;
- the failure is observable/auditable;
- eligibility and action mapping remain unchanged.

## 14. Plan explanation

Each frozen plan contains first-party deterministic explanation data covering:

- source Growth opportunity type;
- P7 score/priority/evidence references;
- action-map version and mapping reason;
- market scope;
- advisory method identities;
- whether AI adjustment was accepted or defaulted to zero.

DeepSeek commentary is stored as bounded model annotation and is distinguishable from authoritative source facts.

## 15. Persistence and immutability

P9-A introduces a dedicated Prisma model file and migration.

Requirements:

- candidate uniqueness is enforced by project + `candidateKey`;
- plan uniqueness is enforced by candidate + `planVersion`;
- repository APIs expose create/get/list operations only for frozen artifacts;
- retries are idempotent;
- candidate and plan rows are database-immutable.

The migration follows the established P8 PostgreSQL immutability pattern: a P9-A-specific trigger function raises on mutation, and `BEFORE UPDATE OR DELETE` triggers protect both `OptimizationCandidate` and `OptimizationPlan`.

P9-A does not modify P8's existing immutability function or triggers.

## 16. Service boundary

First-party module:

```text
src/modules/optimization/
```

Responsibilities:

- `optimization.types.ts` — planner enums/contracts;
- `optimization.policy.ts` — eligibility, action map, ranking and advisory map constants;
- `optimization.provenance.ts` — strict Growth market/source provenance projection;
- `optimization.candidate.ts` — candidate identity/materialization pure functions;
- `optimization.ranking.ts` — deterministic ranking and bounded adjustment application;
- `optimization.repository.ts` — immutable persistence;
- `optimization.service.ts` — explicit candidate/plan materialization orchestration.

AI task builder/parser remains under `src/modules/ai/` to follow existing AI gateway patterns.

P9-A adds no optimization BullMQ queue, cron, event bus, or daily reconciliation. P9-B owns those concerns.

## 17. Runtime triggering scope

P9-A V1 exposes an explicit service entrypoint for manual/test/programmatic materialization. P9-B can call that entrypoint later.

P9-A V1 does not independently schedule itself.

## 18. HTTP/API scope

P9-A V1 adds **no HTTP route**. This keeps the first milestone focused on a tested service/persistence boundary and avoids pre-implementing P9-B orchestration or a UI contract.

A later phase may expose authenticated read/trigger routes without changing planner authority.

## 19. Testing strategy

TDD coverage must include:

1. deterministic candidate key generation;
2. configured-market candidate fan-out;
3. legacy candidate with null market/locale;
4. invalid/missing provenance persists one `INVALID_PROVENANCE` ineligible candidate, idempotently, and creates no plan;
5. eligibility reason codes;
6. complete opportunity-to-action mapping;
7. deterministic base ranking/tiebreaks;
8. bounded `[-2,+2]` AI adjustment validation and exact direction semantics;
9. invalid/duplicate/unknown AI candidate-id rejection;
10. deterministic final-rank recomputation and displacement bound;
11. AI failure fallback to zero adjustment;
12. advisory action-to-method mapping and exact provenance packaging;
13. no raw vendor body exposure;
14. advisory-integrity failure before plan persistence;
15. idempotent candidate/plan persistence;
16. database rejection of UPDATE/DELETE on frozen candidate/plan rows;
17. P7 score/evidence/lifecycle authority isolation;
18. P8 risk/approval/mutation/verification authority isolation;
19. no Draft PR/merge/deploy path from P9-A;
20. migration validation, full Vitest regression, Typecheck, and Build.

## 20. Release gate

Before P9-A may be marked complete:

- Prisma schema validates;
- Prisma client generates;
- migrations apply on clean CI database;
- focused P9-A tests pass;
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

P9-A produces immutable planner artifacts those phases can consume without weakening P7/P8 authority boundaries.