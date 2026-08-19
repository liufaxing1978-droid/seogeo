# P6-C Visibility Metrics & Competitor Share of Voice — Design

Date: 2026-08-19
Status: Approved in chat; pending written-spec review
Repository: `liufaxing1978-droid/seogeo`
Depends on: P6-A Prompt Monitor & Sampling Core, P6-B Citation & Mention Intelligence
Next phase: P6-D History, Dashboard, Alerts & Report Integration

## 1. Goal

P6-C converts immutable P6-B Mention/Citation facts into deterministic, auditable visibility metrics.

P6-C answers three measurement questions:

1. What share of eligible AI observations mention the owned project or a monitored competitor?
2. What share of eligible citation-grounded observations cite the owned project or a monitored competitor?
3. Among monitored market actors that are actually mentioned, what percentage of mention presence belongs to the owned project versus each monitored competitor?

P6-C delivers:

- Mention Rate;
- Citation Rate;
- Mention Share of Voice;
- immutable metric snapshots;
- overall, provider and Prompt Set breakdowns;
- deterministic coverage accounting;
- Advanced/Enterprise API and web surfaces;
- safe observability and release verification.

P6-C does not deliver:

- new provider sampling;
- DeepSeek/LLM metric calculation;
- citation URL fetching;
- consumer-product UI automation;
- semantic/fuzzy subject inference;
- weighted visibility scoring;
- ranking score synthesis;
- historical trend presentation;
- alerts;
- report integration.

Trend visualization, alerts and report integration remain P6-D responsibilities. P6-C only creates the immutable snapshot foundation those features may later consume.

## 2. Architectural decision

Three approaches were considered:

### Option A — live SQL metrics

Calculate metrics directly from P6-B facts at request time.

Advantages:

- small initial implementation;
- no metric snapshot storage.

Rejected because:

- historical values can change after late extraction/backfill;
- audit/replay is weaker;
- API requests can become expensive and inconsistent;
- P6-D history would need to reconstruct changing past states.

### Option B — immutable metric snapshots

Materialize deterministic metric snapshots over an explicit time window, input cutoff, extractor version, subject-set hash and calculation scope.

Advantages:

- replayable and auditable;
- stable historical values;
- late backfill cannot mutate an old result;
- simple downstream reads;
- clean foundation for P6-D.

This is the approved P6-C design.

### Option C — pre-aggregated analytics cube

Maintain multi-dimensional provider/prompt/time/subject rollups continuously.

Rejected for P6-C because it is unnecessary operational complexity at the current project scale. Provider × Prompt Set cross-cubes, OLAP infrastructure and generalized analytics dimensions are deliberately deferred.

## 3. Truth boundary

P6-C authoritative metrics may be derived only from persisted P6-A and P6-B data.

Allowed inputs:

- `PlatformObservation` identity, provider, Prompt Set relationship, timestamps and source status;
- completed `VisibilityExtraction` rows;
- P6-B `mentionStatus` and `citationStatus`;
- P6-B `MentionObservation` facts;
- P6-B `CitationObservation` facts;
- the exact P6-B `subjectSetHash`, `extractorVersion` and subject snapshot used by the source extraction.

Forbidden inputs for authoritative P6-C calculations:

- live provider API calls;
- P4 AI Gateway;
- DeepSeek;
- embeddings;
- fuzzy matching;
- generated prose interpretation;
- external URL fetches;
- search engines;
- consumer ChatGPT/Gemini/Perplexity/Claude UI automation;
- current subject configuration applied retroactively to old extraction facts.

The metric calculator is deterministic and database-only.

## 4. Version and subject-set isolation

P6-C must never mix facts across different measurement contracts.

One metric snapshot uses exactly one:

- `extractorVersion`;
- `subjectSetHash`;
- `formulaVersion`;
- scope definition;
- half-open observation window `[windowStart, windowEnd)`;
- `inputCutoffAt`.

If subject configuration changes, P6-B produces a new `subjectSetHash`. P6-C must create a new snapshot identity. It must not reinterpret old facts with the new subject registry.

If the P6-B extractor changes, P6-C must not combine facts from multiple extractor versions inside one snapshot.

Initial P6-C formula version:

`VISIBILITY_METRICS_V1`

## 5. Observation window and cutoff semantics

P6-C time filtering uses `PlatformObservation.observedAt`.

