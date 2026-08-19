# P6-C Visibility Metrics & Competitor Share of Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic, immutable Mention Rate, Citation Rate, and presence-based Mention Share of Voice snapshots over persisted P6-B facts, with explicit evidence coverage, version isolation, Advanced/Enterprise API/UI access, and zero provider/network calculation.

**Architecture:** P6-C adds a pure metric calculator, immutable metric snapshot/row persistence, a database-only materialization service and `visibility-metrics` queue, then project-scoped REST and EJS surfaces. Each snapshot is frozen by `formulaVersion + extractorVersion + subjectSetHash + window + inputCutoffAt + scopeHash`. Missing/unknown P6-B evidence is never coerced to zero. P6-D trends, alerts, history dashboarding, and report integration remain out of scope.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma 6, Redis/BullMQ, Zod, Vitest/Supertest/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-p6c-visibility-metrics-sov-design.md`

## Global Constraints

- Authoritative P6-C inputs come only from persisted P6-A `PlatformObservation` and P6-B extraction/fact rows.
- No DeepSeek, LLM, embedding, fuzzy matching, live provider call, external URL fetch, search engine, or consumer-product UI automation may participate in authoritative metric calculation.
- `UNKNOWN` and missing/failed requested extraction input are not zero and do not enter a denominator; P6-C V1 makes the affected metric/dimension `UNKNOWN`.
- `KNOWN_EMPTY` is eligible evidence and enters the correct denominator.
- Explicit `NOT_ELIGIBLE` never enters a denominator; mixed eligible + explicit NOT_ELIGIBLE may still be `CALCULATED` when no unknown/missing input exists.
- A legitimate zero is `metricStatus=CALCULATED`, `numerator=0`, `denominator>0`.
- Mention SOV uses observation-level actor presence, not occurrence count. Owned subjects roll up to one `OWNED_ROLLUP`; each competitor subject is one actor.
- One snapshot never mixes `subjectSetHash` or `extractorVersion` values.
- Candidate observations are selected from P6-A independently of extraction availability; missing extraction remains visible as unknown coverage.
- A completed metric snapshot is immutable. Later P6-B backfill cannot mutate old P6-C rows.
- All P6-C generation/read surfaces use existing feature code `COMPETITOR_SOV`; Standard is rejected before writes/enqueue.
- Hard bounds: maximum window 31 days, maximum Prompt Set filters 20, maximum candidates 20,000, DB batch size 500, list default 25/max 100.
- Dimensions V1: `OVERALL`, `PROVIDER`, `PROMPT_SET` only; no Provider × Prompt Set cube.
- P6-D trend lines, deltas, alerts, scheduled notifications, history widgets, report integration, and AI narrative trend explanation are forbidden.
- Each implementation task starts from the latest merged `main` after the prior task; do not carry stale stacked history.
- Never merge while required CI is pending/failing. Read the current PR head SHA immediately before merge and pass that exact SHA as `expected_head_sha`.

## Delivery Discipline

Sequential branches/PRs:

1. `feat/p6c-task-01-metric-calculator`
2. `feat/p6c-task-02-metric-persistence`
3. `feat/p6c-task-03-metric-materialization`
4. `feat/p6c-task-04-metrics-api`
5. `feat/p6c-task-05-metrics-ui`
6. `feat/p6c-task-06-release-gate`

If a branch becomes historically polluted, rebuild from current `main` and transplant only that task's files.

---

## File Map

- Pure domain: `src/modules/visibility/visibility-metrics.types.ts`, `visibility-metrics.calculator.ts`
- Persistence: `prisma/models/visibility-metrics.prisma`, `prisma/migrations/20260819215800_add_visibility_metrics/migration.sql`
- Materialization: `visibility-metrics.repository.ts`, `visibility-metrics.service.ts`, `visibility-metrics.queue.ts`, `visibility-metrics.worker.ts`
- API: `visibility-metrics.routes.ts`
- Web: `visibility-metrics.web.repository.ts`, `visibility-metrics.web.routes.ts`, `src/views/visibility/metrics.ejs`
- Observability: `visibility-metrics.observability.ts`
- Operations: `docs/development/p6c-visibility-metrics-sov.md`

---

## Task 1: Metric Contracts + Pure Calculator

**Branch:** `feat/p6c-task-01-metric-calculator`

**Files:**
- Create `src/modules/visibility/visibility-metrics.types.ts`
- Create `src/modules/visibility/visibility-metrics.calculator.ts`
- Create `tests/unit/visibility-metrics.calculator.test.ts`

**Interfaces:**

```ts
export const P6C_FORMULA_VERSION = 'VISIBILITY_METRICS_V1' as const;
export type VisibilityMetricProvider = 'OPENAI'|'GEMINI'|'PERPLEXITY'|'ANTHROPIC'|'DEEPSEEK';
export type VisibilityMetricEvidenceStatus = 'EXTRACTED'|'KNOWN_EMPTY'|'UNKNOWN'|'NOT_ELIGIBLE';
export type VisibilityMetricType = 'MENTION_RATE'|'CITATION_RATE'|'MENTION_SHARE_OF_VOICE';
export type VisibilityMetricStatus = 'CALCULATED'|'NO_SIGNAL'|'UNKNOWN'|'NOT_ELIGIBLE'|'NO_DATA';
export type VisibilityMetricDimensionType = 'OVERALL'|'PROVIDER'|'PROMPT_SET';

