# P9-0F Unified Search Facts

## Purpose

P9-0F adds a provider-aware, provenance-preserving search-performance fact layer for P9-0G without changing the existing Google Search Console ingestion authority or P7 Growth scoring.

The layer currently normalizes two implemented search-performance sources:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`

The schema reserves the existing search-provider identities for Baidu Search Resource Platform, 360 Webmaster, Sogou Webmaster, and Shenma Webmaster, but P9-0F does not fabricate observations or mappings for providers whose programmable data source has not been implemented.

P9-0F is search-engine performance evidence. It is deliberately separate from P6/P9-0E AI visibility `PlatformObservation` data.

## Authority boundaries

### Google Search Console

Existing `GscDailySnapshot` and `GscQueryPageFact` rows remain the authoritative Google source records.

P9-0F does not replace, rewrite, delete, or backfill those tables. The Google normalizer reads only completed persisted GSC facts and reuses these existing authority fields verbatim:

- `normalizedQuery`
- `normalizationVersion`
- `canonicalPage`

This avoids silently changing historical GSC normalization behavior inside the unified layer.

### Bing Webmaster

Bing adapter observations are first persisted into the P9-0F provider-source boundary:

- `SearchProviderObservationBatch`
- `SearchProviderObservationRecord`

Only the typed, allowlisted observation fields produced by the existing Bing adapter are persisted. The source repository does not persist API keys, authorization headers, cookies, arbitrary upstream response bodies, hidden provider traces, or secret-bearing error payloads.

## Unified schema

P9-0F adds:

- `SearchProviderObservationBatch`
- `SearchProviderObservationRecord`
- `SearchFactSnapshot`
- `SearchFact`
- `SearchFactMetric`

The migration is additive. Existing GSC, Growth, visibility, publication, and project rows are not rewritten.

### Snapshot identity and immutability

A normalized snapshot is identified by:

```text
project
provider
market
locale
property
source kind
source ref
normalization version
```

Completed snapshots are immutable application records. Re-materializing the exact same source and normalization version returns the existing completed snapshot when its deterministic input hash and fact count still agree.

Changing the normalization version creates a new snapshot rather than mutating the previous completed snapshot.

The materialization hash is derived from stable source identity plus deterministically ordered normalized facts and metrics. Wall-clock time is not part of the hash.

## Fact kinds

The unified fact kinds are:

```text
QUERY_PAGE
QUERY
PAGE
SITE
```

They describe the dimensional granularity actually supplied by the provider. P9-0F does not invent missing dimensions in order to force providers into the same shape.

Current mappings:

| Provider source | Unified fact kind |
| --- | --- |
| GSC query + page daily fact | `QUERY_PAGE` |
| Bing `QUERY_STATS` | `QUERY` |
| Bing `PAGE_STATS` | `PAGE` |
| Bing `SITE_TRAFFIC_DAILY` | `SITE` |

In particular, Bing query facts and page facts are not joined into synthetic query-page facts.

## Metric semantics

P9-0F uses explicit metric semantics:

```text
CLICKS
IMPRESSIONS
CTR
GOOGLE_SEARCH_CONSOLE_POSITION
BING_AVG_CLICK_POSITION
BING_AVG_IMPRESSION_POSITION
```

There is intentionally no generic `POSITION` metric.

Google Search Console position, Bing average click position, and Bing average impression position are different provider semantics and remain distinguishable through persistence and the read contract.

### Google mapping

A persisted GSC query-page fact maps:

| Source field | Metric semantic |
| --- | --- |
| `clicks` | `CLICKS` |
| `impressions` | `IMPRESSIONS` |
| `ctr` | `CTR` |
| `position` | `GOOGLE_SEARCH_CONSOLE_POSITION` |

CTR is preserved from the authoritative GSC fact. It is not recomputed by P9-0F.

### Bing mapping

Bing query/page/site facts preserve clicks and impressions where present. Query and page facts may also contain:

| Source field | Metric semantic |
| --- | --- |
| `avgClickPosition` | `BING_AVG_CLICK_POSITION` |
| `avgImpressionPosition` | `BING_AVG_IMPRESSION_POSITION` |

P9-0F does not derive CTR from Bing clicks and impressions because the current adapter contract does not expose a native Bing CTR fact under this unified semantic contract.

## Evidence states and nullable metrics

Metric evidence states are:

```text
KNOWN_PRESENT
KNOWN_EMPTY
UNKNOWN
NOT_SUPPORTED
```

The numeric-value rule is strict:

- `KNOWN_PRESENT` requires a finite, non-negative numeric value;
- every non-present evidence state requires `numericValue = null`.

Therefore `UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` are never converted to zero.

A nullable Bing position is normalized as, for example:

```text
metricSemantic = BING_AVG_CLICK_POSITION
numericValue = null
evidenceState = UNKNOWN
sourceField = avgClickPosition
```

This distinction is preserved all the way through the P9-0G read contract.

## Completeness semantics

Unified source completeness values are:

```text
COMPLETE
TOP_ROWS_ONLY
PROVIDER_UNSPECIFIED
UNKNOWN
```

Current implemented sources use:

- GSC completed daily snapshots: `TOP_ROWS_ONLY` when the authoritative GSC snapshot declares that state;
- Bing persisted batches: `PROVIDER_UNSPECIFIED`.

Completeness describes source coverage and is retained on every returned read view. It must not be interpreted as a score or as evidence that missing facts equal zero.

## Google normalization behavior

The Google normalizer is intentionally conservative. It receives an existing persisted `GscQueryPageFact` and:

- uses the original fact key and observation identity;
- preserves source date;
- reuses raw query/page values;
- reuses persisted `normalizedQuery`, `normalizationVersion`, and `canonicalPage`;
- maps only the explicit Google metrics listed above.

It does not run a second query or page normalizer over GSC history.

## Bing normalization behavior

Bing source persistence first validates and deterministically stores only supported typed observations.

The Bing normalizer then:

- maps each supported observation kind to its real fact granularity;
- normalizes query text with the versioned P9-0F query normalization behavior;
- canonicalizes only `http`/`https` page URLs and rejects credential-bearing URLs;
- removes page fragments from canonical page identity;
- rejects unexpected payload fields at the normalizer boundary;
- preserves nullable position semantics as explicit `UNKNOWN` evidence;
- does not create CTR or GSC position metrics.

## Materialization safety

### GSC

Google materialization requires the source daily snapshot to be completed. Before writing normalized facts it verifies that:

- the source property belongs to the same project as the snapshot;
- every source fact belongs to the same project;
- every source fact date matches the snapshot date;
- the authoritative row count matches the loaded fact count;
- source freshness exists and becomes the unified source cutoff.

An inconsistent or unfinished GSC source is rejected before any normalized snapshot is written.

### Bing

Bing materialization verifies the persisted batch identity and observation boundary, including:

- provider is `BING_WEBMASTER`;
- project, market, locale, property, and completeness are internally consistent;
- observation count matches the persisted records;
- observation dates do not exceed the batch cutoff.

### Transactional writes

A new materialization runs in one database transaction:

1. create the normalized snapshot in `RUNNING` state;
2. create facts and their metrics;
3. update the snapshot to `COMPLETED` with the final fact count.

If the transaction fails, the partial normalized snapshot is not committed.

## Provider-aware read contract for P9-0G

`SearchFactRepository.listCompletedFacts()` exposes completed normalized facts to the next phase.

Supported filters are:

- project
- provider
- market
- locale
- property
- fact kind
- metric semantic
- canonical page
- normalized query
- inclusive source-date range

The project filter is applied to both the fact and its snapshot. Only snapshots with `status = COMPLETED` and a non-null completion timestamp are visible.

A metric-semantic filter selects facts that contain that semantic, but it does **not** prune the returned metric collection. P9-0G receives the complete metric set for each selected fact and can therefore reason from the original provider-specific evidence without losing context.

Each returned view retains:

- snapshot id
- project
- provider
- market
- locale
- property reference and type
- source kind and source ref
- source observation ref
- source cutoff
- source completeness
- normalization version
- fact key and kind
- source date
- raw and normalized query fields
- raw and canonical page fields
- query/page normalization version fields
- the complete metric set, including evidence state and source field

P9-0F does not perform provider weighting, cross-provider scoring, deduplication, attribution merging, or opportunity ranking. Those decisions belong to P9-0G.

## Separation from AI visibility

`SearchFactSnapshot` / `SearchFact` / `SearchFactMetric` are not AI visibility observations.

P6/P9-0E `PlatformObservation` remains the authority for provider-neutral AI visibility sampling. P9-0F does not migrate, alias, combine, or score those observations against search-engine performance facts.

This separation prevents an API visibility observation from being mislabeled as a search-console ranking/performance fact and prevents search-engine metrics from being treated as consumer AI visibility evidence.

## P7 Growth compatibility

P9-0F does not modify P7 Growth score formulas, evidence mapping, thresholds, prompt behavior, or existing GSC-based Growth repositories.

The unified facts layer is an additive handoff boundary for later work. Existing Growth tests remain part of the P9-0F release verification so a search-fact change cannot silently alter current P7 behavior.

## Security boundary

P9-0F does not:

- store search-provider API credentials in observation rows;
- store authorization headers or cookies;
- store arbitrary upstream bodies outside the typed source allowlist;
- infer missing provider metrics;
- convert unknown evidence to zero;
- invent Bing CTR;
- invent Bing query-page joins;
- map provider-specific positions to a generic position semantic;
- scrape provider consumer interfaces;
- merge search-performance facts into AI visibility persistence.

## Rollback guidance

The database migration is additive: it creates new enums, tables, indexes, and foreign keys and does not issue `DROP`, `TRUNCATE`, `DELETE`, or updates against existing application data.

A routine application rollback should stop writing/reading the P9-0F layer and leave the new database objects in place. Once production may contain unified search facts, destructive removal of the tables or PostgreSQL enum types should not be part of a normal rollback because it would discard historical evidence.

If a later controlled database decommission is ever required, it should be planned separately with explicit backup, retention, and dependency review rather than appended to an application rollback.

## Verification coverage

P9-0F tests cover:

- enum/type/schema contract;
- additive migration validation and deploy;
- deterministic Bing source persistence and replay;
- Bing source cutoff and credential-bearing URL rejection;
- GSC authority-field reuse;
- Bing fact-kind mapping and nullable position evidence;
- no synthetic CTR or query-page joins;
- immutable/idempotent materialization;
- new normalization version producing a new snapshot;
- GSC completed/source-identity validation;
- provider-aware completed-only reads;
- full provenance retention;
- metric filters retaining the complete metric set;
- provider-specific position semantics remaining separate;
- project isolation and exclusion of `RUNNING` snapshots;
- unchanged GSC worker and Bing adapter regressions;
- unchanged P7 Growth score/evidence regressions.

## Release gate

P9-0F is ready for review only when the **exact final documentation head** passes all three CI jobs:

1. `verify`
   - Prisma validate
   - Prisma generate
   - migrations deploy
   - TypeScript typecheck
   - full Vitest suite
   - production build
2. `production-audit`
   - deployable runtime dependency installation
   - Prisma CLI absence check
   - production dependency audit
3. `e2e`
   - Prisma generation and migration
   - Chromium installation
   - browser smoke tests

A green run on an earlier implementation head is insufficient. After the final exact head is green and the release diff review confirms the semantic/security boundaries above, PR #152 may be marked Ready for review. It remains unmerged until a separate explicit human merge command.
