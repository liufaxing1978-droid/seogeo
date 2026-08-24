# P9-D Experiment Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded P9-D experiment engine that starts only from exact P8 VERIFIED publication facts, evaluates immutable search/AI-visibility observations from persisted completed snapshots, and reports conservative observed effects without changing P7, P8, P9 planning authority, Git, deployment, or feedback weights.

**Architecture:** Add one isolated `optimization-experiments` module with immutable experiment/observation persistence, deterministic identities and schedules, read-only Search Facts/Visibility Metrics resolvers, a deterministic evaluator, one BullMQ queue, and persisted-read API/UI projections. P8 verification exposes only an injected post-commit handoff; queue delivery failure must never reverse or fail P8 verification. P9-D writes only its own two tables and never updates `OptimizationPlan.historicalRankAdjustment`.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Prisma 6.14/PostgreSQL 17, BullMQ 5.58/Redis 7, Express 5, Zod 3.25, EJS, Vitest 3.2, Supertest 7, Playwright 1.55/Chromium.

**Spec:** `docs/superpowers/specs/2026-08-24-p9-d-experiment-engine-design.md`

## Global Constraints

- Base branch for implementation is `feat/p9-d-experiment-engine`, originally created from `main@5fac353d0e5e8c4bd5c187e4318bd1c7e4490d4e`.
- `OPTIMIZATION_EXPERIMENTS`: Standard=false, Advanced=true, Enterprise=true.
- Start only from `PublicationExecution.status = VERIFIED` plus an exact persisted `PublicationVerification.status = VERIFIED` with non-null `observedAt` and matching bounded HTTP(S) `observedUrl`.
- P8 proposal provenance must be `sourceType = P9_OPTIMIZATION_PLAN` and `sourceReferenceId = OptimizationPlan.id`.
- P9-D may read P7/P8/P9/Search Facts/Visibility Metrics, but may persist only `OptimizationExperiment` and `OptimizationExperimentObservation` plus bounded operational logs.
- No P9-D provider calls, DeepSeek calls, Git writes, Draft-PR creation, merge, deployment, rollback, P7 scoring mutation, P8 authority mutation, or `OptimizationPlan.historicalRankAdjustment` update.
- Missing, `UNKNOWN`, `NOT_SUPPORTED`, incompatible, or absent top-row facts never become numeric zero.
- `CONTENT_CREATION` never uses target-page absence as a zero baseline; it uses exact query-level comparison only when immutable P9 provenance resolves that query scope.
- P9-D reports observed association only; it does not claim causal effect.
- `OptimizationExperiment` and `OptimizationExperimentObservation` are immutable with PostgreSQL `BEFORE UPDATE OR DELETE` triggers.
- Experiment lifecycle is derived from immutable identity + immutable observations; no mutable experiment status column is introduced.
- P9-D owns exactly one new queue: `optimization-experiment-evaluation`.
- Queue payloads contain durable IDs/window identifiers only; no content body, prompt, provider raw payload, credential, or model answer.
- GET API/UI routes are persisted-read only: no enqueue, AI, provider, Git, mutation, or fact recalculation side effects.
- Existing `.github/workflows/ci.yml` remains authoritative; do not weaken or bypass `verify`, `production-audit`, or `e2e`.
- No merge or deployment without a later, separate explicit human authorization.

---

## File Structure

```text
prisma/models/optimization-experiment.prisma
prisma/migrations/20260824140000_add_p9d_experiment_engine/migration.sql
src/modules/optimization-experiments/
  experiment.types.ts
  experiment.identity.ts
  experiment.schedule.ts
  experiment.repository.ts
  experiment.scope.ts
  experiment.search-source.ts
  experiment.visibility-source.ts
  experiment.contamination.ts
  experiment.evaluator.ts
  experiment.queue.ts
  experiment.worker.ts
  experiment.service.ts
  experiment.observability.ts
  experiment.routes.ts
  experiment.web.repository.ts
  experiment.web.routes.ts
src/views/optimization-experiments/index.ejs
src/views/optimization-experiments/show.ejs
docs/development/p9-d-experiment-engine.md
```

Shared integration surfaces permitted to change:

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

Tests:

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

### Task 19: Persistence, identity, schedule, and feature gate

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
- Consumes existing Prisma `RecommendedActionType`, `MarketCode`, `OptimizationPlan`, `PublicationExecution`, and `PublicationVerification` identities.
- Produces the complete shared P9-D domain contracts below. Later tasks must import these names rather than redefining local variants.

- [ ] **Step 1: Write the RED feature/schedule tests**

Create `tests/unit/experiment.feature-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hasFeature } from '../../src/auth/feature-flags.js';

describe('P9-D feature gate', () => {
  it('is Advanced/Enterprise only', () => {
    expect(hasFeature('STANDARD', 'OPTIMIZATION_EXPERIMENTS')).toBe(false);
    expect(hasFeature('ADVANCED', 'OPTIMIZATION_EXPERIMENTS')).toBe(true);
    expect(hasFeature('ENTERPRISE', 'OPTIMIZATION_EXPERIMENTS')).toBe(true);
  });
});
```

