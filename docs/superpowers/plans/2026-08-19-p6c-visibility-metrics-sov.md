# P6-C Visibility Metrics & Competitor Share of Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic, immutable Mention Rate, Citation Rate, and presence-based Mention Share of Voice snapshots over persisted P6-B facts, with explicit evidence coverage, version isolation, Advanced/Enterprise API/UI access, and zero provider/network calculation.

**Architecture:** P6-C adds a pure metric calculator, immutable metric snapshot/row persistence, a database-only materialization service and `visibility-metrics` queue, then project-scoped REST and EJS surfaces. Every snapshot is frozen by `formulaVersion + extractorVersion + subjectSetHash + window + inputCutoffAt + scopeHash`; missing/unknown P6-B evidence is never coerced to zero. P6-D trends, alerts, history dashboarding, and report integration remain out of scope.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma 6, Redis/BullMQ, Zod, Vitest/Supertest/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-p6c-visibility-metrics-sov-design.md`

## Global Constraints

- Authoritative P6-C inputs come only from persisted P6-A `PlatformObservation` and P6-B extraction/fact rows.
- No DeepSeek, LLM, embedding, fuzzy matching, live provider call, external URL fetch, search engine, or consumer-product UI automation may participate in authoritative metric calculation.
- `UNKNOWN` and missing/failed requested extraction input are not zero and do not enter a denominator; in P6-C V1 they make the affected metric/dimension `UNKNOWN`.
- `KNOWN_EMPTY` is eligible evidence and must enter the correct denominator.
- Explicit `NOT_ELIGIBLE` never enters a denominator; mixed eligible + explicit NOT_ELIGIBLE may still be `CALCULATED` when no unknown/missing input exists.
- A legitimate zero has `metricStatus=CALCULATED`, `numerator=0`, `denominator>0`.
- Mention SOV uses observation-level actor presence, not occurrence count. Owned subjects roll up to one `OWNED_ROLLUP`; each competitor subject is one actor.
- One snapshot never mixes `subjectSetHash` or `extractorVersion` values.
- Candidate observations are selected from P6-A independently of extraction availability; missing extraction must remain visible as unknown coverage.
- A completed metric snapshot is immutable. Later P6-B backfill creates no mutation of old P6-C rows.
- All P6-C generation/read surfaces use existing feature code `COMPETITOR_SOV`; Standard is rejected before writes or enqueue side effects.
- Hard bounds: maximum window 31 days, maximum Prompt Set filters 20, maximum candidates 20,000, DB batch size 500, list default 25/max 100.
- P6-C V1 dimensions are only `OVERALL`, `PROVIDER`, and `PROMPT_SET`; no Provider × Prompt Set cube.
- P6-D trend lines, deltas, alerts, scheduled notifications, history dashboard widgets, report integration, and AI narrative trend explanation are forbidden in this phase.
- Every implementation task starts from the latest merged `main` after the previous task; do not keep stale stacked histories.
- Do not merge while required CI is pending/failing. Use exact expected head SHA for every merge.

## Delivery / Branch Discipline

Use six sequential task branches/PRs:

1. `feat/p6c-task-01-metric-calculator`
2. `feat/p6c-task-02-metric-persistence`
3. `feat/p6c-task-03-metric-materialization`
4. `feat/p6c-task-04-metrics-api`
5. `feat/p6c-task-05-metrics-ui`
6. `feat/p6c-task-06-release-gate`

After each task is merged, create the next branch from fresh `main`. If a PR becomes historically polluted, rebuild it from current `main` and transplant only that task's files rather than force-merging stale history.

---

## File Structure

### Pure metric domain
- `src/modules/visibility/visibility-metrics.types.ts` — formula/version, pure input/actor/row contracts.
- `src/modules/visibility/visibility-metrics.calculator.ts` — deterministic Mention Rate, Citation Rate, Mention SOV and status logic.

### Persistence
- `prisma/models/visibility-metrics.prisma` — snapshot/row enums and models.
- `prisma/migrations/20260819215800_add_visibility_metrics/migration.sql` — exact P6-C DDL.

### Materialization / queue
- `src/modules/visibility/visibility-metrics.repository.ts`
- `src/modules/visibility/visibility-metrics.service.ts`
- `src/modules/visibility/visibility-metrics.queue.ts`
- `src/modules/visibility/visibility-metrics.worker.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`

### API / web
- `src/modules/visibility/visibility-metrics.routes.ts`
- `src/modules/visibility/visibility-metrics.web.repository.ts`
- `src/modules/visibility/visibility-metrics.web.routes.ts`
- `src/views/visibility/metrics.ejs`
- `src/views/partials/sidebar.ejs`
- `src/public/css/app.css` only for P6-C status presentation if existing classes are insufficient.
- `src/app.ts`

### Observability / operations
- `src/modules/visibility/visibility-metrics.observability.ts`
- `docs/development/p6c-visibility-metrics-sov.md`
- `README.md` only after the pre-README release gate is green.

---

## Task 1: Metric Contracts + Pure Deterministic Calculator

**Branch:** `feat/p6c-task-01-metric-calculator`

**Files:**
- Create: `src/modules/visibility/visibility-metrics.types.ts`
- Create: `src/modules/visibility/visibility-metrics.calculator.ts`
- Create: `tests/unit/visibility-metrics.calculator.test.ts`

**Interfaces:**

```ts
export const P6C_FORMULA_VERSION = 'VISIBILITY_METRICS_V1' as const;