Window semantics are half-open:

`windowStart <= observedAt < windowEnd`

All persisted timestamps are compared in UTC. Project timezone is a display/default-window concern only; it does not change stored snapshot timestamps.

`inputCutoffAt` makes snapshot history immutable.

A candidate observation is visible to the materializer only when the source observation existed by the cutoff. A P6-B extraction is usable only when its completed authoritative state existed by the cutoff.

Late P6-B backfill after `inputCutoffAt` never mutates an existing metric snapshot. A user may explicitly generate a new snapshot with a later cutoff.

## 6. Candidate observation set

For one snapshot, candidate observations are project-scoped `PlatformObservation` records that:

- fall inside `[windowStart, windowEnd)`;
- match the snapshot scope;
- existed by `inputCutoffAt`;
- can be associated with the requested P6-B `extractorVersion` and `subjectSetHash` measurement contract.

Scope V1 may restrict:

- provider allowlist;
- Prompt Set allowlist.

If no filter is supplied, all project providers and Prompt Sets represented in the time window are included.

The canonical scope is sorted and serialized into `scopeJson`; `scopeHash` is the SHA-256 of that stable representation.

## 7. Market actor model

P6-C top-line metrics use market actors rather than counting every owned alias/subject separately.

### Owned actor

All active owned subject types present in the P6-B subject snapshot roll up into one actor:

- `OWNED_BRAND`;
- `OWNED_DOMAIN`;
- `OWNED_ENTITY`.

Stable actor key:

`OWNED_ROLLUP`

For one source observation, any number of owned subject/alias matches still create at most one owned presence unit.

### Competitor actor

Each monitored `COMPETITOR` subject is a separate market actor.

Stable actor key:

`COMPETITOR:<subjectId>`

For one source observation, repeated aliases, repeated mention occurrences and repeated mention rows for the same competitor still create at most one competitor presence unit.

### Why presence rather than occurrence count

Share of Voice V1 intentionally uses observation-level presence, not raw word frequency.

This prevents:

- one answer repeating a brand name many times from dominating SOV;
- multiple owned aliases from inflating owned visibility;
- verbose providers from receiving artificial weight.

Occurrence counts remain available in P6-B facts but are not authoritative SOV weights in P6-C V1.

## 8. Mention Rate

For actor `A` in dimension `D`:

`Mention Rate(A,D) = mentionedEligibleObservations(A,D) / mentionEligibleObservations(D)`

### Denominator eligibility

An observation enters the Mention Rate denominator only when the matching P6-B extraction has:

- `mentionStatus = EXTRACTED`, or
- `mentionStatus = KNOWN_EMPTY`.

These are the only states that positively establish a complete deterministic mention scan.

Excluded from denominator:

- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- missing matching extraction;
- failed/incomplete metric input identity.

### Numerator

The numerator is the number of distinct eligible source observations in which actor `A` is present.

Owned actor presence is true when any owned subject has at least one P6-B `MentionObservation` in that extraction.

Competitor actor presence is true when that competitor subject has at least one P6-B `MentionObservation` in that extraction.

Multiple aliases or multiple occurrences in the same answer count once.

### Legitimate zero

If the denominator is positive, coverage is complete, and actor `A` appears in zero eligible observations:

- metric status is `CALCULATED`;
- numerator is `0`;
- the displayed rate is exactly `0%`.

A legitimate zero must never be represented as `UNKNOWN`.

## 9. Citation Rate

For actor `A` in dimension `D`:

`Citation Rate(A,D) = citedEligibleObservations(A,D) / citationEligibleObservations(D)`

### Denominator eligibility

An observation enters the Citation Rate denominator only when the matching P6-B extraction has:

- `citationStatus = EXTRACTED`, or
- `citationStatus = KNOWN_EMPTY`.

Excluded from denominator:

- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- missing matching extraction;
- failed/incomplete metric input identity.

### Numerator

The numerator is the number of distinct citation-eligible source observations containing at least one deterministically attributed citation for actor `A`.

Owned actor citation presence is true when a P6-B `CitationObservation` is deterministically linked as owned through its persisted owned classification.

Competitor citation presence is true when a P6-B `CitationObservation` is deterministically linked to that competitor subject/competitor provenance.

Repeated citations to the same actor inside one source observation count once for Citation Rate.

P6-C never re-parses or fetches a citation URL to change attribution.

