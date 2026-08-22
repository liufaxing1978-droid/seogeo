# P9-0B Global Search Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral global search interface that preserves existing Google Search Console behavior and adds a read-only Bing Webmaster adapter without inventing metric equivalence or changing P7/P8 authority.

**Architecture:** Introduce a focused `search-providers` module that owns provider codes, capability manifests, normalized observation envelopes, provider registry, a Google adapter over the existing Search Console transport, and a Bing Webmaster JSON/HTTP client + adapter. Existing GSC persistence, OAuth flow, worker, snapshots, and facts remain authoritative and unchanged; P9-0B exposes adapter contracts only. Unified persisted cross-provider facts are intentionally deferred to P9-0F.

**Tech Stack:** Node.js 22, TypeScript 5.9, Zod 3.25, Vitest 3.2, existing Google Search Console module, native `fetch`, P9-0A `MarketSelection` contract.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-global-china-seogeo-controlled-autopilot-design.md`

## Global Constraints

- P0-P8-C and P9-0A remain complete and backward compatible.
- Existing Google Search Console persistence and `GscDailySnapshot` / `GscQueryPageFact` truth are not renamed, migrated, recomputed, or reinterpreted.
- P9-0B adds no P7 scoring changes, P8 mutation changes, queues, schedulers, autonomous optimization, or unified cross-provider fact persistence.
- Provider capability is explicit. Unsupported or unavailable semantics remain `NOT_SUPPORTED` / `NOT_IMPLEMENTED`; missing metrics are never coerced to zero.
- Google Search Console Search Analytics query+page observations retain `TOP_ROWS_ONLY` completeness semantics because Search Console does not guarantee all rows.
- Bing query and page statistics are not represented as Google-style daily query+page facts. Bing's documented query/page statistics are updated weekly; site rank/traffic statistics are updated daily.
- Bing SOAP and POX are not implemented. The adapter uses the documented JSON/HTTP endpoint pattern and OAuth Bearer or API-key authentication only.
- Read-only provider operations only. URL submission, sitemap submission, site mutation, and provider settings writes are capability metadata only and are not callable in P9-0B.
- Bing AI Performance is not represented as a supported API capability in P9-0B because no authoritative export API is established by this plan.
- Provider adapters never own or persist credentials. Authentication values are injected by callers and never emitted in errors, logs, observations, or test snapshots.
- P9-0A remains the market-resolution authority. Provider callers consume `MarketSelection`; provider code must not independently interpret `Project.targetCountry` or `Project.defaultLanguage`.
- Every task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### New provider core

- `src/modules/search-providers/search-provider.types.ts`
- `src/modules/search-providers/search-provider.registry.ts`
- `src/modules/search-providers/google-search-provider.adapter.ts`
- `src/modules/search-providers/bing-webmaster.client.ts`
- `src/modules/search-providers/bing-search-provider.adapter.ts`

### Existing Google integration

- No production modification required to `src/modules/search-console/google-search-console.client.ts` unless a type-only export is strictly necessary and covered by tests.
- No production modification to GSC Prisma models, repository, worker, service, or routes in this plan.

### Tests

- `tests/unit/search-provider.types.test.ts`
- `tests/unit/search-provider.registry.test.ts`
- `tests/unit/google-search-provider.adapter.test.ts`
- `tests/unit/bing-webmaster.client.test.ts`
- `tests/unit/bing-search-provider.adapter.test.ts`
- `tests/integration/search-provider.compatibility.test.ts`

### Documentation

- `docs/development/p9-0b-global-search-provider-layer.md`

---

### Task 1: Define Provider Codes, Capability Manifests, and Observation Contracts

**Files:**
- Create: `src/modules/search-providers/search-provider.types.ts`
- Test: `tests/unit/search-provider.types.test.ts`

**Interfaces:**

```ts
export const SEARCH_PROVIDER_CODES = [
  'GOOGLE_SEARCH_CONSOLE',
  'BING_WEBMASTER'
] as const;
export type SearchProviderCode = typeof SEARCH_PROVIDER_CODES[number];

export const SEARCH_PROVIDER_CAPABILITIES = [
  'LIST_PROPERTIES',
  'QUERY_PAGE_DAILY',
  'QUERY_STATS',
  'PAGE_STATS',
  'SITE_TRAFFIC_DAILY',
  'CRAWL_STATS',
  'URL_INSPECTION',
  'URL_SUBMISSION',
  'SITEMAP_SUBMISSION'
] as const;
export type SearchProviderCapability = typeof SEARCH_PROVIDER_CAPABILITIES[number];