export type VisibilityMetricProvider =
  | 'OPENAI' | 'GEMINI' | 'PERPLEXITY' | 'ANTHROPIC' | 'DEEPSEEK';

export type VisibilityMetricEvidenceStatus =
  | 'EXTRACTED' | 'KNOWN_EMPTY' | 'UNKNOWN' | 'NOT_ELIGIBLE';

export type VisibilityMetricType =
  | 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE';

export type VisibilityMetricStatus =
  | 'CALCULATED' | 'NO_SIGNAL' | 'UNKNOWN' | 'NOT_ELIGIBLE' | 'NO_DATA';

export type VisibilityMetricDimensionType = 'OVERALL' | 'PROVIDER' | 'PROMPT_SET';

export interface VisibilityMetricActor {
  actorType: 'OWNED_ROLLUP' | 'COMPETITOR';
  actorKey: string;
  actorSubjectId: string | null;
}

export interface VisibilityMetricInputRecord {
  observationId: string;
  provider: VisibilityMetricProvider;
  promptSetId: string;
  promptSetName: string;
  mentionStatus: VisibilityMetricEvidenceStatus;
  citationStatus: VisibilityMetricEvidenceStatus;
  ownedMentioned: boolean;
  competitorMentionedSubjectIds: string[];
  ownedCited: boolean;
  competitorCitedSubjectIds: string[];
}

export interface CalculatedVisibilityMetricRow {
  metricType: VisibilityMetricType;
  metricStatus: VisibilityMetricStatus;
  dimensionType: VisibilityMetricDimensionType;
  dimensionKey: string;
  dimensionLabelSnapshot: string | null;
  actorType: 'OWNED_ROLLUP' | 'COMPETITOR';
  actorSubjectId: string | null;
  actorKey: string;
  numerator: number;
  denominator: number;
  candidateObservationCount: number;
  eligibleObservationCount: number;
  notEligibleObservationCount: number;
  unknownObservationCount: number;
}

export function calculateVisibilityMetrics(input: {
  records: VisibilityMetricInputRecord[];
  actors: VisibilityMetricActor[];
}): CalculatedVisibilityMetricRow[];
```

- [ ] **Step 1: Write RED tests for evidence-state semantics**

Create fixtures proving:

```ts
const rows = calculateVisibilityMetrics({ records, actors });
const ownedMention = rows.find((row) =>
  row.metricType === 'MENTION_RATE' &&
  row.dimensionType === 'OVERALL' &&
  row.actorKey === 'OWNED_ROLLUP'
)!;
```

Lock these facts:
- `KNOWN_EMPTY` enters Mention/Citation denominators.
- `UNKNOWN` never enters a denominator and makes that metric/dimension `UNKNOWN`.
- missing extraction will later be normalized by Task 3 to `UNKNOWN`; calculator behavior for the normalized record is identical.
- mixed eligible + `NOT_ELIGIBLE` remains `CALCULATED` if no unknown exists.
- all explicit `NOT_ELIGIBLE` returns `NOT_ELIGIBLE`.
- zero candidates returns `NO_DATA` rows for all supplied actors/metric types.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts
```

Expected: missing module/contracts.

- [ ] **Step 3: Implement dimension grouping and coverage classification**

Generate groups for:

```ts
{ type: 'OVERALL', key: 'OVERALL', label: null }
{ type: 'PROVIDER', key: record.provider, label: record.provider }
{ type: 'PROMPT_SET', key: record.promptSetId, label: record.promptSetName }
```

Deduplicate source observations by `observationId` inside a group before counting.

- [ ] **Step 4: Implement Mention Rate and Citation Rate**

For rates:
- denominator = count of `EXTRACTED | KNOWN_EMPTY` records for the metric evidence channel;
- numerator = eligible observations where the actor is present;
- any `UNKNOWN` record => status `UNKNOWN`, no authoritative ratio;
- zero candidates => `NO_DATA`;
- candidates but all explicit `NOT_ELIGIBLE` => `NOT_ELIGIBLE`;
- denominator > 0 and no unknown => `CALCULATED`, including numerator 0.

