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
- presence-based Mention Share of Voice;
- immutable metric snapshots;
- Overall, Provider and Prompt Set breakdowns;
- deterministic evidence coverage accounting;
- Advanced/Enterprise REST and web surfaces;
- safe observability and release verification.

P6-C does not deliver:

- provider sampling;
- DeepSeek/LLM metric calculation;
- citation URL fetching;
- semantic/fuzzy subject inference;
- consumer-product UI automation;
- weighted visibility scoring;
- ranking score synthesis;
- trend presentation;
- alerts;
- report integration.

Trend visualization, alerts and report integration remain P6-D responsibilities. P6-C only creates the immutable snapshot foundation that P6-D may later consume.

## 2. Architectural decision

Three approaches were considered.

### Option A — live SQL metrics

Calculate metrics from P6-B facts at request time.

Rejected because late extraction/backfill could change historical values, audit/replay would be weak, and P6-D history would have to reconstruct changing past states.

### Option B — immutable metric snapshots

Materialize deterministic metric snapshots over an explicit time window, input cutoff, extractor version, subject-set hash and scope.

Advantages:

- replayable and auditable;
- stable historical values;
- late backfill cannot mutate an old result;
- cheap downstream reads;
- clean P6-D foundation.

This is the approved P6-C design.

### Option C — generalized analytics cube

Maintain continuously pre-aggregated provider/prompt/time/actor cubes.

Rejected for P6-C as premature complexity. Provider × Prompt Set cross-cubes, OLAP infrastructure and generalized arbitrary dimensions are deferred.

## 3. Truth boundary

P6-C authoritative metrics may be derived only from persisted P6-A/P6-B data.

Allowed inputs:

- `PlatformObservation` identity, provider, Prompt Set relationship, timestamps and source status;
- completed P6-B `VisibilityExtraction` rows;
- P6-B `mentionStatus` and `citationStatus`;
- P6-B `MentionObservation` facts;
- P6-B `CitationObservation` facts;
- exact P6-B `subjectSetHash`, `extractorVersion` and subject snapshot.

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
- current subject configuration applied retroactively to old P6-B facts.

The metric calculator and materializer are deterministic and database-only.

## 4. Measurement-contract isolation

One metric snapshot uses exactly one:

- `formulaVersion`;
- `extractorVersion`;
- `subjectSetHash`;
- subject snapshot;
- scope definition;
- half-open observation window `[windowStart, windowEnd)`;
- `inputCutoffAt`.

P6-C must never mix P6-B facts across different `subjectSetHash` values or different `extractorVersion` values.

If subject configuration changes, P6-B produces a new `subjectSetHash`; P6-C creates a new snapshot identity.

Initial formula version:

`VISIBILITY_METRICS_V1`

## 5. Time window and cutoff semantics

P6-C filters source data using `PlatformObservation.observedAt`.

Window semantics are half-open:

`windowStart <= observedAt < windowEnd`

Stored timestamps are compared in UTC. Project timezone is used only to choose/display default windows; it does not alter persisted snapshot timestamps.

`inputCutoffAt` freezes the evidence horizon.

A candidate P6-A observation is visible to the materializer only when:

- it is in the requested observation window/scope; and
- `PlatformObservation.createdAt <= inputCutoffAt`.

A P6-B extraction is usable only when:

- it matches the requested project, `extractorVersion` and `subjectSetHash`;
- `status = COMPLETED`;
- `completedAt <= inputCutoffAt`.

An extraction that completed after the cutoff is treated as missing at that cutoff. Late extraction/backfill never mutates an existing metric snapshot; a later cutoff creates a new snapshot.

## 6. Candidate observation set

Candidate observations are selected from P6-A first, independently of whether a matching P6-B extraction exists.

This is required so P6-C can correctly distinguish:

- complete evidence;
- explicit `NOT_ELIGIBLE`;
- P6-B `UNKNOWN`;
- missing extraction;
- failed/incomplete extraction identity.

A candidate observation must:

- belong to the project;
- fall inside `[windowStart, windowEnd)`;
- satisfy `createdAt <= inputCutoffAt`;
- match the requested Provider/Prompt Set scope.

P6-C then looks up the requested P6-B measurement contract for every candidate.

Scope V1 may restrict:

- Provider allowlist;
- Prompt Set allowlist.

No filter means all project providers/Prompt Sets represented in the window.

The canonical scope is sorted and serialized into `scopeJson`; `scopeHash` is SHA-256 over that stable representation.

## 7. Resolving the subject-set contract

A snapshot request must resolve the requested `subjectSetHash` to an exact same-project subject snapshot before materialization.

Resolution order:

1. load a same-project P6-B `VisibilityExtraction` with the requested `subjectSetHash` and `extractorVersion` and use its bounded `subjectSnapshotJson`;
2. verify every matching extraction used by the snapshot has the same canonical subject snapshot for that hash;
3. if no historical extraction exists for the hash, the current active subject registry may be snapshotted only when its freshly calculated hash exactly equals the requested `subjectSetHash`.

If the hash cannot be resolved to a same-project subject snapshot, fail closed with a stable contract-not-found error. Do not create a metric snapshot with an unverifiable subject set.

This rule also allows a valid `NO_DATA` metric snapshot when the requested hash is the current same-project subject contract even though the selected time window contains no observations.

## 8. Market actor model

P6-C top-line metrics use market actors rather than treating every owned alias/subject as a separate market participant.

### Owned actor

All owned subject types from the exact P6-B subject snapshot roll up to one actor:

- `OWNED_BRAND`;
- `OWNED_DOMAIN`;
- `OWNED_ENTITY`.

Stable actor key:

`OWNED_ROLLUP`

For one source observation, any number of owned subject/alias matches create at most one owned presence unit.

### Competitor actor

Each monitored `COMPETITOR` P6-B subject is a separate actor.

Stable actor key:

`COMPETITOR:<subjectId>`

For one source observation, repeated aliases, mention rows and occurrences for the same competitor create at most one competitor presence unit.

### Why observation-level presence

P6-C V1 uses presence, not raw occurrence frequency, because occurrence weighting would let verbose answers or repeated aliases artificially dominate Share of Voice.

P6-B occurrence counts remain preserved facts but are not P6-C V1 SOV weights.

## 9. Mention Rate

For actor `A` in dimension `D`:

`Mention Rate(A,D) = mentionedEligibleObservations(A,D) / mentionEligibleObservations(D)`

An observation enters the denominator only when the matching P6-B extraction has:

- `mentionStatus = EXTRACTED`; or
- `mentionStatus = KNOWN_EMPTY`.

Excluded from the denominator:

- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- missing matching extraction;
- failed/incomplete extraction identity at the cutoff.

The numerator is the count of distinct mention-eligible source observations in which actor `A` is present.

Owned presence is true when any owned subject has at least one P6-B `MentionObservation` in that extraction.

Competitor presence is true when that competitor subject has at least one P6-B `MentionObservation` in that extraction.

Multiple aliases/occurrences count once per actor per source observation.

If denominator > 0, coverage is complete and numerator = 0, the result is a legitimate `CALCULATED` 0%.

## 10. Citation Rate

For actor `A` in dimension `D`:

`Citation Rate(A,D) = citedEligibleObservations(A,D) / citationEligibleObservations(D)`

An observation enters the denominator only when the matching P6-B extraction has:

- `citationStatus = EXTRACTED`; or
- `citationStatus = KNOWN_EMPTY`.

Excluded from the denominator:

- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- missing matching extraction;
- failed/incomplete extraction identity at the cutoff.

The numerator is the count of distinct citation-eligible source observations containing at least one persisted P6-B citation attributed to actor `A`.

Owned citation presence is based only on persisted P6-B owned classification.

Competitor citation presence is based only on persisted P6-B competitor subject/provenance classification.

Repeated citations to the same actor inside one source observation count once for Citation Rate.

