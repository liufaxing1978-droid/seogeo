# P6-D History, Dashboard, Alerts & Report Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete P6 by adding immutable history comparisons, deterministic alerts, real dashboard/history surfaces, PROJECT_REPORT_V2, and optional DeepSeek trend explanation over already-persisted P6 facts.

**Architecture:** P6-D consumes completed immutable P6-C `VisibilityMetricSnapshot`/`VisibilityMetricRow` data and never re-samples providers or re-extracts mentions/citations. A pure comparison calculator produces absolute percentage-point deltas only for compatible snapshots; database-only monitoring jobs materialize comparisons and alert events; REST/Web/reporting read bounded safe facts; optional DeepSeek trend analysis remains advisory through the existing P4 AI Gateway.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest/Playwright, existing DeepSeek P4 AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-20-p6d-history-dashboard-alerts-report-design.md`

## Global Constraints

- P6-D reads persisted P6-A/P6-B/P6-C facts only; authoritative history/comparison/report generation makes zero provider/external-network calls.
- P6-D must not call P6-A sampling, P6-B extraction, or P6-C metric materialization from dashboard/history/report rendering.
- Numeric comparisons require same project, completed snapshots, same formulaVersion, extractorVersion, subjectSetHash, scopeHash, equal window duration, and non-overlapping windows.
- Numeric ratio requires `metricStatus=CALCULATED` and denominator > 0 on both current and previous rows.
- Delta is absolute percentage-point change stored as basis points: `round((currentRatio - previousRatio) * 10000)`.
- `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE`, and `NO_SIGNAL` never become zero and never receive a fabricated numeric delta.
- History series preserve gaps for non-numeric states.
- `PROJECT_REPORT_V1` rows remain immutable/readable; P6-D introduces `PROJECT_REPORT_V2`.
- V2 report generation is database-only and must not trigger P6 sampling/extraction/metric generation or DeepSeek automatically.
- P6 history/alerts/details remain Advanced/Enterprise only through the existing P6-C access boundary; Standard must fail before restricted P6 reads/writes.
- Optional `VISIBILITY_TREND_ANALYSIS` uses the P4 DeepSeek AI Gateway and may explain facts only; it cannot mutate deterministic P6 facts.
- Alert V1 is in-app only; do not claim email/Slack/SMS/WeChat delivery.
- Provider secrets, prompt/answer text, aliases/canonical values, citation URLs/bodies, provider raw bodies, reasoning, subjectSnapshotJson, full metric-row bodies, and full report JSON are forbidden from P6-D observability.
- History series max 180 points; comparison list max 100; alert list max 100; active alert rules max 50/project; report competitor rows max 20; reconciliation sweep max 100 projects / 100 snapshots.
- Every implementation task begins on a fresh branch from updated `main` after the prior task merges.
- README P6 completion marker is written only after code/docs exact-head full CI is green, followed by a second fresh final-head CI before merge.

---

## File Structure

### Comparison domain

- `src/modules/visibility/visibility-history.types.ts` — P6-D comparison contracts, stable error/status types.
- `src/modules/visibility/visibility-history.calculator.ts` — pure compatibility/row matching/delta calculations.
- `src/modules/visibility/visibility-history.repository.ts` — bounded project-scoped snapshot/comparison persistence reads/writes.
- `src/modules/visibility/visibility-history.service.ts` — predecessor selection and transactional comparison materialization.

### Persistence

- `prisma/models/visibility-history.prisma` — comparisons, delta rows, alert rules/events/enums.
- `prisma/migrations/<timestamp>_add_visibility_history_alerts/migration.sql` — exact SQL/FKs/indexes.

### Monitoring / alerts

- `src/modules/visibility/visibility-monitoring.queue.ts` — deterministic `visibility-monitoring` job identity/options.
- `src/modules/visibility/visibility-monitoring.worker.ts` — evaluate-snapshot and reconciliation processors.
- `src/modules/visibility/visibility-alerts.service.ts` — deterministic rule validation/evaluation/event lifecycle.
- `src/modules/visibility/visibility-history.observability.ts` — P6-D safe lifecycle allowlist.
- `src/queue/queues.ts` — register `visibility-monitoring`.
- `src/queue/worker-bootstrap.ts` — activate monitoring worker.
- `src/modules/visibility/visibility-metrics.service.ts` — best-effort enqueue after P6-C completes, without invalidating P6-C on enqueue failure.

### REST / Web

- `src/modules/visibility/visibility-history.routes.ts` — history/comparison/alert API.
- `src/modules/visibility/visibility-history.web.repository.ts` — bounded safe history/alert view models.
- `src/modules/visibility/visibility-history.web.routes.ts` — EJS routes/actions.
- `src/views/visibility/history.ejs` — server-rendered history and gap-safe inline SVG/HTML charts.
- `src/views/visibility/alerts.ejs` — rule config and in-app alert inbox.
- `src/modules/visibility/visibility.web.repository.ts` — upgrade latest P6 overview facts.
- `src/views/visibility/index.ejs` — add latest metrics/deltas/alerts and links.
- `src/views/partials/sidebar.ejs` — history/alerts navigation.
- `src/app.ts` — mount routes.

### Dashboard

- `src/web/view-models.ts` — replace placeholder P6 cards with typed bounded facts.
- `src/web/routes.ts` — load project/portfolio facts with plan-aware P6 access.
- `src/views/dashboard.ejs` — real portfolio values/states.
- `src/views/projects/show.ejs` — real project overview values/states.

### Reporting / AI

- `src/modules/reporting/report-builder.ts` — add explicit V1/V2 generation path and safe P6 V2 fact section.
- `src/modules/reporting/report.routes.ts` — V2 generation contract while retaining V1 reads.
- `src/modules/reporting/report.web.repository.ts` — render both versions safely.
- `src/modules/reporting/report.web.routes.ts` — version-aware page model.
- `src/views/reports/show.ejs` — P6 V2 section when present.
- `prisma/models/ai-gateway.prisma` — add `VISIBILITY_TREND_ANALYSIS` enum value.
- `src/modules/ai/visibility-trend-analysis.ts` — bounded P6 trend fact packet and task creation.
- `src/modules/ai/ai-prompts.ts` (or the repository's current versioned prompt registry file) — add trend prompt version/structured-output contract using established P4 pattern.

### Docs / release

- `docs/development/p6d-history-dashboard-alerts-report.md` — operator guide.
- `README.md` — mark P6-D/P6 complete only after pre-README exact-head gate succeeds.

---

## Task 1: Pure Comparison Calculator and Compatibility Contract

**Branch:** `feat/p6d-task-01-comparison-calculator`

**Files:**
- Create: `src/modules/visibility/visibility-history.types.ts`
- Create: `src/modules/visibility/visibility-history.calculator.ts`
- Create: `tests/unit/visibility-history.calculator.test.ts`

**Interfaces:**

Produce:

```ts
export const P6D_COMPARISON_VERSION = 'VISIBILITY_COMPARISON_V1' as const;

