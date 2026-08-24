# P9-D Experiment Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded P9-D experiment engine that starts only from exact P8 VERIFIED publication facts, evaluates immutable search/AI-visibility observations from persisted completed snapshots, and reports conservative observed effects without changing P7, P8, P9 planning authority, Git, deployment, or feedback weights.

**Architecture:** Add one isolated `optimization-experiments` module with immutable experiment/observation persistence, deterministic identities and schedules, read-only Search Facts/Visibility Metrics resolvers, a deterministic evaluator, one BullMQ queue, and persisted-read API/UI projections. P8 verification only emits an injected post-commit handoff; queue delivery failure must never reverse or fail P8 verification. P9-D writes only its own two tables and never updates `OptimizationPlan.historicalRankAdjustment`.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Prisma 6.14/PostgreSQL 17, BullMQ 5.58/Redis 7, Express 5, Zod 3.25, EJS, Vitest 3.2, Supertest 7, Playwright 1.55/Chromium.

**Spec:** `docs/superpowers/specs/2026-08-24-p9-d-experiment-engine-design.md`

## Global Constraints

- Base implementation branch: `feat/p9-d-experiment-engine`, originally branched from `main@5fac353d0e5e8c4bd5c187e4318bd1c7e4490d4e`.
- `OPTIMIZATION_EXPERIMENTS`: Standard=false, Advanced=true, Enterprise=true.
- An experiment starts only from `PublicationExecution.status = VERIFIED` plus an exact persisted `PublicationVerification.status = VERIFIED` with `observedAt` and matching bounded HTTP(S) `observedUrl`.
- P8 proposal provenance must be `sourceType = P9_OPTIMIZATION_PLAN` and `sourceReferenceId = OptimizationPlan.id`.
- P9-D may read P7/P8/P9/Search Facts/Visibility Metrics, but may persist only `OptimizationExperiment` and `OptimizationExperimentObservation` plus bounded logs.
- No P9-D provider calls, DeepSeek calls, Git writes, Draft-PR creation, merge, deployment, rollback, P7 scoring mutation, P8 authority mutation, or `OptimizationPlan.historicalRankAdjustment` update.
- Missing, `UNKNOWN`, `NOT_SUPPORTED`, incompatible, or absent top-row facts never become numeric zero.
- `CONTENT_CREATION` never uses page absence as a zero baseline; it uses exact query-level comparison only when immutable P9 provenance resolves that query scope.
- P9-D reports observed association only; it does not claim causal effect.
- `OptimizationExperiment` and `OptimizationExperimentObservation` are immutable via PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- Experiment lifecycle is derived from immutable identity + observations; no mutable experiment status column is introduced.
- P9-D owns exactly one new queue: `optimization-experiment-evaluation`.
- Queue payloads contain durable IDs/window identifiers only; no content body, prompt, provider raw payload, credential, or model answer.
- GET API/UI routes are persisted-read only: no enqueue, AI, provider, Git, mutation, or fact recalculation side effects.
- Existing `.github/workflows/ci.yml` stays authoritative; do not weaken or bypass `verify`, `production-audit`, or `e2e`.
- No merge or deployment without a later, separate explicit human authorization.

---

## File Structure

Create the P9-D module with one responsibility per file:

```text
prisma/models/optimization-experiment.prisma
prisma/migrations/20260824140000_add_p9d_experiment_engine/migration.sql
src/modules/optimization-experiments/
  experiment.types.ts            # version constants, bounded domain/read-model types
  experiment.identity.ts         # canonical hashes and deterministic observation identity
  experiment.schedule.ts         # intervention support, due windows, expected directions
  experiment.repository.ts       # P9-D persistence + P8/P9 authority reads + reconciliation reads
  experiment.scope.ts            # exact search/visibility measurement-scope derivation
  experiment.search-source.ts    # completed Search Facts comparison resolver/aggregation
  experiment.visibility-source.ts# completed Visibility Metrics comparison resolver
  experiment.contamination.ts    # read-only P8 contamination checks
  experiment.evaluator.ts        # deterministic V1 effect classification
  experiment.queue.ts            # one BullMQ queue and durable payloads
  experiment.worker.ts           # start/evaluate/reconcile job processor
  experiment.service.ts          # start/evaluate orchestration over injected ports
  experiment.observability.ts    # bounded allowlisted operational events
  experiment.routes.ts           # read-only REST API
  experiment.web.repository.ts   # persisted-read web projection
  experiment.web.routes.ts       # project-scoped read-only EJS routes
src/views/optimization-experiments/index.ejs
src/views/optimization-experiments/show.ejs
docs/development/p9-d-experiment-engine.md
```

Modify only the shared integration surfaces needed by P9-D:

```text
prisma/models/optimization.prisma
prisma/models/publication.prisma
src/auth/feature-flags.ts
src/queue/queues.ts
src/queue/worker-bootstrap.ts
src/modules/publication/publication-verification.worker.ts
src/app.ts
src/views/partials/sidebar.ejs
```

Tests are split by authority boundary rather than implementation layer:

```text
tests/unit/experiment.feature-gate.test.ts
tests/unit/experiment.identity.test.ts
tests/unit/experiment.schedule.test.ts
tests/unit/experiment.scope.test.ts
tests/unit/experiment.search-source.test.ts
tests/unit/experiment.visibility-source.test.ts
tests/unit/experiment.evaluator.test.ts
tests/unit/experiment.queue.test.ts
tests/unit/experiment.worker.test.ts
tests/unit/publication-verification-experiment-handoff.test.ts
tests/unit/queues.test.ts
tests/unit/worker-bootstrap.test.ts
tests/integration/experiment.persistence.test.ts
tests/integration/experiment.start-authority.test.ts
tests/integration/experiment.contamination.test.ts
tests/integration/experiment.authority.test.ts
tests/integration/experiment.routes.test.ts
tests/e2e/optimization-experiments.spec.ts
```

---

### Task 19: Experiment persistence, identity, schedule, and feature gate

**Files:**
- Create: `prisma/models/optimization-experiment.prisma`
- Create: `prisma/migrations/20260824140000_add_p9d_experiment_engine/migration.sql`
- Modify: `prisma/models/optimization.prisma`
- Modify: `prisma/models/publication.prisma`
- Create: `src/modules/optimization-experiments/experiment.types.ts`
- Create: `src/modules/optimization-experiments/experiment.identity.ts`
- Create: `src/modules/optimization-experiments/experiment.schedule.ts`
- Create: `src/modules/optimization-experiments/experiment.repository.ts`
- Modify: `src/auth/feature-flags.ts`
- Test: `tests/unit/experiment.feature-gate.test.ts`
- Test: `tests/unit/experiment.identity.test.ts`
- Test: `tests/unit/experiment.schedule.test.ts`
- Test: `tests/integration/experiment.persistence.test.ts`

