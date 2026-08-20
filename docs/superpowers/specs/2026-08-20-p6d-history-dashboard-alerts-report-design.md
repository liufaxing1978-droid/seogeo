# P6-D History, Dashboard, Alerts & Report Integration — Design

Date: 2026-08-20
Status: Approved direction in chat; written-spec review pending
Repository: `liufaxing1978-droid/seogeo`
Base: P6-C complete on `main`

## 1. Goal

Complete the P6 AI Visibility product loop by turning immutable P6-C metric snapshots into auditable history, deterministic period comparisons, actionable in-app alerts, real project/dashboard surfaces, report snapshots, and optional DeepSeek trend explanation.

P6-D must **consume** authoritative facts from P6-A/P6-B/P6-C. It must not re-sample providers, re-extract mentions/citations, or silently recompute P6-C formulas during dashboard/report rendering.

The end-to-end boundary remains:

```text
P6-A official API observations
  -> P6-B deterministic Mention/Citation facts
  -> P6-C immutable metric snapshots
  -> P6-D immutable comparisons / history / alerts / report references
  -> optional P4 DeepSeek advisory explanation
```

## 2. Chosen approach

Use **immutable history + deterministic comparison materialization + rule-based alerts + report snapshot integration**.

Rejected alternatives:

1. **Query-time-only trend calculation** — simpler initially, but historical interpretation would depend on current query code and would be harder to audit or alert from reliably.
2. **Full analytics/OLAP cube** — too large for the current product and would duplicate P6-C calculation responsibilities.

P6-D stores comparison/delta facts that reference two already-completed P6-C snapshots. It never mutates either source snapshot.

## 3. Non-goals

P6-D does not:

- call OpenAI, Gemini, Perplexity, Anthropic, DeepSeek web grounding, or any external search/citation URL as part of authoritative history/comparison/report generation;
- change P6-A observation semantics;
- change P6-B Mention/Citation extraction semantics;
- change `VISIBILITY_METRICS_V1` formulas;
- treat `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE`, or `NO_SIGNAL` as zero;
- compute percentage-change claims from incompatible snapshots;
- automate consumer-product browser accounts or sessions;
- send email, Slack, SMS, WeChat, or other external notifications in V1;
- build a general-purpose BI/OLAP warehouse.

The P6-D V1 notification channel is an **in-app alert inbox**. External delivery can be a later extension over the same AlertEvent trigger facts.

## 4. Source-of-truth boundary

Authoritative P6-D inputs are limited to persisted project-scoped data:

- completed `VisibilityMetricSnapshot` rows;
- `VisibilityMetricRow` rows belonging to those snapshots;
- snapshot provenance and coverage counts;
- deterministic project plan/feature state;
- existing persisted P1-P5 facts when building dashboard/report sections;
- already-persisted P6-D comparison and alert facts.

P6-D must not read raw P6-A answer text, raw prompt text, provider bodies, reasoning, aliases, citation bodies, or subject snapshot JSON for normal history/dashboard/report rendering.

A P6-D numeric delta is a derived fact over two immutable P6-C ratios. P6-C remains the authority for the underlying numerator/denominator/status.

## 5. Comparison compatibility contract

A numeric comparison is allowed only when both snapshots:

- belong to the same `projectId`;
- have `status=COMPLETED`;
- have the same `formulaVersion`;
- have the same `extractorVersion`;
- have the same `subjectSetHash`;
- have the same `scopeHash`;
- have equal measurement-window duration;
- do not overlap in measurement time.

The normal automatic selector chooses the nearest earlier compatible completed snapshot whose `windowEnd <= current.windowStart`.

A gap between the two windows is allowed, but the comparison records `gapDurationMs`. The UI must display the two exact date ranges and must not label a gapped comparison as “week-over-week” or another contiguous-period claim.

If no compatible predecessor exists, the service returns an explicit `NO_COMPATIBLE_PREVIOUS` state and emits safe observability. It does **not** persist a fake comparison row and does not create a zero delta.

### 5.1 Row identity

Rows are matched by the existing P6-C identity:

```text
metricType + dimensionType + dimensionKey + actorKey
```

Because `subjectSetHash` is equal, the monitored actor registry should be stable. A missing expected row nevertheless fails closed for that row and produces no numeric delta.

### 5.2 Numeric delta semantics

A ratio is numeric only when the P6-C row has:

- `metricStatus=CALCULATED`;
- `denominator > 0`.