P6-C never fetches or reinterprets a citation URL to change attribution.

## 11. Mention Share of Voice

P6-C V1 uses presence-based Mention Share of Voice:

`Mention SOV(A,D) = actorPresenceUnits(A,D) / totalActorPresenceUnits(D)`

For each mention-eligible source observation:

1. add one `OWNED_ROLLUP` unit if any owned subject was mentioned;
2. add one unit for each distinct competitor subject mentioned;
3. ignore repeated aliases/occurrences for the same actor in that observation.

Example:

- observation 1: owned + competitor A;
- observation 2: owned + competitor A + competitor B;
- observation 3: competitor B.

Presence units:

- owned = 2;
- competitor A = 2;
- competitor B = 2;
- denominator = 6.

Each SOV is `2/6`.

When SOV is `CALCULATED`, all actor numerators for the same snapshot/dimension must sum exactly to the shared SOV denominator. Integer-unit equality is authoritative; UI rounding is presentation only.

If mention coverage is complete, mention-eligible observations exist, but total actor presence is zero, SOV status is `NO_SIGNAL`, not 0%.

## 12. Metric status model

P6-C introduces:

- `CALCULATED`
- `NO_SIGNAL`
- `UNKNOWN`
- `NOT_ELIGIBLE`
- `NO_DATA`

### `CALCULATED`

Use when:

- the dimension has at least one eligible denominator observation;
- the metric has a defined denominator;
- there are no unknown/missing required inputs for that metric/dimension.

Numerator may be zero.

### `NO_SIGNAL`

Valid only for Mention SOV when:

- mention coverage is complete;
- at least one mention-eligible observation exists;
- total actor-presence denominator is zero.

### `UNKNOWN`

Use when any candidate observation in the metric/dimension lacks trustworthy complete P6-B input for that metric, including:

- P6-B evidence status `UNKNOWN`;
- missing requested extraction at the cutoff;
- failed/non-completed requested extraction at the cutoff;
- inconsistent P6-B facts/subject snapshot.

P6-C V1 is deliberately strict: if required input is unknown, it does not publish a percentage for that metric/dimension. Coverage counts remain available for diagnosis.

### `NOT_ELIGIBLE`

Use when candidate observations exist, none are eligible, every candidate has explicit P6-B `NOT_ELIGIBLE` for the metric, and there are no unknown/missing required inputs.

### `NO_DATA`

Use when the selected time window/scope contains zero candidate P6-A observations.

## 13. Mixed eligible and NOT_ELIGIBLE inputs

Explicit `NOT_ELIGIBLE` does not invalidate an otherwise complete metric.

Example:

- 10 candidates;
- 6 `EXTRACTED/KNOWN_EMPTY`;
- 4 explicit `NOT_ELIGIBLE`;
- 0 unknown/missing.

The metric is `CALCULATED` with denominator 6.

`NOT_ELIGIBLE` never enters a denominator and is never converted to zero.

## 14. Dimensions

P6-C V1 materializes:

### Overall

- `dimensionType = OVERALL`
- internal storage key = `OVERALL`.

### Provider

- `dimensionType = PROVIDER`
- one group per represented `VisibilityProvider`;
- storage key = provider enum string.

### Prompt Set

- `dimensionType = PROMPT_SET`
- one group per represented `VisibilityPromptSet.id`;
- storage key = Prompt Set UUID;
- `dimensionLabelSnapshot` stores the Prompt Set name at snapshot time for stable historical display.

Prompt text is never required for metric calculation or logging.

Provider × Prompt Set cross-product rows are intentionally not materialized in V1.

## 15. Metric precision

Authoritative storage uses integer numerator/denominator counts.

Percentages are derived for API/UI responses and are not stored as the only truth.

API response may expose a decimal ratio rounded to four decimal places; UI may display 1–2 decimal places.

SOV correctness is tested using integer presence units, not rounded percentages.

## 16. Data model

### Enum: `VisibilityMetricSnapshotStatus`

