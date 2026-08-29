# P11-02A Official Search Evidence Design

Status: **REVIEW**  
Date: **2026-08-29**  
Stacked base: `e1786e7019c6eeaacf5e1c4a7d0993c504763ae8` (`feat/p11-01-keyword-demand-capture` closure head)

## 1. Purpose

P11-02A connects the authoritative keyword library introduced in P11-01 to already persisted official search-provider facts.

The user outcome is:

> When an operator opens a strategic keyword such as `符纸`, the system can show what the platform has actually observed for that exact search demand in Google Search Console and Bing Webmaster data, without fabricating live SERP rank, search volume, provider health, or zero-demand conclusions.

P11-02A is a **search evidence layer**, not a live rank tracker.

It reuses the existing provider and normalized `SearchFact` infrastructure. It does not introduce a second search-provider abstraction or duplicate provider snapshots.

## 2. Scope

P11-02A includes:

1. a deterministic keyword-to-search-query matching normalizer;
2. a read-only keyword search-evidence service over persisted `SearchFact` rows;
3. provider/lane-specific aggregation for Google Search Console and Bing Webmaster;
4. explicit evidence states that preserve incomplete-data semantics;
5. project-scoped JSON read API;
6. Keyword Center UI integration using the existing P11 shell;
7. provider capability/unavailability presentation for Google, Bing, Baidu, 360, Sogou, and Shenma without pretending configuration is live health;
8. RBAC/fail-closed behavior using existing `PROJECT_READ` rules;
9. focused RED -> minimal GREEN -> exact-head CI gates.

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

The repository already has the required upstream fact layers.

### 3.1 Search provider registry