## 10. Mention Share of Voice

P6-C V1 uses presence-based Mention Share of Voice.

For actor `A` in dimension `D`:

`Mention SOV(A,D) = actorPresenceUnits(A,D) / totalActorPresenceUnits(D)`

For each mention-eligible observation:

1. create `OWNED_ROLLUP` presence if any owned subject was mentioned;
2. create one presence unit for each distinct competitor subject mentioned;
3. do not count repeated occurrences or aliases more than once per actor per observation.

Example:

- answer 1 mentions owned + competitor A;
- answer 2 mentions owned + competitor A + competitor B;
- answer 3 mentions competitor B.

Presence units:

- owned = 2;
- competitor A = 2;
- competitor B = 2;
- total = 6.

Each actor SOV = `2 / 6 = 33.333...%`.

When SOV is calculable, the stored numerators across all market actors for the same dimension must sum exactly to the stored denominator. UI percentage rounding may make displayed values differ from exactly 100.00%; the integer-unit invariant is authoritative.

### No-signal case

If mention coverage is complete, at least one mention-eligible observation exists, but no monitored actor appears anywhere, then total actor-presence units are zero.

SOV is not `0%` for every actor because there is no market signal denominator.

The metric status is `NO_SIGNAL`.

## 11. Metric status model

P6-C introduces explicit metric states:

- `CALCULATED`
- `NO_SIGNAL`
- `UNKNOWN`
- `NOT_ELIGIBLE`
- `NO_DATA`

### `CALCULATED`

Use when:

- at least one eligible denominator observation exists;
- no candidate input is unknown/missing for the requested measurement contract;
- the metric has a defined denominator.

Numerator may be zero.

### `NO_SIGNAL`

Used by SOV only when:

- mention coverage is complete;
- at least one mention-eligible observation exists;
- total actor presence is zero.

### `UNKNOWN`

Use when any candidate observation that is relevant to the requested scope lacks a trustworthy completed P6-B state for the metric being calculated, including:

- P6-B evidence status `UNKNOWN`;
- missing required extraction for the requested `extractorVersion + subjectSetHash`;
- failed extraction/materialization identity at the cutoff;
- inconsistent P6-B fact rows.

P6-C V1 is deliberately strict: it does not publish a percentage when the selected measurement set contains unknown required inputs.

Coverage counts are still persisted so the UI can explain why the metric is unknown.

### `NOT_ELIGIBLE`

Use when:

- candidate observations exist;
- none are eligible for the metric;
- every candidate has an explicit `NOT_ELIGIBLE` P6-B evidence state;
- there are no unknown/missing required inputs.

### `NO_DATA`

Use when the selected time window and scope contain zero candidate P6-A observations.

## 12. Mixed eligible and explicit NOT_ELIGIBLE inputs

Explicit `NOT_ELIGIBLE` observations do not invalidate an otherwise complete metric.

Example:

- 10 candidate observations;
- 6 `EXTRACTED/KNOWN_EMPTY`;
- 4 explicit `NOT_ELIGIBLE`;
- 0 `UNKNOWN`/missing.

The metric may be `CALCULATED` with denominator `6`.

The snapshot stores all coverage counts so users can see that only 6/10 candidates were metric-eligible.

`NOT_ELIGIBLE` is never converted to zero and never enters the denominator.

## 13. Dimensions

P6-C V1 materializes three dimension levels:

### Overall

- `dimensionType = OVERALL`
- `dimensionKey = null`

### Provider

- `dimensionType = PROVIDER`
- one row group per represented `VisibilityProvider`.

### Prompt Set

- `dimensionType = PROMPT_SET`
- one row group per represented `VisibilityPromptSet.id`.

The Prompt Set relationship is resolved through the immutable observation prompt/run relationships. P6-C does not read or log prompt text to calculate a metric.

P6-C V1 deliberately does not materialize Provider × Prompt Set cross-product rows.

## 14. Metric precision

The database stores authoritative integer numerator/denominator counts.

Percentages are derived from those counts for API/UI responses.

Do not store rounded percentage as the only truth.

Recommended API percentage precision:

- decimal ratio rounded for presentation to four decimal places or equivalent basis-point precision;
- UI may display 1–2 decimal places.

For SOV, integer presence-unit sums are the invariant used for correctness tests.

## 15. Data model

