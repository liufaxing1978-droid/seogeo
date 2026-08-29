# P11-02A Official Search Evidence Design

Status: **REVIEW**  
Date: **2026-08-29**  
Stacked base: `e1786e7019c6eeaacf5e1c4a7d0993c504763ae8` (`feat/p11-01-keyword-demand-capture` closure head)

## 1. Purpose

P11-02A connects the authoritative keyword library introduced in P11-01 to already persisted official search-provider facts.

The user outcome is:

> When an operator opens a strategic keyword such as `符纸`, the system can show what the platform has actually observed for that exact search demand in Google Search Console and Bing Webmaster data, without fabricating live SERP rank, search volume, provider health, or zero-demand conclusions.

P11-02A is a **search evidence layer**, not a live rank tracker.

It reuses the existing provider registry and normalized `SearchFact` infrastructure. It does not introduce a second provider abstraction or duplicate provider snapshots.

## 2. Scope

P11-02A includes:

1. deterministic keyword-to-search-query matching;
2. a read-only keyword search-evidence service over persisted `SearchFact` rows;
3. provider/lane-specific aggregation for Google Search Console and Bing Webmaster;
4. explicit evidence states that preserve incomplete-data semantics;
5. project-scoped JSON read API;
6. Keyword Center UI integration using the existing P11 shell;
7. provider capability/unavailability presentation for Google, Bing, Baidu, 360, Sogou, and Shenma;
8. existing `PROJECT_READ` authorization and fail-closed resource behavior;
9. RED -> minimal GREEN -> exact-head CI execution.

P11-02A does **not** include:

- third-party real-time SERP rank APIs;
- scraping Google/Baidu result pages;
- search-volume APIs;
- autonomous keyword strategy changes;
- provider credential writes or connection flows;
- URL/sitemap submission;
- AI visibility ranking;
- P11-02B or P11-02C functionality;
- merge or deployment authority changes.

## 3. Existing Repository Integration

### 3.1 Search provider registry

`src/modules/search-providers/search-provider.types.ts` and `search-provider.registry.ts` already define:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`
- `BAIDU_SEARCH_RESOURCE`
- `QIHOO_360_WEBMASTER`
- `SOGOU_WEBMASTER`
- `SHENMA_WEBMASTER`

Capabilities are explicitly `SUPPORTED`, `NOT_SUPPORTED`, or `NOT_IMPLEMENTED`, with cadence, read-only semantics, and access mode.

P11-02A must consume this truth. It must not infer provider readiness or health from configuration presence.

For keyword query evidence the required capability mapping is frozen as:

```text
GOOGLE_SEARCH_CONSOLE -> QUERY_PAGE_DAILY
BING_WEBMASTER        -> QUERY_STATS
BAIDU_SEARCH_RESOURCE -> QUERY_STATS
QIHOO_360_WEBMASTER   -> QUERY_STATS
SOGOU_WEBMASTER       -> QUERY_STATS
SHENMA_WEBMASTER      -> QUERY_STATS
```

### 3.2 Unified SearchFact layer

`src/modules/search-facts` already persists normalized provider evidence with:

- provider;
- market and locale;
- property reference;
- fact kind;
- source observation and snapshot identity;
- source date and cutoff;
- source completeness;
- raw query plus normalized query where applicable;
- canonical page where applicable;
- metric semantic;
- metric evidence state;
- numeric metric value where known.

P11-02A consumes persisted facts through the existing search-fact repository boundary. It must not bypass that layer by calling Google/Bing transports directly.

### 3.3 Existing Google evidence

Google Search Console currently provides persisted `QUERY_PAGE` facts with:

- `CLICKS`
- `IMPRESSIONS`
- `CTR`
- `GOOGLE_SEARCH_CONSOLE_POSITION`

Current daily sync completeness is `TOP_ROWS_ONLY`.

### 3.4 Existing Bing evidence

Bing Webmaster currently provides persisted `QUERY`, `PAGE`, and `SITE` facts. Keyword matching uses only `QUERY` facts and may read:

- `CLICKS`
- `IMPRESSIONS`
- `BING_AVG_CLICK_POSITION`
- `BING_AVG_IMPRESSION_POSITION`

Current Bing completeness is `PROVIDER_UNSPECIFIED`.

## 4. Frozen Truth and Authority Boundaries

P11-02A preserves all P11-01 and earlier boundaries.

- `Keyword` remains the authoritative operator-controlled demand declaration.
- `SearchFact` remains the authoritative record of what a provider observation actually contained.
- Search-evidence reads never mutate keywords.
- Search-evidence reads never trigger crawl, AI, provider sync, OAuth, queues, URL submission, content generation, publication, or distribution.
- Google Search Console remains read-only.
- AI receives no new authority over keywords or provider facts.
- Provider configuration is not provider health.
- Search Console average position is not deterministic live Google SERP rank.
- Bing average positions are provider-reported averages, not guaranteed current rank.
- Missing query rows in incomplete provider data do not prove zero impressions, zero searches, or no ranking.
- Search evidence does not prove commercial value.
- Adding a keyword does not cause ranking.

## 5. Search Evidence Match Normalization

P11-01 keyword identity remains frozen. P11-02A must **not** change `Keyword.normalizedText` or its uniqueness semantics.

Add a separate pure matcher:

```ts
normalizeSearchEvidenceQuery(text: string): string
```

Required normalization:

1. Unicode NFKC;
2. curly single quotes -> `'`;
3. curly double quotes -> `"`;
4. Unicode dash variants -> `-`;
5. trim;
6. collapse whitespace;
7. locale-independent lowercase.