Do not return floating-point percentage as authoritative storage; return integer numerator/denominator.

- [ ] **Step 5: Implement presence-based Mention SOV**

For each mention-eligible observation:
- add at most one `OWNED_ROLLUP` presence;
- deduplicate competitor subject IDs with `Set`;
- only actors supplied in `actors` are countable;
- denominator = sum of actor presence units across the dimension.

If mention evidence is complete and eligible observations exist but presence denominator is 0, all SOV rows are `NO_SIGNAL`.

- [ ] **Step 6: Add invariant tests**

Prove:
- rate numerator <= denominator;
- `CALCULATED` rate denominator > 0;
- SOV calculated numerators sum exactly to shared denominator;
- repeated competitor IDs in one record count once;
- owned/competitor actor not supplied in `actors` cannot appear in output;
- Provider and Prompt Set partitions calculate independently;
- no Prisma/BullMQ/provider/fetch import exists in calculator source.

- [ ] **Step 7: Verify GREEN**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit and open Task 1 PR**

```bash
git add src/modules/visibility/visibility-metrics.types.ts src/modules/visibility/visibility-metrics.calculator.ts tests/unit/visibility-metrics.calculator.test.ts
git commit -m "feat: add P6-C visibility metric calculator"
```

Required PR scope: only pure contracts/calculator/tests; no Prisma/API/UI.

---

## Task 2: Prisma Metric Snapshot Persistence

**Branch:** `feat/p6c-task-02-metric-persistence`

**Files:**
- Create: `prisma/models/visibility-metrics.prisma`
- Create: `prisma/migrations/20260819215800_add_visibility_metrics/migration.sql`
- Create: `tests/integration/visibility-metrics.persistence.test.ts`

**Enums:**

```prisma
enum VisibilityMetricSnapshotStatus { QUEUED RUNNING COMPLETED FAILED }
enum VisibilityMetricType { MENTION_RATE CITATION_RATE MENTION_SHARE_OF_VOICE }
enum VisibilityMetricStatus { CALCULATED NO_SIGNAL UNKNOWN NOT_ELIGIBLE NO_DATA }
enum VisibilityMetricDimensionType { OVERALL PROVIDER PROMPT_SET }
enum VisibilityMetricActorType { OWNED_ROLLUP COMPETITOR }
```

**Snapshot model contract:**

```prisma
model VisibilityMetricSnapshot {
  id                         String                         @id @default(uuid()) @db.Uuid
  projectId                  String                         @db.Uuid
  status                     VisibilityMetricSnapshotStatus @default(QUEUED)
  formulaVersion             String
  extractorVersion           String
  subjectSetHash             String
  subjectSnapshotJson        Json
  windowStart                DateTime
  windowEnd                  DateTime
  inputCutoffAt              DateTime
  scopeJson                  Json
  scopeHash                  String
  inputFingerprint           String?
  candidateObservationCount  Int                            @default(0)
  completedExtractionCount   Int                            @default(0)
  missingExtractionCount     Int                            @default(0)
  failedExtractionCount      Int                            @default(0)
  errorCode                  String?
  startedAt                  DateTime?
  completedAt                DateTime?
  createdAt                  DateTime                       @default(now())
  updatedAt                  DateTime                       @updatedAt

  rows VisibilityMetricRow[]

  @@unique([projectId, formulaVersion, extractorVersion, subjectSetHash, windowStart, windowEnd, inputCutoffAt, scopeHash])
  @@index([projectId, status, createdAt])
  @@index([projectId, windowStart, windowEnd])
}
```

**Row model contract:**

```prisma
model VisibilityMetricRow {
  id                          String                        @id @default(uuid()) @db.Uuid
  visibilityMetricSnapshotId  String                        @db.Uuid
  projectId                   String                        @db.Uuid
  metricType                  VisibilityMetricType
  metricStatus                VisibilityMetricStatus
  dimensionType               VisibilityMetricDimensionType
  dimensionKey                String
  dimensionLabelSnapshot      String?
  actorType                   VisibilityMetricActorType
  actorSubjectId              String?                       @db.Uuid
  actorKey                    String
  numerator                   Int
  denominator                 Int
  candidateObservationCount   Int
  eligibleObservationCount    Int
  notEligibleObservationCount Int
  unknownObservationCount     Int
  createdAt                   DateTime                      @default(now())

  snapshot VisibilityMetricSnapshot @relation(fields: [visibilityMetricSnapshotId], references: [id], onDelete: Cascade)

  @@unique([visibilityMetricSnapshotId, metricType, dimensionType, dimensionKey, actorKey])
  @@index([projectId, metricType])
  @@index([visibilityMetricSnapshotId, dimensionType, dimensionKey])
  @@index([actorSubjectId])
}
```