**Interfaces:**
- Consumes: existing Prisma `RecommendedActionType`, `MarketCode`, `OptimizationPlan`, `PublicationExecution`, and `PublicationVerification` identities.
- Produces: `OPTIMIZATION_EXPERIMENT_VERSION`, `OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION`, `OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION`, `ExperimentWindowType`, `ExperimentMeasurementScope`, `buildExperimentKey()`, `buildObservationKey()`, `scheduleForIntervention()`, and `OptimizationExperimentRepository.createOrGetExperiment/createOrGetObservation`.
- Later tasks must treat repository create-or-get methods as collision-verifying immutable writes, not upserts.

- [ ] **Step 1: Write RED feature, identity, and schedule tests**

Create `tests/unit/experiment.feature-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

describe('P9-D feature gate', () => {
  it('enables optimization experiments only for Advanced and Enterprise', () => {
    expect(hasFeature('STANDARD', 'OPTIMIZATION_EXPERIMENTS')).toBe(false);
    expect(hasFeature('ADVANCED', 'OPTIMIZATION_EXPERIMENTS')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_EXPERIMENTS')).toBe(true);
  });
});
```

Create `tests/unit/experiment.schedule.test.ts` with exact schedules:

```ts
import { describe, expect, it } from 'vitest';
import { scheduleForIntervention } from '../../src/modules/optimization-experiments/experiment.schedule.js';

describe('P9-D deterministic schedule', () => {
  it.each([
    ['SERP_SNIPPET_OPTIMIZATION', ['7D', '14D', '28D']],
    ['ON_PAGE_OPTIMIZATION', ['14D', '28D', '56D']],
    ['CONTENT_REFRESH', ['14D', '28D', '56D']],
    ['CONTENT_CREATION', ['14D', '28D', '56D']],
    ['GEO_CITABILITY_IMPROVEMENT', ['14D', '28D', '56D']],
    ['AI_VISIBILITY_IMPROVEMENT', ['14D', '28D', '56D']]
  ] as const)('%s has the frozen V1 windows', (action, windows) => {
    expect(scheduleForIntervention(action).map((item) => item.windowType)).toEqual(windows);
  });

  it.each(['TECHNICAL_SEO_REMEDIATION', 'CANNIBALIZATION_REMEDIATION'] as const)(
    '%s is unsupported instead of receiving a proxy metric',
    (action) => expect(scheduleForIntervention(action)).toBeNull()
  );
});
```

Create `tests/unit/experiment.identity.test.ts` asserting canonical object-key order, sorted/deduped source refs, stable identical hashes, and different hashes when execution/verification/window/source identity changes.

- [ ] **Step 2: Run the unit RED set and verify the failure is missing P9-D contracts**

Run:

```bash
npx vitest run \
  tests/unit/experiment.feature-gate.test.ts \
  tests/unit/experiment.identity.test.ts \
  tests/unit/experiment.schedule.test.ts
```

Expected: FAIL because `OPTIMIZATION_EXPERIMENTS` and `src/modules/optimization-experiments/*` do not exist. No unrelated existing test should be changed to make RED pass.

- [ ] **Step 3: Add the immutable Prisma model and forward-only migration**

Create `prisma/models/optimization-experiment.prisma` with these exact semantic fields:

```prisma
enum OptimizationExperimentEffectState {
  POSITIVE
  NEUTRAL
  NEGATIVE
  INCONCLUSIVE
}

enum OptimizationExperimentCoverageState {
  SUFFICIENT
  PARTIAL
  INSUFFICIENT
  UNKNOWN
}

enum OptimizationExperimentContaminationState {
  CLEAR
  CONFLICTING_MUTATION
  TARGET_REVISION_CHANGED
  VERIFICATION_INVALIDATED
  SOURCE_IDENTITY_CHANGED
  UNKNOWN
}

model OptimizationExperiment {
  id                        String                @id @default(uuid()) @db.Uuid
  projectId                 String                @db.Uuid
  optimizationPlanId        String                @db.Uuid
  publicationExecutionId    String                @db.Uuid
  publicationVerificationId String                @db.Uuid
  experimentVersion         String
  experimentKey             String
  interventionType          RecommendedActionType
  targetUrl                 String
  marketCode                MarketCode?
  locale                    String?
  verifiedAnchorAt          DateTime
  measurementScopeJson      Json
  observationScheduleJson   Json
  expectedDirectionJson     Json
  createdAt                 DateTime              @default(now())

  optimizationPlan        OptimizationPlan        @relation(fields: [optimizationPlanId], references: [id], onDelete: Restrict)
  publicationExecution    PublicationExecution    @relation(fields: [publicationExecutionId], references: [id], onDelete: Restrict)
  publicationVerification PublicationVerification @relation(fields: [publicationVerificationId], references: [id], onDelete: Restrict)
  observations            OptimizationExperimentObservation[]

  @@unique([projectId, experimentKey], map: "OptimizationExperiment_project_key")
  @@unique([optimizationPlanId, publicationExecutionId, experimentVersion], map: "OptimizationExperiment_plan_execution_version")
  @@index([projectId, createdAt], map: "OptimizationExperiment_project_created_idx")
  @@index([publicationExecutionId], map: "OptimizationExperiment_execution_idx")
}

model OptimizationExperimentObservation {
  id                           String                                   @id @default(uuid()) @db.Uuid
  projectId                    String                                   @db.Uuid
  experimentId                 String                                   @db.Uuid
  observationVersion           String
  observationKey               String
  windowType                   String
  windowDays                   Int
  dueAt                        DateTime
  inputCutoffAt                DateTime
  baselineSearchSourceRefs     Json
  observedSearchSourceRefs     Json
  baselineVisibilitySourceRefs Json
  observedVisibilitySourceRefs Json
  baselineMetricsJson          Json
  observedMetricsJson          Json
  deltaMetricsJson             Json
  coverageState                OptimizationExperimentCoverageState
  contaminationState           OptimizationExperimentContaminationState
  effectState                  OptimizationExperimentEffectState
  reasonCodes                  Json
  evaluatorVersion             String
  createdAt                    DateTime                                 @default(now())

  experiment OptimizationExperiment @relation(fields: [experimentId], references: [id], onDelete: Restrict)

  @@unique([experimentId, observationKey], map: "OptimizationExperimentObservation_experiment_key")
  @@index([projectId, createdAt], map: "OptimizationExperimentObservation_project_created_idx")
  @@index([experimentId, windowType, createdAt], map: "OptimizationExperimentObservation_window_idx")
}
```

Add only required reverse relations:

```prisma
// OptimizationPlan
experiments OptimizationExperiment[]

// PublicationExecution
optimizationExperiments OptimizationExperiment[]

// PublicationVerification
optimizationExperiments OptimizationExperiment[]
```