- `QUEUED`
- `RUNNING`
- `COMPLETED`
- `FAILED`

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
- `status` `VisibilityMetricSnapshotStatus`
- `formulaVersion` string
- `extractorVersion` string
- `subjectSetHash` string
- `subjectSnapshotJson` JSON
- `windowStart` DateTime
- `windowEnd` DateTime
- `inputCutoffAt` DateTime
- `scopeJson` JSON
- `scopeHash` string
- `inputFingerprint` string nullable until successful derivation
- `candidateObservationCount` Int default 0
- `completedExtractionCount` Int default 0
- `missingExtractionCount` Int default 0
- `failedExtractionCount` Int default 0
- `errorCode` string nullable
- `startedAt` DateTime nullable
- `completedAt` DateTime nullable
- `createdAt` DateTime
- `updatedAt` DateTime

Recommended uniqueness:

`(projectId, formulaVersion, extractorVersion, subjectSetHash, windowStart, windowEnd, inputCutoffAt, scopeHash)`

Rules:

- a completed snapshot is immutable;
- a failed snapshot identity may be safely retried;
- `subjectSnapshotJson` contains only the bounded P6-B subject measurement contract;
- no prompt text, answer text, reasoning, provider raw body, API key or cookie is stored.

### `VisibilityMetricRow`

Fields:

- `id` UUID
- `visibilityMetricSnapshotId` UUID
- `projectId` UUID
- `metricType` enum
- `metricStatus` enum
- `dimensionType` enum
- `dimensionKey` string (always non-null in storage)
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

- owned: `actorType = OWNED_ROLLUP`, `actorSubjectId = null`, `actorKey = OWNED_ROLLUP`;
- competitor: `actorType = COMPETITOR`, `actorSubjectId = subjectId`, `actorKey = COMPETITOR:<subjectId>`.

Recommended uniqueness:

`(visibilityMetricSnapshotId, metricType, dimensionType, dimensionKey, actorKey)`

Using a non-null internal dimension key avoids PostgreSQL null-uniqueness ambiguity. REST/UI may expose `dimensionKey = null` for Overall if desired, but persistence uses `OVERALL`.

## 17. Input fingerprint

`inputFingerprint` proves the exact materialized evidence identity.

It is a SHA-256 over bounded, canonically sorted non-sensitive metadata including:

- candidate observation IDs;
- matching extraction IDs or explicit missing markers;
- P6-B mention/citation evidence states;
- extraction completion identity;
- provider;
- Prompt Set ID.

It must not include:

- prompt text;
- answer text;
- alias strings;
- provider raw responses;
- provider reasoning;
- API keys/cookies;
- fetched external content.

## 18. Materialization algorithm

For one metric snapshot request:

1. load project and verify `COMPETITOR_SOV` feature before any write/enqueue;
2. validate `windowStart`, `windowEnd`, `inputCutoffAt` and optional scope;
3. resolve the requested same-project subject-set contract;
4. create/claim the unique snapshot shell;
5. select P6-A candidate observations independently of extraction availability;
6. load requested P6-B extraction identities as-of cutoff;
7. verify subject snapshot consistency;
8. calculate completed/missing/failed and per-metric evidence coverage;
9. build a bounded, normalized input stream;
10. run the pure deterministic calculator;
11. build Overall, Provider and Prompt Set rows;
12. verify calculator/materialization invariants;
13. transactionally replace any prior failed partial state with all final rows and mark the snapshot `COMPLETED`;
14. emit safe completion observability.

If derivation/materialization fails:

- no partial metric rows may remain;
- snapshot shell is marked `FAILED` with stable bounded `errorCode`;
- retry reclaims the same snapshot identity.

No provider/network dependency is available to the calculator/materializer worker.

## 19. Pure calculator contract

Introduce:

`visibility-metrics.calculator.ts`

The pure calculator receives normalized records containing only:

- observation ID;
- provider;
- Prompt Set ID;
- mention evidence status;
- citation evidence status;
- owned mention presence;
- competitor mention presence set;
- owned citation presence;
- competitor citation presence set.