### Enum: `VisibilityMetricType`

- `MENTION_RATE`
- `CITATION_RATE`
- `MENTION_SHARE_OF_VOICE`

### Enum: `VisibilityMetricStatus`

- `CALCULATED`
- `NO_SIGNAL`
- `UNKNOWN`
- `NOT_ELIGIBLE`
- `NO_DATA`

### Enum: `VisibilityMetricDimensionType`

- `OVERALL`
- `PROVIDER`
- `PROMPT_SET`

### Enum: `VisibilityMetricActorType`

- `OWNED_ROLLUP`
- `COMPETITOR`

### `VisibilityMetricSnapshot`

Fields:

- `id` UUID
- `projectId` UUID
- `formulaVersion` string
- `extractorVersion` string
- `subjectSetHash` string
- `subjectSnapshotJson` JSON
- `windowStart` DateTime
- `windowEnd` DateTime
- `inputCutoffAt` DateTime
- `scopeJson` JSON
- `scopeHash` string
- `inputFingerprint` string
- `candidateObservationCount` Int
- `completedExtractionCount` Int
- `missingExtractionCount` Int
- `failedExtractionCount` Int
- `createdAt` DateTime

Rules:

- immutable after successful materialization;
- contains no prompt text, answer text, reasoning, provider raw body, API key or cookie;
- `subjectSnapshotJson` is copied from the exact P6-B measurement contract and is used for historical actor reconstruction;
- snapshot generation fails closed if matching extractions with the same `subjectSetHash` disagree on the canonical subject snapshot.

Recommended uniqueness:

`(projectId, formulaVersion, extractorVersion, subjectSetHash, windowStart, windowEnd, inputCutoffAt, scopeHash)`

### `VisibilityMetricRow`

Fields:

- `id` UUID
- `visibilityMetricSnapshotId` UUID
- `projectId` UUID
- `metricType` enum
- `metricStatus` enum
- `dimensionType` enum
- `dimensionKey` string nullable
- `dimensionLabelSnapshot` string nullable
- `actorType` enum
- `actorSubjectId` UUID nullable
- `actorKey` string
- `numerator` Int
- `denominator` Int
- `candidateObservationCount` Int
- `eligibleObservationCount` Int
- `notEligibleObservationCount` Int
- `unknownObservationCount` Int
- `createdAt` DateTime

Actor constraints:

- `OWNED_ROLLUP` has `actorSubjectId = null`, `actorKey = OWNED_ROLLUP`;
- `COMPETITOR` has `actorSubjectId = <P6-B competitor subjectId>` and `actorKey = COMPETITOR:<subjectId>`.

Recommended uniqueness:

`(visibilityMetricSnapshotId, metricType, dimensionType, dimensionKey, actorKey)`

Because PostgreSQL unique constraints treat nulls specially, implementation must normalize `OVERALL` to a stable non-null uniqueness key internally if required by Prisma/PostgreSQL constraints. The public API may still expose `dimensionKey = null` for Overall.

## 16. Input fingerprint

`inputFingerprint` makes the exact materialized evidence set auditable.

It is a deterministic hash over bounded, sorted non-sensitive metadata such as:

- source observation IDs;
- matching extraction IDs;
- P6-B evidence states;
- P6-B extraction completion identity;
- provider;
- Prompt Set ID.

It must not include:

- prompt text;
- answer text;
- alias strings;
- canonical subject values outside the already-approved bounded subject snapshot;
- citation page bodies;
- provider raw responses;
- reasoning;
- secrets.

The fingerprint is evidence identity, not a semantic score.

## 17. Materialization algorithm

For one metric snapshot request:

1. validate project and Advanced/Enterprise feature access before side effects;
2. normalize/validate `windowStart`, `windowEnd`, `inputCutoffAt` and optional scope filters;
3. select candidate P6-A observations in the half-open window and scope;
4. load matching P6-B extraction identity for the requested `extractorVersion + subjectSetHash` as-of cutoff;
5. verify subject snapshot consistency;
6. calculate candidate/completed/missing/failed coverage;
7. construct immutable normalized input records in memory;
8. run the pure deterministic metric calculator;
9. build Overall, Provider and Prompt Set rows;
10. verify invariants before persistence;
11. transactionally insert the immutable snapshot and all rows;
12. emit safe observability.