Create `prisma/migrations/20260824140000_add_p9d_experiment_engine/migration.sql` as an additive migration. In addition to Prisma-generated enum/table/FK/index SQL, install immutability triggers using a P9-D-owned function:

```sql
CREATE OR REPLACE FUNCTION "p9d_reject_immutable_change"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-D immutable record cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationExperiment_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationExperiment"
FOR EACH ROW EXECUTE FUNCTION "p9d_reject_immutable_change"();

CREATE TRIGGER "OptimizationExperimentObservation_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationExperimentObservation"
FOR EACH ROW EXECUTE FUNCTION "p9d_reject_immutable_change"();
```

Do not edit any existing applied migration.

- [ ] **Step 4: Implement versions, identities, schedules, and collision-verifying persistence**

In `experiment.types.ts`, define exact constants and bounded types:

```ts
export const OPTIMIZATION_EXPERIMENT_VERSION = 'OPTIMIZATION_EXPERIMENT_V1' as const;
export const OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION = 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1' as const;
export const OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION = 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1' as const;
export type ExperimentWindowType = '7D' | '14D' | '28D' | '56D';
export type ExperimentMetricDirection = 'HIGHER' | 'LOWER';
export type ExperimentMetricRole = 'PRIMARY' | 'SECONDARY';
```

Define measurement-scope unions here so Task 20 has stable names:

```ts
export type SearchExperimentMeasurementScope = {
  kind: 'SEARCH';
  provider: 'GOOGLE_SEARCH_CONSOLE';
  marketCode: string;
  locale: string;
  propertyRef: string;
  normalizedQuery: string;
  canonicalPage: string | null;
  aggregationScope: 'QUERY_PAGE' | 'QUERY';
};

export type VisibilityExperimentMeasurementScope = {
  kind: 'VISIBILITY';
  metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE';
  subjectSetHash: string;
  scopeHash: string;
  formulaVersion: string;
  extractorVersion: string;
  dimensionType: string;
  dimensionKey: string;
  actorType: string;
  actorKey: string;
};

export type ExperimentMeasurementScope =
  | SearchExperimentMeasurementScope
  | VisibilityExperimentMeasurementScope;
```

`experiment.identity.ts` owns its canonical serializer instead of importing P9-C identity helpers. `buildExperimentKey()` hashes experiment version + all immutable bindings. `buildObservationKey()` sorts/deduplicates the four source-ref sets before hashing.

`experiment.schedule.ts` exports:

```ts
export type ExperimentWindow = {
  windowType: ExperimentWindowType;
  windowDays: 7 | 14 | 28 | 56;
};

export function scheduleForIntervention(
  action: RecommendedActionType
): readonly ExperimentWindow[] | null;

export function dueAtForWindow(anchor: Date, windowDays: number): Date;
```

Use millisecond arithmetic from exact `verifiedAnchorAt` for `dueAt`; Search Facts calendar-day boundaries are resolved separately in Task 20.

In `experiment.repository.ts`, implement `createOrGetExperiment()` and `createOrGetObservation()` as read-first/create/catch-P2002/read-collision flows. Compare every immutable scalar plus canonicalized JSON; on mismatch throw `EXPERIMENT_IDENTITY_COLLISION` or `EXPERIMENT_OBSERVATION_IDENTITY_COLLISION`. Never use Prisma `upsert` for immutable records.

- [ ] **Step 5: Add RED/green persistence integration coverage**

Create `tests/integration/experiment.persistence.test.ts` using the repository's existing rollback-sentinel transaction pattern. Prove:

```ts
expect(toRegclass.experiment).not.toBeNull();
expect(toRegclass.observation).not.toBeNull();
expect(triggerNames).toEqual(expect.arrayContaining([
  'OptimizationExperiment_immutable',
  'OptimizationExperimentObservation_immutable'
]));
```

Inside a rollback transaction, create the minimum P9/P8 fixture, call `createOrGetExperiment()` twice with identical input and assert one row/id; then alter `targetUrl` while reusing the same key and assert `EXPERIMENT_IDENTITY_COLLISION`. Create an observation twice and prove identical reuse; change one source ref with the same key and assert observation collision.

- [ ] **Step 6: Run Task 19 GREEN verification**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run \
  tests/unit/experiment.feature-gate.test.ts \
  tests/unit/experiment.identity.test.ts \
  tests/unit/experiment.schedule.test.ts \
  tests/integration/experiment.persistence.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 19**

```bash
git add \
  prisma/models/optimization-experiment.prisma \
  prisma/models/optimization.prisma \
  prisma/models/publication.prisma \
  prisma/migrations/20260824140000_add_p9d_experiment_engine/migration.sql \
  src/auth/feature-flags.ts \
  src/modules/optimization-experiments/experiment.types.ts \
  src/modules/optimization-experiments/experiment.identity.ts \
  src/modules/optimization-experiments/experiment.schedule.ts \
  src/modules/optimization-experiments/experiment.repository.ts \
  tests/unit/experiment.feature-gate.test.ts \
  tests/unit/experiment.identity.test.ts \
  tests/unit/experiment.schedule.test.ts \
  tests/integration/experiment.persistence.test.ts
git commit -m "feat: add P9-D experiment persistence"
```

---

### Task 20: Exact VERIFIED start gate and persisted-fact resolvers

**Files:**
- Create: `src/modules/optimization-experiments/experiment.scope.ts`
- Create: `src/modules/optimization-experiments/experiment.search-source.ts`
- Create: `src/modules/optimization-experiments/experiment.visibility-source.ts`
- Create: `src/modules/optimization-experiments/experiment.service.ts`
- Extend: `src/modules/optimization-experiments/experiment.repository.ts`
- Test: `tests/unit/experiment.scope.test.ts`
- Test: `tests/unit/experiment.search-source.test.ts`
- Test: `tests/unit/experiment.visibility-source.test.ts`
- Test: `tests/integration/experiment.start-authority.test.ts`

**Interfaces:**
- Consumes: Task 19 `ExperimentMeasurementScope`, immutable repository APIs, P9 candidate/plan fields, P8 proposal/execution/verification facts, `SearchFactRepository.listCompletedFacts()`, and persisted P6 Growth evidence pointing to `VisibilityMetricRow`.
- Produces: `OptimizationExperimentService.startFromVerifiedExecution()`, `resolveExperimentMeasurementScope()`, `resolveSearchWindowComparison()`, `resolveVisibilityWindowComparison()`, and `ExperimentWindowResolution` for Task 21.
- Start result is a closed union: `{ kind:'STARTED'; experiment } | { kind:'EXISTING'; experiment } | { kind:'DEFERRED'; reasonCode }`.