export type VisibilityHistorySnapshotContract = {
  id: string;
  projectId: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  scopeHash: string;
  windowStart: Date;
  windowEnd: Date;
};

export type VisibilityHistoryMetricRowInput = {
  metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE';
  metricStatus: 'CALCULATED' | 'NO_SIGNAL' | 'UNKNOWN' | 'NOT_ELIGIBLE' | 'NO_DATA';
  dimensionType: 'OVERALL' | 'PROVIDER' | 'PROMPT_SET';
  dimensionKey: string;
  actorType: 'OWNED_ROLLUP' | 'COMPETITOR';
  actorSubjectId: string | null;
  actorKey: string;
  numerator: number;
  denominator: number;
};

export type VisibilityHistoryDeltaRow = {
  metricType: VisibilityHistoryMetricRowInput['metricType'];
  dimensionType: VisibilityHistoryMetricRowInput['dimensionType'];
  dimensionKey: string;
  actorType: VisibilityHistoryMetricRowInput['actorType'];
  actorSubjectId: string | null;
  actorKey: string;
  previousMetricStatus: VisibilityHistoryMetricRowInput['metricStatus'];
  currentMetricStatus: VisibilityHistoryMetricRowInput['metricStatus'];
  previousNumerator: number;
  previousDenominator: number;
  currentNumerator: number;
  currentDenominator: number;
  deltaBasisPoints: number | null;
};