Create `tests/unit/experiment.schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { scheduleForIntervention } from '../../src/modules/optimization-experiments/experiment.schedule.js';

describe('P9-D schedule V1', () => {
  it.each([
    ['SERP_SNIPPET_OPTIMIZATION', ['7D', '14D', '28D']],
    ['ON_PAGE_OPTIMIZATION', ['14D', '28D', '56D']],
    ['CONTENT_REFRESH', ['14D', '28D', '56D']],
    ['CONTENT_CREATION', ['14D', '28D', '56D']],
    ['GEO_CITABILITY_IMPROVEMENT', ['14D', '28D', '56D']],
    ['AI_VISIBILITY_IMPROVEMENT', ['14D', '28D', '56D']]
  ] as const)('%s', (action, expected) => {
    expect(scheduleForIntervention(action)?.map((item) => item.windowType)).toEqual(expected);
  });

  it.each(['TECHNICAL_SEO_REMEDIATION', 'CANNIBALIZATION_REMEDIATION'] as const)(
    'does not invent a proxy for %s',
    (action) => expect(scheduleForIntervention(action)).toBeNull()
  );
});
```

Run:

```bash
npx vitest run tests/unit/experiment.feature-gate.test.ts tests/unit/experiment.schedule.test.ts
```

Expected: FAIL only because the feature/module does not exist.

- [ ] **Step 2: Add the exact Prisma schema and additive migration**

Create `prisma/models/optimization-experiment.prisma`:

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

Add only these reverse relations:

```prisma
// OptimizationPlan
experiments OptimizationExperiment[]

// PublicationExecution
optimizationExperiments OptimizationExperiment[]

// PublicationVerification
optimizationExperiments OptimizationExperiment[]
```

Create the forward-only migration at the exact planned path. It must create the three enums, two tables, unique/index constraints, and `ON DELETE RESTRICT ON UPDATE CASCADE` FKs matching the schema. Add these immutable triggers after the generated DDL:

```sql
CREATE OR REPLACE FUNCTION "reject_p9d_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-D immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationExperiment_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationExperiment"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9d_immutable_mutation"();

CREATE TRIGGER "OptimizationExperimentObservation_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationExperimentObservation"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9d_immutable_mutation"();
```

Do not edit any earlier migration.

- [ ] **Step 3: Define every shared P9-D type once**

Create `experiment.types.ts`:

```ts
export const OPTIMIZATION_EXPERIMENT_VERSION = 'OPTIMIZATION_EXPERIMENT_V1' as const;
export const OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION = 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1' as const;
export const OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION = 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1' as const;

export type ExperimentWindowType = '7D' | '14D' | '28D' | '56D';
export type ExperimentMetricDirection = 'HIGHER' | 'LOWER';
export type ExperimentMetricRole = 'PRIMARY' | 'SECONDARY';
export type ExperimentCoverageState = 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
export type ExperimentContaminationState =
  | 'CLEAR'
  | 'CONFLICTING_MUTATION'
  | 'TARGET_REVISION_CHANGED'
  | 'VERIFICATION_INVALIDATED'
  | 'SOURCE_IDENTITY_CHANGED'
  | 'UNKNOWN';
export type ExperimentEffectState = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';

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

export type ExperimentMetricComparison = {
  family: 'SEARCH' | 'VISIBILITY';
  metricKey: string;
  role: ExperimentMetricRole;
  direction: ExperimentMetricDirection;
  baselineValue: number | null;
  observedValue: number | null;
  baselineZeroIsExplicit: boolean;
  baselineSourceRefs: readonly string[];
  observedSourceRefs: readonly string[];
  reasonCodes: readonly string[];
};

export type ExperimentWindowResolution = {
  comparisons: readonly ExperimentMetricComparison[];
  baselineSearchSourceRefs: readonly string[];
  observedSearchSourceRefs: readonly string[];
  baselineVisibilitySourceRefs: readonly string[];
  observedVisibilitySourceRefs: readonly string[];
  coverageState: ExperimentCoverageState;
  reasonCodes: readonly string[];
  inputCutoffAt: Date;
};
```

- [ ] **Step 4: Implement deterministic identities and schedules**

`experiment.identity.ts` owns a canonical JSON serializer and SHA-256 helper; it must not import P9-C identity code.

Export exact signatures:

```ts
export function buildExperimentKey(input: {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  interventionType: string;
  targetUrl: string;
  marketCode: string | null;
  locale: string | null;
  verifiedAnchorAt: Date;
  measurementScope: ExperimentMeasurementScope;
  observationSchedule: readonly ExperimentWindow[];
  expectedDirections: Record<string, ExperimentMetricDirection>;
}): string;

export function buildObservationKey(input: {
  experimentId: string;
  windowType: ExperimentWindowType;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: readonly string[];
  observedSearchSourceRefs: readonly string[];
  baselineVisibilitySourceRefs: readonly string[];
  observedVisibilitySourceRefs: readonly string[];
  evaluatorVersion: string;
}): string;
```

