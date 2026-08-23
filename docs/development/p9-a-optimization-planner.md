# P9-A Optimization Planner

## Purpose

P9-A turns persisted P7 Growth opportunities into immutable, market-aware optimization candidates and frozen optimization plans. It answers **what eligible optimization should happen next and why**. It does not execute website changes and does not own publication, approval, merge, deploy, rollback, or verification authority.

The authority chain is:

```text
P7 GrowthOpportunitySnapshot
→ deterministic candidate materialization
→ eligibility gate
→ deterministic action mapping
→ deterministic ranking
→ P9-0H advisory projection packaging
→ optional bounded DeepSeek rerank
→ immutable OptimizationPlan
→ P9-B / P9-C later
```

`OptimizationPlan` is the P9-A planning artifact. P8 `PublicationPlan` remains the later execution-oriented artifact describing exact repository/file operations.

## Authority boundaries

P9-A is deliberately narrow.

P7 remains authoritative for:

- opportunity identity and type;
- score and score state;
- priority;
- evidence quality and coverage;
- ranking eligibility;
- lifecycle state;
- persisted source provenance.

P9-A does not import P7 detector/scoring/service authority and does not rewrite P7 rows. UNKNOWN and missing values are never converted to zero, false, pass, or inferred truth.

P8 remains authoritative for:

- risk classification;
- approval requirements and approvals;
- `PublicationProposal`, `PublicationPlan`, preview, mutation, execution, verification, and rollback;
- Draft PR operations;
- merge and deploy.

P9-A creates none of those artifacts. `automationEligibility` is always `false` in V1.

P9-0H advisory skills remain `ADVISORY_ONLY`. P9-A consumes only integrity-checked first-party projections and persists bounded method/provenance identities. Runtime does not execute raw vendored Markdown or third-party code.

There is no P9-A HTTP route, optimization BullMQ queue, cron, or event-bus ownership. AI tasks use the existing AI gateway/queue. P9-B owns later orchestration; P9-C owns controlled autopilot policy.

## Persisted artifacts

### OptimizationCandidate

Candidates are immutable audit records. A candidate captures one persisted P7 opportunity snapshot projected into one market scope.

Key persisted facts include:

- `projectId`;
- `growthOpportunityIdentityId`;
- `growthSnapshotId`;
- `candidateVersion = OPTIMIZATION_CANDIDATE_V1`;
- `candidateKey`;
- market scope mode / market / locale;
- P7 opportunity type, query, canonical page;
- P7 score, score state, priority, evidence quality/coverage, ranking eligibility, lifecycle;
- bounded source provenance and source fact references;
- eligibility state and reason codes.

Identity is SHA-256 over canonical JSON containing exactly:

```text
candidateVersion
projectId
growthOpportunityIdentityId
growthSnapshotId
marketScopeMode
marketCode
locale
```

Object keys are sorted and `null` is explicit. Score, priority, advisory content, rank, and timestamps do not enter the candidate identity. A new P7 snapshot therefore creates a new candidate instead of mutating the old one.

Uniqueness is enforced by `(projectId, candidateKey)`.

### OptimizationPlan

Plans are immutable frozen recommendations for eligible candidates.

V1 persists:

- `planVersion = OPTIMIZATION_PLAN_V1`;
- deterministic recommended action;
- source fact references;
- deterministic rank;
- AI rank adjustment;
- `historicalRankAdjustment = 0`;
- final rank;
- bounded advisory context;
- `automationEligibility = false`;
- first-party explanation / AI annotation.

Uniqueness is enforced by `(candidateId, planVersion)`.

Repository APIs are create/get/list only. Existing rows are reused only when the complete immutable payload is consistent. A conflicting payload fails closed rather than updating the row.

Both `OptimizationCandidate` and `OptimizationPlan` are protected by P9-A-specific PostgreSQL `BEFORE UPDATE OR DELETE` triggers. Production code has no update/delete repository methods.

## Market provenance modes

P9-A accepts only persisted P7 search provenance version `GROWTH_SEARCH_PROVENANCE_V1`.

### CONFIGURED_MARKET

One candidate is created for each distinct valid `(marketCode, locale)` in the persisted scoring-lane market projections.

Rules:

- values come only from persisted provenance;
- duplicate pairs are removed;
- pairs are sorted deterministically;
- no synthetic `GLOBAL` candidate is invented.

### UNCONFIGURED_LEGACY

Exactly one candidate is created with:

```text
marketCode = null
locale = null
```

No market or locale is inferred.

### INVALID_PROVENANCE

Missing, malformed, or contradictory provenance produces exactly one auditable candidate with:

```text
marketScopeMode = INVALID_PROVENANCE
marketCode = null
locale = null
```

It is always ineligible and never produces an `OptimizationPlan`. This keeps rejection inspectable and idempotent without inventing market truth.