Matching in P11-02A is **exact normalized query match only**.

No fuzzy matching, substring matching, stemming, synonyms, embeddings, or automatic Traditional/Simplified conversion.

Examples:

- `Ｆｏｏ   符紙` -> `foo 符紙`;
- punctuation variants may collapse to one exact form;
- `符紙` and `符纸` remain distinct.

The service normalizes both authoritative `Keyword.text` and persisted fact raw `query` through this matcher. It must not assume provider-specific `normalizedQuery` versions remain permanently identical to this bridge.

## 6. Evidence Window

Default evidence window is the trailing **28 UTC calendar days ending yesterday**.

For injected/current UTC date `D`:

- `dateTo = D - 1 day`
- `dateFrom = dateTo - 27 days`

The service clock is injectable for deterministic tests.

The API may accept explicit `from=YYYY-MM-DD` and `to=YYYY-MM-DD`.

Rules:

- `from <= to`;
- maximum span is 93 calendar days;
- dates use UTC provider source dates;
- empty/stale windows produce evidence states, not fabricated zeros.

The response exposes effective `dateFrom`, `dateTo`, latest matching source date, and latest available lane source date where known.

## 7. Evidence States

A real persisted evidence lane returns one of:

- `OBSERVED`
- `NOT_OBSERVED`
- `UNKNOWN`

A provider-level availability projection may return:

- `UNAVAILABLE`

### 7.1 OBSERVED

Use when at least one persisted query-capable fact in the requested window exactly matches the normalized authoritative keyword and the core query observation is valid.

An individual optional metric may still be unknown while the lane remains `OBSERVED`.

Example: Bing may have a valid query observation with clicks/impressions while one position field is `UNKNOWN`. In that case the lane is `OBSERVED` and only that position metric is `null`/unknown.

### 7.2 NOT_OBSERVED

Use only when all are true:

1. required query capability is supported;
2. persisted source evidence covers the relevant lane/window sufficiently;
3. source completeness is `COMPLETE` for the relevant query fact set;
4. no exact normalized query match exists.

Absence from `TOP_ROWS_ONLY` or `PROVIDER_UNSPECIFIED` data is never `NOT_OBSERVED`.

With current Google/Bing sources, `NOT_OBSERVED` is primarily future-safe and normally will not be emitted for an absent query.

### 7.3 UNKNOWN

Use when a safe lane-level conclusion cannot be made, including:

- supported query capability but no persisted query-source evidence in the requested window;
- query absent from `TOP_ROWS_ONLY` Google evidence;
- query absent from `PROVIDER_UNSPECIFIED` Bing evidence;
- only page/site facts exist but no query-capable source evidence;
- stale or partial source evidence is insufficient to make an absence claim;
- source conflicts make the lane unsafe to aggregate.