Normalize every source-ref array with trim → reject empty → dedupe → sort before hashing.

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

- [ ] **Step 5: Implement immutable repository create-or-get contracts**

In `experiment.repository.ts` define the exact create inputs:

```ts
export type CreateExperimentInput = {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  experimentVersion: string;
  experimentKey: string;
  interventionType: RecommendedActionType;
  targetUrl: string;
  marketCode: MarketCode | null;
  locale: string | null;
  verifiedAnchorAt: Date;
  measurementScopeJson: Prisma.InputJsonValue;
  observationScheduleJson: Prisma.InputJsonValue;
  expectedDirectionJson: Prisma.InputJsonValue;
};

export type CreateExperimentObservationInput = {
  projectId: string;
  experimentId: string;
  observationVersion: string;
  observationKey: string;
  windowType: ExperimentWindowType;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: Prisma.InputJsonValue;
  observedSearchSourceRefs: Prisma.InputJsonValue;
  baselineVisibilitySourceRefs: Prisma.InputJsonValue;
  observedVisibilitySourceRefs: Prisma.InputJsonValue;
  baselineMetricsJson: Prisma.InputJsonValue;
  observedMetricsJson: Prisma.InputJsonValue;
  deltaMetricsJson: Prisma.InputJsonValue;
  coverageState: ExperimentCoverageState;
  contaminationState: ExperimentContaminationState;
  effectState: ExperimentEffectState;
  reasonCodes: Prisma.InputJsonValue;
  evaluatorVersion: string;
};
```

Export:

```ts
createOrGetExperiment(input: CreateExperimentInput): Promise<OptimizationExperiment>;
createOrGetObservation(input: CreateExperimentObservationInput): Promise<OptimizationExperimentObservation>;
```

Use read-first/create/catch-`P2002`/read-collision. Compare every immutable scalar and canonicalized JSON. Throw `EXPERIMENT_IDENTITY_COLLISION` or `EXPERIMENT_OBSERVATION_IDENTITY_COLLISION`; never use an upsert update branch.

- [ ] **Step 6: Add identity/persistence integration coverage**

`tests/unit/experiment.identity.test.ts` proves object-key ordering and source-ref ordering cannot change a hash, while changing execution/verification/window/source identity changes it.

`tests/integration/experiment.persistence.test.ts` uses the existing transaction rollback-sentinel pattern and proves:

```ts
expect(tableNames).toEqual(expect.arrayContaining([
  'OptimizationExperiment',
  'OptimizationExperimentObservation'
]));
expect(triggerNames).toEqual(expect.arrayContaining([
  'OptimizationExperiment_immutable',
  'OptimizationExperimentObservation_immutable'
]));
```

It also proves identical create-or-get reuse and collision rejection for both records.

- [ ] **Step 7: Run Task 19 GREEN**

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

- [ ] **Step 8: Commit Task 19**

