# P6-D History, Dashboard, Alerts & Report Integration — Operator Guide

P6-D completes the AI Visibility product loop on top of immutable P6-C metric snapshots. It is deliberately database-first: authoritative history, comparison, alert, dashboard, and report generation must not call external AI/search providers.

## 1. Source-of-truth boundary

The authoritative chain is:

```text
P6-A provider observations
  -> P6-B deterministic mention/citation extraction
  -> P6-C immutable metric snapshots and rows
  -> P6-D immutable comparisons, history, alerts and report facts
  -> optional P4 DeepSeek advisory trend explanation
```

P6-D consumes persisted facts only. Dashboard/history/report rendering must never start P6-A sampling, P6-B extraction, P6-C metric materialization, or automatic DeepSeek work.

## 2. History retention model

P6-D does not rewrite historical P6-C snapshots. A `VisibilityMetricComparison` references a current and previous completed snapshot and stores immutable row-level deltas. Deleting P6-D comparison data must never cascade into source P6-C snapshots.

Operational read bounds are intentionally finite:

- history snapshots / time-series points: max 180;
- comparison list: max 100;
- alert inbox: max 100;
- active alert rules: max 50 per project;
- reconciliation sweep: max 100 candidate snapshots;
- `PROJECT_REPORT_V2` competitor SOV rows: max 20.

These are application bounds, not instructions to delete older authoritative P6-C data. Any future archival or retention policy must preserve source snapshot provenance and must be designed separately.

## 3. Comparison compatibility

Numeric comparisons are permitted only when both snapshots are:

- from the same project;
- completed;
- on the same formula version;
- on the same extractor version;
- on the same subject-set hash;
- on the same scope hash;
- equal in measurement-window duration;
- non-overlapping in time.

The automatic selector uses the nearest earlier compatible snapshot with `previous.windowEnd <= current.windowStart`.

A time gap is allowed and is stored as `gapDurationMs`. A gapped comparison must be shown with its exact windows and must not be described as contiguous week-over-week growth.

If no compatible predecessor exists, the normal state is `NO_COMPATIBLE_PREVIOUS`. P6-D does not create a fake comparison or zero delta.

## 4. Delta and UNKNOWN semantics

`deltaBasisPoints` is an absolute percentage-point difference represented in basis points:

```text
deltaBasisPoints = round((currentRatio - previousRatio) * 10000)
```

For example, 20% -> 25% is `+500 bp`, meaning +5.0 percentage points.

A ratio is numeric only when `metricStatus=CALCULATED` and `denominator > 0`. The following states are never coerced to zero:

- `UNKNOWN`
- `NO_DATA`
- `NOT_ELIGIBLE`
- `NO_SIGNAL`

When either side is non-numeric, `deltaBasisPoints=null`. Preserve and display the state transition instead, for example `CALCULATED -> UNKNOWN`.

Evidence Coverage uses `completedExtractionCount / candidateObservationCount` only when the candidate count is greater than zero.

## 5. Alert lifecycle

P6-D V1 alerts are deterministic and in-app only. Do not claim email, Slack, SMS, WeChat, or other external delivery.

Supported rule types are:

- `OWNED_MENTION_RATE_DROP`
- `OWNED_CITATION_RATE_DROP`
- `OWNED_SOV_DROP`
- `COMPETITOR_SOV_RISE`
- `EVIDENCE_COVERAGE_DROP`
- `METRIC_BECAME_UNKNOWN`

Trigger evidence is immutable. The mutable lifecycle is:

```text
OPEN -> ACKNOWLEDGED -> RESOLVED
```

`reasonCode`, source comparison, actor identity, delta/status evidence, and `triggeredAt` are not rewritten after creation. Repeated evaluation of the same rule/comparison/actor is deduplicated by deterministic event fingerprint.

Resolution occurs when a later compatible comparison no longer satisfies the same rule/actor condition. Resolution does not delete the original trigger evidence.

## 6. Monitoring and reconciliation

The `visibility-monitoring` queue is database-only.

`evaluate-snapshot` runs after a completed P6-C metric snapshot is available. A queue insertion failure must not invalidate an already completed P6-C snapshot.

`reconcile-history` is the recovery path for missed monitoring handoffs. Each sweep is bounded and re-enqueues deterministic snapshot jobs. It must not call providers or DeepSeek.