- [ ] **Step 1: Write RED persistence test**

Prove creation of a `QUEUED` snapshot and metric rows; assert storage Overall key is non-null `OVERALL`.

- [ ] **Step 2: Add uniqueness/immutability-shaped persistence contracts**

Assert duplicate exact snapshot identity is rejected/upsertable by the composite key and duplicate row identity is rejected. Assert cascade deleting the snapshot deletes only its metric rows.

- [ ] **Step 3: Run RED**

```bash
npm test -- tests/integration/visibility-metrics.persistence.test.ts
```

Expected: Prisma client has no P6-C models/enums.

- [ ] **Step 4: Implement Prisma model and exact migration**

Create `prisma/models/visibility-metrics.prisma` and `prisma/migrations/20260819215800_add_visibility_metrics/migration.sql`. Migration must include the five enums, two tables, FK from row to snapshot with cascade, uniqueness constraints and indexes above. Do not add P6-D trend/history tables.

- [ ] **Step 5: Verify schema/migration GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- tests/integration/visibility-metrics.persistence.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit and open Task 2 PR**

```bash
git add prisma/models/visibility-metrics.prisma prisma/migrations/20260819215800_add_visibility_metrics/migration.sql tests/integration/visibility-metrics.persistence.test.ts
git commit -m "feat: add P6-C metric snapshot persistence"
```

---

## Task 3: Immutable Materialization Service + Queue + Worker

**Branch:** `feat/p6c-task-03-metric-materialization`

**Files:**
- Create: `src/modules/visibility/visibility-metrics.repository.ts`
- Create: `src/modules/visibility/visibility-metrics.service.ts`
- Create: `src/modules/visibility/visibility-metrics.queue.ts`
- Create: `src/modules/visibility/visibility-metrics.worker.ts`
- Create: `tests/integration/visibility-metrics.materialization.test.ts`
- Create: `tests/unit/visibility-metrics.queue.test.ts`
- Modify: `tests/unit/worker-bootstrap.test.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`

**Service contracts:**

```ts
export interface VisibilityMetricScope {
  providers: VisibilityMetricProvider[];
  promptSetIds: string[];
}

export interface PrepareVisibilityMetricSnapshotInput {
  projectId: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  extractorVersion: string;
  subjectSetHash: string;
  scope: VisibilityMetricScope;
}

export class VisibilityMetricsService {
  prepareSnapshot(input: PrepareVisibilityMetricSnapshotInput): Promise<VisibilityMetricSnapshot>;
  materializeSnapshot(projectId: string, snapshotId: string): Promise<VisibilityMetricSnapshot>;
}
```

**Repository contracts:**

```ts
createOrGetShell(input): Promise<VisibilityMetricSnapshot>;
claim(snapshotId: string): Promise<boolean>; // only QUEUED|FAILED
getProjectSnapshot(projectId: string, snapshotId: string): Promise<VisibilityMetricSnapshot | null>;
completeAtomic(snapshotId: string, result): Promise<VisibilityMetricSnapshot>;
fail(snapshotId: string, errorCode: string): Promise<VisibilityMetricSnapshot>;
```

`completeAtomic` must reject mutation of an already `COMPLETED` snapshot. For a retried failed identity, delete any stale rows inside the completion transaction before creating the full final set; no partial rows survive failure.

- [ ] **Step 1: Write RED tests for request normalization and subject-contract resolution**

Lock:
- `windowStart < windowEnd`;
- `windowEnd <= inputCutoffAt` and cutoff cannot be in the future relative to the resolved service clock;
- maximum duration is 31 days;
- Prompt Set filter count <= 20 and every ID belongs to project;
- scope provider/prompt IDs are sorted/deduplicated before stable JSON/hash;
- subject contract resolves from same-project P6-B extraction matching `extractorVersion + subjectSetHash`;
- if no historical extraction exists, `VisibilitySubjectService.buildActiveSnapshot()` is allowed only if its hash exactly equals requested hash;
- otherwise throw `VISIBILITY_METRICS_CONTRACT_NOT_FOUND` before snapshot write.

