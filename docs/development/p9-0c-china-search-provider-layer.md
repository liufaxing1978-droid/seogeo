# P9-0C China Search Provider Layer

## Purpose

P9-0C adds explicit mainland-China search-provider capability metadata for Baidu Search Resource Platform, 360 Search Webmaster Platform, Sogou Webmaster Platform, and Shenma Webmaster Platform.

The layer is deliberately conservative. It records what an official platform publicly exposes, distinguishes callable API access from authenticated platform/UI access, and fails closed when no stable authoritative programmatic interface has been verified.

P9-0C does **not** scrape authenticated dashboards, reverse-engineer private endpoints, persist China-provider credentials, or create provider write clients.

## Provider codes

- `BAIDU_SEARCH_RESOURCE`
- `QIHOO_360_WEBMASTER`
- `SOGOU_WEBMASTER`
- `SHENMA_WEBMASTER`

These extend the P9-0B provider registry alongside:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`

## Access modes

Every provider capability declares one access mode:

- `API` — an authoritative programmatic interface is known. This does not imply the runtime currently enables it.
- `PLATFORM_ONLY` — an official authenticated webmaster-platform/UI surface is verified, but P9-0C has no approved runtime adapter for it.
- `NONE` — no equivalent surface is asserted by this implementation.

Capability state and access mode are intentionally separate. For example, Baidu URL submission is `NOT_IMPLEMENTED + API`: the official submission API exists, but this system refuses to call it in P9-0C.

## Evidence-bounded China capability matrix

The matrix below is intentionally stricter than a generic "webmaster platform has analytics" assumption. A capability is marked `PLATFORM_ONLY` only when an official public page supports that specific mapping. Otherwise it remains `NOT_SUPPORTED + NONE`.

| Capability | Baidu | 360 Search | Sogou | Shenma |
| --- | --- | --- | --- | --- |
| List/manage verified properties | Platform only | Platform only | Platform only | Platform only |
| Query + page daily facts | None | None | None | None |
| Query statistics | Platform only | None | Platform only | Platform only |
| Page statistics | None | None | None | None |
| Site traffic | Platform only, cadence unspecified | None | Platform only, daily | Platform only, cadence unspecified |
| Index coverage / index volume | Platform only | None | Platform only | Platform only |
| Crawl statistics | Platform only | None | Platform only | Platform only |
| Robots observation | Platform only | None | None | None |
| Provider diagnostics | Platform only | None | None | Platform only |
| URL inspection equivalent | None | None | None | None |
| URL submission | API exists but runtime disabled | Platform only | Platform only | None |
| Sitemap submission | Platform only | None | Platform only | Platform only |

`None` means `NOT_SUPPORTED + NONE` in the P9-0C contract. It does not claim that the provider can never add such a feature; it means this release has insufficient authoritative evidence to model an equivalent capability.

## Baidu Search Resource Platform

Official Baidu Search Resource Platform material documents:

- resource submission;
- traffic and keyword reporting;
- index-volume reporting;
- crawl-frequency / crawl-diagnostics tooling;
- robots-related tooling;
- ordinary-inclusion API submission.

The public API documentation states that one ordinary-inclusion request accepts at most 2,000 URLs. This is recorded only as provider reference information; P9-0C does not implement submission.

### Secure-transport blocker

Baidu's currently verifiable public material still shows the ordinary-inclusion submission endpoint in the form:

```text
http://data.zz.baidu.com/urls?site=...&token=...
```

Because the token-bearing example uses plaintext HTTP, P9-0C records `URL_SUBMISSION` as `NOT_IMPLEMENTED + API` and keeps runtime writes disabled. The system must not send a production token over an unverified plaintext transport merely because an official API exists.

Relevant official references used for this capability snapshot:

- `https://ziyuan.baidu.com/college/articleinfo?id=267&page=2`
- `https://ziyuan.baidu.com/college/articleinfo?id=3019`
- `https://ziyuan.baidu.com/college/articleinfo?id=3076`
- `https://ziyuan.baidu.com/college/articleinfo?id=3159`

## 360 Search Webmaster Platform

The official public platform homepage exposes broad categories including data submission, data analysis, official-site verification, and mobile adaptation:

- `https://zhanzhang.so.com/`

P9-0C does not translate the generic label "data analysis" into query statistics, page statistics, index coverage, crawl statistics, or other precise fact types without a public official page establishing that equivalence. Therefore exact analytics capabilities remain `NOT_SUPPORTED + NONE` in this release.

Verified property management and URL/data submission remain `PLATFORM_ONLY`; there is no runtime adapter.

## Sogou Webmaster Platform

Official Sogou resource-platform help pages expose specific webmaster surfaces including:

- site verification and management;
- sitemap submission;
- URL/resource submission;
- crawl-pressure reporting;
- index reporting;
- site traffic reporting;
- keyword reporting.