`src/modules/search-providers/search-provider.types.ts` and `search-provider.registry.ts` define:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`
- `BAIDU_SEARCH_RESOURCE`
- `QIHOO_360_WEBMASTER`
- `SOGOU_WEBMASTER`
- `SHENMA_WEBMASTER`

The registry records each capability as `SUPPORTED`, `NOT_SUPPORTED`, or `NOT_IMPLEMENTED`, plus cadence, read-only semantics, and access mode.

P11-02A must read this truth. It must not infer provider readiness from a configured name or environment variable.

### 3.2 Unified SearchFact layer

`src/modules/search-facts` already persists normalized provider evidence with:

- provider;
- market and locale;
- property reference;
- fact kind;
- source observation and source snapshot identity;
- source date and cutoff;
- source completeness;
- raw query plus normalized query where query facts exist;
- canonical page where page facts exist;
- metric semantic;
- evidence state;
- numeric metric value where known.

P11-02A consumes this persisted layer through `SearchFactRepository`. It must not bypass it by calling Google or Bing transports directly.

### 3.3 Existing Google evidence

Google Search Console currently provides persisted `QUERY_PAGE` facts with:

- `CLICKS`
- `IMPRESSIONS`
- `CTR`
- `GOOGLE_SEARCH_CONSOLE_POSITION`

The current daily sync completeness is `TOP_ROWS_ONLY`.

### 3.4 Existing Bing evidence

Bing Webmaster currently provides persisted query, page, and site facts. P11-02A keyword matching uses only query-capable facts (`QUERY`) and may read:

- `CLICKS`
- `IMPRESSIONS`
- `BING_AVG_CLICK_POSITION`
- `BING_AVG_IMPRESSION_POSITION`

Current Bing completeness is `PROVIDER_UNSPECIFIED`.

## 4. Frozen Truth and Authority Boundaries

P11-02A preserves all P11-01 and earlier boundaries.

- `Keyword` remains the authoritative operator-controlled demand declaration.
- `SearchFact` remains the authoritative record of what a provider observation actually contained.
- Search evidence reads never mutate keywords.
- Search evidence reads never trigger crawl, AI, provider sync, OAuth, queue enqueue, URL submission, or publication.
- Google Search Console remains read-only.
- AI receives no new authority over keyword strategy or provider facts.
- Provider configuration is not provider health.
- Search Console average position is not deterministic live Google SERP rank.
- Bing average position metrics are provider-reported averages, not a guaranteed current rank.
- Missing query rows in incomplete provider data do not prove zero impressions, zero searches, or no ranking.
- Search evidence does not prove commercial value.
- Adding a keyword does not cause search-engine ranking.

## 5. Search Evidence Match Normalization

P11-01 keyword identity must remain frozen. P11-02A must **not** change `Keyword.normalizedText` or its uniqueness semantics.

Instead, add a separate pure matcher:

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
7. lowercase using locale-independent semantics.

This intentionally aligns with the existing Google/Bing query-normalization behavior while remaining owned by the search-evidence matching boundary.

Matching rule in P11-02A is **exact normalized query match only**.

No fuzzy matching, substring matching, stemming, synonym matching, semantic embedding, or automatic Traditional/Simplified Chinese conversion is allowed.

Therefore:

- `Ｆｏｏ   符紙` can normalize to `foo 符紙`;
- punctuation variants can normalize to one exact form;
- `符紙` and `符纸` remain distinct unless the operator separately creates both authoritative keywords.

The service should normalize the authoritative `Keyword.text` and the persisted provider fact's raw `query` through the matching normalizer. It must not assume provider-specific `normalizedQuery` versions remain permanently identical to the keyword matcher.

## 6. Evidence Window

Default keyword search evidence uses the trailing **28 UTC calendar days ending yesterday**.

For an injected/current UTC date `D`, default range is:

- `dateTo = D - 1 day`
- `dateFrom = dateTo - 27 days`

The service clock must be injectable for deterministic tests.

The API may accept explicit `from=YYYY-MM-DD` and `to=YYYY-MM-DD` overrides.

Rules:

- `from <= to`;
- maximum requested span is 93 calendar days in P11-02A;
- dates are interpreted as UTC provider source dates;
- an empty or stale window is represented through evidence-state semantics, not fabricated zeros.

The response must expose the effective `dateFrom`, `dateTo`, latest matching source date, and latest available provider source date where known.

## 7. Evidence States

Each provider/market/property lane returns one of:

- `OBSERVED`
- `NOT_OBSERVED`
- `UNKNOWN`
- `UNAVAILABLE`

### 7.1 OBSERVED

Use only when at least one persisted query-capable fact in the requested window exactly matches the normalized authoritative keyword and the metrics used in the output have valid evidence states.

### 7.2 NOT_OBSERVED

Use only when all of the following are true:

1. the provider capability required for keyword query evidence is supported;
2. persisted source evidence covers the requested lane/window sufficiently;
3. source completeness is `COMPLETE` for the relevant query fact set;
4. no exact normalized query match exists.

P11-02A must not treat absence from `TOP_ROWS_ONLY` or `PROVIDER_UNSPECIFIED` data as `NOT_OBSERVED`.

With current repository providers, this means `NOT_OBSERVED` is primarily a future-safe state and normally will **not** be emitted for absent Google or Bing queries.

### 7.3 UNKNOWN

Use when a conclusion cannot be made safely, including:

- supported provider capability but no persisted facts in the requested window;
- query absent from `TOP_ROWS_ONLY` Google data;
- query absent from `PROVIDER_UNSPECIFIED` Bing data;
- required position metric is provider `UNKNOWN`;
- only non-query fact kinds are available for the keyword;
- stale or partial source evidence is insufficient to make an absence claim.

`UNKNOWN` must not be rendered as zero.

### 7.4 UNAVAILABLE

Use when the provider registry says the relevant query capability is `NOT_SUPPORTED` or `NOT_IMPLEMENTED` for P11-02A.

For unavailable lanes, the response should surface the capability state and access mode from the manifest rather than inventing health.

## 8. Provider Lane Identity

Search evidence must not silently merge markets or properties.

A lane is identified by:

```text
(provider, marketCode, locale, propertyRef)
```

Results are grouped and sorted deterministically by that identity.

Keyword `language` / `targetCountry` metadata may be displayed as operator targeting context, but P11-02A must not silently infer a provider lane from those free-form fields.

API filters may optionally narrow by provider, marketCode, locale, or propertyRef.

If no filter is supplied, return all qualifying persisted lanes separately.

## 9. Google Search Console Aggregation

Google keyword evidence uses exact-matching `QUERY_PAGE` facts.

For each lane and requested window:

- `clicks` = sum of known-present clicks across matching rows;
- `impressions` = sum of known-present impressions across matching rows;
- `ctr` = `clicks / impressions` when impressions > 0; otherwise `null` with an evidence explanation rather than NaN/Infinity;
- `averagePosition` = impression-weighted mean of `GOOGLE_SEARCH_CONSOLE_POSITION` across matching rows with impressions > 0;
- preserve matched pages as per-page evidence, deterministically ordered by impressions desc, clicks desc, canonical URL asc;
- include source snapshot IDs and source completeness values for traceability.

The UI/API label must be **Search Console average position** / **Search Console 平均位置**.

It must never be labeled simply `Google rank`, `当前排名`, or `Google 第 X 名`.

Because current GSC sync is `TOP_ROWS_ONLY`, an absent query is `UNKNOWN`, not `NOT_OBSERVED`.

## 10. Bing Webmaster Aggregation

Bing keyword evidence uses exact-matching `QUERY` facts.

For each lane and requested window:

- `clicks` = sum of known-present clicks;
- `impressions` = sum of known-present impressions;
- `avgClickPosition` = click-weighted mean of known-present `BING_AVG_CLICK_POSITION` values when click weight is available and positive;
- `avgImpressionPosition` = impression-weighted mean of known-present `BING_AVG_IMPRESSION_POSITION` values when impression weight is available and positive;
- a provider position metric with evidence state `UNKNOWN` remains `null`/unknown and must not become zero;
- include source snapshot IDs and completeness for provenance.

Because current Bing completeness is `PROVIDER_UNSPECIFIED`, an absent query is `UNKNOWN`, not `NOT_OBSERVED`.

## 11. Provider Availability Projection

The keyword evidence read model should include provider projections for all six known provider codes.

### Google

- query evidence capability: supported via `QUERY_PAGE_DAILY`;
- show persisted GSC evidence when available;
- no direct network call from keyword reads.

### Bing

- query evidence capability: supported via `QUERY_STATS`;
- show persisted Bing query evidence when available;
- no direct network call from keyword reads.

### Baidu / 360 / Sogou / Shenma

Use the registry capability state only.

If query evidence is `NOT_IMPLEMENTED` or `NOT_SUPPORTED`, render `UNAVAILABLE` with truthful wording such as:

- `官方平台能力尚未接入`
- `当前接口不支持查询级证据`

Do not render:

- `排名 0`
- `无排名`
- `连接正常`
- `健康`

unless a future feature has independent evidence for those claims.

## 12. Proposed Module Boundary

Add focused files under `src/modules/keywords`:

```text
keyword-search-evidence-normalize.ts
keyword-search-evidence.ts
keyword-search-evidence.repository.ts
keyword-search-evidence.service.ts
```

Responsibilities:

### `keyword-search-evidence-normalize.ts`

Pure exact-match normalization only.

### `keyword-search-evidence.ts`

Pure provider aggregation and evidence-state resolution. No Prisma, no network, no Express.

### `keyword-search-evidence.repository.ts`

Read-only adapter over `SearchFactRepository` and provider manifests. It loads persisted facts and lane/source metadata only.

### `keyword-search-evidence.service.ts`

Orchestrates:

1. authoritative keyword lookup by `(projectId, keywordId)`;
2. date-window validation/defaulting;
3. persisted fact load;
4. exact match normalization;
5. lane aggregation;
6. provider availability projection.

No method in this service may enqueue provider synchronization.

## 13. Persistence Design

P11-02A should add **no new ranking/search-evidence persistence table**.

Reason:

- `SearchFact` already preserves provider observations and provenance;
- P11-02A aggregation is deterministic over a requested time window;
- storing a second derived ranking snapshot would introduce stale duplicated truth without a current requirement.

If implementation inspection reveals a performance problem, that must be treated as a separate design change rather than silently adding derived persistence during GREEN work.

No Prisma migration is expected for P11-02A.

## 14. Read Model

Suggested types:

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

Exact final naming may follow repository conventions, but the semantics above are frozen.

## 15. JSON API

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

No CSRF is required because the route is read-only.

Fail-closed rules:

- foreign/nonexistent project remains project-not-found according to existing middleware;
- foreign keyword ID returns `KEYWORD_NOT_FOUND` without leaking its true project;
- unsupported provider filters do not cause network calls; provider capability can be returned as `UNAVAILABLE` when the provider code is valid;
- malformed dates or filters fail with stable validation errors.

Suggested new error codes:

- `KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID`
- `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID`

Existing `KEYWORD_NOT_FOUND` remains the keyword identity error.

## 16. Keyword Center UI

Extend the existing P11 Keyword Center instead of adding a disconnected dashboard.

### 16.1 Library row summary

Add a compact **搜索证据 / Search Evidence** area showing provider states, for example:

```text
Google GSC   OBSERVED
1,286 impressions · 74 clicks · 5.75% CTR
Search Console 平均位置 8.4