Use an injectable clock in the service so boundary tests do not depend on wall-clock time.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility-metrics.materialization.test.ts
```

- [ ] **Step 3: Implement canonical scope and shell identity**

Use stable JSON + SHA-256. Initial formula is `P6C_FORMULA_VERSION`. Snapshot identity is exactly the Prisma composite key from Task 2.

- [ ] **Step 4: Implement candidate selection before extraction lookup**

Candidate query filters:

```ts
where: {
  projectId,
  observedAt: { gte: windowStart, lt: windowEnd },
  createdAt: { lte: inputCutoffAt },
  ...(providers.length ? { provider: { in: providers } } : {}),
  ...(promptSetIds.length ? { prompt: { promptSetId: { in: promptSetIds } } } : {})
}
```

Count first. If count > 20,000, fail with `VISIBILITY_METRICS_SCOPE_TOO_LARGE`. Fetch candidate IDs/metadata in deterministic batches of 500.

- [ ] **Step 5: Normalize P6-B input as-of cutoff**

For every candidate observation load only the requested P6-B contract:

```ts
extractorVersion === snapshot.extractorVersion
subjectSetHash === snapshot.subjectSetHash
```

A matching extraction is usable only when `status=COMPLETED` and `completedAt <= inputCutoffAt`.

Normalize:
- usable completed extraction => its persisted mention/citation evidence states;
- explicit usable evidence `NOT_ELIGIBLE` remains NOT_ELIGIBLE;
- missing extraction, RUNNING/FAILED/QUEUED, or completion after cutoff => metric input `UNKNOWN` and appropriate snapshot coverage counter;
- subject snapshot mismatch for same hash => fail closed with `VISIBILITY_METRICS_SUBJECT_SNAPSHOT_MISMATCH`.

- [ ] **Step 6: Build actor-presence input without reading private content**

Load P6-B facts by extraction IDs only:
- Mention rows: `subjectId`, `subjectType`;
- Citation rows: `ownedSubjectId`, `competitorSubjectId`;
- Prompt Set name for dimension label;
- never load prompt text, answer text, citation URL/body, provider reasoning or secrets.

Build booleans/sets for the pure calculator. Actors come only from the exact snapshotted subjects: one `OWNED_ROLLUP` plus one actor per `COMPETITOR` subject.

- [ ] **Step 7: Build non-sensitive input fingerprint**

Hash canonically sorted records containing observation ID, provider, Prompt Set ID, matching extraction ID or explicit missing marker, mention/citation evidence states, and extraction completion timestamp/identity. Do not hash prompt/answer/alias/provider body content.

- [ ] **Step 8: Implement atomic completion and replay tests**

Prove:
- exact repeated request returns same completed snapshot;
- late P6-B backfill does not mutate old snapshot/rows;
- later `inputCutoffAt` yields a new identity;
- subjectSetHash versions never mix;
- extractorVersion versions never mix;
- forced persistence failure leaves zero partial rows and marks shell FAILED;
- FAILED can be reclaimed and completed;
- completed cannot be reclaimed/mutated.

- [ ] **Step 9: Implement `visibility-metrics` queue**

```ts
export const VISIBILITY_METRICS_QUEUE_NAME = 'visibility-metrics' as const;
export const VISIBILITY_METRICS_ATTEMPTS = 2;

export interface MaterializeVisibilityMetricSnapshotJobData {
  projectId: string;
  snapshotId: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  windowStart: string;
  windowEnd: string;
  inputCutoffAt: string;
  scopeHash: string;
}
```

Build deterministic bounded job ID as:

```ts
`visibility-metrics:${sha256(stableIdentity)}`
```

Queue only `materialize-metric-snapshot` jobs.

- [ ] **Step 10: Add queue/worker RED→GREEN tests**

Test deterministic job ID, attempts=2, project/snapshot validation, worker calls only `materializeSnapshot`, and `globalThis.fetch`/provider adapter spies remain at zero calls.

- [ ] **Step 11: Activate worker bootstrap**

Add `visibility-metrics` to `QUEUE_NAMES`; update:

```ts
workerDefinitionForQueue(
  name: 'visibility' | 'visibility-extraction' | 'visibility-metrics'
)
```

`visibility-metrics` processor = `processVisibilityMetricsJob`, concurrency = 2.

- [ ] **Step 12: Verify GREEN**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts tests/unit/visibility-metrics.queue.test.ts tests/unit/worker-bootstrap.test.ts tests/integration/visibility-metrics.materialization.test.ts
npm run typecheck
```

- [ ] **Step 13: Commit and open Task 3 PR**

```bash
git add src/modules/visibility/visibility-metrics.repository.ts src/modules/visibility/visibility-metrics.service.ts src/modules/visibility/visibility-metrics.queue.ts src/modules/visibility/visibility-metrics.worker.ts src/queue/queues.ts src/queue/worker-bootstrap.ts tests/unit/visibility-metrics.queue.test.ts tests/unit/worker-bootstrap.test.ts tests/integration/visibility-metrics.materialization.test.ts
git commit -m "feat: materialize immutable P6-C metric snapshots"
```

---

## Task 4: Project-Scoped REST API

**Branch:** `feat/p6c-task-04-metrics-api`