`UNKNOWN` must never render as zero.

### 7.4 UNAVAILABLE

Use for a provider-level projection when the registry says the required query capability is `NOT_SUPPORTED` or `NOT_IMPLEMENTED`.

Expose capability state and access mode, not invented health.

## 8. Provider Lane Identity

Real persisted search evidence must never silently merge markets or properties.

A persisted evidence lane is identified by the fully populated tuple:

```text
(provider, marketCode, locale, propertyRef)
```

Results are grouped and sorted deterministically by this identity.

Provider-level availability projections are different from persisted evidence lanes. When a provider has no qualifying persisted lane, a projection may use `marketCode=null`, `locale=null`, and `propertyRef=null` solely to communicate provider capability/availability. Such a projection must never carry observed metrics.

Keyword `language` / `targetCountry` may be shown as operator targeting context, but P11-02A does not silently infer provider lanes from those free-form fields.

Optional API filters may narrow by provider, marketCode, locale, or propertyRef.

## 9. Source Inventory Requirement

Evidence-state resolution requires more than loading exact query matches.

The repository must load a bounded **lane/source inventory** for the requested project/filter/window so the service can know:

- which provider/market/locale/property lanes actually have persisted query-capable source evidence;
- source completeness for those lanes;
- snapshot/source identities;
- latest available source date;
- whether the exact keyword query matched.

Therefore the repository must not implement the feature as only:

```text
WHERE normalizedQuery = <keyword>
```

because a no-row result alone cannot distinguish `UNKNOWN` from `NOT_OBSERVED`.

The read must remain bounded by the 93-day maximum window and query-capable fact kinds. No unbounded full-history scan is permitted.

## 10. Duplicate/Conflict Safety

Aggregation must not double-count the same persisted observation.

Before aggregation, facts are deterministically de-duplicated by persisted observation identity sufficient to distinguish one provider observation, using existing SearchFact identity fields such as:

```text
(snapshotId, sourceObservationRef, factKey)
```

If the same logical observation identity appears with conflicting metric/query/page content, the lane must fail closed as a source conflict rather than selecting one arbitrarily.

## 11. Google Search Console Aggregation

Google keyword evidence uses exact-matching persisted `QUERY_PAGE` facts.

For each real lane and requested window:

- `clicks` = sum known-present clicks across matched Query+Page rows;
- `impressions` = sum known-present impressions across matched Query+Page rows;
- `ctr` = `clicks / impressions` when impressions > 0, otherwise `null`;
- `searchConsoleAveragePosition` = impression-weighted mean of `GOOGLE_SEARCH_CONSOLE_POSITION` across rows with positive impression weight;
- matched pages are aggregated per canonical page and ordered by impressions desc, clicks desc, canonical URL asc;
- snapshot IDs and completeness are preserved.

Important semantic qualification:

These values are **derived aggregates over the persisted Query+Page rows available to this system**. They must not be described as an exact Google Search Console property-level `query`-only total, because the repository currently stores Query+Page top-row evidence rather than a separate query-only authoritative aggregate.

Required label:

**Search Console 平均位置 / Search Console average position**

Forbidden labels:

- `Google rank`
- `Google 当前排名`
- `Google 第 X 名`

Because current GSC data is `TOP_ROWS_ONLY`, an absent query is `UNKNOWN`.

## 12. Bing Webmaster Aggregation

Bing keyword evidence uses exact-matching persisted `QUERY` facts.

For each real lane/window:

- `clicks` = sum known-present clicks;
- `impressions` = sum known-present impressions;
- `bingAverageClickPosition` = click-weighted mean of known-present click-position values when positive click weight exists;
- `bingAverageImpressionPosition` = impression-weighted mean of known-present impression-position values when positive impression weight exists;
- a position metric with evidence state `UNKNOWN` remains `null`/unknown and does **not** downgrade an otherwise valid matched query lane from `OBSERVED`;
- snapshot IDs and completeness are preserved.

Because current Bing completeness is `PROVIDER_UNSPECIFIED`, an absent query is `UNKNOWN`.

## 13. Provider Availability Projection