It returns integer metric rows/statuses.

The calculator must not import:

- Prisma;
- BullMQ;
- provider adapters;
- HTTP clients/fetch;
- P4 AI Gateway;
- DeepSeek;
- browser automation.

## 20. Calculator invariants

Enforce before completion:

1. counts are non-negative;
2. Mention/Citation numerator <= denominator;
3. `CALCULATED` Mention/Citation rows require denominator > 0;
4. legitimate zero is numerator 0 with denominator > 0;
5. `NO_SIGNAL` is valid only for Mention SOV with positive mention-eligible observations and zero actor-presence denominator;
6. `CALCULATED` SOV actor numerators for one dimension sum exactly to the shared SOV denominator;
7. `UNKNOWN`, `NOT_ELIGIBLE`, `NO_DATA`, `NO_SIGNAL` expose no authoritative percentage;
8. actor presence is deduplicated per source observation;
9. all rows in one snapshot use the exact snapshot formula/extractor/subject-set identity;
10. no row is created for an actor absent from the exact subject snapshot.

Invariant failure aborts materialization.

## 21. Snapshot immutability and replay

A `COMPLETED` snapshot and its rows are immutable.

If P6-B is backfilled later:

- old snapshot remains unchanged;
- old rows remain unchanged;
- explicit recomputation uses a later `inputCutoffAt` and therefore a new unique snapshot identity.

Requesting the exact same completed identity returns the existing snapshot.

A `FAILED` snapshot may be retried under the same identity.

## 22. Queue and worker

Dedicated queue:

`visibility-metrics`

Job:

`materialize-metric-snapshot`

Stable job ID is derived from:

`projectId + formulaVersion + extractorVersion + subjectSetHash + windowStart + windowEnd + inputCutoffAt + scopeHash`

Configuration:

- attempts = 2;
- worker concurrency = 2;
- database-only execution;
- no provider credentials/dependencies.

One job handles one bounded snapshot window. Historical batch creation, if later required, must expand to bounded window-level jobs rather than one unbounded history job.

## 23. Feature gate

The repository already defines `COMPETITOR_SOV` in `src/auth/feature-flags.ts` for Advanced/Enterprise plans.

P6-C uses that existing feature code for all P6-C metric-generation/read surfaces.

Required ordering:

- Standard rejected before snapshot shell creation;
- Standard rejected before queue enqueue;
- Standard rejected before REST reads;
- Standard rejected before Metrics/SOV web reads.

P6-C must not create a new parallel entitlement system.

## 24. REST API

Extend `/api/v1/projects/:projectId/visibility`.

### Create snapshot

`POST /api/v1/projects/:projectId/visibility/metrics/snapshots`

Input:

- `windowStart`;
- `windowEnd`;
- optional `inputCutoffAt` (server defaults to request time and persists the exact resolved value);
- `extractorVersion`;
- `subjectSetHash`;
- optional Provider filter;
- optional Prompt Set filter.

Behavior:

- strict Zod validation;
- `COMPETITOR_SOV` plan gate before side effects;
- same-project Prompt Set validation;
- queues database-only materialization;
- never samples a provider.

### List snapshots

`GET /api/v1/projects/:projectId/visibility/metrics/snapshots`

Filters:

- window/date range;
- formulaVersion;
- extractorVersion;
- subjectSetHash;
- status;
- bounded pagination.

### Snapshot detail

`GET /api/v1/projects/:projectId/visibility/metrics/snapshots/:snapshotId`

Returns:

- snapshot provenance;
- coverage counts;
- grouped Overall/Provider/Prompt Set metric rows;
- no prompt/answer/provider body/reasoning content.

### Latest convenience read

`GET /api/v1/projects/:projectId/visibility/metrics/latest`

Returns the latest `COMPLETED` snapshot matching explicit filters. It must never combine rows across snapshots.

## 25. Web UI

Primary route:

`/projects/:id/visibility/metrics`