**Files:**
- Create: `src/modules/visibility/visibility-metrics.routes.ts`
- Create: `tests/integration/visibility-metrics.api.test.ts`
- Modify: `src/app.ts`

**Interfaces:**

- `POST /api/v1/projects/:projectId/visibility/metrics/snapshots`
- `GET /api/v1/projects/:projectId/visibility/metrics/snapshots`
- `GET /api/v1/projects/:projectId/visibility/metrics/snapshots/:snapshotId`
- `GET /api/v1/projects/:projectId/visibility/metrics/latest`

`AppOptions` adds:

```ts
visibilityMetricsQueue?: VisibilityMetricsQueue;
```

- [ ] **Step 1: Write RED request-validation tests**

POST body uses strict Zod:

```ts
z.object({
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  inputCutoffAt: z.string().datetime().optional(),
  extractorVersion: z.string().min(1).max(100),
  subjectSetHash: z.string().regex(/^[a-f0-9]{64}$/i),
  providers: z.array(z.enum(['OPENAI','GEMINI','PERPLEXITY','ANTHROPIC','DEEPSEEK'])).max(5).optional(),
  promptSetIds: z.array(z.string().uuid()).max(20).optional()
}).strict()
```

Prove malformed date/hash, unknown fields, >20 Prompt Sets and >31-day window produce 400 with zero metric snapshot writes and zero queue calls.

- [ ] **Step 2: Write RED feature/project-isolation tests**

Prove:
- Advanced and Enterprise may create/read;
- Standard returns `403 FEATURE_NOT_AVAILABLE` before `prepareSnapshot`/write/enqueue;
- foreign Prompt Set ID returns 404/fail-closed before write;
- foreign snapshot ID returns 404 without leaking foreign data.

Use a fake `VisibilityMetricsQueuePort` like existing P6-B API tests.

- [ ] **Step 3: Implement lazy queue port and routes**

Use a lazy BullMQ queue named `visibility-metrics` only when no queue is injected. Gate every P6-C endpoint with existing `COMPETITOR_SOV` before side effects.

POST flow:
1. feature-gate project;
2. parse body;
3. resolve server cutoff (`new Date()` when omitted);
4. call `prepareSnapshot`;
5. enqueue snapshot job;
6. return 202 with `snapshotId`, `jobId`, formula/extractor/subjectSetHash/scopeHash/window/cutoff.

- [ ] **Step 4: Implement safe list/detail/latest serializers**

List default 25/max100, deterministic ordering. Detail returns snapshot provenance, coverage and rows, but explicitly excludes:
- `subjectSnapshotJson`;
- prompt/answer text;
- aliases/canonical subject values;
- citation URLs;
- provider bodies/reasoning/secrets.

For API presentation:

```ts
ratio = row.metricStatus === 'CALCULATED' && row.denominator > 0
  ? Number((row.numerator / row.denominator).toFixed(4))
  : null;
```

Expose Overall `dimensionKey` as `null` while storage remains `OVERALL`.

Latest must select one latest `COMPLETED` snapshot matching explicit contract filters; never combine snapshots.

- [ ] **Step 5: Run GREEN + regression**