export function assertComparableSnapshots(
  current: VisibilityHistorySnapshotContract,
  previous: VisibilityHistorySnapshotContract
): { windowDurationMs: number; gapDurationMs: number };

export function calculateVisibilityHistoryDeltaRows(input: {
  currentRows: VisibilityHistoryMetricRowInput[];
  previousRows: VisibilityHistoryMetricRowInput[];
}): VisibilityHistoryDeltaRow[];

export function calculateCoverageBasisPoints(input: {
  currentCandidateCount: number;
  currentCompletedCount: number;
  previousCandidateCount: number;
  previousCompletedCount: number;
}): { currentBasisPoints: number | null; previousBasisPoints: number | null; deltaBasisPoints: number | null };
```

Define `VisibilityHistoryError` with stable codes from the spec. The calculator imports no Prisma/BullMQ/provider/AI/network module.

- [ ] **Step 1: Write RED compatibility tests**

Cover same-project/same-version/hash/scope/equal-window/non-overlap success and each mismatch error. Include a gapped but compatible pair and assert the exact `gapDurationMs`.

```ts
expect(assertComparableSnapshots(current, previous)).toEqual({
  windowDurationMs: 7 * DAY,
  gapDurationMs: 2 * DAY
});
```

- [ ] **Step 2: Write RED delta semantics tests**

Prove:

```ts
// 20% -> 25%
expect(delta.deltaBasisPoints).toBe(500);

// legitimate 0% -> 10%
expect(zeroToTen.deltaBasisPoints).toBe(1000);

// CALCULATED -> UNKNOWN
expect(stateChange.deltaBasisPoints).toBeNull();
expect(stateChange.previousMetricStatus).toBe('CALCULATED');
expect(stateChange.currentMetricStatus).toBe('UNKNOWN');
```

Also prove row matching uses `metricType + dimensionType + dimensionKey + actorKey`, sorted deterministically, and missing expected identities fail closed with `VISIBILITY_HISTORY_ROW_MISSING`.

- [ ] **Step 3: Write RED Evidence Coverage tests**

Prove candidate=0 yields null ratio/delta, and 80/100 -> 60/100 yields `-2000` bp.

- [ ] **Step 4: Run focused RED**

```bash
npm test -- tests/unit/visibility-history.calculator.test.ts
```

Expected RED: missing `visibility-history.types.ts` / calculator exports.

- [ ] **Step 5: Implement minimal pure calculator**

Use millisecond window lengths, exact string equality for version/hash/scope, `previous.windowEnd <= current.windowStart`, and integer basis-point rounding with `Math.round`.

- [ ] **Step 6: Verify GREEN and isolation**

```bash
npm test -- tests/unit/visibility-history.calculator.test.ts
npm run typecheck
```

Also static-review imports to confirm no Prisma/BullMQ/provider/fetch/AI dependency.

- [ ] **Step 7: Commit / PR / full gate**

Commit only Task 1 files. Open a draft PR, run full repository CI, scope-review, mark Ready, and squash merge only after exact-head `verify`, `e2e`, and `production-audit` succeed.

---

## Task 2: Comparison Persistence Foundation

**Branch:** `feat/p6d-task-02-comparison-persistence`

**Files:**
- Create: `prisma/models/visibility-history.prisma`
- Create: `prisma/migrations/<timestamp>_add_visibility_history_comparisons/migration.sql`
- Create: `tests/integration/visibility-history.persistence.test.ts`

**Interfaces:**

Add enums/models for `VisibilityMetricComparison` and `VisibilityMetricDeltaRow` exactly as the spec defines. Comparison rows exist only for compatible successfully materialized pairs.

FK rules:

```text
VisibilityMetricComparison.currentSnapshotId -> VisibilityMetricSnapshot.id ON DELETE RESTRICT
VisibilityMetricComparison.previousSnapshotId -> VisibilityMetricSnapshot.id ON DELETE RESTRICT
VisibilityMetricDeltaRow.comparisonId -> VisibilityMetricComparison.id ON DELETE CASCADE
```

- [ ] **Step 1: Write RED Prisma persistence tests** proving comparison uniqueness, delta-row uniqueness, project/time indexes usable through normal queries, comparison delete cascades delta rows, and deleting a comparison never deletes source P6-C snapshots.
- [ ] **Step 2: Run Prisma RED** with validate/generate/test and observe missing models.
- [ ] **Step 3: Add enums/models/migration** with exact unique/index/FK contracts.
- [ ] **Step 4: Verify** `prisma validate`, `prisma generate`, `prisma migrate deploy`, focused integration test, `npm run typecheck`.
- [ ] **Step 5: Commit / PR / exact-head full gate / squash merge.**

---

## Task 3: History Repository, Materialization Service, Monitoring Queue and Reconciliation

**Branch:** `feat/p6d-task-03-history-materialization`

**Files:**
- Create: `src/modules/visibility/visibility-history.repository.ts`
- Create: `src/modules/visibility/visibility-history.service.ts`
- Create: `src/modules/visibility/visibility-monitoring.queue.ts`
- Create: `src/modules/visibility/visibility-monitoring.worker.ts`
- Create: `tests/integration/visibility-history.materialization.test.ts`
- Create: `tests/unit/visibility-monitoring.queue.test.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/modules/visibility/visibility-metrics.service.ts`

**Interfaces:**

Produce:

```ts
export class VisibilityHistoryService {
  materializeForSnapshot(projectId: string, currentSnapshotId: string): Promise<{
    comparisonId: string | null;
    outcome: 'COMPLETED' | 'NO_COMPATIBLE_PREVIOUS';
  }>;
}