```bash
git add prisma/models prisma/migrations/20260824140000_add_p9d_experiment_engine \
  src/auth/feature-flags.ts src/modules/optimization-experiments \
  tests/unit/experiment.feature-gate.test.ts tests/unit/experiment.identity.test.ts \
  tests/unit/experiment.schedule.test.ts tests/integration/experiment.persistence.test.ts
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
- Consumes Task 19 types/repository plus exact P8/P9 facts, `SearchFactRepository.listCompletedFacts()`, and P6 Growth evidence pointing to `VisibilityMetricRow`.
- Produces `VerifiedExperimentStartContext`, `ExperimentStartResult`, `resolveExperimentMeasurementScope()`, `resolveSearchWindowComparison()`, `resolveVisibilityWindowComparison()`, and `OptimizationExperimentService.startFromVerifiedExecution()`.

- [ ] **Step 1: Define exact start-context and result contracts before writing service logic**

Add to `experiment.repository.ts`:

```ts
export type VerifiedExperimentStartContext = {
  project: { id: string; planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' };
  optimizationPlan: {
    id: string;
    projectId: string;
    recommendedActionType: RecommendedActionType;
    sourceFactReferences: Prisma.JsonValue;
    candidate: {
      id: string;
      projectId: string;
      growthSnapshotId: string;
      marketScopeMode: string;
      marketCode: MarketCode | null;
      locale: string | null;
      normalizedQuery: string;
      canonicalPage: string | null;
      sourceProvenance: Prisma.JsonValue;
    };
  };
  proposal: {
    id: string;
    projectId: string;
    sourceType: PublicationProposalSourceType;
    sourceReferenceId: string | null;
  };
  publicationPlan: {
    id: string;
    projectId: string;
    targetPublicUrl: string;
  };
  execution: {
    id: string;
    projectId: string;
    status: PublicationExecutionStatus;
  };
  verification: {
    id: string;
    projectId: string;
    status: PublicationVerificationStatus;
    observedUrl: string;
    observedAt: Date;
  };
};

export type ExperimentStartReasonCode =
  | 'EXPERIMENT_FEATURE_NOT_AVAILABLE'
  | 'EXPERIMENT_EXECUTION_NOT_VERIFIED'
  | 'EXPERIMENT_VERIFICATION_NOT_VERIFIED'
  | 'EXPERIMENT_P9_SOURCE_MISMATCH'
  | 'EXPERIMENT_VERIFICATION_URL_MISMATCH'
  | 'EXPERIMENT_INTERVENTION_NOT_SUPPORTED'
  | 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED';

export type ExperimentStartResult =
  | { kind: 'STARTED'; experiment: OptimizationExperiment }
  | { kind: 'EXISTING'; experiment: OptimizationExperiment }
  | { kind: 'DEFERRED'; reasonCode: ExperimentStartReasonCode };
```

Repository signature:

```ts
loadVerifiedStartContext(input: {
  projectId: string;
  publicationExecutionId: string;
}): Promise<VerifiedExperimentStartContext | null>;
```

- [ ] **Step 2: Write the RED start-authority matrix**

In `tests/integration/experiment.start-authority.test.ts` create exact fixtures and assert:

```text
Advanced valid P9/VERIFIED binding => STARTED
Enterprise valid binding => STARTED
Standard => EXPERIMENT_FEATURE_NOT_AVAILABLE
execution PR_CREATED/DEPLOYED/VERIFYING => EXPERIMENT_EXECUTION_NOT_VERIFIED
verification FAILED/UNKNOWN/missing observedAt => EXPERIMENT_VERIFICATION_NOT_VERIFIED
proposal source type/reference mismatch => EXPERIMENT_P9_SOURCE_MISMATCH
observed URL mismatch => EXPERIMENT_VERIFICATION_URL_MISMATCH
TECHNICAL_SEO_REMEDIATION / CANNIBALIZATION_REMEDIATION => EXPERIMENT_INTERVENTION_NOT_SUPPORTED
cross-project binding => no experiment
```

Take before/after snapshots of the plan/candidate/execution/verification and assert unchanged.

- [ ] **Step 3: Implement exact P8/P9 authority loading and URL binding**

Select the execution by exact `id + projectId`; bind through `PublicationPlan → PublicationProposal → OptimizationPlan → OptimizationCandidate`. Select VERIFIED verification rows with non-null `observedAt`/`observedUrl`, ordered `observedAt ASC, createdAt ASC, id ASC`.

In `experiment.scope.ts`:

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

Normalized verification URL must equal normalized publication target URL.

- [ ] **Step 4: Resolve search measurement scope only from immutable configured-market Growth provenance**

For `SERP_SNIPPET_OPTIMIZATION`, `ON_PAGE_OPTIMIZATION`, `CONTENT_REFRESH` require:

```text
candidate.marketScopeMode = CONFIGURED_MARKET
marketCode + locale non-null
normalizedQuery non-empty
canonicalPage normalized URL == verified target URL
sourceProvenance.version = GROWTH_SEARCH_PROVENANCE_V1
sourceProvenance.mode = CONFIGURED_MARKET
scoringLane.provider = GOOGLE_SEARCH_CONSOLE
exactly one scoringLane.marketProjections entry matching marketCode + locale
matching propertyRef non-empty
```

Return `SearchExperimentMeasurementScope` with `aggregationScope:'QUERY_PAGE'`.

For `CONTENT_CREATION`, require the same provider/market/query/property identity but return `aggregationScope:'QUERY'` and `canonicalPage:null`. Legacy/unconfigured/ambiguous provenance defers with `EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED`.

- [ ] **Step 5: Resolve visibility scope from the exact P6 evidence row**

For `GEO_CITABILITY_IMPROVEMENT`, require Growth evidence:

```text
snapshotId = candidate.growthSnapshotId
sourceModule = P6_VISIBILITY
sourceType = VISIBILITY_METRIC_ROW
ruleKey = P6_CITATION_RATE
```

For `AI_VISIBILITY_IMPROVEMENT`, use `P6_MENTION_RATE` unless immutable source/evidence explicitly targets citation.

Resolve `GrowthOpportunityEvidence.sourceId` to the exact `VisibilityMetricRow` and parent completed snapshot, and require:

```text
row.projectId == projectId
snapshot.projectId == projectId
snapshot.status == COMPLETED
sourceFactVersion == `${snapshot.formulaVersion}:${snapshot.id}`
row.dimensionType == OVERALL
row.actorType == OWNED_ROLLUP
```

Freeze metric/subject/scope/formula/extractor/dimension/actor identity in `VisibilityExperimentMeasurementScope`.

- [ ] **Step 6: Implement exact Search Facts window resolver**

Export:

```ts
export async function resolveSearchWindowComparison(input: {
  scope: SearchExperimentMeasurementScope;
  verifiedAnchorAt: Date;
  windowType: ExperimentWindowType;
  windowDays: number;
  source: Pick<SearchFactRepository, 'listCompletedFacts'>;
}): Promise<ExperimentWindowResolution>;
```

UTC date windows:

```text
baseline = anchor calendar day - N through anchor day - 1
observed = anchor calendar day through anchor day + N - 1
```

Rules:

- exact provider/market/locale/property/query filtering;
- query-page scope also filters canonical page;
- query scope aggregates all exact-query rows only from `COMPLETE` snapshots;
- query-page may use `TOP_ROWS_ONLY` only when the exact target fact exists for every required date in both windows;
- `PROVIDER_UNSPECIFIED`/`UNKNOWN` completeness is insufficient;
- missing date/fact is not zero;
- duplicate logical facts choose greatest `sourceCutoffAt`, tie-break lexicographically smallest `snapshotId`, never by metric value.

Aggregation:

```text
CLICKS = sum
IMPRESSIONS = sum
CTR = total clicks / total impressions
GOOGLE_SEARCH_CONSOLE_POSITION = impression-weighted mean
BING_AVG_CLICK_POSITION = click-weighted mean
BING_AVG_IMPRESSION_POSITION = impression-weighted mean
```

Required unknown/missing metric or weight marks that comparison insufficient.

- [ ] **Step 7: Implement exact Visibility Metrics resolver**

Export:

```ts
export async function resolveVisibilityWindowComparison(input: {
  projectId: string;
  scope: VisibilityExperimentMeasurementScope;
  verifiedAnchorAt: Date;
  dueAt: Date;
  windowType: ExperimentWindowType;
  source: VisibilityExperimentSourcePort;
}): Promise<ExperimentWindowResolution>;
```

`VisibilityExperimentSourcePort` is defined in the same file:

```ts
export interface VisibilityExperimentSourcePort {
  listCompatibleSnapshots(input: {
    projectId: string;
    scope: VisibilityExperimentMeasurementScope;
  }): Promise<readonly VisibilityExperimentSnapshotView[]>;
}
```

`VisibilityExperimentSnapshotView` includes snapshot id/window/inputCutoff/formula/extractor/subject/scope plus the exact metric row status/numerator/denominator/eligible counts/dimension/actor fields.

Select baseline = latest compatible completed snapshot ending `<= verifiedAnchorAt`; observation = earliest compatible completed snapshot ending `>= dueAt`; durations must match. Require exact frozen identities, denominator > 0, eligible count >=10 on both sides, and reject `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE` for a conclusive comparison.

- [ ] **Step 8: Implement start service with no upstream mutation**

Export:

```ts
export class OptimizationExperimentService {
  async startFromVerifiedExecution(input: {
    projectId: string;
    publicationExecutionId: string;
  }): Promise<ExperimentStartResult>;
}
```

Order: load context → feature gate → exact P8/P9 binding → URL match → supported intervention → resolve measurement scope → schedule/expected directions → build key → `createOrGetExperiment()`.

Primary direction map:

```text
SERP_SNIPPET_OPTIMIZATION: CTR HIGHER
ON_PAGE_OPTIMIZATION: CLICKS HIGHER
CONTENT_REFRESH: CLICKS HIGHER
CONTENT_CREATION: IMPRESSIONS HIGHER
GEO_CITABILITY_IMPROVEMENT: CITATION_RATE HIGHER
AI_VISIBILITY_IMPROVEMENT: frozen primary metric HIGHER
```

- [ ] **Step 9: Run Task 20 GREEN and commit**

```bash
npx vitest run \
  tests/unit/experiment.scope.test.ts \
  tests/unit/experiment.search-source.test.ts \
  tests/unit/experiment.visibility-source.test.ts \
  tests/integration/experiment.start-authority.test.ts
npm run typecheck
git add src/modules/optimization-experiments tests/unit/experiment.* tests/integration/experiment.start-authority.test.ts
git commit -m "feat: resolve verified P9-D experiment facts"
```

---

### Task 21: Evaluator, contamination, queue, reconciliation, and P8 VERIFIED handoff

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
- Consumes Task 20 `ExperimentWindowResolution` and `OptimizationExperimentService.startFromVerifiedExecution()`.
- Produces `detectExperimentContamination()`, `evaluateExperimentEffect()`, `OptimizationExperimentService.evaluateWindow()`, `OptimizationExperimentQueue`, and `processOptimizationExperimentJob()`.
- P8 worker accepts only an injected callback; it does not import P9-D.

- [ ] **Step 1: Define evaluator result and write RED classification tests**

In `experiment.evaluator.ts`:

```ts
export type ExperimentEvaluationResult = {
  effectState: ExperimentEffectState;
  coverageState: ExperimentCoverageState;
  contaminationState: ExperimentContaminationState;
  reasonCodes: readonly string[];
  deltaMetrics: readonly {
    metricKey: string;
    absoluteDelta: number | null;
    relativeDelta: number | null;
  }[];
};

export function evaluateExperimentEffect(input: {
  resolution: ExperimentWindowResolution;
  contaminationState: ExperimentContaminationState;
  contaminationReasonCodes: readonly string[];
}): ExperimentEvaluationResult;
```

RED tests lock:

```text
coverage/source blocker => INCONCLUSIVE
contamination != CLEAR => INCONCLUSIVE
click/impression baseline>0 and |relative delta|<0.02 => NEUTRAL
explicit known baseline=0, observed=0 => NEUTRAL
explicit known baseline=0, observed>0 => POSITIVE
inferred/missing zero never reaches that branch
CTR |absolute delta|<0.02 => NEUTRAL
position |absolute delta|<1.0 => NEUTRAL; lower is favorable
visibility rate |absolute delta|<0.05 => NEUTRAL
primary favorable with no significant adverse secondary => POSITIVE
primary adverse with no significant favorable secondary => NEGATIVE
significant direction conflict => INCONCLUSIVE
```

- [ ] **Step 2: Implement conservative contamination detection**

Export:

```ts
export async function detectExperimentContamination(input: {
  experimentId: string;
  projectId: string;
  publicationExecutionId: string;
  targetUrl: string;
  verifiedAnchorAt: Date;
  observedWindowEnd: Date;
  repository: ExperimentContaminationReadPort;
}): Promise<{
  state: ExperimentContaminationState;
  reasonCodes: readonly string[];
}>;
```

Priority:

```text
original rollback completed => VERIFICATION_INVALIDATED
other same-target DEPLOYED/VERIFIED/ROLLED_BACK event in interval => CONFLICTING_MUTATION
other same-target TARGET_REVISION_CHANGED event in interval => TARGET_REVISION_CHANGED
source resolver incompatibility => SOURCE_IDENTITY_CHANGED (applied by service)
required authority unreadable => UNKNOWN
otherwise CLEAR
```

No Git read or semantic subtraction.

- [ ] **Step 3: Implement stable input-cutoff and `evaluateWindow()`**

Extend service:

```ts
async evaluateWindow(input: {
  projectId: string;
  experimentId: string;
  windowType: ExperimentWindowType;
}): Promise<OptimizationExperimentObservation | null>;
```

Flow: load experiment/project → confirm requested frozen schedule → return null before `dueAt` → resolve source window → contamination → evaluator → stable source cutoff → observation key → immutable create-or-get → bounded emit.

Stable `inputCutoffAt`:

```text
selected sources exist => max SearchFact.sourceCutoffAt / VisibilityMetricSnapshot.inputCutoffAt
no comparable source yet => dueAt
```

This prevents daily reconciliation from creating duplicate no-data rows when source facts did not change.

- [ ] **Step 4: Write RED queue/registry/bootstrap tests**

`experiment.queue.ts` must expose:

```ts
export const OPTIMIZATION_EXPERIMENT_QUEUE_NAME = 'optimization-experiment-evaluation' as const;
export const OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS = 2;

export type OptimizationExperimentJobData =
  | { kind: 'START_EXPERIMENT'; publicationExecutionId: string; projectId: string }
  | { kind: 'EVALUATE_WINDOW'; experimentId: string; projectId: string; windowType: ExperimentWindowType }
  | { kind: 'RECONCILE_DAILY' };
```

Queue methods:

```ts
enqueueStart(publicationExecutionId: string, projectId: string): Promise<unknown>;
enqueueWindow(experimentId: string, projectId: string, windowType: ExperimentWindowType): Promise<unknown>;
```

Use attempts=2, exponential 5s, `removeOnComplete:true`, `removeOnFail:200`. Update `QUEUE_NAMES` to insert the new queue after `optimization-autopilot`. Worker concurrency=2. Add one 24h date-free scheduler:

```ts
export const OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-experiment-daily-reconcile',
  repeat: { every: 24 * 60 * 60 * 1000 },
  job: { name: 'reconcile-daily', data: { kind: 'RECONCILE_DAILY' as const } }
};
```

- [ ] **Step 5: Implement worker + bounded reconciliation**

`processOptimizationExperimentJob()` handles:

```text
start-experiment: start service; if experiment exists, enqueue its frozen windows
evaluate-window: evaluateWindow only; never enqueue provider sampling
reconcile-daily: enqueue VERIFIED P9 executions without an experiment, then every due experiment/window
```

Repository limits/order:

```text
verified starts: 100, createdAt ASC/id ASC
due experiments: 200, createdAt ASC/id ASC
```

A daily due-window retry is safe because source identity + stable cutoff controls observation reuse.

- [ ] **Step 6: Add post-commit P8 VERIFIED handoff without P8→P9 import**

Extend `PublicationVerificationWorkerDeps`:

```ts
onVerified?: (input: { executionId: string; projectId: string }) => Promise<void>;
```

After successful existing `persistFinal(... VERIFIED ...)`:

```ts
const persisted = await persistFinal(/* existing args */);
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

