# P9-0F Unified Search Facts Design

Date: 2026-08-22
Status: Approved in chat; written spec awaiting review
Repository: `liufaxing1978-droid/seogeo`
Base: `main@a6d1fd648b0d836ef590d33492bdc44df18a190f`
Branch: `feat/p9-0f-unified-search-facts`

## 1. Goal

P9-0F introduces a provider-aware normalized search-fact layer between provider-native search observations and P7 Growth Intelligence.

The layer must preserve provider provenance, market, locale, property/site identity, exact source snapshot/cutoff, metric semantics, evidence state, and source completeness without rewriting or weakening any existing authoritative provider data.

P9-0F does **not** change P7 scoring. P9-0G will consume the unified search facts and adapt P7 to multiple providers.

## 2. Scope

P9-0F covers search-engine performance evidence only.

Initial normalized inputs:

- Google Search Console existing persisted facts
- Bing Webmaster observations through the existing search-provider abstraction

Future-compatible inputs:

- Baidu Search Resource Platform
- 360 Search webmaster platform
- Sogou official webmaster/search interfaces when usable
- Shenma official webmaster interfaces when usable

P9-0F explicitly excludes P9-0E AI visibility observations. `PlatformObservation` remains the authoritative AI-visibility observation model and is not migrated into search-fact tables.

## 3. Non-goals and hard boundaries

P9-0F MUST NOT:

- modify P7 Growth scoring, opportunity formulas, lifecycle, evidence quality rules, or explanation semantics;
- reinterpret AI visibility samples as search-engine performance facts;
- delete or replace `GscDailySnapshot` or `GscQueryPageFact`;
- force provider-specific metrics into a false common semantic;
- treat `UNKNOWN`, `NOT_SUPPORTED`, missing values, or absent provider fields as zero;
- fabricate CTR, position, click, impression, completeness, or provider evidence;
- erase the original provider/property/source snapshot reference;
- perform AI inference or semantic merging of authoritative facts;
- write directly to `main`;
- auto-merge the P9-0F pull request.

## 4. Chosen architecture

Use an additive three-layer model:

```text
provider-native source observations
        ↓
SearchFactSnapshot
        ↓
SearchFact
        ↓
SearchFactMetric
        ↓
P9-0G Growth adapter
```

Existing GSC persisted tables remain authoritative provider-native data. Bing and future providers require durable source observations where their current adapter output is otherwise transient.

The normalized layer is immutable by normalization version: newer normalization logic creates a new snapshot/version instead of rewriting completed historical normalized facts.

## 5. Market and locale semantics

Reuse the existing `MarketCode` and `ProjectMarket` foundation.

Normalized search snapshots copy market and locale into the immutable snapshot rather than relying only on a mutable `ProjectMarket` relationship.

Required market identity on every normalized snapshot:

- `marketCode`
- `locale`

This preserves historical interpretation if the project later changes its enabled markets or locale configuration.

## 6. Provider and property identity

Every normalized snapshot preserves:

- provider code
- provider-native property/site reference
- provider-native property type when known
- project identity