Official traffic help states that site traffic data is shown for individual days and updated daily, so P9-0C records `SITE_TRAFFIC_DAILY` as `PLATFORM_ONLY` with `DAILY` cadence. Keyword reporting remains provider-specific `QUERY_STATS`; it is not fabricated into Google-style query+page daily facts.

Relevant official references:

- `https://zhanzhang.sogou.com/index.php/help/toolhelp`
- `https://zhanzhang.sogou.com/index.php/help/keyword`
- `https://zhanzhang.sogou.com/index.php/help/analysis`
- `https://zhanzhang.sogou.com/index.php/flow/index`

## Shenma Webmaster Platform

Official Shenma help material exposes:

- site registration / verification;
- search traffic and keyword analysis;
- crawl-volume / crawl-frequency / crawl-exception analysis;
- index and site-analysis data;
- sitemap submission;
- structured-data / data-open workflows.

P9-0C maps those verified surfaces conservatively to provider-specific `PLATFORM_ONLY` capabilities. It does not claim page-level statistics, robots observation, URL inspection, or URL-submission equivalence where no authoritative mapping was established.

Official references:

- `https://zhanzhang.sm.cn/open/help`
- `https://zhanzhang.sm.cn/open/helpuser`
- `https://zhanzhang.sm.cn/open/helpAnalyse`
- `https://zhanzhang.sm.cn/open/helpsitemap`
- `https://zhanzhang.sm.cn/open/helpopen`

Shenma's service terms also reinforce the no-scraping boundary by restricting unauthorized extraction, monitoring, reverse engineering, and use of platform information. P9-0C therefore does not use browser automation or authenticated-dashboard scraping as a substitute for an API.

## China provider policy

`china-search-provider.policy.ts` defines immutable policy metadata for all four China providers:

- market: `CN`;
- credential persistence: disabled;
- authenticated dashboard scraping: disabled;
- undocumented/private endpoint access: disabled;
- runtime writes: disabled.

This policy module performs no I/O.

## No fabricated metric equivalence

P9-0C does not force China platform data into Google Search Console semantics.

In particular:

- no China provider supports `QUERY_PAGE_DAILY` in this release;
- no missing CTR or position is synthesized;
- no generic "data analysis" UI is treated as evidence for a particular metric shape;
- platform/UI presence does not make a capability callable by runtime code;
- `requireSearchProviderCapability()` continues to fail closed for every China provider capability in P9-0C.

## Existing Google and Bing behavior

P9-0C does not change P9-0B runtime behavior:

- Google Search Console query+page daily reads remain supported and marked `TOP_ROWS_ONLY` at the observation layer.
- Existing `GSC_QUERY_NORMALIZATION_VERSION` remains `GSC_QUERY_NORMALIZATION_V1`.
- Bing query/page statistics remain weekly provider-specific observations.
- Bing site traffic remains daily site-level observations.

## Market boundary

P9-0A remains the authority for project market/locale resolution. China provider policy is explicitly `CN`, but `src/modules/search-providers` must not independently read legacy `Project.targetCountry` or `Project.defaultLanguage` fields.

Later orchestration must resolve active markets through the P9-0A market service/port before selecting providers.

## Relationship to P9-0F unified facts

P9-0C persists no China search observations and creates no fake facts. It only supplies provider capability and governance metadata.

P9-0F is responsible for any future unified search-fact persistence. A China-provider source can enter that layer only when there is an approved authoritative acquisition path and a provider-specific observation contract that preserves source cadence, completeness, and provenance.

## Upgrade path

If a provider publishes a stable authoritative API later:

1. verify the official API documentation and authentication model;
2. verify transport security and terms of use;
3. add a provider-specific observation contract rather than reusing an incompatible Google/Bing shape;
4. add RED contract tests for response validation, secrets, rate limits, completeness, and cadence;
5. implement a read-only adapter first where possible;
6. change the manifest from `PLATFORM_ONLY`/`NONE` only after exact-head tests prove the new capability;
7. keep write capabilities behind a separate explicit security and approval review.

Do not silently change capability semantics based on third-party articles, reverse-engineered endpoints, or login-page network calls.

## Rollback

P9-0C is code/configuration-only and adds no database migration. Rollback can remove the four China provider codes, manifests, policy metadata, tests, and this document, provided no later P9 phase has begun persisting references to those provider codes.

Rollback must not modify existing Google Search Console or Bing facts, P9-0A market rows, P7 growth truth, or P8 publication truth.

## Release gate

P9-0C is complete only when the exact feature head passes:

1. Prisma validation and generation;
2. all migrations;
3. TypeScript typecheck;
4. full Vitest suite;
5. production build;
6. full Chromium Playwright E2E;
7. deployable runtime dependency audit.

The release gate also requires the source-level compatibility tests proving no China authenticated-dashboard client, browser-scraping library, legacy market-field dependency, fabricated query+page capability, or runtime provider write path was introduced.