If both current and previous rows satisfy that rule:

```text
currentRatio = currentNumerator / currentDenominator
previousRatio = previousNumerator / previousDenominator
deltaBasisPoints = round((currentRatio - previousRatio) * 10000)
```

`deltaBasisPoints` is an **absolute percentage-point delta** represented in basis points. P6-D does not publish multiplicative “percentage growth” because changing denominators can make that misleading.

Example:

```text
previous 20% -> current 25% => +500 bp = +5.0 percentage points
```

The comparison row also freezes both source numerators and denominators so the change remains auditable.

### 5.3 Non-numeric state transitions

If either side is not numeric, `deltaBasisPoints=null`.

P6-D still persists/returns the source statuses so the UI can show transitions such as:

- `CALCULATED -> UNKNOWN`;
- `NO_SIGNAL -> CALCULATED`;
- `CALCULATED -> NO_DATA`.

These are state transitions, not zero-valued deltas.

## 6. Persistence design

Create a dedicated P6-D Prisma model file:

```text
prisma/models/visibility-history.prisma
```

### 6.1 VisibilityMetricComparison

A row exists only for a successfully materialized compatible pair. Incompatible/no-predecessor states are returned/logged rather than stored as fake comparison objects.

Fields:

- `id`
- `projectId`
- `comparisonVersion` — initial `VISIBILITY_COMPARISON_V1`
- `currentSnapshotId`
- `previousSnapshotId`
- `windowDurationMs`
- `gapDurationMs`
- `createdAt`

Uniqueness:

```text
(projectId, comparisonVersion, currentSnapshotId, previousSnapshotId)
```

Both snapshot foreign keys use restrictive semantics: deleting P6-D data must never delete or cascade into P6-C source snapshots.

### 6.2 VisibilityMetricDeltaRow

One immutable row-level comparison.

Fields:

- `id`
- `visibilityMetricComparisonId`
- `projectId`
- `metricType`
- `dimensionType`
- `dimensionKey`
- `actorType`
- `actorSubjectId?`
- `actorKey`
- `previousMetricStatus`
- `currentMetricStatus`
- `previousNumerator`
- `previousDenominator`
- `currentNumerator`
- `currentDenominator`
- `deltaBasisPoints?`
- `createdAt`

Uniqueness:

```text
(comparisonId, metricType, dimensionType, dimensionKey, actorKey)
```

Comparison and all delta rows are written transactionally. A failure leaves no partial completed comparison.

### 6.3 VisibilityAlertRule

Project-owned deterministic alert configuration.

V1 rule types:

- `OWNED_MENTION_RATE_DROP`
- `OWNED_CITATION_RATE_DROP`
- `OWNED_SOV_DROP`
- `COMPETITOR_SOV_RISE`
- `EVIDENCE_COVERAGE_DROP`
- `METRIC_BECAME_UNKNOWN`

Fields:

- `id`
- `projectId`
- `ruleType`
- `name`
- `enabled`
- `severity`: `INFO | WARNING | CRITICAL`
- `thresholdBasisPoints?`
- `actorSubjectId?` — optional for “any competitor”; required when one competitor is targeted
- timestamps

V1 numeric alert rules evaluate the `OVERALL` dimension only. Provider/Prompt-Set-specific alert rules are deferred to avoid alert storms and configuration complexity.

A project may have at most 50 active alert rules.

### 6.4 VisibilityAlertEvent

Trigger evidence is immutable; only inbox lifecycle state/timestamps may change.

Fields:

- `id`
- `projectId`
- `alertRuleId`
- `comparisonId`
- `actorKey?`
- `eventFingerprint`
- `status`: `OPEN | ACKNOWLEDGED | RESOLVED`
- `severity`
- `reasonCode`
- `deltaBasisPoints?`
- `previousMetricStatus?`
- `currentMetricStatus?`
- `triggeredAt`
- `acknowledgedAt?`
- `resolvedAt?`
- `createdAt`
- `updatedAt`

`eventFingerprint` is deterministic over rule/comparison/actor identity and unique, preventing duplicate inbox events from duplicate jobs.

`reasonCode`, source comparison, actor identity, delta/status transition and `triggeredAt` never change after creation. Acknowledge/resolve actions may update only lifecycle state and timestamps.

Resolution is deterministic: when the next compatible comparison for the same rule/actor no longer satisfies the rule, the latest open/acknowledged event may transition to `RESOLVED`. Trigger evidence is never deleted.

