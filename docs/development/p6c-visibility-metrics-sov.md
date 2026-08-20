# P6-C Visibility Metrics & Competitor Share of Voice

P6-C turns persisted P6-A observations and P6-B deterministic Mention/Citation facts into immutable, auditable visibility metric snapshots. It is intentionally database-only during authoritative calculation.

## Truth boundary

Authoritative P6-C calculation may read only persisted P6-A/P6-B data:

- `PlatformObservation` identity/provider/Prompt Set/timestamps;
- completed P6-B `VisibilityExtraction` rows;
- P6-B Mention/Citation evidence states;
- persisted Mention and Citation fact identifiers/classification;
- the exact `extractorVersion`, `subjectSetHash` and subject snapshot frozen by the measurement contract.

P6-C materialization must not call DeepSeek, the P4 AI Gateway, provider APIs, search engines, citation URLs, external HTTP endpoints, embeddings, fuzzy matching or consumer-product UI automation.

## Snapshot identity and immutability

A metric snapshot is frozen by:

- `formulaVersion` (`VISIBILITY_METRICS_V1`);
- `extractorVersion`;
- `subjectSetHash`;
- `windowStart` / `windowEnd`;
- `inputCutoffAt`;
- canonical `scopeHash`.

The observation window is half-open: `windowStart <= observedAt < windowEnd`.

`inputCutoffAt` freezes the evidence horizon. Candidate observations must have `createdAt <= inputCutoffAt`; matching P6-B extractions are usable only when `status=COMPLETED` and `completedAt <= inputCutoffAt`.

A completed snapshot is immutable. Later P6-B extraction/backfill never mutates old P6-C rows. A later cutoff creates a different snapshot identity.

## Evidence-state semantics

For Mention Rate and Citation Rate:

- `EXTRACTED` enters the denominator;
- `KNOWN_EMPTY` enters the denominator;
- `NOT_ELIGIBLE` never enters the denominator;
- `UNKNOWN`, missing extraction, failed extraction or post-cutoff extraction never enter the denominator and make the affected V1 metric/dimension `UNKNOWN`.

A legitimate zero is not UNKNOWN. Example: numerator `0`, denominator `10`, complete evidence => `CALCULATED` 0%.

`NO_SIGNAL` is specific to Mention SOV when mention evidence is complete and eligible observations exist, but no monitored actor has any presence unit.

`NO_DATA` means the selected window/scope contains zero candidate P6-A observations.

## Formulas

### Mention Rate

`Mention Rate(A,D) = mentionedEligibleObservations(A,D) / mentionEligibleObservations(D)`

One actor contributes at most one mentioned observation per source observation, regardless of repeated aliases or occurrence count.

### Citation Rate

`Citation Rate(A,D) = citedEligibleObservations(A,D) / citationEligibleObservations(D)`

One actor contributes at most one cited observation per source observation. P6-C never fetches or reinterprets citation URLs.

### Presence-based Mention Share of Voice

`Mention SOV(A,D) = actorPresenceUnits(A,D) / totalActorPresenceUnits(D)`

Actor model:

- all owned subjects (`OWNED_BRAND`, `OWNED_DOMAIN`, `OWNED_ENTITY`) roll up to `OWNED_ROLLUP`;
- each monitored competitor subject is a separate `COMPETITOR:<subjectId>` actor;
- repeated aliases/mentions of the same actor in one observation count once.

For a `CALCULATED` SOV dimension, the sum of all actor numerators must equal the shared denominator exactly. Rounded UI percentages are presentation only.

## Dimensions

P6-C V1 materializes only:

- `OVERALL`;
- `PROVIDER`;
- `PROMPT_SET`.

Provider × Prompt Set cross-cubes are not materialized in P6-C V1.

## Hard bounds

- maximum metric window: 31 days;
- maximum Prompt Set filters: 20;
- maximum candidate observations: 20,000;
- database materialization batch size: 500;
- REST snapshot list default: 25;
- REST snapshot list max: 100;
- web generation is unfiltered in V1; provider/prompt-scoped creation remains REST-only.

If the candidate count exceeds 20,000, materialization fails with `VISIBILITY_METRICS_SCOPE_TOO_LARGE` before metric rows are persisted.

## Queue and replay behavior

Queue: `visibility-metrics`.

Job name: `materialize-metric-snapshot`.

Attempts: `2`.

The bounded deterministic BullMQ job ID is `visibility-metrics-<sha256(canonical identity)>`.

Workers validate the complete project-scoped snapshot identity before accepting the job. `QUEUED` and `FAILED` snapshots may be claimed; `COMPLETED` snapshots are immutable and cannot be reclaimed. A persistence failure must leave no partial metric row set.