export const VISIBILITY_MONITORING_QUEUE_NAME = 'visibility-monitoring' as const;

export class VisibilityMonitoringQueue {
  enqueueSnapshot(projectId: string, snapshotId: string): Promise<void>;
  enqueueReconcile(): Promise<void>;
}
```

Snapshot predecessor query order: `windowEnd desc`, then `createdAt desc`, with same project/status/version/hash/scope/window duration and `windowEnd <= current.windowStart`; still call the pure compatibility validator before persistence.

- [ ] **Step 1: RED materialization tests** proving nearest compatible predecessor selection, no compatible predecessor returns normal null comparison, one transaction creates comparison+all delta rows, duplicate materialization reuses the same comparison, and source snapshots remain unchanged.
- [ ] **Step 2: RED queue tests** proving deterministic SHA-256 job ID, `attempts=2`, queue name, and separate reconcile job identity.
- [ ] **Step 3: RED P6-C completion integration test** with an injected monitoring queue: completed metric snapshot remains `COMPLETED` when monitoring enqueue throws, while successful enqueue occurs only after `completeAtomic` succeeds.
- [ ] **Step 4: Implement repository/service/queue/worker** with zero provider/network calls.
- [ ] **Step 5: Register queue/worker** and bounded reconcile scan: max 100 projects/100 unprocessed completed snapshots per sweep.
- [ ] **Step 6: Verify focused tests + typecheck + full CI.**
- [ ] **Step 7: Scope-review and squash merge.**

---

## Task 4: Alert Rules, Events, Evaluation and Resolution

**Branch:** `feat/p6d-task-04-alerts`

**Files:**
- Modify: `prisma/models/visibility-history.prisma`
- Create: `prisma/migrations/<timestamp>_add_visibility_alerts/migration.sql`
- Create: `src/modules/visibility/visibility-alerts.service.ts`
- Create: `tests/unit/visibility-alerts.service.test.ts`
- Create: `tests/integration/visibility-alerts.persistence.test.ts`
- Modify: `src/modules/visibility/visibility-monitoring.worker.ts`

**Interfaces:**

Produce:

```ts
export class VisibilityAlertsService {
  createRule(projectId: string, input: CreateVisibilityAlertRuleInput): Promise<VisibilityAlertRule>;
  updateRule(projectId: string, ruleId: string, input: UpdateVisibilityAlertRuleInput): Promise<VisibilityAlertRule>;
  evaluateComparison(projectId: string, comparisonId: string): Promise<{
    triggered: number;
    resolved: number;
  }>;
  acknowledge(projectId: string, alertId: string): Promise<VisibilityAlertEvent>;
}
```

Validation:
- numeric threshold rules require integer `thresholdBasisPoints` in 1..10000;
- `METRIC_BECAME_UNKNOWN` requires `thresholdBasisPoints=null`;
- max 50 active rules/project;
- competitor-specific `actorSubjectId`, when supplied, must resolve to a same-project active competitor subject.

Deterministic event fingerprint:

```text
sha256(`${ruleId}:${comparisonId}:${actorKey ?? 'NONE'}`)
```

- [ ] **Step 1: RED pure evaluator tests** for all six rule types, exact threshold edge, no trigger on nonnumeric states, any-competitor vs one-competitor targeting, and deterministic fingerprint.
- [ ] **Step 2: RED persistence tests** for rule validation, project isolation, unique event fingerprint, immutable trigger fields, acknowledge-only lifecycle update, and deterministic resolution on the next non-triggering comparison.
- [ ] **Step 3: Add Prisma enums/models/migration.**
- [ ] **Step 4: Implement alert service and integrate monitoring worker after comparison materialization.**
- [ ] **Step 5: Verify focused + full CI; squash merge.**

---

## Task 5: History / Alerts REST API

**Branch:** `feat/p6d-task-05-history-api`

**Files:**
- Create: `src/modules/visibility/visibility-history.routes.ts`
- Create: `tests/integration/visibility-history.api.test.ts`
- Modify: `src/app.ts`

**Interfaces / routes:**

```text
GET  /api/v1/projects/:projectId/visibility/history/snapshots
GET  /api/v1/projects/:projectId/visibility/history/series
GET  /api/v1/projects/:projectId/visibility/history/comparisons
GET  /api/v1/projects/:projectId/visibility/history/comparisons/:comparisonId
GET  /api/v1/projects/:projectId/visibility/history/alerts
GET  /api/v1/projects/:projectId/visibility/history/alert-rules
POST /api/v1/projects/:projectId/visibility/history/alert-rules
PATCH /api/v1/projects/:projectId/visibility/history/alert-rules/:ruleId
POST /api/v1/projects/:projectId/visibility/history/alerts/:alertId/acknowledge
```

`series` query requires metricType, dimensionType, dimensionKey, actorKey and bounded `limit` 1..180. Ratios serialize only for CALCULATED denominator>0; otherwise `ratio=null`. Comparison delta serializes null for nonnumeric states.

- [ ] **Step 1: RED API tests** for strict Zod validation, default/max bounds, Advanced/Enterprise success, Standard 403 before P6 repository calls, foreign IDs 404, safe payloads, null nonnumeric ratios/deltas, and acknowledgement isolation.
- [ ] **Step 2: Implement bounded serializers/routes** using project-scoped selects only.
- [ ] **Step 3: Mount routes in `src/app.ts`.**
- [ ] **Step 4: Verify focused tests + typecheck + full CI; squash merge.**

---

## Task 6: History / Alerts Web UI and AI Visibility Overview Upgrade

**Branch:** `feat/p6d-task-06-history-ui`

**Files:**
- Create: `src/modules/visibility/visibility-history.web.repository.ts`
- Create: `src/modules/visibility/visibility-history.web.routes.ts`
- Create: `src/views/visibility/history.ejs`
- Create: `src/views/visibility/alerts.ejs`
- Create: `tests/integration/visibility-history.web.test.ts`
- Create: `tests/e2e/visibility-history.spec.ts`
- Modify: `src/modules/visibility/visibility.web.repository.ts`
- Modify: `src/modules/visibility/visibility.web.routes.ts`
- Modify: `src/views/visibility/index.ejs`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/app.ts`