Watch these safe lifecycle events:

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

Only allowlisted metadata may appear: internal IDs, status/reason codes, metric/actor identifiers, delta basis points, bounded counts, and duration.

Never log through P6-D observability:

- prompt text or raw answers;
- provider raw bodies;
- authorization headers, API keys, credentials or tokens;
- private aliases or canonical subject values;
- citation URLs or citation bodies;
- reasoning;
- `subjectSnapshotJson` or full scope payloads;
- full metric-row bodies;
- full report JSON.

## 7. Dashboard and access boundaries

AI Visibility history, comparison detail, alerts, and trend analysis are Advanced/Enterprise features. Standard requests must fail before restricted P6 repository reads or writes.

Portfolio views do not compute a synthetic cross-project AI Visibility average. Ratios remain attached to their project and sampling contract.

Dashboard rendering is read-only over persisted facts and must not create sampling, extraction, metric, comparison, AI, or alert work.

## 8. PROJECT_REPORT_V2

`PROJECT_REPORT_V1` remains readable and immutable. P6-D adds an explicit `PROJECT_REPORT_V2` generation path.

For projects with P6 access and a completed P6-C snapshot, V2 may freeze:

- safe Overall Mention Rate;
- safe Overall Citation Rate;
- safe Owned SOV;
- max 20 competitor SOV rows;
- Evidence Coverage;
- latest compatible comparison and bounded Overall deltas;
- open alert counts by severity.

V2 generation is database-only. It does not automatically trigger provider sampling, extraction, metric generation, comparison work, or DeepSeek.

`report.v2.generated` is emitted only after the `ReportSnapshot` has been successfully persisted. The event carries metadata only, never the report body.

## 9. Optional DeepSeek trend analysis

`VISIBILITY_TREND_ANALYSIS` is advisory. It uses the existing P4 DeepSeek gateway only after deterministic P6 facts exist and only on an explicit user-triggered action.

The input packet contains bounded safe facts such as project identity, current/previous safe metrics, comparison deltas, Evidence Coverage, alert summaries, and safe source references.

It must not contain prompt/answer text, aliases/canonical values, citation URLs, provider raw data, or reasoning.

The result persists only as an `AiAnalysisResult`. It must not mutate P6 snapshots, rows, comparisons, or alert evidence.

## 10. Rollout checklist

Before enabling P6-D in production:

1. apply all Prisma migrations;
2. verify worker bootstrap includes `visibility-monitoring`;
3. confirm Redis/BullMQ health;
4. confirm P6 feature gates for Standard vs Advanced/Enterprise;
5. run the full release gate;
6. inspect safe observability for unexpected payload fields;
7. generate one V2 report on a controlled Advanced fixture;
8. verify no external provider call occurs during history/dashboard/report generation.

Release gate:

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

## 11. Rollback guidance

Prefer application rollback before destructive database rollback.

Safe rollback sequence:

1. stop or disable the P6-D web/API exposure and monitoring worker deployment;
2. deploy the last known-good application revision;
3. leave immutable P6-C snapshots and already-written P6-D evidence intact;
4. do not delete source P6-C snapshots to remove P6-D comparisons;
5. if reconciliation caused load pressure, stop the reconciliation schedule first; deterministic jobs can be resumed later;
6. if optional trend analysis is problematic, disable the user-triggered path without changing deterministic P6 facts;
7. investigate with IDs/reason codes only—never copy private provider payloads into operational logs.

Schema down-migrations are not the default rollback mechanism. P6-D tables can remain unused while the application is rolled back, preserving evidence and avoiding accidental loss.

## 12. Incident triage

For a missing comparison:

- verify current snapshot is `COMPLETED`;
- check formula/extractor/subject-set/scope compatibility;
- check exact windows and non-overlap;
- inspect `visibility.history.comparison.incomparable` or `.failed` metadata;
- run/allow bounded reconciliation if the monitoring handoff was missed.

For an unexpected alert:

- inspect rule type/threshold/actor;
- inspect the referenced immutable comparison;
- verify both metric statuses before interpreting a numeric delta;
- remember that `UNKNOWN` is a state, not 0%.

For a report discrepancy:

- verify report version;
- inspect the frozen source references and snapshot ID;
- compare against the same persisted P6-C snapshot, not current live state;
- do not regenerate provider observations as part of report diagnosis.