Bing         UNKNOWN
当前数据完整度不足，不能判断该关键词未出现
```

The table must remain usable at the existing responsive breakpoints.

### 16.2 Provider evidence panel

A project keyword detail/search-evidence section should show:

- provider display name;
- state badge;
- market / locale / property lane;
- requested date window;
- latest source date;
- completeness;
- metrics supported by that provider;
- matched Google pages where available;
- source/provenance explanation;
- explicit truth note.

### 16.3 Required truth copy

Google evidence must visibly state:

> Search Console 平均位置是所选数据窗口的官方汇总指标，不代表某个用户此刻看到的实时 Google SERP 排名。

Absent incomplete data must visibly state:

> 当前持久化数据不完整，未观察到该关键词不能解释为 0 搜索量或无排名。

### 16.4 Provider availability cards

Baidu/360/Sogou/Shenma can be listed with their manifest capability state, but no fabricated metric placeholders such as `排名 0` should appear.

## 17. No-Execution Read Contract

P11-02A keyword evidence reads must be side-effect free.

Tests must prove that calling the JSON API or rendering Keyword Center does **not** call or enqueue:

- Search Console sync;
- Bing provider collection;
- crawler enqueue;
- AI task enqueue;
- content generation;
- publication/distribution.

The feature is a projection over persisted facts only.

## 18. Authorization and Security

- reads require existing `PROJECT_READ`;
- no new role/capability is introduced;
- no provider tokens or credential references are rendered;
- no OAuth vault access is needed for keyword evidence reads;
- cross-project keyword IDs fail closed;
- no mutation endpoint is introduced;
- no CSRF-exempt mutation is introduced;
- output provenance may expose safe snapshot/fact identifiers but never secrets.

## 19. Determinism

For the same persisted facts, keyword text, filters, and clock/window, output must be stable.

Required deterministic ordering:

1. provider code;
2. market code;
3. locale;
4. propertyRef;
5. matched pages by impressions desc, clicks desc, canonical URL asc;
6. snapshot IDs lexicographically sorted.

Floating-point aggregates used for output should be calculated consistently and rounded only at the presentation boundary, not during aggregation.

## 20. Observability

P11-02A should use low-cardinality application observability only for failures and important read diagnostics.

Minimum useful signals:

- keyword search-evidence evaluation failed;
- invalid evidence range/filter;
- provider fact conflict/invalid required metric;
- unsupported/not-implemented provider projection count where existing observability conventions support it.

Do not log:

- provider credentials;
- OAuth tokens;
- full sensitive request headers.

A normal successful read does not need noisy per-keyword logs if existing request telemetry already covers it.

## 21. Test Strategy

Implementation must follow **RED -> minimal GREEN -> exact-head full CI**.

### 21.1 Pure normalization

Test:

- NFKC;
- whitespace collapse;
- Latin lowercase;
- curly quote normalization;
- dash normalization;
- Traditional/Simplified Chinese remain distinct.

### 21.2 Pure evidence aggregation

Google:

- exact query match;
- sum clicks/impressions;
- recompute CTR;
- impression-weight average position;
- deterministic matched-page ordering;
- absent query + `TOP_ROWS_ONLY` => `UNKNOWN`;
- known matching rows => `OBSERVED`.

Bing:

- exact query match;
- sum clicks/impressions;
- click-weight avg click position;
- impression-weight avg impression position;
- unknown provider metric remains unknown;
- absent query + `PROVIDER_UNSPECIFIED` => `UNKNOWN`.

Generic:

- complete source + no match => `NOT_OBSERVED`;
- unsupported/not-implemented query capability => `UNAVAILABLE`.

### 21.3 Repository/service integration

Seed persisted `SearchFact` rows and authoritative keywords.

Test:

- same-project keyword resolves real evidence;
- foreign keyword fails closed;
- multiple provider/market/property lanes stay separate;
- 28-day default UTC window;
- explicit range validation;
- provider/market/locale/property filters;
- no direct provider transport invocation;
- no enqueue side effects.

### 21.4 API authorization

Test:

- anonymous => 401;
- VIEWER/project member with `PROJECT_READ` => 200;
- non-member => project-not-found behavior;
- foreign keyword ID => `KEYWORD_NOT_FOUND`;
- no CSRF required for GET;
- invalid filters/ranges return stable errors.

### 21.5 Web/UI

Test:

- Keyword Center renders Google observed evidence when seeded;
- labels metric as `Search Console 平均位置`, not `Google 当前排名`;
- absent incomplete data renders `UNKNOWN`, not zero;
- unavailable China provider capabilities render truthful unavailable wording;
- VIEWER can read evidence;
- rendering does not enqueue provider/crawl/AI work;
- responsive Playwright coverage remains green.

### 21.6 Exact-head regression

At each frozen phase and final closure head, require the repository's current full gates:

- `verify`
- `production-audit`
- `deployment-artifact`
- `e2e`

No phase is declared complete without exact-head evidence.

## 22. Recommended Implementation Phases

P11-02A should be delivered as four isolated freezes:

### A — Pure matcher + provider aggregation

- normalization;
- evidence states;
- Google/Bing aggregation;
- no Prisma/Express.

### B — Persisted SearchFact read service

- repository/service;
- lanes and date filters;
- no network/queue side effects;
- freeze read-domain semantics.

### C — Secured JSON API

- `PROJECT_READ`;
- fail closed;
- stable range/filter errors;
- freeze API contract.

### D — Keyword Center evidence UI + E2E

- truthful provider labels;
- responsive UI;
- provider availability projection;
- final exact-head closure evidence document.

Each phase uses RED first and full exact-head CI before advancing.

## 23. P11-02B / P11-02C Boundary

P11-02A intentionally stops before live rank-provider work.

### P11-02B — Live SERP Rank Provider

Future design may introduce a paid third-party SERP provider with explicit:

- engine;
- location;
- language;
- device;
- timestamp;
- organic rank/URL evidence;
- cost/rate limits;
- credential handling;
- provider health/freshness semantics.

Only that future evidence should be labeled live/observed SERP rank.

### P11-02C — China Search Evidence Import/Provider

Future design may add supported official/platform-backed evidence for Baidu or other China search platforms. It must respect each provider's actual API/platform capability and must not rely on fragile direct SERP scraping as the authoritative system fact path.

## 24. Branch and Integration Strategy

P11-01 PR #182 remains Draft and unmerged at design time.

Therefore P11-02A is designed as a stacked change based on:

`e1786e7019c6eeaacf5e1c4a7d0993c504763ae8`

Design branch:

`docs/p11-02a-official-search-evidence-design`

After P11-01 is eventually merged, P11-02A implementation must be rebased/retargeted onto the real `main` integration point before final integration. No direct default-branch writes are permitted.

## 25. Acceptance Criteria

P11-02A is complete only when all are true:

1. an authoritative keyword can resolve exact official Google/Bing persisted query evidence;
2. Google evidence displays clicks, impressions, recomputed CTR, and Search Console average position with provenance;
3. Bing evidence preserves provider-specific positions and unknown values honestly;
4. absent incomplete Google/Bing rows are `UNKNOWN`, not zero or `NOT_OBSERVED`;
5. `NOT_OBSERVED` is emitted only with complete query evidence;
6. unsupported/not-implemented provider query capability is `UNAVAILABLE`;
7. markets/locales/properties are never silently merged;
8. reads trigger no provider sync, crawl, AI, content, publication, or distribution execution;
9. cross-project access fails closed;
10. UI never labels Search Console/Bing average positions as deterministic live SERP rank;
11. no new ranking persistence table is introduced;
12. final exact-head full CI is green;
13. no merge or deployment occurs without separate authorization.