export interface VisibilityMetricActor {
  actorType: 'OWNED_ROLLUP'|'COMPETITOR';
  actorKey: string;
  actorSubjectId: string|null;
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

export function calculateVisibilityMetrics(input: {
  records: VisibilityMetricInputRecord[];
  actors: VisibilityMetricActor[];
}): CalculatedVisibilityMetricRow[];
```

- [ ] **Step 1 — RED evidence-state tests**

Lock: `KNOWN_EMPTY` enters denominators; `UNKNOWN` never enters denominator and yields UNKNOWN; mixed eligible + NOT_ELIGIBLE may calculate; all NOT_ELIGIBLE yields NOT_ELIGIBLE; zero candidates yields Overall `NO_DATA` rows.

- [ ] **Step 2 — Run RED**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts
```

Expected: missing P6-C calculator/contracts.

- [ ] **Step 3 — Implement deterministic dimensions/coverage**

Groups:

```ts
{ type:'OVERALL', key:'OVERALL', label:null }
{ type:'PROVIDER', key:record.provider, label:record.provider }
{ type:'PROMPT_SET', key:record.promptSetId, label:record.promptSetName }
```

Deduplicate by `observationId` inside each group.

- [ ] **Step 4 — Implement Mention/Citation Rate**

Denominator = `EXTRACTED|KNOWN_EMPTY`. Numerator = distinct eligible observations where actor is present. If any record for that metric/dimension is UNKNOWN, return UNKNOWN with integer coverage counts and no authoritative ratio. Denominator > 0 + numerator 0 = CALCULATED zero.

- [ ] **Step 5 — Implement presence-based Mention SOV**

One owned unit max per observation; competitor subject IDs deduped via `Set`; only supplied actors count. SOV denominator = all actor presence units. Eligible mention observations + zero actor units = NO_SIGNAL.

- [ ] **Step 6 — Invariant tests**

Prove rate numerator <= denominator; CALCULATED rate denominator > 0; calculated SOV actor numerators sum exactly to shared denominator; duplicate competitor IDs count once; actor absent from actor registry cannot appear; Provider and Prompt Set partitions are independent; calculator has no Prisma/BullMQ/provider/fetch import.

- [ ] **Step 7 — GREEN**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts
npm run typecheck
```

- [ ] **Step 8 — Commit**

```bash
git add src/modules/visibility/visibility-metrics.types.ts src/modules/visibility/visibility-metrics.calculator.ts tests/unit/visibility-metrics.calculator.test.ts
git commit -m "feat: add P6-C visibility metric calculator"
```

Task 1 PR contains only pure calculator/contracts/tests.

---

## Task 2: Prisma Metric Snapshot Persistence

**Branch:** `feat/p6c-task-02-metric-persistence`

**Files:**
- Create `prisma/models/visibility-metrics.prisma`
- Create `prisma/migrations/20260819215800_add_visibility_metrics/migration.sql`
- Create `tests/integration/visibility-metrics.persistence.test.ts`

**Enums:**

```prisma
enum VisibilityMetricSnapshotStatus { QUEUED RUNNING COMPLETED FAILED }
enum VisibilityMetricType { MENTION_RATE CITATION_RATE MENTION_SHARE_OF_VOICE }
enum VisibilityMetricStatus { CALCULATED NO_SIGNAL UNKNOWN NOT_ELIGIBLE NO_DATA }
enum VisibilityMetricDimensionType { OVERALL PROVIDER PROMPT_SET }
enum VisibilityMetricActorType { OWNED_ROLLUP COMPETITOR }
```

**Snapshot fields:** `id`, `projectId`, `status`, `formulaVersion`, `extractorVersion`, `subjectSetHash`, `subjectSnapshotJson`, `windowStart`, `windowEnd`, `inputCutoffAt`, `scopeJson`, `scopeHash`, nullable `inputFingerprint`, candidate/completed/missing/failed counts, `errorCode`, lifecycle timestamps, created/updated timestamps.

Composite uniqueness:

```prisma
@@unique([projectId, formulaVersion, extractorVersion, subjectSetHash, windowStart, windowEnd, inputCutoffAt, scopeHash])
```

**Row fields:** snapshot/project IDs, metric type/status, dimension type, non-null `dimensionKey`, optional `dimensionLabelSnapshot`, actor type/subject/key, numerator/denominator, candidate/eligible/notEligible/unknown counts, createdAt.

Row uniqueness:

```prisma
@@unique([visibilityMetricSnapshotId, metricType, dimensionType, dimensionKey, actorKey])
```

- [ ] **Step 1 — RED persistence contract**

Create QUEUED snapshot and rows; assert Overall storage key is `OVERALL`; assert exact snapshot identity and exact row identity are unique.

- [ ] **Step 2 — Lifecycle/cascade test**

Prove snapshot row lifecycle fields persist; deleting metric snapshot cascades only its rows. Migration must enforce project scoping/FKs in the same style as existing repository migrations without adding P6-D tables.

- [ ] **Step 3 — Run RED**

```bash
npm test -- tests/integration/visibility-metrics.persistence.test.ts
```

- [ ] **Step 4 — Implement model + exact migration**

Create the five enums, two tables, required constraints/indexes and snapshot→row cascade. No trend/history tables.

- [ ] **Step 5 — GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- tests/integration/visibility-metrics.persistence.test.ts
npm run typecheck
```

- [ ] **Step 6 — Commit**

```bash
git add prisma/models/visibility-metrics.prisma prisma/migrations/20260819215800_add_visibility_metrics/migration.sql tests/integration/visibility-metrics.persistence.test.ts
git commit -m "feat: add P6-C metric snapshot persistence"
```

---

## Task 3: Materialization Repository + Service + Queue + Worker

**Branch:** `feat/p6c-task-03-metric-materialization`

**Files:**
- Create `src/modules/visibility/visibility-metrics.repository.ts`
- Create `src/modules/visibility/visibility-metrics.service.ts`
- Create `src/modules/visibility/visibility-metrics.queue.ts`
- Create `src/modules/visibility/visibility-metrics.worker.ts`
- Create `tests/integration/visibility-metrics.materialization.test.ts`
- Create `tests/unit/visibility-metrics.queue.test.ts`
- Modify `tests/unit/worker-bootstrap.test.ts`
- Modify `src/queue/queues.ts`
- Modify `src/queue/worker-bootstrap.ts`

**Core interfaces:**

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

Repository exposes `createOrGetShell`, `claim` (QUEUED|FAILED only), project-scoped `get`, `completeAtomic`, and `fail`. `COMPLETED` is immutable.

- [ ] **Step 1 — RED validation/contract tests**

Lock `windowStart < windowEnd`; max duration 31 days; `inputCutoffAt` cannot be later than injected service clock; Prompt Set count <=20 and every ID belongs to project; providers/prompt IDs sorted/deduped before scope hash. Do not impose an additional `windowEnd <= inputCutoffAt` rule: candidate `createdAt <= inputCutoffAt` is the approved evidence-horizon rule.

- [ ] **Step 2 — Subject-contract resolution RED**

Resolution order: same-project P6-B extraction with requested extractor/hash; verify canonical `subjectSnapshotJson`; otherwise current `VisibilitySubjectService.buildActiveSnapshot()` only when its freshly computed hash equals requested hash; else `VISIBILITY_METRICS_CONTRACT_NOT_FOUND` before write.

- [ ] **Step 3 — Implement shell/scope identity**

Stable canonical scope JSON + SHA-256; formula `VISIBILITY_METRICS_V1`; exact Prisma composite identity from Task 2.

- [ ] **Step 4 — Candidate selection before extraction lookup**

Use half-open `observedAt` window, `createdAt <= inputCutoffAt`, optional provider and Prompt Set scope. Count first; >20,000 => `VISIBILITY_METRICS_SCOPE_TOO_LARGE`; deterministic DB batches of 500.

- [ ] **Step 5 — Normalize P6-B as-of-cutoff evidence**

Only requested `extractorVersion + subjectSetHash`. A matching extraction is usable only when `status=COMPLETED` and `completedAt <= inputCutoffAt`. Missing/non-completed/post-cutoff extraction becomes normalized UNKNOWN coverage, not silently filtered. Same hash with inconsistent subject snapshot fails `VISIBILITY_METRICS_SUBJECT_SNAPSHOT_MISMATCH`.

- [ ] **Step 6 — Build actor presence without private content**

Load only fact identifiers/classification: Mention `subjectId/subjectType`; Citation `ownedSubjectId/competitorSubjectId`; observation provider/Prompt Set ID/name. Never load prompt text, answer text, citation URL/body, provider body/reasoning or secrets.

- [ ] **Step 7 — Input fingerprint**

SHA-256 over canonically sorted non-sensitive metadata: candidate observation ID, provider, Prompt Set ID, matching extraction ID or explicit missing marker, mention/citation evidence states, extraction completion identity. No content bodies/aliases/URLs/secrets.

- [ ] **Step 8 — Atomic replay tests**

Prove exact repeated completed identity returns unchanged snapshot; later P6-B backfill cannot mutate old rows; later cutoff creates new identity; hash/version never mix; forced persistence failure leaves no partial rows and marks FAILED; FAILED retry may complete; COMPLETED cannot be reclaimed.

- [ ] **Step 9 — Queue contract**

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

Stable bounded ID: `visibility-metrics:` + SHA-256 of canonical job identity. Job name: `materialize-metric-snapshot`.

- [ ] **Step 10 — Queue/worker tests**

Deterministic ID, attempts=2, same-project snapshot validation, worker invokes only `materializeSnapshot`, `globalThis.fetch`/provider spies remain zero.

- [ ] **Step 11 — Worker bootstrap**

Add `visibility-metrics` to `QUEUE_NAMES`; extend `workerDefinitionForQueue` to return P6-C processor at concurrency 2.

- [ ] **Step 12 — GREEN**

```bash
npm test -- tests/unit/visibility-metrics.calculator.test.ts tests/unit/visibility-metrics.queue.test.ts tests/unit/worker-bootstrap.test.ts tests/integration/visibility-metrics.materialization.test.ts
npm run typecheck
```

- [ ] **Step 13 — Commit**

```bash
git add src/modules/visibility/visibility-metrics.repository.ts src/modules/visibility/visibility-metrics.service.ts src/modules/visibility/visibility-metrics.queue.ts src/modules/visibility/visibility-metrics.worker.ts src/queue/queues.ts src/queue/worker-bootstrap.ts tests/unit/visibility-metrics.queue.test.ts tests/unit/worker-bootstrap.test.ts tests/integration/visibility-metrics.materialization.test.ts
git commit -m "feat: materialize immutable P6-C metric snapshots"
```

---

## Task 4: Project-Scoped REST API

**Branch:** `feat/p6c-task-04-metrics-api`

**Files:**
- Create `src/modules/visibility/visibility-metrics.routes.ts`
- Create `tests/integration/visibility-metrics.api.test.ts`
- Modify `src/app.ts`

**Routes:**
- `POST /api/v1/projects/:projectId/visibility/metrics/snapshots`
- `GET /api/v1/projects/:projectId/visibility/metrics/snapshots`
- `GET /api/v1/projects/:projectId/visibility/metrics/snapshots/:snapshotId`
- `GET /api/v1/projects/:projectId/visibility/metrics/latest`

`AppOptions` adds `visibilityMetricsQueue?: VisibilityMetricsQueue`.

- [ ] **Step 1 — RED strict validation**

POST schema: ISO datetime strings; extractorVersion 1–100 chars; 64-char SHA-256 subjectSetHash; providers from existing five enums max5; Prompt Set UUID array max20; `.strict()`. Malformed/extra fields and >31-day windows produce 400 with zero snapshot write/queue call.

- [ ] **Step 2 — RED access/isolation**

Advanced/Enterprise allowed; Standard `403 FEATURE_NOT_AVAILABLE` before prepare/write/enqueue; foreign Prompt Set fails closed before write; foreign snapshot ID 404.

- [ ] **Step 3 — Implement queue-backed POST**

Gate `COMPETITOR_SOV`, parse, resolve omitted cutoff to server request time, call `prepareSnapshot`, enqueue, return 202 with safe snapshot/job/provenance identity. Lazy BullMQ port uses queue `visibility-metrics` only when no injected fake queue exists.

- [ ] **Step 4 — Safe list/detail/latest**

List default25/max100, deterministic ordering. Detail exposes metric/provenance/coverage only and excludes `subjectSnapshotJson`, prompt/answer, aliases/canonical subject values, citation URLs, provider bodies/reasoning/secrets. Presentation ratio only for CALCULATED + denominator>0:

```ts
Number((row.numerator / row.denominator).toFixed(4))
```

Otherwise `ratio=null`. Public Overall dimensionKey may be null; storage remains `OVERALL`. Latest selects one completed snapshot and never combines snapshots.

- [ ] **Step 5 — GREEN**

```bash
npm test -- tests/integration/visibility-metrics.api.test.ts tests/integration/visibility-intelligence.api.test.ts
npm run typecheck
```

- [ ] **Step 6 — Commit**

```bash
git add src/modules/visibility/visibility-metrics.routes.ts src/app.ts tests/integration/visibility-metrics.api.test.ts
git commit -m "feat: add P6-C visibility metrics API"
```

---

## Task 5: Metrics & SOV Web UI

**Branch:** `feat/p6c-task-05-metrics-ui`

**Files:**
- Create `src/modules/visibility/visibility-metrics.web.repository.ts`
- Create `src/modules/visibility/visibility-metrics.web.routes.ts`
- Create `src/views/visibility/metrics.ejs`
- Create `tests/integration/visibility-metrics.web.test.ts`
- Create `tests/e2e/visibility-metrics.spec.ts`
- Modify `src/views/partials/sidebar.ejs`
- Modify `src/public/css/app.css` only if explicit state presentation needs it
- Modify `src/app.ts`
- Modify `tests/e2e/visibility-center.spec.ts`
- Modify `tests/e2e/citation-monitor.spec.ts`

**Web routes:** `GET /projects/:id/visibility/metrics`, `POST /projects/:id/visibility/metrics/snapshots`, both gated by `COMPETITOR_SOV` before restricted reads/writes.

- [ ] **Step 1 — RED rendering tests**

Seed safe metric snapshots/rows and assert Owned Mention Rate, Owned Citation Rate, Owned Mention SOV, coverage, competitor table, Provider breakdown, Prompt Set breakdown, formula/extractor/hash/window/cutoff provenance. Standard 403 before restricted reads.

- [ ] **Step 2 — Lock visual status semantics**

CALCULATED `0/10` renders explicit `0.0%` (or equivalent zero); UNKNOWN renders `UNKNOWN`, never 0%; NOT_ELIGIBLE, NO_DATA and NO_SIGNAL each render explicit text.

- [ ] **Step 3 — Bounded web repository**

Return project metadata, selected/latest snapshot and safe rows; up to 20 recent same-project extractor/hash contracts for generation. Never return prompt/answer, aliases/canonical subject values, citation URLs/bodies, provider raw data/reasoning.

- [ ] **Step 4 — Web snapshot generation**

GET renders selected/latest or empty state/form. POST accepts window + extractorVersion + subjectSetHash, uses server time cutoff, prepares/enqueues an unfiltered snapshot, redirects 303 to metrics with snapshotId. Provider/Prompt scoped creation remains REST API V1.

- [ ] **Step 5 — EJS page**

Use existing metric-grid/card/panel/table/badge styles. Add minimal status-specific CSS only to make UNKNOWN/non-zero semantics unmistakable. No trend chart/delta/alert/history/report/P6-D claims.

- [ ] **Step 6 — Sidebar/old-phase assertions**

Replace disabled P6-C placeholder with active-aware `/projects/:id/visibility/metrics` link labelled `Visibility 指标`. Update P6-A/P6-B E2E so they verify those pages themselves do not calculate metrics rather than expecting a global disabled placeholder.

- [ ] **Step 7 — Chromium fixture**

Seed Prisma facts/snapshot rows in Playwright Node setup. Browser proves active metrics nav, legitimate zero vs UNKNOWN, competitor SOV, provenance/coverage, and absence of trend/alert language.

- [ ] **Step 8 — GREEN**

```bash
npm test -- tests/integration/visibility-metrics.web.test.ts tests/integration/visibility-intelligence.web.test.ts
npm run test:e2e -- tests/e2e/visibility-metrics.spec.ts tests/e2e/visibility-center.spec.ts tests/e2e/citation-monitor.spec.ts
npm run typecheck
```

- [ ] **Step 9 — Commit**

```bash
git add src/modules/visibility/visibility-metrics.web.repository.ts src/modules/visibility/visibility-metrics.web.routes.ts src/views/visibility/metrics.ejs src/views/partials/sidebar.ejs src/public/css/app.css src/app.ts tests/integration/visibility-metrics.web.test.ts tests/e2e/visibility-metrics.spec.ts tests/e2e/visibility-center.spec.ts tests/e2e/citation-monitor.spec.ts
git commit -m "feat: add P6-C metrics and SOV UI"
```

---

## Task 6: Observability + Operator Guide + Release Gate

**Branch:** `feat/p6c-task-06-release-gate`

**Files:**
- Create `src/modules/visibility/visibility-metrics.observability.ts`
- Create `tests/integration/visibility-metrics.observability.test.ts`
- Create `docs/development/p6c-visibility-metrics-sov.md`
- Modify `visibility-metrics.queue.ts`, `visibility-metrics.worker.ts`, `visibility-metrics.service.ts`
- Modify `README.md` only after the code/docs head is fully green

**Allowed events:** `visibility.metrics.queued`, `.started`, `.completed`, `.failed`.

**Allowed fields only:** projectId, snapshotId, formulaVersion, extractorVersion, subjectSetHash, scopeHash, status, candidate/eligible/unknown/notEligible counts, errorCode, durationMs.

- [ ] **Step 1 — RED safe logging tests**

Pass safe fields plus forbidden promptText, answerText, alias, canonicalValue, citationUrl, providerBody, apiKey, cookie, reasoning. Assert all forbidden keys/values are absent.

- [ ] **Step 2 — Implement lifecycle events**

Queued only after queue add succeeds; started after valid same-project job accepted; completed after immutable completion; failed with bounded errorCode/duration. Never log subject snapshot or metric row bodies.

- [ ] **Step 3 — Operator guide**

Document formulas, evidence states, actor dedup, version isolation, cutoff/immutability, hard bounds, queue/retry, COMPETITOR_SOV gate, safe logging, zero-network boundary, P6-D exclusions and diagnosis of UNKNOWN/missing inputs.

- [ ] **Step 4 — Commit code/docs head**

```bash
git add src/modules/visibility/visibility-metrics.observability.ts src/modules/visibility/visibility-metrics.queue.ts src/modules/visibility/visibility-metrics.worker.ts src/modules/visibility/visibility-metrics.service.ts tests/integration/visibility-metrics.observability.test.ts docs/development/p6c-visibility-metrics-sov.md
git commit -m "chore: complete P6-C release verification"
```

This commit exists before CI so GitHub can verify the actual code/docs head.

- [ ] **Step 5 — Pre-README exact-head release gate**

Require on the exact code/docs head:

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

Existing `.github/workflows/ci.yml` maps these to `verify`, `production-audit`, Chromium `e2e`; edit CI only if an actual required command is missing.

- [ ] **Step 6 — Evidence review**

Confirm: provider/external network calls=0; UNKNOWN never denominator/zero; KNOWN_EMPTY denominator; legitimate zero distinct; owned dedup; calculated SOV numerators sum denominator; hash/version isolation; old snapshot immutable after later P6-B backfill; Standard cannot generate/read; P1–P6-B regressions green; no P6-D implementation.

- [ ] **Step 7 — README completion marker only now**

After Step 5/6 are green, change roadmap/current milestone to:

```text
P6-C Visibility Metrics & Competitor Share of Voice — complete
P6-D History, Dashboard, Alerts & Report Integration — next
```

Add concise P6-C release-evidence paragraph; no P6-D implementation claim.

```bash
git add README.md
git commit -m "docs: mark P6-C complete"
```

- [ ] **Step 8 — Fresh final-head CI**

On the README commit head require `verify`, `production-audit`, and Chromium `e2e` all SUCCESS. Previous-head green evidence is not sufficient.

- [ ] **Step 9 — Scope review + exact-head merge**

Compare `main..head`: no provider/network metric dependency; no sensitive logging; no P6-D feature. Re-read PR head SHA immediately before merge and pass that exact SHA to GitHub `expected_head_sha`.

- [ ] **Step 10 — Post-merge + archival summary**

Verify main points to merge commit and README says P6-C complete/P6-D next. Then create `兴善堂_SEO_GEO_P6-C_最终总结文档.docx` with formulas, architecture, data model, API/UI, safety boundary, PR/CI evidence and P6-D boundary.

---

## Completion Definition

P6-C is complete only after all six task PRs merge sequentially from fresh `main`, the exact final Task 6 head passes verify + production-audit + Chromium E2E, README is changed only after the pre-README gate, and final scope review confirms no P6-D functionality or provider/network metric calculation was introduced.