- [ ] **Step 1: Write RED authority and scope tests before service implementation**

Create `tests/integration/experiment.start-authority.test.ts` with fixtures for these exact cases:

```text
ADVANCED + P9 proposal + execution VERIFIED + verification VERIFIED + exact URL => STARTED
ENTERPRISE same bindings => STARTED
STANDARD => DEFERRED / EXPERIMENT_FEATURE_NOT_AVAILABLE
execution PR_CREATED/DEPLOYED/VERIFYING => DEFERRED / EXPERIMENT_EXECUTION_NOT_VERIFIED
verification FAILED/UNKNOWN/missing observedAt => DEFERRED / EXPERIMENT_VERIFICATION_NOT_VERIFIED
proposal sourceType != P9_OPTIMIZATION_PLAN => DEFERRED / EXPERIMENT_P9_SOURCE_MISMATCH
proposal sourceReferenceId != plan.id => DEFERRED / EXPERIMENT_P9_SOURCE_MISMATCH
observedUrl mismatches targetPublicUrl => DEFERRED / EXPERIMENT_VERIFICATION_URL_MISMATCH
TECHNICAL_SEO_REMEDIATION => DEFERRED / EXPERIMENT_INTERVENTION_NOT_SUPPORTED
CANNIBALIZATION_REMEDIATION => DEFERRED / EXPERIMENT_INTERVENTION_NOT_SUPPORTED
cross-project execution/plan/verification => no experiment row
```

Assert the service never updates the source plan, candidate, execution, or verification rows.

- [ ] **Step 2: Implement exact URL and P8/P9 authority loading**

Extend `experiment.repository.ts` with a read-only authority method:

```ts
loadVerifiedStartContext(input: {
  projectId: string;
  publicationExecutionId: string;
}): Promise<VerifiedExperimentStartContext | null>;
```

The Prisma query must bind through:

```text
PublicationExecution.projectId
→ PublicationPlan.projectId
→ PublicationProposal.projectId
→ PublicationProposal.sourceType = P9_OPTIMIZATION_PLAN
→ PublicationProposal.sourceReferenceId = OptimizationPlan.id
→ OptimizationPlan.projectId
→ OptimizationCandidate.projectId
```

Select VERIFIED verification rows with non-null `observedAt`/`observedUrl`, ordered deterministically by `observedAt ASC, createdAt ASC, id ASC`; use the first exact valid row.

In `experiment.scope.ts`, use a strict bounded URL normalizer:

```ts
export function normalizeExperimentHttpUrl(value: string): string {
  if (value.length > 2_048) throw new Error('EXPERIMENT_URL_INVALID');
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('EXPERIMENT_URL_INVALID');
  }
  url.hash = '';
  return url.href;
}
```

Normalized `observedUrl` and `targetPublicUrl` must be equal.

- [ ] **Step 3: Derive search measurement scope only from immutable configured-market provenance**

For `SERP_SNIPPET_OPTIMIZATION`, `ON_PAGE_OPTIMIZATION`, and `CONTENT_REFRESH`, require:

```text
candidate.marketScopeMode = CONFIGURED_MARKET
candidate.marketCode != null
candidate.locale != null
candidate.normalizedQuery non-empty
candidate.canonicalPage normalized URL == verified target URL
candidate.sourceProvenance.version = GROWTH_SEARCH_PROVENANCE_V1
candidate.sourceProvenance.mode = CONFIGURED_MARKET
scoringLane.provider = GOOGLE_SEARCH_CONSOLE
one scoringLane.marketProjections entry exactly matches marketCode + locale
matching projection.propertyRef non-empty
```

Return a search scope with `aggregationScope:'QUERY_PAGE'`.

For `CONTENT_CREATION`, require the same configured-market/query/provider/property provenance, but set `aggregationScope:'QUERY'` and `canonicalPage:null`. Do not infer a pre-existing target-page zero.

Legacy/unconfigured or ambiguous provenance returns `EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED` rather than guessing a property/market.

- [ ] **Step 4: Derive visibility scope from the exact P6 evidence row referenced by the candidate Growth snapshot**

For `GEO_CITABILITY_IMPROVEMENT`, load a candidate Growth evidence row with:

```text
snapshotId = candidate.growthSnapshotId
sourceModule = P6_VISIBILITY
sourceType = VISIBILITY_METRIC_ROW
ruleKey = P6_CITATION_RATE
```

For `AI_VISIBILITY_IMPROVEMENT`, prefer `P6_MENTION_RATE`; use `P6_CITATION_RATE` only when the immutable candidate source/evidence explicitly identifies citation as the target root cause.

Resolve `GrowthOpportunityEvidence.sourceId` to the exact `VisibilityMetricRow` and parent snapshot. Validate:

```text
row.projectId == projectId
snapshot.projectId == projectId
snapshot.status == COMPLETED
sourceFactVersion == `${snapshot.formulaVersion}:${snapshot.id}`
row.dimensionType == OVERALL
row.actorType == OWNED_ROLLUP
```

Freeze `subjectSetHash`, `scopeHash`, `formulaVersion`, `extractorVersion`, metric, dimension, and actor identity into `VisibilityExperimentMeasurementScope`. If any binding is missing or ambiguous, defer with `EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED`.

- [ ] **Step 5: Implement exact Search Facts window resolution and aggregation**

`experiment.search-source.ts` consumes an injected port compatible with `SearchFactRepository.listCompletedFacts()`.

For an N-day window anchored at the UTC calendar date containing `verifiedAnchorAt`:

```ts
baseline = [anchorDay - N days, anchorDay - 1 day]
observed = [anchorDay, anchorDay + (N - 1) days]
```

Selection rules:

- query-page scope filters exact provider/market/locale/property/query/page;
- query scope filters exact provider/market/locale/property/query and aggregates the query across its returned query-page rows;
- `COMPLETE` is conclusive-compatible;
- `TOP_ROWS_ONLY` is accepted only for exact query-page scope when the exact target fact exists in both windows for every required date;
- query aggregation for `CONTENT_CREATION` requires `COMPLETE`; a truncated top-row snapshot is insufficient;
- `PROVIDER_UNSPECIFIED`/`UNKNOWN` completeness is insufficient;
- if multiple compatible snapshots represent the same logical date/fact, deterministically select highest `sourceCutoffAt`, then lexicographically smallest `snapshotId`; never select by metric value;
- every required UTC source date must be represented for a conclusive result; absence is not zero.

Aggregate exact known metrics as follows:

```text
CLICKS = sum daily clicks
IMPRESSIONS = sum daily impressions
CTR = total clicks / total impressions (never mean daily CTR)
GOOGLE_SEARCH_CONSOLE_POSITION = impression-weighted mean position
BING_AVG_CLICK_POSITION = click-weighted mean position
BING_AVG_IMPRESSION_POSITION = impression-weighted mean position
```