## 7. Evidence coverage comparison

P6-D exposes one operational coverage ratio derived from P6-C snapshot coverage counts:

```text
coverageRatio = completedExtractionCount / candidateObservationCount
```

It is numeric only when `candidateObservationCount > 0`.

`EVIDENCE_COVERAGE_DROP` uses the absolute basis-point change in this ratio. This operational coverage ratio is not a replacement for P6-C per-metric/per-dimension eligibility counts and must be labeled “Evidence Coverage”.

## 8. Comparison materialization service

Introduce a pure comparison calculator and a persistence service.

```text
visibility-history.calculator.ts
  - compatibility checks
  - row matching
  - ratio / delta computation
  - state-transition output

visibility-history.repository.ts
  - bounded project-scoped reads
  - immutable comparison persistence
  - idempotent lookup/create

visibility-history.service.ts
  - predecessor selection
  - transactional comparison materialization
  - alert evaluation handoff
```

The pure calculator must have no Prisma, BullMQ, provider, DeepSeek, or network dependency.

## 9. Monitoring queue and reliability

Add a zero-network BullMQ queue:

```text
visibility-monitoring
```

Jobs:

```text
evaluate-snapshot
reconcile-history
```

### 9.1 evaluate-snapshot

Input contains only project ID and completed P6-C snapshot ID.

Behavior:

1. validate same-project completed snapshot;
2. select nearest compatible predecessor;
3. if none exists, finish as a normal no-comparison state;
4. otherwise materialize or reuse the immutable comparison;
5. evaluate enabled alert rules;
6. persist idempotent alert events/resolutions;
7. emit safe lifecycle observability.

Attempts: `2` because the job is database-only and creates no paid provider request.

Deterministic job ID:

```text
visibility-monitoring-<sha256(projectId:snapshotId)>
```

### 9.2 P6-C completion integration

After P6-C has atomically completed an immutable snapshot, it may enqueue one `evaluate-snapshot` job.

A monitoring-queue insertion failure must **not** roll back or mark the already-valid P6-C snapshot failed. P6-C truth remains complete. The failure is observable and recoverable by reconciliation.

### 9.3 reconcile-history

A bounded recurring reconciliation job catches completed snapshots that have no comparison work because of prior queue/infrastructure failure.

V1 uses one global hourly reconciliation schedule. It is not a user-facing notification schedule.

Hard bounds per sweep:

- max 100 projects;
- max 100 unprocessed completed snapshots total;
- enqueue only deterministic `evaluate-snapshot` jobs.

The sweep never calls providers or DeepSeek.

## 10. Alert evaluation semantics

Numeric rules trigger only when the comparison row is numeric on both sides.

```text
OWNED_MENTION_RATE_DROP:
  actorKey = OWNED_ROLLUP
  metricType = MENTION_RATE
  deltaBasisPoints <= -threshold

OWNED_CITATION_RATE_DROP:
  actorKey = OWNED_ROLLUP
  metricType = CITATION_RATE
  deltaBasisPoints <= -threshold

OWNED_SOV_DROP:
  actorKey = OWNED_ROLLUP
  metricType = MENTION_SHARE_OF_VOICE
  deltaBasisPoints <= -threshold

COMPETITOR_SOV_RISE:
  actorType = COMPETITOR
  metricType = MENTION_SHARE_OF_VOICE
  deltaBasisPoints >= threshold
```

`METRIC_BECAME_UNKNOWN` is state-based, not numeric. It triggers when an applicable monitored row moves from a non-UNKNOWN state to `UNKNOWN`.

No alert rule treats `NO_DATA`, `NO_SIGNAL`, `NOT_ELIGIBLE`, or `UNKNOWN` as zero.

## 11. History REST API

Base:

```text
/api/v1/projects/:projectId/visibility/history
```

V1 surface:

- `GET /snapshots` — bounded completed P6-C snapshot summaries;
- `GET /series` — one bounded metric/dimension/actor time series;
- `GET /comparisons` — bounded comparison summaries;
- `GET /comparisons/:comparisonId` — comparison + safe delta rows;
- `GET /alerts` — bounded in-app alert inbox;
- `GET /alert-rules` — project rules;
- `POST /alert-rules` — create rule;
- `PATCH /alert-rules/:ruleId` — update enabled/name/severity/threshold;
- `POST /alerts/:alertId/acknowledge` — acknowledge one event.

