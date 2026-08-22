# P9-0C China Search Provider Layer Implementation Plan

> **Execution mode:** Subagent-Driven Development + TDD. Every task follows RED → minimal GREEN → exact-head CI.

**Goal:** Add conservative, provider-neutral China search coverage for Baidu, 360 Search, Sogou, and Shenma without fabricating unsupported metrics, scraping authenticated dashboards, or transmitting credentials over an unverified transport.

**Architecture:** Extend the existing P9-0B search-provider contracts and registry. P9-0C records official platform capabilities and access modes, but only exposes a callable runtime capability when a stable, authoritative programmatic interface is verified and safe enough for production. Current official research confirms Baidu has an API submission workflow, while 360/Sogou/Shenma mainly expose webmaster-platform/UI workflows in publicly verifiable documentation. Baidu's authoritative public documentation still shows a plaintext HTTP token endpoint, so P9-0C deliberately records the API as present-but-not-implemented rather than sending production secrets over plaintext HTTP.

**Hard boundaries:**

- No authenticated-dashboard scraping.
- No browser automation against webmaster portals.
- No undocumented/private endpoint reverse engineering.
- No provider session-cookie storage.
- No China provider credential persistence in `src/modules/search-providers`.
- No fake query/page/CTR/position metrics.
- No provider write calls in P9-0C.
- No P7/P8/queue/autopilot changes.
- Existing Google/Bing behavior must remain unchanged.
- P9-0A remains market/locale authority; China providers do not inspect legacy `Project.targetCountry/defaultLanguage` directly.

## Official capability snapshot used by this plan

### Baidu Search Resource Platform

Public platform surface includes resource submission, index volume, traffic/keywords, crawl frequency/diagnostics/errors, robots, and related webmaster tools. Official documentation states ordinary-inclusion API submission and documents the endpoint as `http://data.zz.baidu.com/urls?site=...&token=...`; each request accepts at most 2,000 URLs. Because this documented endpoint transports the token over plaintext HTTP, runtime submission remains fail-closed in P9-0C.

### 360 Search Webmaster Platform

Public platform exposes data submission, data analysis, sitemap submission, mobile adaptation, site verification, and related webmaster tooling. No stable public statistics API contract was verified for P9-0C. A 2025 official/community answer to API sitemap submission still directs users to the webmaster UI rather than an API.

### Sogou Webmaster Platform

Public resource platform exposes URL/resource submission and webmaster tools. Current public resource-submission page is UI-based and does not establish a stable public statistics API contract for P9-0C.

### Shenma Webmaster Platform

Public platform exposes sitemap submission, data-open features, website analysis, and mobile adaptation. No stable public statistics API contract was verified for P9-0C.

---

## Task 1 — Extend provider codes, capabilities, and access-mode contracts

**Files**
- Modify: `src/modules/search-providers/search-provider.types.ts`
- Modify: `tests/unit/search-provider.types.test.ts`

Add providers:

```ts
'BAIDU_SEARCH_RESOURCE'
'QIHOO_360_WEBMASTER'
'SOGOU_WEBMASTER'
'SHENMA_WEBMASTER'
```

Add capabilities:

```ts
'INDEX_COVERAGE'
'ROBOTS_OBSERVATION'
'PROVIDER_DIAGNOSTICS'
```

Add access mode:

```ts
export type SearchProviderAccessMode = 'API' | 'PLATFORM_ONLY' | 'NONE';
```

Extend descriptor:

```ts
export interface SearchProviderCapabilityDescriptor {
  state: CapabilityState;
  cadence: SourceCadence;
  readOnly: boolean;
  accessMode: SearchProviderAccessMode;
  notes?: string;
}
```

Rules:
- Every manifest capability must explicitly declare access mode.
- `SUPPORTED + API` means callable by current runtime.
- `NOT_IMPLEMENTED + API` means official programmatic capability exists but P9 runtime deliberately does not expose it yet.
- `NOT_IMPLEMENTED + PLATFORM_ONLY` means official platform/UI capability exists but no stable public API adapter is implemented.
- `NOT_SUPPORTED + NONE` means the provider contract does not offer an equivalent surface.

RED tests must lock the exact provider/capability arrays and the access-mode union behavior.

---

## Task 2 — Expand the capability registry for all six search providers

**Files**
- Modify: `src/modules/search-providers/search-provider.registry.ts`
- Modify: `tests/unit/search-provider.registry.test.ts`

### Existing provider preservation

Google and Bing retain all P9-0B states/cadences. Add accessMode without changing semantics:
- callable existing reads → `API`
- unimplemented provider/API concepts → `API` where an existing public API family supports them, otherwise `NONE`
- unsupported equivalence → `NONE`

### Baidu manifest

Conservative P9-0C states:

- `LIST_PROPERTIES`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `QUERY_PAGE_DAILY`: `NOT_SUPPORTED`, `NONE`
- `QUERY_STATS`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `PAGE_STATS`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `SITE_TRAFFIC_DAILY`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `INDEX_COVERAGE`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `CRAWL_STATS`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `ROBOTS_OBSERVATION`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `PROVIDER_DIAGNOSTICS`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `URL_INSPECTION`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`
- `URL_SUBMISSION`: `NOT_IMPLEMENTED`, `API`, readOnly false; note secure-transport blocker
- `SITEMAP_SUBMISSION`: `NOT_IMPLEMENTED`, `PLATFORM_ONLY`, readOnly false

### 360 Search manifest

All publicly observed webmaster functions are `NOT_IMPLEMENTED + PLATFORM_ONLY`; no query/page equivalence is claimed. `QUERY_PAGE_DAILY` is `NOT_SUPPORTED + NONE`.

### Sogou manifest

URL/resource submission and webmaster surfaces are `NOT_IMPLEMENTED + PLATFORM_ONLY`; no public statistics API is claimed. `QUERY_PAGE_DAILY` is `NOT_SUPPORTED + NONE`.

### Shenma manifest

Sitemap/data-open/website-analysis/mobile-adaptation surfaces are `NOT_IMPLEMENTED + PLATFORM_ONLY`; no public statistics API is claimed. `QUERY_PAGE_DAILY` is `NOT_SUPPORTED + NONE`.

Registry tests must verify:
- all six providers list exactly once;
- China providers fail closed through `requireSearchProviderCapability`;
- Baidu URL submission is not callable despite official API existence;
- existing Google/Bing supported capabilities remain supported and unchanged.

---

## Task 3 — Add China provider policy metadata without network clients

**Files**
- Create: `src/modules/search-providers/china-search-provider.policy.ts`
- Create: `tests/unit/china-search-provider.policy.test.ts`

Create immutable policy metadata:

```ts
export interface ChinaSearchProviderPolicy {
  provider: Extract<SearchProviderCode,
    | 'BAIDU_SEARCH_RESOURCE'
    | 'QIHOO_360_WEBMASTER'
    | 'SOGOU_WEBMASTER'
    | 'SHENMA_WEBMASTER'>;
  market: 'CN';
  credentialPersistenceAllowed: false;
  authenticatedDashboardScrapingAllowed: false;
  undocumentedEndpointAccessAllowed: false;
  runtimeWriteEnabled: false;
  reasons: readonly string[];
}
```

Exports:

```ts
export function getChinaSearchProviderPolicy(provider: ChinaSearchProviderCode): ChinaSearchProviderPolicy;
export function listChinaSearchProviderPolicies(): readonly ChinaSearchProviderPolicy[];
```

Tests must prove all four providers:
- are CN-market only at this policy layer;
- disallow credential persistence;
- disallow authenticated portal scraping;
- disallow undocumented endpoints;
- have runtime writes disabled.

This module is policy metadata only. It performs no I/O.

---

## Task 4 — Add source-level compatibility and anti-scraping guards

**Files**
- Create: `tests/integration/china-search-provider.compatibility.test.ts`

Integration tests must prove:

1. Existing Google/Bing manifests retain their P9-0B supported capabilities.
2. `GSC_QUERY_NORMALIZATION_VERSION === 'GSC_QUERY_NORMALIZATION_V1'`.
3. Search-provider production source does not import Playwright/Puppeteer/Cheerio for China portal scraping.
4. No China-provider runtime client file exists that calls authenticated webmaster dashboards.
5. China provider source does not read `targetCountry` or `defaultLanguage`.
6. `requireSearchProviderCapability('BAIDU_SEARCH_RESOURCE', 'URL_SUBMISSION')` fails closed.
7. No provider code fabricates `QUERY_PAGE_DAILY` for Baidu/360/Sogou/Shenma.

Source scan should be narrowly limited to `src/modules/search-providers/**/*.ts`.

---

## Task 5 — Document provider matrix and security blocker

**Files**
- Create: `docs/development/p9-0c-china-search-provider-layer.md`

Document:
- provider matrix;
- API vs platform-only distinction;
- Baidu official API submission capability and plaintext-HTTP blocker;
- 2,000 URL/request official Baidu limit as reference only, not runtime behavior;
- 360/Sogou/Shenma verified public platform surfaces;
- why dashboard scraping/private endpoints are prohibited;
- relationship to P9-0F unified facts;
- upgrade path when an authoritative safe API becomes available;
- rollback instructions.

No production token/example credential belongs in documentation.

---

## Task 6 — Exact-head release gate

Run against the exact feature head:

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Completion assertions:
- six provider manifests present;
- Google/Bing behavior unchanged;
- China providers explicit and fail closed;
- no runtime China-provider write call;
- no authenticated-dashboard scraping;
- no credentials persisted;
- no fabricated metrics;
- exact-head verify/e2e/production-audit green.

After P9-0C merge, proceed to **P9-0D Global AI Visibility Expansion**.