**UI contract:**

History page shows one metric series at a time plus compact Owned Mention/Citation/SOV and competitor SOV cards; nonnumeric points render explicit state labels and produce SVG gaps rather than `0`. All cards include exact current/previous windows and provenance.

Alerts page supports rule creation/update and acknowledgement through normal POST forms with redirect-after-post.

AI Visibility overview reads exactly one latest completed P6-C snapshot, its compatible comparison when available, Evidence Coverage, and open alert count. It must not merge rows from different snapshots.

- [ ] **Step 1: RED integration tests** for gating, bounded view model, zero-vs-UNKNOWN distinction, exact windows/provenance, rule/acknowledge forms, and no sampling side effects.
- [ ] **Step 2: RED Playwright** proving navigation, history gaps, alerts lifecycle, and overview links.
- [ ] **Step 3: Implement repository/routes/templates using existing visual system; no new chart dependency.**
- [ ] **Step 4: Verify focused + Chromium + full CI; squash merge.**

---

## Task 7: Real Project and Portfolio Dashboard Upgrade

**Branch:** `feat/p6d-task-07-dashboard`

**Files:**
- Modify: `src/web/view-models.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/views/dashboard.ejs`
- Modify: `src/views/projects/show.ejs`
- Create: `tests/integration/dashboard.real-data.test.ts`
- Modify/Create: `tests/e2e/dashboard.spec.ts`