Hard bounds:

- history snapshots default 30, max 180;
- time-series points default 30, max 180;
- comparisons default 25, max 100;
- alert inbox default 25, max 100;
- alert rules max 50 active/project.

All reads are project-scoped and exclude private P6-A/P6-B content.

## 12. History Web UI

Add:

```text
/projects/:id/visibility/history
/projects/:id/visibility/alerts
```

### 12.1 History page

Show:

- Owned Mention Rate history;
- Owned Citation Rate history;
- Owned Mention SOV history;
- configured competitor SOV history;
- Evidence Coverage history;
- current vs previous compatible-period delta;
- exact current/previous date windows;
- formula/extractor/subject-set/scope provenance;
- status transitions and no-comparison reasons.

Series gaps remain gaps. `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE`, and `NO_SIGNAL` must not be plotted at 0%.

Use server-rendered data and lightweight inline SVG/HTML. Do not add a heavy charting dependency for P6-D V1.

### 12.2 Alerts page

Show:

- open / acknowledged / resolved events;
- deterministic rule reason;
- exact metric/status transition or delta;
- source comparison and date windows;
- rule configuration form;
- acknowledgement action.

No external notification delivery is claimed.

## 13. AI Visibility overview upgrade

Upgrade `/projects/:id/visibility` from sampling-core-only overview to a real P6 overview while preserving P6-A sampling configuration/run access.

For Advanced/Enterprise projects, show from one latest completed P6-C snapshot:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned Mention SOV;
- Evidence Coverage;
- latest compatible delta when available;
- latest sampling time / metric cutoff;
- provider coverage summary;
- open alert count.

The page must never merge rows across different P6-C snapshots/contracts.

## 14. Project and portfolio dashboard upgrade

The repository still contains early placeholder `-- / 等待数据 / 等待 P6` cards. P6-D replaces those placeholders with real persisted facts.

### 14.1 Project overview `/projects/:id`

Use bounded repository reads for:

- latest SEO Score;
- latest GEO Score;
- latest Citability summary when available;
- latest P6-C Owned Mention Rate / Citation Rate / SOV for Advanced/Enterprise;
- Critical Issues count;
- recent alerts for Advanced/Enterprise.

A Standard project must not perform restricted P6 reads.

### 14.2 Portfolio dashboard `/`

Do not invent a cross-project “average AI Visibility” ratio.

Instead show bounded portfolio facts such as:

- active project count;
- project cards with latest SEO/GEO facts;
- for Advanced/Enterprise project cards, latest P6 metric status/value when available;
- projects with open critical SEO issues;
- projects with open P6 alerts.

This keeps ratios attached to their own project/sample contract.

## 15. Feature gates

Reuse existing gates rather than inventing a new plan tier.

- P6 history, comparisons, alerts and P6 dashboard details require `COMPETITOR_SOV`, matching the P6-C Advanced/Enterprise boundary.
- Sampling controls retain `AI_VISIBILITY` / `PROMPT_MONITOR` boundaries.
- Optional trend AI requires both `AI_ANALYSIS` and P6 visibility access.
- Base P5 reporting remains `REPORTING`.

For Standard projects, `PROJECT_REPORT_V2` may still be generated as a base report, but its P6 visibility section is absent/not-applicable and the report builder must not perform restricted P6 reads.

## 16. Report integration — PROJECT_REPORT_V2

Do not mutate historical `PROJECT_REPORT_V1` snapshots.

Introduce:

```text
PROJECT_REPORT_V2
```

The V2 builder continues to snapshot P1-P5 facts and additionally freezes a **safe P6 summary** when the project has P6 access and completed P6-C evidence.

P6 V2 fact section contains at most:

- latest completed metric snapshot ID and provenance;
- Overall Owned Mention Rate;
- Overall Owned Citation Rate;
- Overall Owned Mention SOV;
- Overall competitor SOV rows, capped at 20 actors;
- Evidence Coverage counts/ratio;
- latest compatible comparison ID and Overall delta rows;
- open-alert counts by severity.

It does not include raw prompt/answer text, subjectSnapshotJson, aliases, citation URLs/bodies, provider raw data, or reasoning.

Report generation is database-only. It never triggers P6 sampling, P6-B extraction, P6-C metric creation, or DeepSeek automatically.

Existing report pages must render both V1 and V2 safely.