`worker-bootstrap.ts` injects only:

```ts
onVerified: ({ executionId, projectId }) =>
  optimizationExperimentQueue.enqueueStart(executionId, projectId)
```

A handoff error is swallowed after bounded logging; P8 stays VERIFIED.

- [ ] **Step 7: Prove P8 isolation and contamination behavior**

`tests/unit/publication-verification-experiment-handoff.test.ts`: injected final persistence returns true; injected handoff throws `redis down`; processor resolves and emits failure event.

`tests/integration/experiment.contamination.test.ts`: a second same-target P8 deployment inside the observation interval forces stored `INCONCLUSIVE / CONFLICTING_MUTATION`, while both P8 executions remain unchanged.

- [ ] **Step 8: Run Task 21 GREEN and commit**

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
git add src/modules/optimization-experiments src/modules/publication/publication-verification.worker.ts \
  src/queue/queues.ts src/queue/worker-bootstrap.ts tests/unit tests/integration/experiment.contamination.test.ts
git commit -m "feat: evaluate P9-D experiment windows"
```

---

### Task 22: Read-only REST API and 优化实验 UI

**Files:**
- Create: `src/modules/optimization-experiments/experiment.routes.ts`
- Create: `src/modules/optimization-experiments/experiment.web.repository.ts`
- Create: `src/modules/optimization-experiments/experiment.web.routes.ts`
- Create: `src/views/optimization-experiments/index.ejs`
- Create: `src/views/optimization-experiments/show.ejs`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Test: `tests/integration/experiment.routes.test.ts`
- Test: `tests/e2e/optimization-experiments.spec.ts`

**Interfaces:**
- REST: `GET /api/v1/projects/:projectId/optimization/experiments` and `GET /api/v1/projects/:projectId/optimization/experiments/:experimentId`.
- Web: `GET /projects/:id/optimization/experiments` and detail route with `/:experimentId`.
- No POST/PUT/PATCH/DELETE experiment route exists in P9-D V1.

- [ ] **Step 1: Define the exact injectable API port and write RED route tests**

`experiment.routes.ts`:

```ts
export interface OptimizationExperimentApiPort {
  listExperiments(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getExperiment(projectId: string, experimentId: string): Promise<unknown | null>;
}
```

`tests/integration/experiment.routes.test.ts` uses `createApp({ optimizationExperimentApi: fakePort })` and proves Advanced/Enterprise 200, Standard 403 `FEATURE_NOT_AVAILABLE`, invalid UUID/pagination 400, missing/cross-project detail 404 `EXPERIMENT_NOT_FOUND`, and only list/get port methods are called.

- [ ] **Step 2: Implement strict persisted-read REST routes**

Use `requireFeature('OPTIMIZATION_EXPERIMENTS')`, UUID Zod params, and strict pagination (`limit 1..100`, `offset 0..100000`). Default reads select P9-D records only plus bounded immutable plan identity. Do not invoke start/evaluate service methods.

- [ ] **Step 3: Implement derived read model without writes**

`experiment.web.repository.ts` selects project/experiments/observations and derives current state:

```text
CONTAMINATED: latest applicable due observation contamination != CLEAR
EVALUATED: all due/final scheduled windows have conclusive POSITIVE/NEUTRAL/NEGATIVE
INCONCLUSIVE: latest applicable due/final observation is INCONCLUSIVE and no newer source-cutoff observation replaces it
OBSERVING: future windows remain or a due window has no observation
```

For one window, current display chooses `inputCutoffAt DESC, createdAt DESC, id ASC`; history remains visible on detail.

- [ ] **Step 4: Implement EJS pages and sidebar**

Render with `activeNav:'optimization-experiments'`, title `优化实验`, project-scoped breadcrumbs, and no mutation form/button.

Add to 增长 after New Content:

```ejs
<a class="<%= activeNav === 'optimization-experiments' ? 'active' : '' %>"
   href="<%= currentProjectId ? `/projects/${currentProjectId}/optimization/experiments` : '/projects' %>">
  优化实验 <span class="badge premium">高级版</span>
</a>
```

Detail must show frozen scope, window, baseline/observed bounded metrics, coverage, contamination, effect, reasons, evaluator version, plus `观察关联，不代表因果关系`. Never render auto-start/evaluate/publish/merge/deploy/rollback controls.

- [ ] **Step 5: Mount routes in `src/app.ts`**

Add:

```ts
optimizationExperimentApi?: OptimizationExperimentApiPort;
```

Mount REST at `/api/v1` and web at `/`. Web route construction must not instantiate Redis queues.

- [ ] **Step 6: Add browser coverage**

Seed immutable rows directly. Assert sidebar/list/detail, 14D/28D/56D outcome rendering, association disclaimer, absence of mutation controls, and Standard denial.

- [ ] **Step 7: Run Task 22 GREEN and commit**

```bash
npx vitest run tests/integration/experiment.routes.test.ts
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/optimization-experiments.spec.ts
git add src/modules/optimization-experiments src/views/optimization-experiments \
  src/views/partials/sidebar.ejs src/app.ts tests/integration/experiment.routes.test.ts \
  tests/e2e/optimization-experiments.spec.ts
git commit -m "feat: expose P9-D experiment results"
```

---

### Task 23: Authority audit, E2E hardening, docs, and exact-head release gate

**Files:**
- Create: `tests/integration/experiment.authority.test.ts`
- Extend: `tests/e2e/optimization-experiments.spec.ts`
- Create: `docs/development/p9-d-experiment-engine.md`
- Review only: `.github/workflows/ci.yml`

**Interfaces:**
- Produces release evidence only; no new runtime authority.
- Completion requires exact-head `verify`, `production-audit`, `e2e`, manual authority review, and zero unresolved review threads.

- [ ] **Step 1: Add the authority-write integration test**

Snapshot before/after start + evaluation for:

```text
GrowthOpportunityIdentity/Snapshot/Lifecycle
OptimizationCandidate/Plan/Run/RunItem/AutopilotDecision
PublicationProposal/Plan/Approval/AutomationAuthorization/Execution/Verification
SearchFactSnapshot/Fact/Metric
VisibilityMetricSnapshot/Row
```

Only `OptimizationExperiment` and `OptimizationExperimentObservation` counts may increase. Assert `OptimizationPlan.historicalRankAdjustment` unchanged.

Also prove `CONTENT_CREATION` without comparable query baseline stores `INCONCLUSIVE` + `NO_COMPARABLE_BASELINE` and no fabricated numeric zero baseline.

- [ ] **Step 2: Add static forbidden-authority scans**

Scan `src/modules/optimization-experiments/**/*.ts` and fail on imports/calls containing:

```text
deepseek.provider
github-mutation.adapter
mergePullRequest
PublicationExecutionService.createHumanApprovedExecution
PublicationExecutionService.createAutomationAuthorizedExecution
authorizePublicationAutomation
publicationAutomationPreparation
```

Fail on Prisma mutations against authoritative delegates such as:

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

P9-D repository writes are limited to experiment/observation creation.

- [ ] **Step 3: Harden E2E for conservative semantics and GET side effects**

Assert:

```text
GET list/detail does not change experiment/observation/P8 row counts
missing-baseline result is INCONCLUSIVE, never displayed as artificial lift
CONFLICTING_MUTATION renders INCONCLUSIVE
position metrics visibly use lower-is-better direction
visibility shows numerator/denominator coverage rather than fabricated rank
Standard denied
cross-project experiment id hidden
```

No E2E path may call an external provider or real GitHub write.

- [ ] **Step 4: Write `docs/development/p9-d-experiment-engine.md`**

Document authority ownership, feature matrix, exact P8 prerequisite, intervention schedules/support, Search Facts aggregation, Visibility snapshot pairing, UNKNOWN/TOP_ROWS_ONLY rules, no-zero new-content rule, neutral bands, coverage thresholds, contamination, derived UI state, queue/reconciliation, P8 handoff isolation, observability allowlist, immutable migration, rollback posture, observational-not-causal limitation, and P9-E ownership of historical weighting.

- [ ] **Step 5: Run the full release-equivalent verification**

Development tree:

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

Separate clean runtime-only tree/environment:

```bash
npm install --omit=dev --legacy-peer-deps
if [ -d node_modules/prisma ]; then
  echo "Prisma CLI must not be present in the runtime dependency tree"
  exit 1
fi
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Do not replace the development dependency tree with the runtime-only tree before Vitest/Playwright.

- [ ] **Step 6: Perform the manual authority review**

Record evidence that:

```text
P9-D writes only its two immutable tables
P8 VERIFIED remains authoritative
P8 verification survives experiment queue failure
no provider/AI/Git/deploy/rollback path exists in P9-D
no P7/P9-A/P9-B/P9-C authority mutation
historicalRankAdjustment untouched
new-content page absence never becomes zero
UNKNOWN/NOT_SUPPORTED never become zero
GET routes side-effect free
unsupported interventions receive no proxy conclusion
contamination forces INCONCLUSIVE
observability excludes content/prompts/credentials/raw provider payloads
```

- [ ] **Step 7: Commit Task 23**

```bash
git add tests/integration/experiment.authority.test.ts tests/e2e/optimization-experiments.spec.ts \
  docs/development/p9-d-experiment-engine.md
git commit -m "test: gate P9-D experiment authority"
```

- [ ] **Step 8: Open/update the P9-D PR as Draft and require exact-head CI**

PR body includes exact head SHA, no-causality/no-feedback/no-Git/no-merge/no-deploy/no-zero-baseline boundaries. Required GitHub Actions on that exact SHA:

```text
verify = success
production-audit = success
e2e = success
```

Any later code/doc commit invalidates the prior exact-head evidence and requires a fresh three-job run.

- [ ] **Step 9: Final review gate**

Before Ready for review:

```text
PR head == exact SHA verified by all three jobs
manual authority review complete
unresolved review threads = 0
PR not merged
deployment not triggered
```

Only then mark Ready for review and stop. Merge requires a separate explicit human `合并`; deployment requires a separate explicit authorization.