The read model includes projections for all six known providers.

### Google

- required capability: `QUERY_PAGE_DAILY`;
- supported;
- use persisted GSC evidence only;
- no direct network call.

### Bing

- required capability: `QUERY_STATS`;
- supported;
- use persisted Bing query evidence only;
- no direct network call.

### Baidu / 360 / Sogou / Shenma

Use the manifest `QUERY_STATS` capability state.

If `NOT_IMPLEMENTED` or `NOT_SUPPORTED`, render `UNAVAILABLE` with wording such as:

- `官方平台能力尚未接入`
- `当前接口不支持查询级证据`

Never infer `连接正常`, `健康`, `无排名`, or `排名 0` from capability/configuration state.

## 14. Module Boundary

Add focused files under `src/modules/keywords`:

```text
keyword-search-evidence-normalize.ts
keyword-search-evidence.ts
keyword-search-evidence.repository.ts
keyword-search-evidence.service.ts
```

### `keyword-search-evidence-normalize.ts`

Pure exact-match normalization only.

### `keyword-search-evidence.ts`

Pure de-duplication, provider aggregation, and evidence-state resolution. No Prisma, network, queue, or Express.

### `keyword-search-evidence.repository.ts`

Read-only adapter over existing search-fact repository/schema and provider manifests.

It must provide two bounded data shapes:

1. lane/source inventory for query-capable evidence in the requested window;
2. facts needed to match and aggregate the authoritative keyword.

It must preserve lanes even when no keyword match exists, because completeness is required to resolve absence truthfully.

### `keyword-search-evidence.service.ts`

Orchestrates:

1. authoritative keyword lookup by `(projectId, keywordId)`;
2. date-window validation/defaulting;
3. bounded lane/source inventory load;
4. exact match normalization;
5. de-duplication/conflict checks;
6. lane aggregation;
7. provider availability projection.

No method may enqueue provider synchronization.

## 15. Persistence Design

P11-02A adds **no new ranking/search-evidence persistence table** and expects **no Prisma migration**.

Reason:

- `SearchFact` already preserves provider observations and provenance;
- search evidence is deterministic over a requested time window;
- a second derived snapshot would duplicate/stale truth without a current requirement.

If implementation inspection proves a performance problem, that is a separate design change and must not be smuggled into GREEN work.

## 16. Read Model

Suggested semantics:

```ts
type KeywordSearchEvidenceState =
  | 'OBSERVED'
  | 'NOT_OBSERVED'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

type KeywordSearchEvidenceLane = {
  provider: SearchProviderCode;
  marketCode: MarketCode | null;
  locale: string | null;
  propertyRef: string | null;
  state: KeywordSearchEvidenceState;
  capabilityState: 'SUPPORTED' | 'NOT_SUPPORTED' | 'NOT_IMPLEMENTED';
  accessMode: SearchProviderAccessMode;
  sourceCompleteness: SearchFactCompleteness[];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: string | null;
  latestAvailableSourceDate: string | null;
  snapshotIds: string[];
  metrics: {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    searchConsoleAveragePosition: number | null;
    bingAverageClickPosition: number | null;
    bingAverageImpressionPosition: number | null;
  };
  matchedPages: Array<{
    canonicalPage: string;
    clicks: number;
    impressions: number;
    averagePosition: number | null;
  }>;
  reason: string;
};

type KeywordSearchEvidenceResult = {
  keyword: {
    id: string;
    text: string;
    normalizedMatchText: string;
  };
  dateFrom: string;
  dateTo: string;
  lanes: KeywordSearchEvidenceLane[];
};
```

For `UNAVAILABLE` provider projections, lane identity fields may be null and all metrics must be null.

For `OBSERVED`, `NOT_OBSERVED`, or lane-specific `UNKNOWN`, provider/market/locale/propertyRef must identify a real persisted lane.

Exact final type names may follow repository conventions, but these semantics are frozen.

## 17. JSON API

Add:

```text
GET /api/v1/projects/:projectId/keywords/:keywordId/search-evidence
```

Optional query parameters:

```text
from=YYYY-MM-DD
to=YYYY-MM-DD
provider=<SearchProviderCode>
marketCode=<MarketCode>
locale=<locale>
propertyRef=<propertyRef>
```