V1 shows:

### Top cards

- Owned Mention Rate;
- Owned Citation Rate;
- Owned Mention SOV;
- Evidence Coverage.

### Competitor table

For each monitored competitor:

- Mention Rate;
- Citation Rate;
- Mention SOV;
- metric status;
- numerator/denominator detail.

### Provider breakdown

For each represented provider:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned SOV;
- competitor SOV comparison.

### Prompt Set breakdown

For each represented Prompt Set:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned SOV;
- competitor comparison.

### Provenance

Always show:

- formulaVersion;
- extractorVersion;
- subjectSetHash;
- windowStart/windowEnd;
- inputCutoffAt;
- candidate/eligible/not-eligible/unknown counts;
- snapshot/metric status.

The UI must visually distinguish:

- calculated 0%;
- `UNKNOWN`;
- `NOT_ELIGIBLE`;
- `NO_DATA`;
- `NO_SIGNAL`.

`UNKNOWN` must not be rendered as an empty bar/card that implies zero.

## 26. P6-D boundary

P6-C may list/select immutable snapshots but does not implement:

- trend lines;
- day/week/month deltas;
- alert thresholds;
- scheduled notifications;
- historical dashboard widgets;
- report snapshot integration;
- AI narrative trend explanation.

Those remain P6-D.

## 27. Observability

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
- snapshot/metric statuses;
- candidate/eligible/unknown/not-eligible counts;
- errorCode;
- durationMs.

Never log:

- prompt text;
- answer text;
- aliases/canonical subject values;
- citation URLs;
- provider raw bodies;
- provider reasoning;
- API keys;
- cookies.

Use a strict serializer allowlist as in P6-B.

## 28. Security and project isolation

Requirements:

- every snapshot/row is project-scoped;
- cross-project snapshot IDs return not found;
- cross-project Prompt Set filters fail closed;
- a subject-set contract must resolve inside the same project;
- Standard fails before side effects;
- serializers expose only metric/provenance/coverage data;
- P6-C never reads provider secrets for calculation.

## 29. Performance bounds

P6-C V1 uses explicit hard limits:

- maximum snapshot observation window = 31 days;
- maximum Prompt Set filters per request = 20;
- Provider filter bounded by the existing provider enum;
- maximum candidate observations per snapshot = 20,000;
- materializer database batch size = 500;
- snapshot list default page size = 25, maximum = 100.

If a request exceeds 20,000 candidate observations, fail with a stable `VISIBILITY_METRICS_SCOPE_TOO_LARGE` error and require a narrower window/scope.

No arbitrary user SQL/grouping expression is accepted.

Batching must produce the same deterministic result as single-batch calculation.

## 30. Testing strategy

### Unit tests — pure calculator

Lock:

- `KNOWN_EMPTY` enters denominators;
- `UNKNOWN` never enters denominators;
- `NOT_ELIGIBLE` never enters denominators;
- legitimate 0% is `CALCULATED`;
- owned aliases/subjects dedupe to one presence per observation;
- competitor aliases/occurrences dedupe to one presence per competitor per observation;
- SOV actor numerators sum exactly to denominator;
- no-signal SOV returns `NO_SIGNAL`;
- Provider breakdown partitions correctly;
- Prompt Set breakdown partitions correctly;
- unknown/missing required input makes the affected metric/dimension `UNKNOWN`;
- no candidate input returns `NO_DATA`;
- all explicit ineligible input returns `NOT_ELIGIBLE`.

### Integration tests — persistence/materialization

Lock:

- snapshot identity/idempotency;
- `QUEUED/RUNNING/COMPLETED/FAILED` lifecycle;
- failed retry safety;
- historical snapshot immutability after later P6-B backfill;
- `inputCutoffAt` behavior;
- candidate observation selection independent of extraction availability;
- subjectSetHash isolation;
- extractorVersion isolation;
- subject snapshot consistency validation;
- transaction rollback on invariant/materialization failure;
- 20,000-candidate hard bound;
- project isolation;
- Standard denied before writes/enqueue.