```bash
npm test -- tests/integration/visibility-metrics.api.test.ts tests/integration/visibility-intelligence.api.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit and open Task 4 PR**

```bash
git add src/modules/visibility/visibility-metrics.routes.ts src/app.ts tests/integration/visibility-metrics.api.test.ts
git commit -m "feat: add P6-C visibility metrics API"
```

---

## Task 5: Metrics & Share of Voice Web UI

**Branch:** `feat/p6c-task-05-metrics-ui`

**Files:**
- Create: `src/modules/visibility/visibility-metrics.web.repository.ts`
- Create: `src/modules/visibility/visibility-metrics.web.routes.ts`
- Create: `src/views/visibility/metrics.ejs`
- Create: `tests/integration/visibility-metrics.web.test.ts`
- Create: `tests/e2e/visibility-metrics.spec.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/public/css/app.css` only for explicit metric-state presentation if necessary.
- Modify: `src/app.ts`
- Modify: `tests/e2e/visibility-center.spec.ts`
- Modify: `tests/e2e/citation-monitor.spec.ts`

**Web routes:**
- `GET /projects/:id/visibility/metrics`
- `POST /projects/:id/visibility/metrics/snapshots`

Both use `COMPETITOR_SOV` before reads/writes/enqueue.

- [ ] **Step 1: Write RED web integration tests**

Seed snapshots/rows directly and prove page renders:
- Owned Mention Rate;
- Owned Citation Rate;
- Owned Mention SOV;
- Evidence Coverage;
- competitor table;
- Provider breakdown;
- Prompt Set breakdown;
- formulaVersion/extractorVersion/subjectSetHash/window/inputCutoffAt provenance.

Prove Standard returns 403 before repository reads that expose P6-C intelligence.

- [ ] **Step 2: Lock status presentation semantics**

Tests must distinguish exact rendered values:
- `CALCULATED` + `0/10` => `0.0%` or equivalent explicit zero;
- `UNKNOWN` => text `UNKNOWN`, never `0%`;
- `NOT_ELIGIBLE` => explicit label;
- `NO_DATA` => explicit label;
- `NO_SIGNAL` => explicit label.

- [ ] **Step 3: Implement bounded web repository**

`getMetricsPage(projectId, requestedSnapshotId?)` returns only:
- project metadata;
- selected/latest completed snapshot metadata;
- safe rows;
- up to 20 recent same-project `extractorVersion + subjectSetHash` contracts for snapshot generation;
- Prompt Set names only as historical labels already stored or safe config labels.

Never return prompt text, answer text, aliases/canonical subject values, citation URL/body, provider raw content or reasoning.

- [ ] **Step 4: Implement web routes and snapshot form**

GET selects requested same-project snapshot or latest completed snapshot; when none exists, render an explanatory empty state and bounded generation form.

POST accepts window/extractorVersion/subjectSetHash, uses server time for `inputCutoffAt`, creates/enqueues an Overall/unfiltered snapshot, then redirects 303 to `/projects/:id/visibility/metrics?snapshotId=<id>`.

Scoped Provider/Prompt Set creation remains available through REST API V1; the web form stays simple.

- [ ] **Step 5: Implement `metrics.ejs`**

Use existing `.metric-grid`, `.metric-card`, `.panel`, `.table-wrap`, `.badge` styles. Add minimal status-specific classes only when they clarify UNKNOWN vs zero.

Do not add trend chart, delta, alert, historical sparkline, report button or P6-D claim.

- [ ] **Step 6: Activate sidebar and update old phase assertions**

Replace:

```ejs
<a href="#">P6-C 指标（未启用）</a>
```

with an active-aware link to `/projects/<id>/visibility/metrics`, label `Visibility 指标`.

Update P6-A/P6-B E2E tests so they assert those pages themselves do not calculate P6-C metrics, rather than asserting the global sidebar placeholder still exists.

- [ ] **Step 7: Add Chromium E2E fixture**

Seed deterministic Prisma data inside Playwright test setup: Advanced project, Prompt Set/run/observations, P6-B subject/extractions/facts, then a P6-C completed snapshot with rows representing a legitimate 0%, UNKNOWN, SOV comparison and provenance. Browser asserts active sidebar, cards/table/status labels and absence of trend/alert language.

- [ ] **Step 8: Verify GREEN**

```bash
npm test -- tests/integration/visibility-metrics.web.test.ts tests/integration/visibility-intelligence.web.test.ts
npm run test:e2e -- tests/e2e/visibility-metrics.spec.ts tests/e2e/visibility-center.spec.ts tests/e2e/citation-monitor.spec.ts
npm run typecheck
```

- [ ] **Step 9: Commit and open Task 5 PR**

```bash
git add src/modules/visibility/visibility-metrics.web.repository.ts src/modules/visibility/visibility-metrics.web.routes.ts src/views/visibility/metrics.ejs src/views/partials/sidebar.ejs src/public/css/app.css src/app.ts tests/integration/visibility-metrics.web.test.ts tests/e2e/visibility-metrics.spec.ts tests/e2e/visibility-center.spec.ts tests/e2e/citation-monitor.spec.ts
git commit -m "feat: add P6-C metrics and SOV UI"
```

---

## Task 6: Safe Observability + Operator Guide + P6-C Release Gate

**Branch:** `feat/p6c-task-06-release-gate`

**Files:**
- Create: `src/modules/visibility/visibility-metrics.observability.ts`
- Create: `tests/integration/visibility-metrics.observability.test.ts`
- Create: `docs/development/p6c-visibility-metrics-sov.md`
- Modify: `src/modules/visibility/visibility-metrics.queue.ts`
- Modify: `src/modules/visibility/visibility-metrics.worker.ts`
- Modify: `src/modules/visibility/visibility-metrics.service.ts`
- Modify: `README.md` only after code/docs head passes the first full gate.

**Allowed events only:**

```ts
type VisibilityMetricsEvent =
  | 'visibility.metrics.queued'
  | 'visibility.metrics.started'
  | 'visibility.metrics.completed'
  | 'visibility.metrics.failed';