## 17. Optional DeepSeek Visibility Trend Analysis

Add a new advisory AI task type:

```text
VISIBILITY_TREND_ANALYSIS
```

It uses the existing P4 AI Gateway, not a P6 provider adapter.

The fact packet is bounded and may include only:

- safe project identity fields;
- current/previous P6-C snapshot IDs and date ranges;
- safe Overall metric statuses/numerators/denominators;
- P6-D delta rows;
- Evidence Coverage summary;
- bounded alert summaries;
- source reference IDs.

It must not include raw prompts, answer bodies, subject aliases/canonical values, citation URLs/bodies, provider raw bodies, or reasoning.

The output is advisory narrative only. It cannot modify P6 facts, comparison rows, alert events, or report factSnapshot.

The History page may expose an explicit user action to create this analysis after deterministic facts already exist.

## 18. Safe observability

Allowed P6-D operational events:

- `visibility.history.comparison.completed`
- `visibility.history.comparison.incomparable`
- `visibility.history.comparison.failed`
- `visibility.alert.triggered`
- `visibility.alert.acknowledged`
- `visibility.alert.resolved`
- `visibility.monitoring.reconcile.completed`
- `report.v2.generated`

Allowlisted fields only:

- projectId;
- current/previous snapshot IDs;
- comparisonId when one exists;
- ruleId / alertId;
- metricType;
- actorKey where it is an internal bounded actor identifier, not a private alias;
- status / reasonCode;
- deltaBasisPoints;
- processed/enqueued/alert counts;
- durationMs.

Never log raw Prompt/Answer content, aliases, canonical subject values, citation URLs, provider bodies, API keys, cookies, subject snapshot JSON, full metric row bodies, report JSON, or AI reasoning.

## 19. Hard limits and performance

P6-D V1 hard limits:

- maximum history series: 180 points;
- maximum comparison list: 100;
- maximum alert list: 100;
- maximum active alert rules: 50/project;
- maximum competitor rows embedded in PROJECT_REPORT_V2: 20;
- reconciliation sweep: max 100 projects / 100 unprocessed snapshots;
- comparison row materialization uses bounded batched DB writes;
- no unbounded JSON response or unbounded project history query.

Indexes must support project/time, comparison current/previous snapshot, alert project/status/time, and rule project/enabled lookups.

## 20. Migration and backward compatibility

P6-D adds new history/alert tables and one new AI task enum value. It does not rewrite existing P6-A/B/C rows.

Existing completed P6-C snapshots remain valid. A bounded backfill/reconcile pass may create P6-D comparisons from historical compatible snapshots without changing those snapshots.

Existing `PROJECT_REPORT_V1` rows remain immutable and readable. New report generation moves to `PROJECT_REPORT_V2` only after V2 tests are green.

## 21. Error handling

Stable comparison errors/reasons include:

- `VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND`
- `VISIBILITY_HISTORY_SNAPSHOT_NOT_COMPLETED`
- `VISIBILITY_HISTORY_NO_COMPATIBLE_PREVIOUS`
- `VISIBILITY_HISTORY_FORMULA_MISMATCH`
- `VISIBILITY_HISTORY_EXTRACTOR_MISMATCH`
- `VISIBILITY_HISTORY_SUBJECT_SET_MISMATCH`
- `VISIBILITY_HISTORY_SCOPE_MISMATCH`
- `VISIBILITY_HISTORY_WINDOW_MISMATCH`
- `VISIBILITY_HISTORY_WINDOW_OVERLAP`
- `VISIBILITY_HISTORY_ROW_MISSING`
- `VISIBILITY_HISTORY_PERSISTENCE_FAILED`

Alert/API errors must remain project-scoped and fail closed for foreign IDs.

A missing compatible predecessor is a normal “no comparison yet” state, not a false 0 delta.

## 22. Testing strategy

### Pure unit tests

- compatibility matrix;
- equal-window and non-overlap rules;
- nearest predecessor selection;
- CALCULATED ratio/delta basis points;
- state transitions with null numeric delta;
- actor/dimension row matching;
- Evidence Coverage delta;
- alert-rule evaluation;
- deterministic alert fingerprint.

### Persistence integration

- comparison/delta uniqueness;
- restrictive source snapshot references;
- transactional comparison row completion;
- project isolation;
- alert rule/event uniqueness and lifecycle;
- deleting P6-D data cannot delete P6-C source snapshots.