### Network boundary tests

Calculator/materializer/worker provider/external-content network call count must be zero.

Tests fail if P6-C invokes provider adapters, P4 AI Gateway, DeepSeek, browser automation or external fetch transports.

### API tests

Lock:

- strict validation;
- 31-day window bound;
- Prompt Set filter bound and same-project ownership;
- bounded pagination;
- project-scoped reads;
- safe serializers;
- Standard 403 before side effects.

### Browser tests

Lock:

- calculated 0% differs visibly from UNKNOWN;
- NOT_ELIGIBLE/NO_DATA/NO_SIGNAL are explicit;
- owned/competitor SOV comparison renders;
- provenance/coverage is visible;
- no P6-D trend claim appears.

## 31. Release gate

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

1. P6-C provider/external network calls = 0;
2. `UNKNOWN` never enters a denominator or becomes zero;
3. `KNOWN_EMPTY` does enter the appropriate denominator;
4. legitimate 0% remains distinguishable from UNKNOWN;
5. owned aliases/subjects cannot double-count one observation;
6. SOV actor numerators sum exactly to denominator when calculated;
7. subjectSetHash values never mix;
8. extractorVersion values never mix;
9. old snapshots remain immutable after later P6-B backfill;
10. Standard cannot enqueue/generate/read P6-C intelligence;
11. P1–P6-B regression suite remains green;
12. no P6-D trend/alert/report implementation is introduced;
13. exact-final-head verify, production-audit and Chromium E2E are green.

Only after this gate may README state:

- `P6-C Visibility Metrics & Competitor Share of Voice — complete`
- `P6-D History, Dashboard, Alerts & Report Integration — next`

## 32. Implementation decomposition

P6-C is implemented in six sequential tasks.

### Task 1 — metric contracts and pure calculator

- types/contracts;
- normalized input contract;
- market actor rollup;
- Mention Rate;
- Citation Rate;
- Mention SOV;
- metric status semantics;
- pure unit tests and invariants.

### Task 2 — Prisma snapshot model and migration

- P6-C enums;
- `VisibilityMetricSnapshot`;
- `VisibilityMetricRow`;
- indexes/uniqueness;
- migration;
- schema validation.

### Task 3 — materialization repository/service/queue/worker

- subject-contract resolution;
- candidate selection;
- cutoff semantics;
- P6-B contract isolation;
- input fingerprint;
- transaction/idempotency/retry;
- hard bounds;
- `visibility-metrics` queue;
- zero-network worker.

### Task 4 — project-scoped REST API

- create/enqueue snapshot;
- list/detail/latest;
- Zod/bounds;
- `COMPETITOR_SOV` gate;
- safe serialization;
- project isolation.

### Task 5 — Metrics & SOV web UI

- top cards;
- coverage;
- competitor comparison;
- Provider/Prompt Set breakdowns;
- explicit status presentation;
- provenance;
- Chromium E2E.

### Task 6 — observability, operator guide and release gate

- strict allowlist lifecycle events;
- operator guide;
- full regression/evidence review;
- exact-head release gate;
- README completion marker only after code/docs head is green.

## 33. Acceptance criteria

P6-C is complete only when:

- immutable visibility metric snapshots can be materialized from saved P6-B facts;
- Owned Mention Rate is deterministic/auditable;
- Owned Citation Rate is deterministic/auditable;
- competitor Mention/Citation Rates are deterministic/auditable;
- presence-based owned/competitor Mention SOV is deterministic/auditable;
- Overall/Provider/Prompt Set dimensions are available;
- metric state and evidence coverage are explicit;
- legitimate zero differs from unknown/no-data/no-signal;
- missing extraction is represented as unknown rather than silently filtered;
- subject/extractor versions never mix;
- snapshots are immutable across later backfill;
- calculator/materializer make zero provider/external-content calls;
- Standard cannot access P6-C;
- no P6-D feature is silently introduced;
- full exact-head release gate passes.