```

**Allowed fields only:**
- `projectId`
- `snapshotId`
- `formulaVersion`
- `extractorVersion`
- `subjectSetHash`
- `scopeHash`
- `status`
- `candidateObservationCount`
- `eligibleObservationCount`
- `unknownObservationCount`
- `notEligibleObservationCount`
- `errorCode`
- `durationMs`

- [ ] **Step 1: Write RED observability tests**

Feed serializer safe fields plus forbidden values:

```ts
{
  promptText: 'SECRET',
  answerText: 'SECRET',
  alias: 'SECRET',
  canonicalValue: 'SECRET',
  citationUrl: 'https://secret.example',
  providerBody: { secret: true },
  apiKey: 'sk-secret',
  cookie: 'secret',
  reasoning: 'secret'
}
```

Assert forbidden keys/values are absent from serialized/logged events.

- [ ] **Step 2: Implement strict allowlist serializer and lifecycle emissions**

Emit queued after queue add succeeds; started after worker accepts a valid same-project job; completed after immutable transaction succeeds; failed with stable bounded error code/duration. Never emit input records, subject snapshot JSON or metric row bodies.

- [ ] **Step 3: Write operator guide**

`docs/development/p6c-visibility-metrics-sov.md` must document:
- truth boundary and zero-network calculation;
- Mention Rate/Citation Rate/SOV formulas;
- UNKNOWN/KNOWN_EMPTY/NOT_ELIGIBLE/NO_DATA/NO_SIGNAL semantics;
- actor rollup/dedup;
- subjectSetHash/extractorVersion isolation;
- inputCutoffAt and immutability;
- hard bounds and queue/retry behavior;
- `COMPETITOR_SOV` plan gate;
- safe logging;
- P6-D exclusions;
- operational diagnosis for missing/unknown snapshots.

- [ ] **Step 4: Run the pre-README full release gate**

On the exact code/docs head run through CI or equivalent repository environment:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Existing `.github/workflows/ci.yml` already maps these into `verify`, `production-audit`, and Chromium `e2e`; do not edit CI unless a real repository requirement is missing.

- [ ] **Step 5: Lock additional evidence before README completion marker**

Confirm tests/review prove:
1. P6-C provider/external network calls = 0;
2. `UNKNOWN` never enters a denominator or becomes zero;
3. `KNOWN_EMPTY` enters the appropriate denominator;
4. legitimate 0% is visibly/semantically distinct from UNKNOWN;
5. owned aliases/subjects cannot double-count one observation;
6. SOV actor numerators sum exactly to denominator when calculated;
7. subjectSetHash values never mix;
8. extractorVersion values never mix;
9. old snapshots remain immutable after later P6-B backfill;
10. Standard cannot enqueue/generate/read P6-C intelligence;
11. P1–P6-B regression suite is green;
12. no P6-D trend/alert/report implementation exists.

- [ ] **Step 6: Commit observability/operator guide after GREEN**

```bash
git add src/modules/visibility/visibility-metrics.observability.ts src/modules/visibility/visibility-metrics.queue.ts src/modules/visibility/visibility-metrics.worker.ts src/modules/visibility/visibility-metrics.service.ts tests/integration/visibility-metrics.observability.test.ts docs/development/p6c-visibility-metrics-sov.md
git commit -m "chore: complete P6-C release verification"
```

- [ ] **Step 7: Update README only after the pre-README head is green**

Change roadmap/current milestone to exactly:

```text
P6-C Visibility Metrics & Competitor Share of Voice — complete
P6-D History, Dashboard, Alerts & Report Integration — next
```

Add a concise P6-C release-evidence paragraph under Release verification. Do not claim P6-D implementation.

Commit separately:

```bash
git add README.md
git commit -m "docs: mark P6-C complete"
```

- [ ] **Step 8: Run fresh exact-final-head CI**

Require all three jobs green on the README final head:
- `verify`
- `production-audit`
- Chromium `e2e`

Do not reuse a previous-head green result for the final merge.

- [ ] **Step 9: Final scope review and exact-head merge**

Compare `main..head` and confirm:
- no provider adapter/network dependency introduced into calculator/materializer;
- no prompt/answer/alias/canonical/citation-URL/private body logging;
- no P6-D trend/alert/report/history implementation;
- only P6-C metric snapshot capability and required docs are present.

Mark PR ready, update body with exact final head + CI run, and merge using `expected_head_sha=<exact final head>`.

- [ ] **Step 10: Post-merge verification and phase summary**

Verify `main` points to the merge commit and README records P6-C complete/P6-D next. Create the external archival summary document `兴善堂_SEO_GEO_P6-C_最终总结文档.docx` after merge, with architecture, formulas, data model, API/UI, safety boundaries, PR/CI evidence and next-phase boundary.

---

## P6-C Completion Definition

P6-C is complete only when all six task PRs have merged sequentially from fresh `main`, the exact final Task 6 head passes verify + production-audit + Chromium E2E, README marks P6-C complete only after that gate, and the final scope review confirms no P6-D functionality or provider/network metric calculation was introduced.