export type CapabilityState = 'SUPPORTED' | 'NOT_SUPPORTED' | 'NOT_IMPLEMENTED';
export type SourceCadence = 'DAILY' | 'WEEKLY' | 'ON_DEMAND' | 'UNKNOWN';
export type CompletenessState = 'COMPLETE' | 'TOP_ROWS_ONLY' | 'PROVIDER_UNSPECIFIED';

export interface SearchProviderCapabilityDescriptor {
  state: CapabilityState;
  cadence: SourceCadence;
  readOnly: boolean;
  notes?: string;
}

export interface SearchProviderManifest {
  provider: SearchProviderCode;
  displayName: string;
  capabilities: Readonly<Record<SearchProviderCapability, SearchProviderCapabilityDescriptor>>;
}

export interface SearchProviderProperty {
  provider: SearchProviderCode;
  propertyRef: string;
  propertyType: 'DOMAIN' | 'URL_PREFIX' | 'SITE';
  permissionState: string;
  verified: boolean | null;
}

export interface GoogleQueryPageDailyObservation {
  kind: 'QUERY_PAGE_DAILY';
  provider: 'GOOGLE_SEARCH_CONSOLE';
  sourceDate: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  completeness: 'TOP_ROWS_ONLY';
}

export interface BingQueryObservation {
  kind: 'QUERY_STATS';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  query: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export interface BingPageObservation {
  kind: 'PAGE_STATS';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  page: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export interface BingSiteTrafficObservation {
  kind: 'SITE_TRAFFIC_DAILY';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  clicks: number;
  impressions: number;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export type SearchProviderObservation =
  | GoogleQueryPageDailyObservation
  | BingQueryObservation
  | BingPageObservation
  | BingSiteTrafficObservation;
```

- [ ] **Step 1: Write failing type/manifest tests**

Create `tests/unit/search-provider.types.test.ts` and assert the provider/capability constants are exact and immutable at runtime:

```ts
import { describe, expect, it } from 'vitest';
import {
  SEARCH_PROVIDER_CAPABILITIES,
  SEARCH_PROVIDER_CODES
} from '../../src/modules/search-providers/search-provider.types.js';

describe('search provider contracts', () => {
  it('locks the initial global provider set', () => {
    expect(SEARCH_PROVIDER_CODES).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER'
    ]);
  });

  it('locks capability names without generic OTHER buckets', () => {
    expect(SEARCH_PROVIDER_CAPABILITIES).toEqual([
      'LIST_PROPERTIES',
      'QUERY_PAGE_DAILY',
      'QUERY_STATS',
      'PAGE_STATS',
      'SITE_TRAFFIC_DAILY',
      'CRAWL_STATS',
      'URL_INSPECTION',
      'URL_SUBMISSION',
      'SITEMAP_SUBMISSION'
    ]);
  });
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/search-provider.types.test.ts
```

Expected: FAIL because `search-provider.types.ts` does not exist.

- [ ] **Step 3: Implement the exact contracts above**

No provider logic, fetch calls, registry, or persistence belongs in Task 1.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- tests/unit/search-provider.types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search-providers/search-provider.types.ts tests/unit/search-provider.types.test.ts
git commit -m "feat: define global search provider contracts"
```

---

### Task 2: Add Deterministic Provider Manifests and Registry

**Files:**
- Create: `src/modules/search-providers/search-provider.registry.ts`
- Test: `tests/unit/search-provider.registry.test.ts`

**Interfaces:**

```ts
export const GOOGLE_SEARCH_PROVIDER_MANIFEST: SearchProviderManifest;
export const BING_SEARCH_PROVIDER_MANIFEST: SearchProviderManifest;

export function getSearchProviderManifest(provider: SearchProviderCode): SearchProviderManifest;
export function listSearchProviderManifests(): readonly SearchProviderManifest[];
export function requireSearchProviderCapability(
  provider: SearchProviderCode,
  capability: SearchProviderCapability
): SearchProviderCapabilityDescriptor;
```

Google manifest states:

- `LIST_PROPERTIES`: `SUPPORTED`, `ON_DEMAND`, readOnly true
- `QUERY_PAGE_DAILY`: `SUPPORTED`, `DAILY`, readOnly true
- `QUERY_STATS`: `NOT_IMPLEMENTED`, `DAILY`, readOnly true
- `PAGE_STATS`: `NOT_IMPLEMENTED`, `DAILY`, readOnly true
- `SITE_TRAFFIC_DAILY`: `NOT_IMPLEMENTED`, `DAILY`, readOnly true
- `CRAWL_STATS`: `NOT_IMPLEMENTED`, `UNKNOWN`, readOnly true
- `URL_INSPECTION`: `NOT_IMPLEMENTED`, `ON_DEMAND`, readOnly true
- `URL_SUBMISSION`: `NOT_SUPPORTED`, `ON_DEMAND`, readOnly false
- `SITEMAP_SUBMISSION`: `NOT_IMPLEMENTED`, `ON_DEMAND`, readOnly false

Bing manifest states:

- `LIST_PROPERTIES`: `SUPPORTED`, `ON_DEMAND`, readOnly true
- `QUERY_PAGE_DAILY`: `NOT_SUPPORTED`, `UNKNOWN`, readOnly true
- `QUERY_STATS`: `SUPPORTED`, `WEEKLY`, readOnly true
- `PAGE_STATS`: `SUPPORTED`, `WEEKLY`, readOnly true
- `SITE_TRAFFIC_DAILY`: `SUPPORTED`, `DAILY`, readOnly true
- `CRAWL_STATS`: `NOT_IMPLEMENTED`, `DAILY`, readOnly true
- `URL_INSPECTION`: `NOT_IMPLEMENTED`, `ON_DEMAND`, readOnly true
- `URL_SUBMISSION`: `NOT_IMPLEMENTED`, `ON_DEMAND`, readOnly false
- `SITEMAP_SUBMISSION`: `NOT_IMPLEMENTED`, `ON_DEMAND`, readOnly false

- [ ] **Step 1: Write failing registry tests**

```ts
it('does not claim Bing query+page daily equivalence', () => {
  const manifest = getSearchProviderManifest('BING_WEBMASTER');
  expect(manifest.capabilities.QUERY_PAGE_DAILY.state).toBe('NOT_SUPPORTED');
  expect(manifest.capabilities.QUERY_STATS).toMatchObject({
    state: 'SUPPORTED', cadence: 'WEEKLY', readOnly: true
  });
});

it('preserves Google top-row query+page capability', () => {
  const manifest = getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE');
  expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
    state: 'SUPPORTED', cadence: 'DAILY', readOnly: true
  });
});

it('fails closed for unsupported or unimplemented capabilities', () => {
  expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'QUERY_PAGE_DAILY'))
    .toThrow(/not supported/i);
  expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'CRAWL_STATS'))
    .toThrow(/not implemented/i);
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/search-provider.registry.test.ts
```

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement frozen manifests and fail-closed lookup**

Use `Object.freeze` for top-level manifests and capability maps. Throw a dedicated `SearchProviderCapabilityError` containing only provider/capability/state; never credentials or source payloads.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- tests/unit/search-provider.registry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search-providers/search-provider.registry.ts tests/unit/search-provider.registry.test.ts
git commit -m "feat: add search provider capability registry"
```

---

### Task 3: Adapt Existing Google Search Console Transport Without Changing GSC Truth

**Files:**
- Create: `src/modules/search-providers/google-search-provider.adapter.ts`
- Test: `tests/unit/google-search-provider.adapter.test.ts`
- Test: `tests/integration/search-provider.compatibility.test.ts`

**Interfaces:**

```ts
export interface GoogleSearchProviderAccess {
  getAccessToken(projectId: string): Promise<string>;
  listReadableProperties(projectId: string): Promise<GoogleSiteEntry[]>;
}

export class GoogleSearchProviderAdapter {
  readonly provider = 'GOOGLE_SEARCH_CONSOLE' as const;
  constructor(
    private readonly access: GoogleSearchProviderAccess,
    private readonly transport: Pick<GoogleSearchConsoleTransport, 'querySearchAnalytics'>
  ) {}

  listProperties(projectId: string): Promise<SearchProviderProperty[]>;
  fetchQueryPageDaily(input: {
    projectId: string;
    propertyRef: string;
    sourceDate: string;
    rowLimit?: number;
  }): Promise<GoogleQueryPageDailyObservation[]>;
}
```

Rules:

- `rowLimit` defaults to 25,000 and must be integer `1..25_000`.
- Request dimensions are exactly `['query', 'page']`.
- `startDate === endDate === sourceDate`.
- Observations use provider `GOOGLE_SEARCH_CONSOLE`, kind `QUERY_PAGE_DAILY`, completeness `TOP_ROWS_ONLY`.
- Validate source date `YYYY-MM-DD` and every returned row: exactly two non-empty keys, finite nonnegative clicks/impressions/position, integer clicks/impressions, `ctr` between 0 and 1, http/https page URL without credentials.
- Do not normalize query/page into P7/GSC fact identity here; the existing GSC worker remains authoritative for persisted GSC normalization.
- `listProperties` maps `sc-domain:` entries to `DOMAIN` and URL-prefix entries to `URL_PREFIX`; readable properties are supplied by the existing SearchConsole service and remain filtered by existing permission logic.

- [ ] **Step 1: Write failing adapter tests**

Cover request shape, mapping, `TOP_ROWS_ONLY`, invalid metric rejection, invalid page URL rejection, invalid source date rejection, and >25k rowLimit rejection.

Core example:

```ts
it('maps Search Analytics query+page rows without persisting or re-normalizing them', async () => {
  const transport = {
    querySearchAnalytics: vi.fn().mockResolvedValue({ rows: [{
      keys: ['六壬', 'https://example.com/liuren'],
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 5.5
    }] })
  };
  const adapter = new GoogleSearchProviderAdapter(access, transport);
  await expect(adapter.fetchQueryPageDaily({
    projectId: 'p1', propertyRef: 'sc-domain:example.com', sourceDate: '2026-08-20'
  })).resolves.toEqual([{
    kind: 'QUERY_PAGE_DAILY',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    sourceDate: '2026-08-20',
    query: '六壬',
    page: 'https://example.com/liuren',
    clicks: 2,
    impressions: 20,
    ctr: 0.1,
    position: 5.5,
    completeness: 'TOP_ROWS_ONLY'
  }]);
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/google-search-provider.adapter.test.ts tests/integration/search-provider.compatibility.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement minimal adapter**

Reuse `GoogleSearchConsoleTransport` and `GoogleSiteEntry` types. Do not change the GSC worker or database models.

- [ ] **Step 4: Add compatibility regression**

`tests/integration/search-provider.compatibility.test.ts` must import existing `GSC_QUERY_NORMALIZATION_VERSION` and verify it remains exactly `GSC_QUERY_NORMALIZATION_V1`; also verify existing GSC Prisma model delegates (`gscDailySnapshot`, `gscQueryPageFact`) are still present after client generation by referencing their methods at compile time.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- tests/unit/google-search-provider.adapter.test.ts tests/integration/search-provider.compatibility.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/search-providers/google-search-provider.adapter.ts tests/unit/google-search-provider.adapter.test.ts tests/integration/search-provider.compatibility.test.ts
git commit -m "feat: adapt Google Search Console provider"
```

---

### Task 4: Implement Read-Only Bing Webmaster JSON/HTTP Client

**Files:**
- Create: `src/modules/search-providers/bing-webmaster.client.ts`
- Test: `tests/unit/bing-webmaster.client.test.ts`

**Interfaces:**

```ts
export type BingWebmasterAuth =
  | { kind: 'OAUTH_BEARER'; accessToken: string }
  | { kind: 'API_KEY'; apiKey: string };

export interface BingSiteEntry {
  url: string;
  isVerified: boolean;
}

export interface BingQueryStat {
  date: string;
  value: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
}

export interface BingTrafficStat {
  date: string;
  clicks: number;
  impressions: number;
}

export interface BingWebmasterTransport {
  listSites(auth: BingWebmasterAuth): Promise<BingSiteEntry[]>;
  getQueryStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]>;
  getPageStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]>;
  getRankAndTrafficStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingTrafficStat[]>;
}
```

HTTP rules:

- Base: `https://www.bing.com/webmaster/api.svc/json`.
- API-key auth appends `apikey=<encoded>` query parameter.
- OAuth auth sets `Authorization: Bearer <token>` and must not append the token to the URL.
- Methods: `GetUserSites`, `GetQueryStats`, `GetPageStats`, `GetRankAndTrafficStats`.
- `siteUrl` is sent through `URLSearchParams`; never string-concatenate raw user input.
- Parse legacy Microsoft JSON wrapper `{ "d": [...] }` with Zod.
- Parse Bing `/Date(<milliseconds><optional offset>)/` into UTC `YYYY-MM-DD` using the millisecond epoch value only; reject malformed date strings.
- Reject non-2xx responses with `BingWebmasterTransportError(code, httpStatus)`; messages contain no API key/token or provider body.
- Reject credential-bearing site/page URLs.
- Reject nonfinite/negative metrics; clicks/impressions must be integers.
- `AvgClickPosition` / `AvgImpressionPosition` may be `null`; if numbers, they must be finite and nonnegative.

- [ ] **Step 1: Write failing client tests**

Cover:

1. API key appears only as encoded `apikey` query parameter.
2. OAuth token appears only in Authorization header.
3. `GetUserSites` parses and returns verified state.
4. query/page stats parse `Query` as the generic `value` field.
5. Bing date wrapper conversion.
6. rank/traffic response conversion.
7. invalid JSON/schema/date/metric rejection.
8. 401/403/429/5xx transport errors expose status/code without credentials.

Example:

```ts
it('uses OAuth bearer without leaking it into the request URL', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ d: [] }), { status: 200 }));
  const client = new BingWebmasterClient(fetchImpl);
  await client.listSites({ kind: 'OAUTH_BEARER', accessToken: 'secret-token' });
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(String(url)).not.toContain('secret-token');
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token');
});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/bing-webmaster.client.test.ts
```

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement minimal client**

Do not add SubmitUrl, SubmitUrlBatch, SubmitFeed, crawl-settings writes, OAuth token exchange, credential persistence, or UI connection flows.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- tests/unit/bing-webmaster.client.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search-providers/bing-webmaster.client.ts tests/unit/bing-webmaster.client.test.ts
git commit -m "feat: add read-only Bing Webmaster client"
```

---

### Task 5: Add Bing Search Provider Adapter Without False Google Equivalence

**Files:**
- Create: `src/modules/search-providers/bing-search-provider.adapter.ts`
- Test: `tests/unit/bing-search-provider.adapter.test.ts`

**Interfaces:**

```ts
export class BingSearchProviderAdapter {
  readonly provider = 'BING_WEBMASTER' as const;
  constructor(
    private readonly transport: BingWebmasterTransport,
    private readonly auth: BingWebmasterAuth
  ) {}

  listProperties(): Promise<SearchProviderProperty[]>;
  fetchQueryStats(siteUrl: string): Promise<BingQueryObservation[]>;
  fetchPageStats(siteUrl: string): Promise<BingPageObservation[]>;
  fetchSiteTrafficDaily(siteUrl: string): Promise<BingSiteTrafficObservation[]>;
}
```

Mapping rules:

- `listProperties`: only verified Bing sites are returned; property type is `SITE`, permissionState `VERIFIED`, verified true.
- `fetchQueryStats`: map generic client `value` to `query`.
- `fetchPageStats`: validate `value` is an http/https URL without credentials, map to `page`.
- `fetchSiteTrafficDaily`: daily site-level clicks/impressions only.
- All Bing observations use completeness `PROVIDER_UNSPECIFIED`.
- Do not calculate CTR if Bing did not return CTR; do not synthesize a single `position` from AvgClickPosition / AvgImpressionPosition.
- Do not join query and page results into fabricated query-page rows.
- Result arrays are deterministically sorted by `sourceDate`, then `query`/`page` where applicable.

- [ ] **Step 1: Write failing adapter tests**

```ts
it('never fabricates query-page daily rows from Bing query stats', async () => {
  const adapter = new BingSearchProviderAdapter(transport, auth);
  const rows = await adapter.fetchQueryStats('https://example.com/');
  expect(rows[0]).toMatchObject({
    kind: 'QUERY_STATS',
    provider: 'BING_WEBMASTER',
    completeness: 'PROVIDER_UNSPECIFIED'
  });
  expect(rows[0]).not.toHaveProperty('page');
  expect(rows[0]).not.toHaveProperty('ctr');
  expect(rows[0]).not.toHaveProperty('position');
});
```

Also test verified-site filtering, deterministic sorting, invalid page URL rejection, and preservation of the two Bing average-position metrics as separate nullable fields.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/bing-search-provider.adapter.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement minimal adapter**

Use only methods declared by `BingWebmasterTransport`. No direct fetch calls in the adapter.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- tests/unit/bing-search-provider.adapter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/search-providers/bing-search-provider.adapter.ts tests/unit/bing-search-provider.adapter.test.ts
git commit -m "feat: add Bing search provider adapter"
```

---

### Task 6: Document Global Provider Semantics and Run Release Gate

**Files:**
- Extend: `tests/integration/search-provider.compatibility.test.ts`
- Create: `docs/development/p9-0b-global-search-provider-layer.md`

**Interfaces:**
- Establishes `getSearchProviderManifest(provider)` as the provider-capability authority for later P9-0C through P9-0G work.
- Establishes Google/Bing adapter outputs as provider-specific observations, not unified persisted facts.

- [ ] **Step 1: Add final compatibility assertions**

The integration test must prove:

```ts
it('keeps P9-0A market resolution independent from search-provider manifests', async () => {
  expect(getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE').provider).toBe('GOOGLE_SEARCH_CONSOLE');
  expect(getSearchProviderManifest('BING_WEBMASTER').provider).toBe('BING_WEBMASTER');
  // No provider code imports Project.targetCountry/defaultLanguage directly.
});

it('keeps GSC query/page persistence authority intact', () => {
  expect(GSC_QUERY_NORMALIZATION_VERSION).toBe('GSC_QUERY_NORMALIZATION_V1');
});
```

Add a repository-level source scan test limited to `src/modules/search-providers/**/*.ts` asserting neither `targetCountry` nor `defaultLanguage` appears in provider source files.

- [ ] **Step 2: Write developer/operator documentation**

Create `docs/development/p9-0b-global-search-provider-layer.md` with:

1. provider codes and capability matrix;
2. Google semantics and `TOP_ROWS_ONLY` limitation;
3. Bing semantics: query/page weekly, site traffic daily, no query+page equivalence;
4. authentication injection boundary and secret-handling rule;
5. read-only scope and explicit non-goals;
6. Bing protocol note: SOAP/POX not implemented; JSON/HTTP/OAuth path only;
7. relationship to P9-0A markets;
8. relationship to P9-0F unified persisted facts;
9. rollback guidance.

- [ ] **Step 3: Run focused provider suite**

```bash
npm test -- \
  tests/unit/search-provider.types.test.ts \
  tests/unit/search-provider.registry.test.ts \
  tests/unit/google-search-provider.adapter.test.ts \
  tests/unit/bing-webmaster.client.test.ts \
  tests/unit/bing-search-provider.adapter.test.ts \
  tests/integration/search-provider.compatibility.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full exact-head local release gate**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Expected: every command exits 0.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/search-provider.compatibility.test.ts docs/development/p9-0b-global-search-provider-layer.md
git commit -m "docs: verify P9-0B global search providers"
```

---

## P9-0B Completion Gate

Before PR merge, verify against the exact feature head:

- Google existing GSC OAuth/persistence/worker/storage code remains behaviorally unchanged.
- Google provider adapter exposes Query+Page daily observations with `TOP_ROWS_ONLY` completeness.
- Bing manifest does not claim Query+Page daily capability.
- Bing query/page observations preserve weekly cadence semantics and separate average click/impression positions.
- Bing site traffic observations are site-level only.
- Bing client supports only read methods in P9-0B.
- SOAP/POX endpoints are absent from production source.
- OAuth/API-key credentials are never persisted or included in observation/error payloads by the provider module.
- Provider source does not read `Project.targetCountry` or `Project.defaultLanguage`.
- No P7/P8/queue/autopilot/unified-fact behavior is introduced.
- exact-head `verify`, Chromium `e2e`, and `production-audit` are all green.

## Follow-on Plan Sequence

After P9-0B is merged and exact-head verified:

1. **P9-0C China Search Provider Layer** — Baidu, 360, Sogou, Shenma capability manifests and official adapters only where authoritative interfaces exist.
2. **P9-0D Global AI Visibility Expansion**.
3. **P9-0E China AI Visibility Expansion**.
4. **P9-0F Unified Search Facts** — persistence and normalization across provider-specific observation shapes.
5. **P9-0G P7 Multi-provider Growth Adapter**.
6. **P9-0H Third-party Skill Foundation**.
7. **P9-A Optimization Planner**.