No provider/network dependency is available to the calculator or materialization worker.

## 18. Pure calculator contract

Introduce a pure module such as:

`visibility-metrics.calculator.ts`

It receives normalized records containing only fields required for aggregation:

- observation ID;
- provider;
- Prompt Set ID;
- mention evidence status;
- citation evidence status;
- owned actor mention presence;
- competitor actor mention presence set;
- owned actor citation presence;
- competitor actor citation presence set.

It returns rows containing integer counts and status.

The calculator must not import:

- Prisma;
- provider adapters;
- HTTP clients;
- fetch;
- BullMQ;
- P4 AI Gateway;
- DeepSeek SDK/client;
- browser automation.

This keeps formulas unit-testable and makes zero-network behavior structurally obvious.

## 19. Calculator invariants

Before materialization completes, enforce:

1. no negative counts;
2. numerator <= denominator for Mention Rate and Citation Rate;
3. `CALCULATED` rate rows require denominator > 0;
4. legitimate zero rate is numerator 0 with denominator > 0;
5. `NO_SIGNAL` is valid only for Mention SOV and denominator 0 with positive mention-eligible observations;
6. SOV `CALCULATED` actor numerators for one dimension sum exactly to the shared SOV denominator;
7. `UNKNOWN` rows expose no authoritative percentage;
8. `NOT_ELIGIBLE` rows expose no authoritative percentage;
9. `NO_DATA` rows expose no authoritative percentage;
10. actor presence is deduplicated per observation.

Invariant failure aborts materialization with a stable error code and no partial metric rows.

## 20. Snapshot immutability and replay

A completed snapshot is immutable.

If P6-B facts are backfilled later:

- old metric snapshot does not change;
- old rows do not change;
- explicit recomputation uses a later `inputCutoffAt` and creates a new snapshot.

If the same exact snapshot identity is requested again:

- return the existing completed snapshot;
- do not duplicate rows.

A failed materialization may be retried under the same identity if no completed snapshot exists.

## 21. Queue and worker

Introduce dedicated queue:

`visibility-metrics`

Job type:

- `materialize-metric-snapshot`

Stable job ID derived from:

`projectId + formulaVersion + extractorVersion + subjectSetHash + windowStart + windowEnd + inputCutoffAt + scopeHash`

Recommended attempts:

- `2`

Recommended worker concurrency:

- `2`

The worker is database-only and does not depend on provider adapters.

A bounded project request must create one bounded snapshot job; P6-C does not run an unbounded historical backfill inside one worker execution.

Historical batch generation, if later required, must expand into bounded window-level jobs.

## 22. Feature gates

P6-C is Advanced/Enterprise only.

Use the existing P6 feature-gating service and preserve side-effect ordering:

- Standard is rejected before metric snapshot creation;
- Standard is rejected before queue enqueue;
- Standard is rejected before metric API reads;
- Standard is rejected before Metrics/SOV web reads.

The implementation plan must map the final route/service surfaces to the existing feature codes already used by the repository. It must not create a parallel plan system.

The top-level P6-C surface represents the roadmap capability “Competitor Share of Voice”; Mention/Citation Rate are part of the same P6-C visibility-metrics capability and inherit the same Advanced/Enterprise access boundary.

## 23. REST API

Extend the project-scoped visibility API.

Recommended endpoints:

### Create snapshot

`POST /api/v1/projects/:projectId/visibility/metrics/snapshots`

Input:

- `windowStart`;
- `windowEnd`;
- optional `inputCutoffAt` (server defaults to request time, then persists exact value);
- `extractorVersion`;
- `subjectSetHash`;
- optional provider filter;
- optional Prompt Set filter.

Behavior:

- strict Zod validation;
- project/plan validation before enqueue;
- queues database-only materialization;
- returns accepted job/snapshot identity metadata;
- never performs provider sampling.

### List snapshots

`GET /api/v1/projects/:projectId/visibility/metrics/snapshots`

Filters:

- time range;
- formulaVersion;
- extractorVersion;
- subjectSetHash;
- bounded pagination.

### Snapshot detail

`GET /api/v1/projects/:projectId/visibility/metrics/snapshots/:snapshotId`

Returns:

- snapshot provenance;
- coverage counts;
- metric rows grouped by Overall/Provider/Prompt Set;
- no prompt/answer/provider body/reasoning content.

### Latest convenience read