### Worker / queue integration

- deterministic monitoring job ID;
- attempts=2;
- duplicate delivery creates one comparison/event set;
- monitoring queue failure does not invalidate completed P6-C;
- reconciliation catches missing comparison work;
- no compatible predecessor is a normal terminal path;
- zero provider/network calls.

### REST integration

- Advanced/Enterprise allowed;
- Standard rejected before restricted P6 reads/writes;
- foreign IDs fail closed;
- bounded pagination;
- non-calculated states serialize with `ratio/delta=null`;
- alert acknowledgement is project-scoped.

### Web / Playwright

- history page renders real persisted values;
- UNKNOWN produces a gap/not 0%;
- alerts inbox and acknowledgement;
- project overview no longer displays P6 placeholders for Advanced fixture;
- Standard fixture performs no restricted P6 access;
- AI Visibility overview links to history/alerts;
- report V1 and V2 both render;
- no page visit triggers provider sampling.

### Reporting / AI

- PROJECT_REPORT_V2 generation is DB-only;
- V2 safe P6 section references one specific completed P6-C snapshot/comparison;
- raw P6 private content excluded;
- VISIBILITY_TREND_ANALYSIS fact packet is bounded and source-reference-validated;
- DeepSeek output remains advisory and cannot mutate deterministic facts.

## 23. Release gate

Before P6-D is marked complete, the exact release head must pass:

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

Static/evidence review must also prove:

- history/comparison/report generation makes zero provider/external-network calls;
- no dashboard/report page starts a visibility sampling run;
- incompatible contracts never receive a numeric delta;
- UNKNOWN/NO_DATA/NOT_ELIGIBLE/NO_SIGNAL never become zero;
- numeric deltas are absolute percentage-point deltas with source numerator/denominator retained;
- duplicate monitoring jobs do not duplicate comparisons or alert events;
- P6-C completion stays valid if P6-D enqueue fails;
- Standard projects do not read/write restricted P6-D resources;
- PROJECT_REPORT_V1 remains immutable/readable;
- PROJECT_REPORT_V2 does not trigger P6 sampling/extraction/metric materialization;
- optional DeepSeek trend analysis is advisory-only and uses persisted facts;
- observability excludes private P6 content and secrets;
- P1-P6-C regression coverage remains green.

As with P6-C, completion uses a two-stage documentation gate:

1. code/docs exact-head full CI green;
2. only then update README to mark P6-D / P6 complete;
3. run a fresh full CI on that final README head;
4. merge only after the final exact head is fully green.

## 24. Implementation decomposition

The implementation plan should split P6-D into isolated sequential tasks, each starting from fresh `main` after the prior task merges:

1. comparison calculator and compatibility contract;
2. P6-D comparison persistence;
3. history materialization + monitoring/reconciliation queue;
4. alert rules/events and evaluator;
5. History/Alerts REST API;
6. History/Alerts Web UI and AI Visibility overview upgrade;
7. project/portfolio real dashboard upgrade;
8. PROJECT_REPORT_V2 integration;
9. optional DeepSeek `VISIBILITY_TREND_ANALYSIS`;
10. safe P6-D observability/operator guide/final release gate.

## 25. Acceptance criteria

P6-D is complete when an Advanced/Enterprise project can:

1. retain multiple immutable P6-C metric snapshots;
2. see a history series without fabricated zero points;
3. compare only compatible measurement contracts;
4. inspect current/previous numerators, denominators, statuses and exact windows;
5. see deterministic Owned Mention Rate, Citation Rate and SOV deltas when numeric;
6. see competitor SOV history and deltas under the same subject-set contract;
7. receive deduplicated deterministic in-app alerts for configured changes;
8. acknowledge alerts and preserve immutable trigger evidence;
9. recover missed monitoring work through bounded reconciliation;
10. see real project/dashboard P6 facts rather than placeholders;
11. generate/read PROJECT_REPORT_V2 with frozen safe P6 facts and no live sampling;
12. optionally request DeepSeek narrative explanation of persisted trend facts;
13. verify that DeepSeek narrative cannot alter authoritative metrics/alerts/report facts;
14. preserve Standard-plan access boundaries;
15. pass the full exact-head release gate with P1-P6-C regressions green.

After final merge, README may mark:

```text
P6-D History, Dashboard, Alerts & Report Integration — complete
P6 AI Visibility Advanced Module — complete
```