## Eligibility

A candidate is eligible only when all of the following are true:

- market scope is not `INVALID_PROVENANCE`;
- P7 `growthRankingEligible` is true;
- P7 score state is `KNOWN`;
- P7 score is finite and non-null;
- lifecycle is non-terminal;
- P7 opportunity type has a supported V1 action mapping.

Terminal lifecycle states are:

```text
DONE
DISMISSED
RESOLVED
```

Stable ineligibility reason codes are:

```text
INVALID_MARKET_PROVENANCE
SOURCE_PROVENANCE_MISSING
GROWTH_NOT_RANKING_ELIGIBLE
GROWTH_SCORE_UNKNOWN
GROWTH_SCORE_MISSING
GROWTH_LIFECYCLE_TERMINAL
UNSUPPORTED_OPPORTUNITY_TYPE
```

Ineligible candidates remain persisted for audit but are excluded from ranking and plan creation.

## V1 action map

The action map is deterministic first-party policy, versioned as `OPTIMIZATION_ACTION_MAP_V1`:

| P7 opportunity type | P9-A recommended action |
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

Unsupported future types fail closed as ineligible. AI cannot change the action type.

## Deterministic ranking

P9-A does not create a second opportunity score. Eligible candidates are sorted only from persisted P7 facts:

1. `growthScore` descending;
2. priority: `CRITICAL > HIGH > MEDIUM > LOW > MONITOR > UNKNOWN`;
3. evidence coverage descending;
4. `candidateKey` ascending.

The resulting 1-based ordinal is `deterministicRank`.

`historicalRankAdjustment` is always `0` in P9-A V1.

## Advisory packaging

Planner advisory context comes only from `createAdvisorySkillRegistry({ rootDir })`, which validates the P9-0H registry / manifest / projection integrity chain before a plan is persisted.

Action-to-method mapping:

| Action | Advisory methods |
| --- | --- |
| `ON_PAGE_OPTIMIZATION` | `ON_PAGE_SEO_CHECK`, `SEO_AUDIT` |
| `SERP_SNIPPET_OPTIMIZATION` | `ON_PAGE_SEO_CHECK`, `ANALYTICS` |
| `CONTENT_CREATION` | `CONTENT_STRATEGY`, `CONTENT_QUALITY_AUDIT` |
| `TECHNICAL_SEO_REMEDIATION` | `TECHNICAL_SEO_CHECK`, `SEO_AUDIT` |
| `GEO_CITABILITY_IMPROVEMENT` | `AI_SEO`, `CONTENT_QUALITY_AUDIT` |
| `AI_VISIBILITY_IMPROVEMENT` | `AI_SEO`, `CONTENT_QUALITY_AUDIT` |
| `CANNIBALIZATION_REMEDIATION` | `SITE_ARCHITECTURE`, `SEO_AUDIT` |
| `CONTENT_REFRESH` | `CONTENT_QUALITY_AUDIT`, `CONTENT_STRATEGY` |

Every requested method must exist exactly once. Missing, duplicate, or integrity-invalid methods abort packaging before plan persistence.

Only these fields are persisted per advisory method:

```text
skillId
methodKey
authority = ADVISORY_ONLY
projectionSha256
sourceRepo
upstreamCommit
localVersion
```

Projection steps, raw vendor bodies, source file hashes, executable handles, and raw Markdown do not enter planner context.

## DeepSeek bounded reranking

AI reranking uses the existing AI gateway with:

```text
AiTaskType = OPTIMIZATION_PLAN_RANKING
prompt = optimization-plan-ranking-v1
mode = REASONING
```

The task fact snapshot contains only already-eligible candidate facts, deterministic action/rank/market information, bounded advisory identities, and first-party source references. It contains no P8 risk/approval authority and no raw vendor content.

DeepSeek may return for supplied candidates only:

```text
candidateId
adjustment        integer [-2, +2]
explanation
sourceReferences
```

Validation is strict:

- unknown object fields are rejected;
- unknown candidate IDs are rejected;
- duplicate candidate IDs are rejected;
- output source references must be a subset of those supplied;
- AI cannot create/delete candidates;
- AI cannot change eligibility, action, P7 score/facts/evidence, market, risk, or approval.

Rank direction is:

```text
adjustedRankSignal = deterministicRank + aiRankAdjustment
```

Negative adjustment can improve ordering; positive adjustment can worsen it. Candidates are sorted by adjusted signal, then deterministic rank, then candidate key, and assigned sequential `finalRank` values.

A second invariant protects the whole set:

```text
abs(finalRank - deterministicRank) <= 2
```

If any candidate violates that displacement bound, the entire AI adjustment set is rejected and all candidates use zero adjustment / deterministic final rank.

Missing candidate adjustments default to zero.

## AI success and failure behavior