Authorization:

```text
requireAuthentication()
requireProjectMembership()
requireProjectCapability('PROJECT_READ')
```

No CSRF is required because this is read-only.

Fail-closed rules:

- foreign/nonexistent project follows existing project-not-found middleware behavior;
- foreign keyword ID returns `KEYWORD_NOT_FOUND` without leaking its actual project;
- valid-but-unavailable provider filters return truthful `UNAVAILABLE` projection without network calls;
- malformed dates/filters fail with stable validation errors.

New error codes:

- `KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID`
- `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID`

Existing `KEYWORD_NOT_FOUND` remains the identity error.

## 18. Keyword Center UI

Extend the existing Keyword Center rather than creating a disconnected dashboard.

### 18.1 Library summary

Add a compact **搜索证据 / Search Evidence** area. Example:

```text
Google GSC   OBSERVED
1,286 Query+Page impressions · 74 clicks · 5.75% derived CTR
Search Console 平均位置 8.4

Bing         UNKNOWN
当前数据完整度不足，不能判断该关键词未出现
```

Google UI copy must make clear that displayed metrics are derived from the persisted Query+Page evidence available to the system, not an independent property-level query-only total.

### 18.2 Provider evidence panel

Show:

- provider display name;
- state badge;
- market / locale / property lane;
- effective date window;
- latest source date;
- completeness;
- provider-supported metrics;
- matched Google pages;
- safe provenance;
- explicit truth note.

### 18.3 Required truth copy

Google:

> Search Console 平均位置来自所选窗口内已持久化的 Query+Page 官方数据汇总，不代表某个用户此刻看到的实时 Google SERP 排名。

Incomplete absence:

> 当前持久化数据不完整，未观察到该关键词不能解释为 0 搜索量或无排名。

### 18.4 China provider cards

Baidu/360/Sogou/Shenma may show manifest capability state only. No fabricated metric placeholders such as `排名 0`.

## 19. No-Execution Read Contract

Calling the JSON API or rendering Keyword Center must **not** call/enqueue:

- Search Console sync;
- Bing collection;
- crawler;
- AI task;
- content generation;
- publication/distribution.

The feature is a persisted-fact projection only.

## 20. Authorization and Security

- reads require `PROJECT_READ`;
- no new role/capability;
- no tokens or credential references rendered;
- no OAuth vault access for evidence reads;
- cross-project keyword IDs fail closed;
- no mutation endpoint;
- no CSRF-exempt mutation;
- safe snapshot/fact identifiers may be returned; secrets may not.

## 21. Determinism

For identical persisted facts, keyword text, filters, and clock/window, output must be stable.

Ordering:

1. provider;
2. marketCode;
3. locale;
4. propertyRef;
5. matched pages by impressions desc, clicks desc, canonical URL asc;
6. snapshot IDs lexicographically.

Floating-point metrics are rounded only at presentation boundaries.

## 22. Observability

Use low-cardinality diagnostics for failures only, following existing conventions.

Useful events/reasons include:

- evidence evaluation failed;
- invalid range/filter;
- source conflict/invalid required metric;
- unavailable capability projection counts where existing telemetry supports them.

Never log provider credentials, OAuth tokens, or sensitive request headers.

## 23. Test Strategy

Implementation follows **RED -> minimal GREEN -> exact-head full CI**.

### 23.1 Pure normalization

- NFKC;
- whitespace;
- Latin lowercase;
- curly quotes;
- dash variants;
- Traditional/Simplified remain distinct.

### 23.2 Pure aggregation

Google:

- exact match;
- de-duplicate identical observations;
- conflict fails closed;
- sum Query+Page clicks/impressions;
- recompute derived CTR;
- impression-weight Search Console average position;
- deterministic page ordering;
- absent + `TOP_ROWS_ONLY` => `UNKNOWN`;
- matching rows => `OBSERVED`.

Bing:

- exact match;
- sum clicks/impressions;
- weighted provider position metrics;
- one unknown position metric remains null while lane stays `OBSERVED`;
- absent + `PROVIDER_UNSPECIFIED` => `UNKNOWN`.