If a required weight/metric is unknown or missing, mark that metric insufficient. Preserve bounded source snapshot IDs and max source cutoff.

- [ ] **Step 6: Implement exact Visibility Metrics baseline/observation pairing**

`experiment.visibility-source.ts` reads only `VisibilityMetricSnapshot.status='COMPLETED'` and the exact frozen metric/dimension/actor identity.

For each due window:

```text
baseline = latest compatible snapshot with windowEnd <= verifiedAnchorAt
observation = earliest compatible snapshot with windowEnd >= dueAt
```

Require equal source-window durations and identical:

```text
subjectSetHash
scopeHash
formulaVersion
extractorVersion
metricType
dimensionType + dimensionKey
actorType + actorKey
```

Reject `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE` for a conclusive result. Require both baseline and observation `eligibleObservationCount >= 10` and denominator > 0. Compute rates from numerator/denominator, not persisted display rounding.

- [ ] **Step 7: Implement `startFromVerifiedExecution()` and immutable experiment creation**

`OptimizationExperimentService.startFromVerifiedExecution()` must:

1. load exact context;
2. verify feature entitlement with `hasFeature(planLevel, 'OPTIMIZATION_EXPERIMENTS')`;
3. verify execution + verification + P9 proposal bindings;
4. reject unsupported interventions;
5. resolve exact measurement scope;
6. derive deterministic schedule and expected-direction map;
7. build the exact experiment key;
8. call `createOrGetExperiment()`;
9. return `STARTED` or `EXISTING` without mutating any upstream row.

Expected primary directions:

```text
SERP_SNIPPET_OPTIMIZATION: CTR HIGHER
ON_PAGE_OPTIMIZATION: CLICKS HIGHER
CONTENT_REFRESH: CLICKS HIGHER
CONTENT_CREATION: IMPRESSIONS HIGHER (query scope)
GEO_CITABILITY_IMPROVEMENT: CITATION_RATE HIGHER
AI_VISIBILITY_IMPROVEMENT: frozen primary visibility metric HIGHER
```

- [ ] **Step 8: Run Task 20 GREEN verification**

Run:

```bash
npx vitest run \
  tests/unit/experiment.scope.test.ts \
  tests/unit/experiment.search-source.test.ts \
  tests/unit/experiment.visibility-source.test.ts \
  tests/integration/experiment.start-authority.test.ts
npm run typecheck
```

Expected: all pass; inspect the integration fixture before commit to confirm no test relies on synthetic zero baselines.

- [ ] **Step 9: Commit Task 20**

```bash
git add \
  src/modules/optimization-experiments/experiment.repository.ts \
  src/modules/optimization-experiments/experiment.scope.ts \
  src/modules/optimization-experiments/experiment.search-source.ts \
  src/modules/optimization-experiments/experiment.visibility-source.ts \
  src/modules/optimization-experiments/experiment.service.ts \
  tests/unit/experiment.scope.test.ts \
  tests/unit/experiment.search-source.test.ts \
  tests/unit/experiment.visibility-source.test.ts \
  tests/integration/experiment.start-authority.test.ts
git commit -m "feat: resolve verified P9-D experiment facts"
```

---

### Task 21: Deterministic evaluator, contamination guards, queue, reconciliation, and P8 VERIFIED handoff

**Files:**
- Create: `src/modules/optimization-experiments/experiment.contamination.ts`
- Create: `src/modules/optimization-experiments/experiment.evaluator.ts`
- Create: `src/modules/optimization-experiments/experiment.observability.ts`
- Create: `src/modules/optimization-experiments/experiment.queue.ts`
- Create: `src/modules/optimization-experiments/experiment.worker.ts`
- Extend: `src/modules/optimization-experiments/experiment.service.ts`
- Extend: `src/modules/optimization-experiments/experiment.repository.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/modules/publication/publication-verification.worker.ts`
- Test: `tests/unit/experiment.evaluator.test.ts`
- Test: `tests/unit/experiment.queue.test.ts`
- Test: `tests/unit/experiment.worker.test.ts`
- Test: `tests/unit/publication-verification-experiment-handoff.test.ts`
- Modify test: `tests/unit/queues.test.ts`
- Modify test: `tests/unit/worker-bootstrap.test.ts`
- Test: `tests/integration/experiment.contamination.test.ts`

**Interfaces:**
- Consumes: Task 20 `ExperimentWindowResolution` and start service; P8 execution events are read-only contamination evidence.
- Produces: `evaluateExperimentWindow()`, `detectExperimentContamination()`, `OptimizationExperimentQueue`, `processOptimizationExperimentJob()`, and a post-P8-verification injected callback signature `{ executionId:string; projectId:string }`.
- P8 remains independent: `publication-verification.worker.ts` accepts an optional callback and must not import the P9-D module.

- [ ] **Step 1: Write RED evaluator tests that lock conservative V1 semantics**

In `tests/unit/experiment.evaluator.test.ts`, cover these exact rules:

```text
any authority/coverage/source blocker => INCONCLUSIVE
any material contamination != CLEAR => INCONCLUSIVE
click/impression count metric: |relative delta| < 0.02 => NEUTRAL when baseline > 0
count baseline=0 and observed=0 => NEUTRAL
count baseline=0 and observed>0 => POSITIVE only when zero is an explicit KNOWN_PRESENT numeric fact, never an inferred absence
CTR absolute delta < 0.02 => NEUTRAL
provider position absolute numeric delta < 1.0 => NEUTRAL; lower is favorable
visibility rate absolute delta < 0.05 => NEUTRAL
primary favorable + no significant adverse secondary => POSITIVE
primary adverse + no significant favorable secondary => NEGATIVE
significant primary/secondary directional conflict => INCONCLUSIVE
all sufficient metrics neutral => NEUTRAL
```

Use table-driven tests with explicit baseline/observed values and expected direction.

- [ ] **Step 2: Implement deterministic contamination detection**

`experiment.contamination.ts` checks only persisted P8 facts over `(verifiedAnchorAt, observedWindowEnd]`.

Return priorities in this order:

1. `VERIFICATION_INVALIDATED` when original execution has a persisted `ROLLED_BACK` or equivalent rollback completion event after the anchor;
2. `CONFLICTING_MUTATION` when another execution for the same normalized target URL has a persisted `DEPLOYED`, `VERIFIED`, or `ROLLED_BACK` event inside the observation interval;
3. `TARGET_REVISION_CHANGED` when another same-target execution records `TARGET_REVISION_CHANGED` inside the interval;
4. `SOURCE_IDENTITY_CHANGED` when Task 20 source resolution reports incompatible provider/property/market/locale/query/page/formula/extractor identity;
5. `UNKNOWN` when required contamination authority cannot be resolved safely;
6. otherwise `CLEAR`.