Provider codes reuse the existing search-provider vocabulary:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`
- `BAIDU_SEARCH_RESOURCE`
- `QIHOO_360_WEBMASTER`
- `SOGOU_WEBMASTER`
- `SHENMA_WEBMASTER`

P9-0F does not add normalized facts for a provider unless the provider has an official usable source surface and an explicit adapter/manifest capability.

## 7. Proposed persistence model

### 7.1 `SearchFactSnapshot`

Purpose: freeze the normalization boundary for one provider/property/market/locale/source cutoff/version.

Required fields:

- `id`
- `projectId`
- `provider`
- `marketCode`
- `locale`
- `propertyRef`
- `propertyType`
- `sourceSnapshotRef`
- `sourceCutoffAt`
- `sourceCompleteness`
- `normalizationVersion`
- `inputHash`
- `status`
- `factCount`
- `startedAt`
- `completedAt`
- `errorCode`
- `createdAt`
- `updatedAt`

Suggested status values:

```text
PENDING
RUNNING
COMPLETED
FAILED
```

Identity is deterministic across:

```text
projectId
+ provider
+ marketCode
+ locale
+ propertyRef
+ sourceSnapshotRef or sourceCutoff
+ normalizationVersion
```

Repeated materialization of the same identity must be idempotent.

### 7.2 `SearchFact`

Purpose: represent one logical normalized search-performance fact without prematurely merging provider-specific metric semantics.

Suggested dimensions:

- `id`
- `snapshotId`
- `projectId`
- `factKey`
- `factKind`
- `sourceDate`
- `query`
- `normalizedQuery`
- `queryNormalizationVersion`
- `page`
- `canonicalPage`
- `createdAt`

Initial `factKind` values:

```text
QUERY_PAGE
QUERY
PAGE
SITE
```

Rules:

- GSC query-page facts map to `QUERY_PAGE`.
- Bing query observations map to `QUERY`.
- Bing page observations map to `PAGE`.
- Bing site traffic observations map to `SITE`.
- A provider fact is never promoted to a more specific kind than the source actually supplies.

### 7.3 `SearchFactMetric`

Purpose: store one explicit metric semantic and value attached to a normalized fact.

Suggested fields:

- `id`
- `factId`
- `metricSemantic`
- `numericValue`
- `evidenceState`
- `sourceField`
- `createdAt`

A unique constraint on `(factId, metricSemantic)` prevents duplicate semantics within one fact.

## 8. Metric semantic contract

Do not use a generic ambiguous `POSITION` semantic across providers.

Initial semantics:

```text
CLICKS
IMPRESSIONS
CTR
GOOGLE_SEARCH_CONSOLE_POSITION
BING_AVG_CLICK_POSITION
BING_AVG_IMPRESSION_POSITION
```

Rules:

- `CLICKS`, `IMPRESSIONS`, and `CTR` may use shared semantics only when the provider source explicitly documents equivalent fields and the adapter supplies them directly.
- Google `position` remains `GOOGLE_SEARCH_CONSOLE_POSITION`.
- Bing `avgClickPosition` remains `BING_AVG_CLICK_POSITION`.
- Bing `avgImpressionPosition` remains `BING_AVG_IMPRESSION_POSITION`.
- Future Baidu/360/Sogou/Shenma position-like data gets provider-specific semantics unless equivalence is explicitly established and reviewed.
- No normalization formula converts one provider's position metric into another provider's position metric in P9-0F.

## 9. Evidence-state contract

Normalized metrics use explicit evidence states:

```text
KNOWN_PRESENT
KNOWN_EMPTY
UNKNOWN
NOT_SUPPORTED
```

Semantics:

- `KNOWN_PRESENT`: provider returned the metric with an unambiguous value.
- `KNOWN_EMPTY`: provider/source explicitly represented an empty result for that fact/metric context.
- `UNKNOWN`: source does not establish whether the metric is absent, unavailable, truncated, or omitted.
- `NOT_SUPPORTED`: provider capability contract explicitly does not support the metric/surface.

`UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` are semantically different and must remain different in persistence and downstream queries.

## 10. Source-completeness contract

Preserve source completeness separately from metric evidence state.

Normalized completeness values:

```text
COMPLETE
TOP_ROWS_ONLY
PROVIDER_UNSPECIFIED
UNKNOWN
```

Initial mappings:

- existing GSC `TOP_ROWS_ONLY` -> `TOP_ROWS_ONLY`
- Bing provider observations currently marked `PROVIDER_UNSPECIFIED` -> `PROVIDER_UNSPECIFIED`
- future providers map only from explicit source/provider facts

Completeness must never be inferred from row count alone.

## 11. Provider-native provenance

Every normalized snapshot/fact must remain traceable to its authoritative source.

### Google Search Console

Existing authoritative chain remains:

```text
GscDailySnapshot
→ GscQueryPageFact
```

The normalized snapshot stores `sourceSnapshotRef = GscDailySnapshot.id` and normalized facts preserve the deterministic source relationship through fact identity/source reference metadata.

P9-0F does not delete, rewrite, or reinterpret historical GSC facts.

### Bing Webmaster

Current Bing provider observations are typed at the adapter layer but do not have the same durable provider-native fact model as GSC.

P9-0F therefore introduces a lightweight append-only provider-source observation persistence boundary for non-GSC providers that need durable provenance before normalization.

The persisted source record must preserve at least:

- project
- provider
- property/site reference
- source date/cutoff
- observation kind
- provider-native payload fields required by normalization
- source completeness
- adapter/schema version
- input/source hash
- created timestamp

It must not store credentials, authorization headers, hidden provider traces, or arbitrary secret-bearing upstream error bodies.

## 12. Normalizer interfaces

Add a dedicated module:

```text
src/modules/search-facts/
```

Suggested responsibilities:

- `search-fact.types.ts` — normalized contracts and semantic enums/types
- `search-fact.repository.ts` — persistence/query boundary
- `search-fact.materializer.ts` — idempotent snapshot orchestration
- `normalizers/google-search-fact.normalizer.ts`
- `normalizers/bing-search-fact.normalizer.ts`

Normalizer input must be provider-native persisted/source data, not UI payloads.

Normalizer output is deterministic and side-effect free before repository persistence.

## 13. Google normalization

For every existing `GscQueryPageFact` in the selected completed source snapshot:

Create one `QUERY_PAGE` `SearchFact` preserving:

- source date
- query
- normalized query
- query normalization version
- page
- canonical page

Metrics:

- `clicks` -> `CLICKS`
- `impressions` -> `IMPRESSIONS`
- `ctr` -> `CTR`
- `position` -> `GOOGLE_SEARCH_CONSOLE_POSITION`

Each supplied numeric field is `KNOWN_PRESENT`.

Snapshot completeness derives from the source `GscDailySnapshot.sourceCompletenessState`; current `TOP_ROWS_ONLY` remains `TOP_ROWS_ONLY`.

## 14. Bing normalization

Map existing Bing observation kinds without inventing query/page joins.

### `QUERY_STATS`

Create `QUERY` fact with:

- `CLICKS`
- `IMPRESSIONS`
- `BING_AVG_CLICK_POSITION` when supplied
- `BING_AVG_IMPRESSION_POSITION` when supplied

Nullable position fields become `UNKNOWN` unless the source contract explicitly establishes an empty or unsupported state.

### `PAGE_STATS`

Create `PAGE` fact with:

- `CLICKS`
- `IMPRESSIONS`
- `BING_AVG_CLICK_POSITION` when supplied
- `BING_AVG_IMPRESSION_POSITION` when supplied

### `SITE_TRAFFIC_DAILY`

Create `SITE` fact with:

- `CLICKS`
- `IMPRESSIONS`

Bing completeness remains `PROVIDER_UNSPECIFIED` with the current provider contract.

## 15. Canonicalization and query normalization

P9-0F reuses existing deterministic canonical-page and query-normalization rules where available.

Rules:

- do not introduce AI normalization;
- preserve original `query` and `page` strings;
- persist normalization/canonicalization version alongside normalized values;
- if a source observation has no page dimension, do not fabricate one;
- if a source observation has no query dimension, do not fabricate one.

## 16. Idempotency and versioning

Materialization must be idempotent for the same source identity and normalization version.

`inputHash` covers the stable provider/source identity plus normalization-relevant source facts.

Rules:

- a completed snapshot is immutable;
- rerunning the same source/version returns or recognizes the existing completed snapshot;
- changed normalization logic increments `normalizationVersion` and creates a new normalized snapshot;
- failed snapshots may be retried only under deterministic identity/error rules without duplicating completed facts;
- no fuzzy merge of normalized facts across versions.

## 17. Repository/query contract for P9-0G

P9-0F exposes provider-aware read methods but does not alter P7.

Minimum downstream query dimensions:

- project
- provider
- market
- locale
- property
- source date/cutoff range
- fact kind
- metric semantic
- canonical page
- normalized query

Returned data must include enough provenance for P9-0G to attach provider/market/source references to Growth evidence.

P9-0F does not perform cross-provider deduplication or scoring. Those decisions belong to P9-0G.

## 18. Error and failure behavior

Materialization failures are snapshot-scoped.

Stable error categories should distinguish at least:

- invalid source snapshot/state
- unsupported provider observation kind
- invalid provider/property identity
- invalid market/locale identity
- malformed provider-source observation
- persistence conflict

Raw credentials or secret-bearing provider error bodies are never persisted in normalized error fields.

One provider's failed normalization must not invalidate another provider's completed normalized snapshot.

## 19. Migration and backward compatibility

P9-0F is additive.

Migration may add:

- normalized snapshot/fact/metric enums/tables
- lightweight non-GSC provider-source observation table if required
- indexes/unique constraints for deterministic identity and downstream lookup

Migration must not drop or rewrite:

- `GscDailySnapshot`
- `GscQueryPageFact`
- existing Growth tables
- visibility/AI observation tables

Rollback guidance is non-destructive: application rollback may stop materializing/reading unified search facts while retaining the additive tables and historical normalized facts.

## 20. Testing strategy

Use TDD with RED observed in actual CI before production implementation for each major contract.

Required coverage:

1. schema/semantic contract
   - explicit provider-specific position semantics
   - evidence state distinctions
   - completeness distinctions
2. GSC normalizer
   - exact query-page mapping
   - exact metric semantics
   - provenance
   - top-row completeness
3. Bing normalizer
   - QUERY/PAGE/SITE fact-kind separation
   - nullable position -> `UNKNOWN`
   - no fabricated query-page join
   - provider-unspecified completeness
4. idempotency/versioning
   - same source/version does not duplicate facts
   - new normalization version creates a new immutable snapshot
5. provenance/security
   - source references preserved
   - no secrets copied into provider-source or normalized records
6. repository reads
   - provider/market/locale/property/date/semantic filters
7. regression
   - existing GSC ingestion remains valid
   - existing search-provider adapters remain valid
   - P7 scoring behavior remains unchanged

## 21. Release gate

P9-0F ships as one isolated pull request from `feat/p9-0f-unified-search-facts` to `main`.

The pull request remains Draft until the exact final head passes all required CI jobs:

```text
verify             success
production-audit   success
e2e                success
```

An earlier green commit is not sufficient.

After exact-head green, the PR may be marked Ready for human review. It must not be auto-merged.

## 22. Success criteria

P9-0F is complete when:

- GSC and Bing can materialize provider-aware normalized search facts;
- every normalized snapshot carries provider, market, locale, property, source cutoff/snapshot, completeness, normalization version, and provenance;
- every metric carries an explicit semantic and evidence state;
- GSC and Bing position semantics remain distinct;
- missing/unknown/unsupported data is never represented as zero;
- original GSC authority remains intact;
- non-GSC source observations are durably traceable before normalization where needed;
- P7 remains unchanged;
- the exact final PR head passes `verify`, `production-audit`, and `e2e`.