Generic:

- `COMPLETE` query source + no match => `NOT_OBSERVED`;
- unsupported/not-implemented required capability => provider projection `UNAVAILABLE`.

### 23.3 Repository/service integration

Seed persisted search facts and keywords.

Test:

- same-project resolution;
- foreign keyword fail closed;
- multiple lanes remain separate;
- lane inventory survives zero keyword matches;
- 28-day default UTC window;
- 93-day maximum range;
- provider/market/locale/property filters;
- no provider transport/vault access;
- no enqueue side effects.

### 23.4 API authorization

- anonymous => 401;
- VIEWER/member with `PROJECT_READ` => 200;
- non-member => project-not-found behavior;
- foreign keyword => `KEYWORD_NOT_FOUND`;
- GET requires no CSRF;
- invalid filters/ranges return stable errors.

### 23.5 Web/UI

- observed Google evidence renders;
- wording is `Search Console 平均位置`, not `Google 当前排名`;
- Query+Page derivation is disclosed;
- absent incomplete data renders `UNKNOWN`, not zero;
- unavailable China capabilities render truthful unavailable wording;
- VIEWER can read;
- rendering triggers no execution;
- responsive Playwright remains usable.

### 23.6 Full regression

At every frozen phase and final closure head require:

- `verify`
- `production-audit`
- `deployment-artifact`
- `e2e`

## 24. Implementation Phases

### A — Pure matcher + aggregation

- normalizer;
- de-dup/conflict semantics;
- states;
- Google/Bing aggregation;
- no Prisma/Express.

### B — Persisted SearchFact read service

- bounded lane inventory;
- repository/service;
- filters/window;
- no execution side effects.

### C — Secured JSON API

- `PROJECT_READ`;
- fail closed;
- stable validation errors.

### D — Keyword Center UI + E2E

- truthful provider labels;
- Query+Page derivation disclosure;
- provider availability projection;
- responsive UI;
- final closure evidence document.

Every phase starts RED and obtains exact-head full CI before advancement.

## 25. P11-02B / P11-02C Boundary

### P11-02B — Live SERP Rank Provider

Future separate design may add a paid SERP provider with explicit engine, location, language, device, timestamp, observed organic rank/URL, rate/cost controls, credential handling, and freshness/health semantics.

Only such future evidence may be labeled live/observed SERP rank.

### P11-02C — China Search Evidence Import/Provider

Future separate design may add supported official/platform-backed Baidu or other China-search evidence. It must follow actual API/platform capability and must not use fragile direct SERP scraping as the authoritative fact path.

## 26. Branch and Integration Strategy

P11-01 PR #182 remains Draft/unmerged at design time.

P11-02A is therefore stacked from:

`e1786e7019c6eeaacf5e1c4a7d0993c504763ae8`

Design branch:

`docs/p11-02a-official-search-evidence-design`

After P11-01 is eventually integrated, P11-02A implementation must be rebased/retargeted onto the real `main` integration point before final integration.

No direct default-branch writes.

## 27. Acceptance Criteria

P11-02A is complete only when all are true:

1. authoritative keywords resolve exact official persisted Google/Bing query evidence;
2. Google displays clicks, impressions, derived CTR, and Search Console average position with provenance;
3. Google Query+Page derived aggregates are not misrepresented as property-level query-only totals;
4. Bing preserves provider-specific positions and per-metric unknown values honestly;
5. absent incomplete Google/Bing rows are `UNKNOWN`, never zero/`NOT_OBSERVED`;
6. `NOT_OBSERVED` requires complete query evidence;
7. unsupported/not-implemented required query capability is `UNAVAILABLE`;
8. lane/source inventory is preserved even when no keyword match exists;
9. markets/locales/properties are never silently merged;
10. duplicate observations are not double-counted and conflicting duplicates fail closed;
11. reads trigger no provider sync, crawl, AI, content, publication, or distribution execution;
12. cross-project access fails closed;
13. UI never labels official average-position evidence as deterministic live SERP rank;
14. no new ranking persistence table/migration is introduced;
15. final exact-head full CI is green;
16. no merge or deployment occurs without separate authorization.