**Interfaces:**

Create one bounded dashboard repository/helper surface rather than embedding unrestricted Prisma reads in EJS. The route resolves project plan first; Standard skips restricted P6 queries entirely.

Project view data includes:

```ts
{
  seoScore: number | null;
  geoScore: number | null;
  citability: { status: string; value: number | null } | null;
  criticalIssueCount: number;
  visibility: null | {
    snapshotId: string;
    mentionRate: SafeMetricValue;
    citationRate: SafeMetricValue;
    ownedSov: SafeMetricValue;
    openAlertCount: number;
  };
}
```

Portfolio never computes a cross-project average visibility ratio.

- [ ] **Step 1: RED integration tests** proving placeholders replaced with persisted fixture data and Standard causes zero restricted P6 repository calls.
- [ ] **Step 2: RED E2E** for an Advanced project with metrics and a Standard project without P6 leakage.
- [ ] **Step 3: Implement bounded latest-fact loaders and templates.**
- [ ] **Step 4: Verify full CI and squash merge.**

---

## Task 8: PROJECT_REPORT_V2 Integration

**Branch:** `feat/p6d-task-08-report-v2`

**Files:**
- Modify: `src/modules/reporting/report-builder.ts`
- Modify: `src/modules/reporting/report.routes.ts`
- Modify: `src/modules/reporting/report.web.repository.ts`
- Modify: `src/modules/reporting/report.web.routes.ts`
- Modify: `src/views/reports/show.ejs`
- Create: `tests/integration/reporting-v2.test.ts`
- Modify/Create: `tests/e2e/reporting.spec.ts`

**Interfaces:**

Preserve:

```ts
export const PROJECT_REPORT_VERSION = 'PROJECT_REPORT_V1';
```

for legacy compatibility, and add:

```ts
export const PROJECT_REPORT_V2_VERSION = 'PROJECT_REPORT_V2';
export async function generateProjectReportV2(projectId: string, ...): Promise<ReportSnapshot>;
```

V2 factSnapshot adds `visibility` only when project has P6 access and a completed P6-C snapshot exists. It contains safe Overall metrics, max 20 competitor SOV rows, Evidence Coverage, latest compatible comparison overall deltas, and alert severity counts.

- [ ] **Step 1: RED V1 regression tests** proving old V1 snapshots remain readable/renderable and their JSON is not rewritten.
- [ ] **Step 2: RED V2 tests** proving Standard builder performs no restricted P6 reads; Advanced V2 freezes one snapshot/comparison; no raw P6 private fields; max 20 competitors; no sampling/extraction/metric/AI invocation.
- [ ] **Step 3: Implement explicit V2 builder and version-aware read/render paths.**
- [ ] **Step 4: Verify integration + E2E + full CI; squash merge.**

---

## Task 9: Optional DeepSeek VISIBILITY_TREND_ANALYSIS

**Branch:** `feat/p6d-task-09-trend-ai`