## Access control

All P6-C generation and read surfaces are gated by the existing `COMPETITOR_SOV` feature.

- Advanced: allowed;
- Enterprise: allowed;
- Standard: rejected with `403 FEATURE_NOT_AVAILABLE` before restricted reads, snapshot writes or queue side effects.

Project scoping is mandatory for Prompt Set filters and snapshot reads; foreign IDs fail closed.

## REST API

Base: `/api/v1/projects/:projectId/visibility/metrics`

- `POST /snapshots` — prepare immutable shell and enqueue materialization;
- `GET /snapshots` — bounded safe snapshot list;
- `GET /snapshots/:snapshotId` — one safe snapshot plus rows;
- `GET /latest` — one latest completed snapshot, never a merge across snapshots.

API responses exclude subject snapshot JSON, scope JSON, prompt/answer text, aliases/canonical subject values, citation URLs/bodies, provider raw data, reasoning and secrets.

A ratio is emitted only when `metricStatus=CALCULATED` and denominator > 0. Otherwise `ratio=null`. Internal Overall storage key remains `OVERALL`; public Overall dimension key may be null.

## Web UI

Project page: `/projects/:id/visibility/metrics`.

The page shows:

- Owned Mention Rate;
- Owned Citation Rate;
- Owned Mention SOV;
- evidence coverage;
- competitor SOV table;
- Provider breakdown;
- Prompt Set breakdown;
- formula/extractor/hash/window/cutoff provenance;
- up to 20 recent same-project completed extractor/hash contracts for generation.

Status semantics are explicit: a legitimate zero renders as a percentage such as `0.0%`; UNKNOWN renders `UNKNOWN`, never 0%. `NOT_ELIGIBLE`, `NO_DATA` and `NO_SIGNAL` remain explicit states.

## Safe observability

Allowed lifecycle events:

- `visibility.metrics.queued`;
- `visibility.metrics.started`;
- `visibility.metrics.completed`;
- `visibility.metrics.failed`.

The serializer allowlist permits only:

- `projectId`;
- `snapshotId`;
- `formulaVersion`;
- `extractorVersion`;
- `subjectSetHash`;
- `scopeHash`;
- `status`;
- `candidateCount`;
- `eligibleCount`;
- `unknownCount`;
- `notEligibleCount`;
- `errorCode`;
- `durationMs`.

Operational coverage counts are coarse snapshot lifecycle diagnostics: candidates with either evidence state UNKNOWN are `unknownCount`; candidates with both metric evidence states explicitly NOT_ELIGIBLE are `notEligibleCount`; the remaining candidates are `eligibleCount`. These log counts do not replace the authoritative per-metric/per-dimension coverage stored on metric rows.

Never log prompt text, answer text, aliases, canonical subject values, citation URLs, subject snapshots, metric row bodies, provider bodies, API keys, cookies or provider reasoning.

`queued` is emitted only after queue insertion succeeds. `started` is emitted only after the worker validates the same-project frozen identity. `completed` is emitted only after atomic immutable completion. `failed` contains a bounded stable `errorCode` and duration.

## Diagnosing UNKNOWN

When a displayed metric is UNKNOWN:

1. inspect snapshot candidate/completed/missing/failed extraction counts;
2. confirm the exact `extractorVersion` and `subjectSetHash`;
3. confirm extraction `completedAt <= inputCutoffAt`;
4. inspect P6-B Mention/Citation evidence states for the same snapshot contract;
5. do not convert missing evidence to zero;
6. if late P6-B backfill completes, create a new snapshot with a later cutoff rather than mutating the old snapshot.

## Release gate

P6-C release verification requires the exact branch head to pass:

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

Evidence review must also confirm:

- authoritative materialization makes zero provider/external network calls;
- UNKNOWN never enters a denominator or becomes zero;
- KNOWN_EMPTY enters the correct denominator;
- legitimate calculated zero remains distinct from UNKNOWN;
- owned aliases/subjects deduplicate to one owned presence unit per observation;
- calculated SOV actor numerators sum exactly to the shared denominator;
- extractor/hash contracts never mix;
- later P6-B backfill cannot mutate an old completed P6-C snapshot;
- Standard cannot generate or read P6-C;
- P1–P6-B regression coverage remains green;
- no P6-D trend, delta, alert, history dashboard or report integration is claimed.

## P6-D boundary

P6-C ends at immutable metric snapshot generation, safe API/UI display, observability and release verification.

The following are explicitly P6-D work:

- historical trend lines;
- period-over-period deltas;
- alerts and scheduled notifications;
- history dashboard widgets;
- report snapshot integration;
- AI narrative trend explanation.