Do not inspect Git directly and do not attempt semantic adjustment for concurrent changes.

- [ ] **Step 3: Implement evaluator and stable observation cutoff semantics**

`experiment.evaluator.ts` exports:

```ts
export function evaluateExperimentEffect(input: {
  comparisons: readonly ExperimentMetricComparison[];
  coverageState: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
  contaminationState: ExperimentContaminationState;
  reasonCodes: readonly string[];
}): ExperimentEvaluationResult;
```

The service must derive `inputCutoffAt` from the selected persisted source identities, not blindly from wall-clock time:

```text
if one or more source snapshots selected: max(SearchFact.sourceCutoffAt, VisibilityMetricSnapshot.inputCutoffAt)
if no comparable source exists yet: dueAt
```

Therefore a daily reconcile with unchanged inputs reuses the same immutable observation key instead of writing duplicate no-data observations. A newly arrived source cutoff creates a new append-only observation.

- [ ] **Step 4: Write RED queue/registry/bootstrap tests**

Create `tests/unit/experiment.queue.test.ts` asserting:

```ts
expect(OPTIMIZATION_EXPERIMENT_QUEUE_NAME).toBe('optimization-experiment-evaluation');
expect(OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS).toBe(2);
```

Lock durable payloads:

```ts
{ kind:'START_EXPERIMENT', publicationExecutionId, projectId }
{ kind:'EVALUATE_WINDOW', experimentId, projectId, windowType:'14D' }
{ kind:'RECONCILE_DAILY' }
```

Job IDs are deterministic and `removeOnComplete:true` so later daily reconciliation can re-enqueue the same window after new source facts arrive.

Update `tests/unit/queues.test.ts` to expect `optimization-experiment-evaluation` immediately after `optimization-autopilot`.

Update `tests/unit/worker-bootstrap.test.ts` to require:

```text
OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY = 2
one 24h date-free reconciliation scheduler
workerDefinitionForQueue('optimization-experiment-evaluation').processor = processOptimizationExperimentJob
```

- [ ] **Step 5: Implement the one owned queue and worker jobs**

`experiment.queue.ts` exports:

```ts
export const OPTIMIZATION_EXPERIMENT_QUEUE_NAME = 'optimization-experiment-evaluation' as const;
export const OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS = 2;

export type OptimizationExperimentJobData =
  | { kind:'START_EXPERIMENT'; publicationExecutionId:string; projectId:string }
  | { kind:'EVALUATE_WINDOW'; experimentId:string; projectId:string; windowType:ExperimentWindowType }
  | { kind:'RECONCILE_DAILY' };
```

Use exponential retry with 5 seconds; `removeOnComplete:true`; `removeOnFail:200`.

`experiment.worker.ts` behavior:

```text
start-experiment → service.startFromVerifiedExecution(); enqueue all scheduled windows only after an experiment exists
evaluate-window → service.evaluateWindow(); no provider/sampling calls
reconcile-daily → enqueue VERIFIED P9 executions lacking experiments, then enqueue every due experiment/window for bounded reconciliation
```

Repository reconciliation reads are bounded and deterministic:

```text
verified starts limit = 100 per reconciliation pass
experiments limit = 200 per reconciliation pass
order = createdAt ASC, id ASC
```

Repeated due-window evaluation is safe because immutable observation identity reuses unchanged source cutoffs/source sets.

- [ ] **Step 6: Implement `evaluateWindow()` persistence flow**

The service must:

1. load experiment inside project;
2. validate requested window belongs to frozen `observationScheduleJson`;
3. return without observation if current time is before `dueAt`;
4. resolve Search or Visibility baseline/observed facts using Task 20;
5. run contamination detection;
6. compute bounded projections/deltas;
7. classify coverage/effect;
8. derive stable `inputCutoffAt`;
9. build observation key from exact source identities;
10. call `createOrGetObservation()`;
11. emit only bounded IDs/window/effect/coverage/contamination/reason codes.

No step may update the experiment row.

- [ ] **Step 7: Add the non-authoritative post-commit P8 VERIFIED handoff**

Extend `PublicationVerificationWorkerDeps` with:

```ts
onVerified?: (input: { executionId: string; projectId: string }) => Promise<void>;
```

On the successful verification branch:

```ts
const persisted = await persistFinal(/* existing VERIFIED arguments */);
if (!persisted) return;
try {
  await deps.onVerified?.({
    executionId: context.execution.id,
    projectId: context.execution.projectId
  });
} catch (error) {
  emit({
    event: 'optimization.experiment.handoff.failed',
    executionId: context.execution.id,
    projectId: context.execution.projectId,
    errorCode: error instanceof Error ? error.name : 'UNKNOWN'
  });
}
return;
```

The callback runs only after the P8 final transaction has committed. A callback failure is swallowed after bounded logging; it must not change the VERIFIED result. Do not import `optimization-experiments` from this P8 worker.

In `worker-bootstrap.ts`, create the P9-D queue and inject:

```ts
onVerified: ({ executionId, projectId }) =>
  optimizationExperimentQueue.enqueueStart(executionId, projectId)
```

Register its worker and a 24h date-free `reconcile-daily` BullMQ scheduler using `upsertJobScheduler`, following the existing P9-B/P9-C scheduler pattern.

- [ ] **Step 8: Prove handoff failure cannot fail P8 and contamination cannot become conclusive**

Create `tests/unit/publication-verification-experiment-handoff.test.ts` with injected `persistFinal=vi.fn().mockResolvedValue(true)` and `onVerified=vi.fn().mockRejectedValue(new Error('redis down'))`; assert `processPublicationVerificationJob()` resolves, persistFinal was called for VERIFIED, and the failure event was emitted.

Create `tests/integration/experiment.contamination.test.ts` proving a second same-target P8 deployment inside the observation interval forces the stored observation to `INCONCLUSIVE / CONFLICTING_MUTATION` without modifying either publication execution.

- [ ] **Step 9: Run Task 21 GREEN verification**

Run:

```bash
npx vitest run \
  tests/unit/experiment.evaluator.test.ts \
  tests/unit/experiment.queue.test.ts \
  tests/unit/experiment.worker.test.ts \
  tests/unit/publication-verification-experiment-handoff.test.ts \
  tests/unit/queues.test.ts \
  tests/unit/worker-bootstrap.test.ts \
  tests/integration/experiment.contamination.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 10: Commit Task 21**

```bash
git add \
  src/modules/optimization-experiments/experiment.contamination.ts \
  src/modules/optimization-experiments/experiment.evaluator.ts \
  src/modules/optimization-experiments/experiment.observability.ts \
  src/modules/optimization-experiments/experiment.queue.ts \
  src/modules/optimization-experiments/experiment.worker.ts \
  src/modules/optimization-experiments/experiment.service.ts \
  src/modules/optimization-experiments/experiment.repository.ts \
  src/modules/publication/publication-verification.worker.ts \
  src/queue/queues.ts \
  src/queue/worker-bootstrap.ts \
  tests/unit/experiment.evaluator.test.ts \
  tests/unit/experiment.queue.test.ts \
  tests/unit/experiment.worker.test.ts \
  tests/unit/publication-verification-experiment-handoff.test.ts \
  tests/unit/queues.test.ts \
  tests/unit/worker-bootstrap.test.ts \
  tests/integration/experiment.contamination.test.ts