`GET /api/v1/projects/:projectId/visibility/metrics/latest`

Returns the latest completed snapshot matching explicit filters. It must not silently combine rows from multiple snapshots.

## 24. Web UI

Primary route:

`/projects/:id/visibility/metrics`

The P6-C V1 page shows:

### Top cards

- Owned Mention Rate;
- Owned Citation Rate;
- Owned Mention Share of Voice;
- Evidence Coverage.

### Competitor table

For each monitored competitor actor:

- Mention Rate;
- Citation Rate;
- Mention SOV;
- evidence state/status;
- numerator/denominator tooltip or detail.

### Provider breakdown

For each provider represented in the snapshot:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned SOV;
- competitor SOV rows or compact comparison.

### Prompt Set breakdown

For each represented Prompt Set:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned SOV;
- competitor comparison.

### Provenance/coverage

Always show:

- formulaVersion;
- extractorVersion;
- subjectSetHash;
- windowStart/windowEnd;
- inputCutoffAt;
- candidate/eligible/not-eligible/unknown counts;
- metric status.

### Status presentation

The UI must visibly distinguish:

- calculated `0%`;
- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- `NO_DATA`;
- SOV `NO_SIGNAL`.

Do not render `UNKNOWN` as 0 or as an empty progress bar that visually implies zero.

## 25. P6-D boundary

P6-C may create immutable snapshots that P6-D can later query, but P6-C does not implement:

- trend lines;
- day-over-day/week-over-week deltas;
- alert thresholds;
- scheduled notifications;
- dashboard history widgets;
- report snapshot integration;
- AI narrative explanation of visibility trends.

The Metrics page may list/select existing snapshots for provenance, but historical trend analysis remains P6-D.

## 26. Observability

Allowed P6-C lifecycle events:

- `visibility.metrics.queued`
- `visibility.metrics.started`
- `visibility.metrics.completed`
- `visibility.metrics.failed`

Safe fields only:

- projectId;
- snapshotId;
- formulaVersion;
- extractorVersion;
- subjectSetHash;
- scopeHash;
- metric status/count summaries;
- candidate/eligible/unknown/not-eligible counts;
- errorCode;
- durationMs.

Do not log:

- prompt text;
- answer text;
- alias strings;
- canonical subject values;
- citation URLs unless an existing explicitly-approved safe logging contract later requires them;
- provider raw bodies;
- provider reasoning;
- API keys;
- cookies.

Use a strict serializer allowlist as in P6-B.

## 27. Security and isolation

Every snapshot and row is project-scoped.

Requirements:

- cross-project snapshot IDs return not found;
- cross-project Prompt Set filters fail closed;
- cross-project subjectSetHash/extractor combinations cannot leak another project's facts;
- Standard requests fail before side effects;
- API serializers expose only metric/provenance/coverage data needed by the client;
- metric generation never reads secrets or provider credentials.

## 28. Performance and bounds

P6-C V1 is designed for bounded windows, not unlimited all-history aggregation.

Initial API bounds should include:

- maximum request window duration chosen in implementation plan based on current P6 sampling volume;
- maximum provider filter count bounded by enum size;
- maximum Prompt Set filter count;
- bounded snapshot list pagination;
- worker query pagination/batching when candidate observations exceed an in-memory safety threshold.

The pure calculator may process batches into deterministic accumulator state if required, but results must be identical to single-batch calculation.

No arbitrary user SQL/grouping expression is accepted.

## 29. Testing strategy

### Unit tests — calculator

Lock these contracts:

- `KNOWN_EMPTY` enters denominators;
- `UNKNOWN` never enters denominators;
- `NOT_ELIGIBLE` never enters denominators;
- legitimate `0%` is `CALCULATED`;
- owned aliases/subjects dedupe to one presence per observation;
- competitor aliases/occurrences dedupe to one presence per competitor per observation;
- SOV actor numerators sum to denominator;
- no-signal SOV returns `NO_SIGNAL`;
- provider breakdown matches overall source partition;
- Prompt Set breakdown matches overall source partition;
- unknown/missing required input makes the affected metric `UNKNOWN`;
- no candidate input returns `NO_DATA`;
- all explicit ineligible input returns `NOT_ELIGIBLE`.

### Integration tests — persistence

Lock:

- snapshot identity/idempotency;
- historical snapshot immutability after later P6-B backfill;
- `inputCutoffAt` behavior;
- subjectSetHash isolation;
- extractorVersion isolation;
- subject snapshot consistency validation;
- transaction rollback on invariant/materialization failure;
- project isolation;
- Standard denied before writes/enqueue.

### Network boundary tests

The metric calculator/materializer/worker must make zero provider or external-content network calls.

Tests should fail if provider adapters, P4 AI Gateway or external fetch transports are invoked from P6-C.

### API tests

Lock:

- strict validation;
- bounded pagination;
- project-scoped reads;
- safe serializers;
- no prompt/answer/reasoning/raw provider body exposure;
- Standard 403 before side effects.

### Browser tests

Lock:

- calculated 0% visually differs from UNKNOWN;
- NOT_ELIGIBLE/NO_DATA/NO_SIGNAL labels are explicit;
- owned/competitor SOV comparison renders;
- provenance is visible;
- no P6-D trend claims appear in P6-C V1.

## 30. Release gate

Run on the exact final P6-C head:

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

Additional required evidence:

1. metric calculator/provider network calls = 0;
2. `UNKNOWN` never enters a denominator or becomes zero;
3. `KNOWN_EMPTY` does enter the appropriate denominator;
4. legitimate 0% remains distinguishable from UNKNOWN;
5. owned aliases/subjects cannot double-count one source observation;
6. SOV presence numerators sum exactly to the SOV denominator when calculated;
7. subjectSetHash versions never mix;
8. extractorVersion versions never mix;
9. old snapshots remain immutable after later P6-B backfill;
10. Standard cannot enqueue/generate/read P6-C intelligence;
11. P1–P6-B regression suite remains green;
12. no P6-D trend/alert/report feature is introduced;
13. exact-final-head verify, production-audit and Chromium E2E are green.

Only after this gate may README change to:

- `P6-C Visibility Metrics & Competitor Share of Voice — complete`
- `P6-D History, Dashboard, Alerts & Report Integration — next`

## 31. Implementation decomposition

P6-C is implemented in six sequential tasks.

### Task 1 — metric contracts and pure calculator

- enums/types;
- normalized input contract;
- market actor rollup;
- Mention Rate;
- Citation Rate;
- Mention SOV;
- metric status semantics;
- pure unit tests and invariants.

No Prisma schema changes are required in the first RED/GREEN calculator slice unless the implementation plan deliberately stacks Task 1 with Task 2 for type generation reasons.

### Task 2 — Prisma snapshot model and migration

- `VisibilityMetricSnapshot`;
- `VisibilityMetricRow`;
- metric enums;
- indexes/uniqueness;
- migration;
- schema validation tests.

### Task 3 — materialization service, repository, queue and worker

- candidate selection;
- cutoff semantics;
- P6-B contract isolation;
- input fingerprint;
- transactional materialization;
- idempotency/retry;
- `visibility-metrics` queue;
- safe database-only worker.

### Task 4 — project-scoped REST API

- enqueue/create snapshot;
- list/detail/latest reads;
- strict validation;
- plan gates;
- safe serialization;
- project isolation.

### Task 5 — Metrics & SOV web UI

- top cards;
- evidence coverage;
- competitor comparison;
- provider breakdown;
- Prompt Set breakdown;
- explicit status semantics;
- provenance;
- Chromium E2E.

### Task 6 — observability, operations guide and P6-C release gate

- strict allowlist events;
- operator guide;
- final regression/evidence checks;
- exact-head release gate;
- README P6-C completion marker only after green code/docs head.

## 32. Acceptance criteria

P6-C is complete only when all of the following are true:

- users can materialize an immutable visibility metric snapshot from saved P6-B facts;
- Owned Mention Rate is deterministic and auditable;
- Owned Citation Rate is deterministic and auditable;
- competitor Mention/Citation Rates are deterministic and auditable;
- presence-based owned/competitor Mention SOV is deterministic and auditable;
- overall/provider/Prompt Set dimensions are available;
- evidence coverage and metric state are explicit;
- legitimate zero is distinct from unknown/no-data/no-signal;
- subject/extractor versions never mix;
- snapshots are immutable across later backfill;
- calculator/materializer make zero provider/external-content calls;
- Standard cannot access the feature;
- no P6-D feature is silently introduced;
- full release gate passes on the exact final head.