### `useAi: false`

`OptimizationService.materializeProject()` persists candidates and freezes deterministic plans immediately:

```text
aiRankAdjustment = 0
historicalRankAdjustment = 0
finalRank = deterministicRank
automationEligibility = false
```

The explanation records `ai.applied = false` and `fallback = false`.

### `useAi: true`

The service:

1. persists all audit candidates;
2. ranks only eligible candidates;
3. packages bounded advisory context;
4. creates/enqueues exactly one idempotent `OPTIMIZATION_PLAN_RANKING` task through the existing AI queue;
5. returns no plans yet plus the `aiTaskId`.

No P9-A-specific queue is created.

On valid worker success, adjusted plans are frozen inside the same durable AI completion transaction.

On provider failure or invalid AI output:

1. the AI run/task is durably marked `FAILED` first;
2. P9-A then idempotently freezes deterministic zero-adjustment fallback plans;
3. fallback never changes eligibility, action, market, advisory context, or P7 facts;
4. fallback creates no P8 artifacts.

The failed AI task remains auditable even though deterministic plans are available.

## First-party explanation

Frozen deterministic/fallback explanations are first-party planner metadata, not a new score or execution authority. The structure records:

- authority `P9_A_FIRST_PARTY_PLANNER`;
- copied P7 growth facts;
- action map version and recommended action;
- market scope;
- advisory method identities;
- AI application/fallback/adjustment annotation.

Raw P7 evidence text and raw vendor projection bodies are not persisted in the explanation.

## Idempotency and immutability

Idempotency is identity-based:

- same P7 snapshot + same projected scope → same candidate key / candidate row;
- same candidate + `OPTIMIZATION_PLAN_V1` → same plan when the entire immutable payload matches;
- same normalized AI seed set → deterministic AI request key;
- repeated fallback calls reuse the same immutable plans;
- a newer P7 snapshot creates a new candidate identity and leaves previous history untouched.

The database is the final immutability boundary. Application retries do not update historical planner rows.

## Migrations

P9-A uses two additive forward migrations:

1. `20260822151000_add_p9a_optimization_planner`
   - planner enums;
   - `OptimizationCandidate` and `OptimizationPlan`;
   - indexes / FKs;
   - P9-A immutable mutation function and triggers.
2. `20260822152000_add_p9a_optimization_ai_task_type`
   - adds `OPTIMIZATION_PLAN_RANKING` to `AiTaskType`.

The repository uses Prisma multi-file schema discovery from the `prisma/` directory (`prisma.config.ts` sets `schema: 'prisma'`). P9-A models live in `prisma/models/optimization.prisma`; the AI enum lives in `prisma/models/ai-gateway.prisma`. Do not duplicate those declarations into `prisma/schema.prisma`.

Never rewrite an already-applied migration to add later P9-A state. Future changes must be new additive migrations.

A rollback of application code must not rewrite/delete historical planner rows. Database rollback, if ever required, must be a separately reviewed forward migration and must preserve audit requirements.

## Operational verification

Focused P9-A regression:

```bash
npx vitest run \
  tests/unit/optimization.policy.test.ts \
  tests/unit/optimization.provenance.test.ts \
  tests/unit/optimization.ranking.test.ts \
  tests/unit/optimization.advisory.test.ts \
  tests/unit/optimization.boundary.test.ts \
  tests/integration/optimization.persistence.test.ts \
  tests/integration/optimization.materialization.test.ts \
  tests/integration/optimization.ai-ranking.test.ts \
  tests/integration/optimization.service.test.ts \
  tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Prisma gates:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Full regression:

```bash
npm run typecheck
npm test
npm run build
```

Final PR head must also have GitHub Actions:

```text
verify = success
production-audit = success
e2e = success
```

Within `verify`, Prisma validate/generate/migrate, Typecheck, Test, and Build must all succeed.

## Release / handoff gates

P9-A is complete only when the exact PR head passes the full gates and the final diff has been manually checked for authority leaks.

Reject a release if the diff introduces any of the following:

- P7 detector/scoring/formula changes;
- P8 risk/approval/mutation/execution/verification authority;
- Git write, PR, merge, deploy, or rollback operations inside optimization modules;
- an optimization queue, cron, or event bus;
- runtime third-party fetch or raw-vendor execution;
- AI authority over eligibility, action, score, market, risk, or approval;
- mutable candidate/plan repository APIs;
- unprotected planner tables;
- edits to already-applied P9-A migrations;
- unrelated dependency or credential changes.

After P9-A, P9-B may consume frozen plans for orchestration/queueing. P9-C may later define controlled autopilot and Draft PR eligibility. Neither authority is granted by P9-A itself.

Merging the P9-A PR still requires a separate explicit human `合并` instruction. Deployment is a separate action and requires separate authorization.