git commit -m "feat: evaluate P9-D experiment windows"
```

---

### Task 22: Project-scoped persisted-read REST API and 优化实验 UI

**Files:**
- Create: `src/modules/optimization-experiments/experiment.routes.ts`
- Create: `src/modules/optimization-experiments/experiment.web.repository.ts`
- Create: `src/modules/optimization-experiments/experiment.web.routes.ts`
- Create: `src/views/optimization-experiments/index.ejs`
- Create: `src/views/optimization-experiments/show.ejs`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Test: `tests/integration/experiment.routes.test.ts`
- Test: `tests/e2e/optimization-experiments.spec.ts` (initial RED route/render slice; final authority E2E expands in Task 23)

**Interfaces:**
- Consumes: immutable P9-D repository records only.
- Produces REST:
  - `GET /api/v1/projects/:projectId/optimization/experiments`
  - `GET /api/v1/projects/:projectId/optimization/experiments/:experimentId`
- Produces Web:
  - `GET /projects/:id/optimization/experiments`
  - `GET /projects/:id/optimization/experiments/:experimentId`
- No POST/PUT/PATCH/DELETE experiment route exists in P9-D V1.

- [ ] **Step 1: Write RED API contract tests with an injectable read port**

Define `OptimizationExperimentApiPort`:

```ts
export interface OptimizationExperimentApiPort {
  listExperiments(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getExperiment(projectId: string, experimentId: string): Promise<unknown | null>;
}
```

In `tests/integration/experiment.routes.test.ts`, use `createApp({ optimizationExperimentApi: fakePort })` and prove:

```text
Advanced list => 200
Enterprise detail => 200
Standard => 403 FEATURE_NOT_AVAILABLE
cross-project/missing detail => 404 EXPERIMENT_NOT_FOUND
invalid UUID/limit/offset => 400 VALIDATION_ERROR
GET invokes only list/get read methods
```

- [ ] **Step 2: Implement strict read-only REST routes**

`experiment.routes.ts` uses `requireFeature('OPTIMIZATION_EXPERIMENTS')`, strict Zod pagination (`limit 1..100`, `offset 0..100000`), UUID params, and the injected/default read port.

The default port selects only P9-D-owned experiment/observation fields plus bounded immutable plan identity needed for display. It must not invoke `OptimizationExperimentService.startFromVerifiedExecution()` or `evaluateWindow()`.

- [ ] **Step 3: Implement a bounded persisted-read web projection with derived lifecycle state**

`experiment.web.repository.ts` loads project, experiments, observations and derives state without writes:

```text
CONTAMINATED: latest due observation has contaminationState != CLEAR
EVALUATED: all due/final scheduled windows have conclusive POSITIVE/NEUTRAL/NEGATIVE observations
INCONCLUSIVE: latest due/final window has INCONCLUSIVE and no later conclusive replacement at a newer source cutoff
OBSERVING: future windows remain due or no due observation exists yet
```

For each window, choose the latest immutable observation by `inputCutoffAt DESC, createdAt DESC, id ASC` for the current view only; historical observations remain visible in detail.

Do not expose raw upstream provider payloads, prompts, article body, credentials, or full P8 mutation payloads.

- [ ] **Step 4: Implement EJS routes/views and sidebar entry**

`experiment.web.routes.ts` checks the project and `hasFeature(planLevel, 'OPTIMIZATION_EXPERIMENTS')`, then renders:

```ts
res.render('layout', {
  title: `优化实验 · ${data.project.name}`,
  activeNav: 'optimization-experiments',
  currentProjectId: data.project.id,
  breadcrumbs: ['项目', data.project.name, '增长', '优化实验'],
  bodyTemplate: 'optimization-experiments/index',
  ...data
});
```

Detail renders `optimization-experiments/show`.

Add the sidebar link inside the 增长 group after `New Content`:

```ejs
<a class="<%= activeNav === 'optimization-experiments' ? 'active' : '' %>"
   href="<%= currentProjectId ? `/projects/${currentProjectId}/optimization/experiments` : '/projects' %>">
  优化实验 <span class="badge premium">高级版</span>
</a>
```

List view shows target URL, intervention type, verified anchor, market/locale, derived state, next/final window. Detail shows frozen measurement scope summary, all windows, baseline/observed bounded metrics, coverage, contamination, effect, reason codes, evaluator version, and the explicit label `观察关联，不代表因果关系`.

Do not render any button/form labeled start/evaluate/publish/merge/deploy/rollback.

- [ ] **Step 5: Mount routes in `src/app.ts` without side-effect defaults**

Add:

```ts
optimizationExperimentApi?: OptimizationExperimentApiPort;
```

Mount REST under `/api/v1` and Web under `/`. The web route constructor must instantiate only a persisted-read repository; it must not create Redis queues.

- [ ] **Step 6: Add initial browser RED/GREEN coverage**

`tests/e2e/optimization-experiments.spec.ts` seeds one Advanced project with immutable experiment/observations directly through Prisma, then asserts:

```text
优化实验 sidebar link is visible and active
list page renders intervention/target/derived state
detail page renders 14D/28D/56D outcomes and source coverage
page renders 观察关联，不代表因果关系
no auto-merge/deploy/rollback/start/evaluate control is rendered
```

Seed a Standard project and assert the feature route is forbidden rather than exposing experiment data.

- [ ] **Step 7: Run Task 22 GREEN verification**

Run:

```bash
npx vitest run tests/integration/experiment.routes.test.ts
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/optimization-experiments.spec.ts
```

Expected: all pass.

- [ ] **Step 8: Commit Task 22**

```bash
git add \
  src/modules/optimization-experiments/experiment.routes.ts \
  src/modules/optimization-experiments/experiment.web.repository.ts \
  src/modules/optimization-experiments/experiment.web.routes.ts \
  src/views/optimization-experiments/index.ejs \
  src/views/optimization-experiments/show.ejs \
  src/views/partials/sidebar.ejs \
  src/app.ts \
  tests/integration/experiment.routes.test.ts \
  tests/e2e/optimization-experiments.spec.ts
git commit -m "feat: expose P9-D experiment results"
```

---

### Task 23: Authority audit, full E2E, operator documentation, and exact-head release gate

**Files:**
- Create: `tests/integration/experiment.authority.test.ts`
- Extend: `tests/e2e/optimization-experiments.spec.ts`
- Create: `docs/development/p9-d-experiment-engine.md`
- Review only: `.github/workflows/ci.yml`
- Review all P9-D changed files; do not alter unrelated authority code to make release checks pass.

**Interfaces:**
- Consumes: all Task 19–22 public contracts.
- Produces: release evidence only; no new runtime authority.
- Completion requires exact-head GitHub CI `verify`, `production-audit`, and `e2e` success plus manual changed-file authority review and zero unresolved review threads.

- [ ] **Step 1: Add an authority-boundary integration test**

`tests/integration/experiment.authority.test.ts` snapshots authoritative rows before start/evaluation and proves they are byte-for-byte/field-for-field unchanged afterward:

```text
GrowthOpportunityIdentity
GrowthOpportunitySnapshot
GrowthOpportunityLifecycle
OptimizationCandidate
OptimizationPlan including historicalRankAdjustment
OptimizationRun
OptimizationRunItem
OptimizationAutopilotDecision
PublicationProposal
PublicationPlan
PublicationApproval / PublicationAutomationAuthorization
PublicationExecution
PublicationVerification
SearchFactSnapshot / SearchFact / SearchFactMetric
VisibilityMetricSnapshot / VisibilityMetricRow
```

The only row-count increases allowed are:

```text
OptimizationExperiment
OptimizationExperimentObservation
```

The test must also prove `CONTENT_CREATION` with no comparable query baseline stores `INCONCLUSIVE / NO_COMPARABLE_BASELINE` and never writes a fabricated baseline value of zero.

- [ ] **Step 2: Add static import/source scans for forbidden P9-D authority**

Within `tests/integration/experiment.authority.test.ts`, scan `src/modules/optimization-experiments/**/*.ts` and fail if P9-D imports or contains execution calls for forbidden owners, including:

```text
deepseek.provider
github-mutation.adapter
mergePullRequest
deploy
rollback execution APIs
PublicationExecutionService.createHumanApprovedExecution
PublicationExecutionService.createAutomationAuthorizedExecution
authorizePublicationAutomation
publicationAutomationPreparation
```

Also assert no P9-D source contains Prisma mutations against these delegates:

```text
optimizationPlan.update
optimizationCandidate.update
optimizationRun.update
optimizationRunItem.update
publicationExecution.update
publicationVerification.update
searchFact.update
visibilityMetricSnapshot.update
```

Repository writes must be limited to `optimizationExperiment.create` and `optimizationExperimentObservation.create`.

- [ ] **Step 3: Expand E2E to prove persisted-read and conservative semantics**

Extend `tests/e2e/optimization-experiments.spec.ts` with:

```text
GET list/detail does not change experiment/observation/P8 row counts
an INCONCLUSIVE missing-baseline observation is visibly labeled insufficient rather than 0%/100% lift
a contaminated observation visibly shows CONFLICTING_MUTATION and INCONCLUSIVE
provider position direction renders lower-is-better semantics
visibility result renders numerator/denominator coverage, not a fabricated rank
Standard cannot access the list or detail
cross-project experiment id does not leak detail
```

No E2E path calls external providers or real GitHub writes.

- [ ] **Step 4: Write operator/developer documentation with frozen V1 semantics**

Create `docs/development/p9-d-experiment-engine.md` documenting:

```text
purpose and authority ownership
feature-gate matrix
P8 VERIFIED prerequisite and exact provenance binding
supported/unsupported interventions
7/14/28/56-day schedules
Search Facts aggregation semantics
Visibility Metrics pairing semantics
UNKNOWN/NOT_SUPPORTED/TOP_ROWS_ONLY rules
CONTENT_CREATION no-zero-baseline rule
coverage thresholds and neutral bands
contamination states
derived UI lifecycle states
queue/reconciliation behavior
P8 handoff failure isolation
observability allowlist
migration/immutability triggers
rollback procedure: disable worker scheduling/feature exposure first, retain immutable audit rows; schema rollback requires an explicitly reviewed future migration
P9-E boundary: historicalRankAdjustment remains untouched
```

State explicitly that P9-D is observational and does not establish causation.

- [ ] **Step 5: Run the full local release-equivalent verification**

With PostgreSQL/Redis test services available, run in this exact order:

```bash
npm install
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Then reproduce `production-audit` in a clean dependency tree/worktree or disposable environment:

```bash
npm install --omit=dev --legacy-peer-deps
if [ -d node_modules/prisma ]; then
  echo "Prisma CLI must not be present in the runtime dependency tree"
  exit 1
fi
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Do not mix the runtime-only install with the development tree used for Vitest/Playwright.

- [ ] **Step 6: Perform the manual changed-file authority review before declaring readiness**

Review the final diff against the spec and record evidence for all of these assertions:

```text
P9-D writes only its two immutable tables
P8 VERIFIED remains authoritative
P8 verification survives experiment queue failure
no provider/AI/Git/deploy/rollback path exists in P9-D
no P7/P9-A/P9-B/P9-C authority mutation
historicalRankAdjustment remains untouched
new-content page absence never becomes zero
UNKNOWN/NOT_SUPPORTED never become zero
GET routes are side-effect free
unsupported interventions never receive proxy conclusions
contamination forces INCONCLUSIVE
all observability fields are bounded and exclude content/prompts/credentials/raw provider payloads
```

- [ ] **Step 7: Commit Task 23 release artifacts**

```bash
git add \
  tests/integration/experiment.authority.test.ts \
  tests/e2e/optimization-experiments.spec.ts \
  docs/development/p9-d-experiment-engine.md
git commit -m "test: gate P9-D experiment authority"
```

- [ ] **Step 8: Open/update the P9-D PR as Draft and require exact-head CI**

The PR body must state the exact feature head SHA and these hard boundaries:

```text
P9-D consumes only persisted P8/Search Facts/Visibility Metrics authority
no causal claim
no feedback weight mutation
no Git/merge/deploy/rollback authority
CONTENT_CREATION never fabricates a page zero baseline
```

Wait for GitHub Actions on that exact head. Required conclusions:

```text
verify = success
production-audit = success
e2e = success
```

If any code/doc commit lands after the green run, treat the prior CI as stale and run the exact-head gate again.

- [ ] **Step 9: Final release review gate**

Before marking the PR Ready for review, verify:

```text
PR head SHA == SHA verified by all three required jobs
manual authority review complete
unresolved review threads == 0
PR is not merged
no deployment was triggered
```

Only then mark the PR Ready for review. Stop there. Merge requires a separate explicit human `合并`; deployment requires a separate explicit authorization.