**Files:**
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/<timestamp>_add_visibility_trend_ai_task/migration.sql`
- Create: `src/modules/ai/visibility-trend-analysis.ts`
- Modify: the current P4 versioned prompt/structured-output registry file(s) used by existing `AiTaskType` implementations.
- Create: `tests/integration/visibility-trend-analysis.test.ts`
- Modify: `src/modules/visibility/visibility-history.routes.ts` and/or web route to expose explicit user-triggered analysis action only after facts exist.

**Fact packet:**

```ts
{
  project: { id, name, primaryDomain, industry, defaultLanguage, targetCountry },
  current: { snapshotId, windowStart, windowEnd, metrics: [...] },
  previous: { snapshotId, windowStart, windowEnd, metrics: [...] },
  comparison: { comparisonId, deltas: [...] },
  evidenceCoverage: {...},
  alerts: [{ alertId, ruleType, severity, reasonCode, deltaBasisPoints, currentMetricStatus, previousMetricStatus }],
  sourceReferences: [...]
}
```

No prompt/answer/alias/canonical subject/citation URL/provider raw data/reasoning.

- [ ] **Step 1: RED enum/migration/task tests.**
- [ ] **Step 2: RED packet safety/source-reference validation tests.**
- [ ] **Step 3: Implement prompt + structured output through existing P4 gateway; never use P6 provider adapters.**
- [ ] **Step 4: Prove DeepSeek result persists only as advisory `AiAnalysisResult` and deterministic P6 tables remain unchanged.**
- [ ] **Step 5: Verify full CI and squash merge.**

---

## Task 10: Safe Observability, Operator Guide and Final P6 Release Gate

**Branch:** `feat/p6d-task-10-release-gate`

**Files:**
- Create: `src/modules/visibility/visibility-history.observability.ts`
- Create: `tests/integration/visibility-history.observability.test.ts`
- Create: `docs/development/p6d-history-dashboard-alerts-report.md`
- Modify: monitoring/history/alerts/report integration points only as required to emit safe lifecycle events.
- Modify: `README.md` only after the pre-README exact-head gate is fully green.

**Allowed events:**

```text
visibility.history.comparison.completed
visibility.history.comparison.incomparable
visibility.history.comparison.failed
visibility.alert.triggered
visibility.alert.acknowledged
visibility.alert.resolved
visibility.monitoring.reconcile.completed
report.v2.generated
```

**Allowed fields only:** projectId, currentSnapshotId, previousSnapshotId, comparisonId, ruleId, alertId, metricType, actorKey as internal bounded identifier, status, reasonCode, deltaBasisPoints, processedCount, enqueuedCount, alertCount, durationMs.

- [ ] **Step 1: RED serializer/event tests** proving all forbidden private fields are stripped.
- [ ] **Step 2: RED lifecycle tests** proving comparison success/no-predecessor/failure, alert trigger/ack/resolve, reconciliation and report V2 emit only after corresponding durable state succeeds.
- [ ] **Step 3: Implement safe allowlist observability and operator guide.**
- [ ] **Step 4: Run pre-README exact-head gate**:

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

Also perform static boundary review for zero provider/network history/report generation, Standard access isolation, no fabricated zeros, P6-C completion survival on monitoring enqueue failure, V1/V2 report compatibility, and advisory-only trend AI.

- [ ] **Step 5: Only after Step 4 is green, update README** to:

```text
P6-D History, Dashboard, Alerts & Report Integration — complete
P6 AI Visibility Advanced Module — complete
```

- [ ] **Step 6: Run a fresh final-head full CI** with the same three GitHub jobs (`verify`, Chromium `e2e`, `production-audit`) all successful on the exact README head.
- [ ] **Step 7: Scope-review, mark PR Ready, squash merge with expected head SHA, then verify `main` contains the completion markers and operator guide.**
- [ ] **Step 8: Produce final P6-A–P6-D archival DOCX** with architecture, data lineage, formulas, PR/CI/merge evidence and final main SHA.

---

## Plan Self-Review Checklist

Before executing Task 1, confirm this plan covers every spec area:

- comparison compatibility/delta semantics — Task 1;
- comparison persistence — Task 2;
- materialization/monitoring/reconciliation/P6-C handoff — Task 3;
- alert rules/events/lifecycle — Task 4;
- REST — Task 5;
- History/Alerts/P6 overview UI — Task 6;
- project/portfolio real dashboard — Task 7;
- PROJECT_REPORT_V2 — Task 8;
- optional DeepSeek trend analysis — Task 9;
- safe observability/operator guide/two-stage final release — Task 10.

No task may broaden P6-D into consumer UI automation, external alert delivery, OLAP, new metric formulas, or provider-backed report rendering.
