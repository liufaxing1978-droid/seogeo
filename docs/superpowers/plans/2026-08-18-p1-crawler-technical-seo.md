# P1 Crawler + Technical SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production data-ingestion layer for SEO GEO: create durable crawl runs, safely fetch project pages, parse deterministic technical signals, persist page history, expose crawl APIs/UI, and make the crawl queue execute real work.

**Architecture:** Extend the P0 modular monolith with a dedicated `crawler` module. A crawl request creates a durable `CrawlRun`, enqueues one BullMQ `crawl` job, then a worker performs URL discovery, robots/sitemap handling, HTTP fetching, optional browser fallback, HTML parsing, same-site link discovery, and append-only snapshot persistence. The crawler writes only factual crawl/page data; it does not calculate SEO/GEO scores or create SEO issues.

**Tech Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL, Prisma, Redis, BullMQ, Zod, native `fetch`, `cheerio`, `fast-xml-parser`, `robots-parser`, optional Playwright Chromium fallback, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-18-seo-geo-platform-design.md`

## Global Constraints

- Keep the P0 modular-monolith structure; do not introduce microservices in P1.
- `Project.primaryDomain` is stored without protocol and is the default crawl boundary.
- Crawler facts must come from actual network responses; never synthesize status codes, robots results, sitemap contents, titles, canonical URLs, or page counts.
- Historical `PageSnapshot`, HTTP results, render results, robots results, and sitemap observations are append-only.
- `Page` is stable URL identity; repeated crawls create new snapshots, not duplicate pages.
- The crawler may write Page/Crawl/Snapshot technical data only; SEO Rule Engine scoring and issue generation remain P2.
- AI/DeepSeek is not used in P1.
- AI Visibility remains unimplemented until P6.
- Default crawl scope is the exact project host plus the `www.` alias when it resolves through redirects; do not recursively crawl arbitrary external hosts.
- Only `http:` and `https:` URLs are eligible. Block loopback, link-local, RFC1918/private IP space, metadata endpoints, and non-public destinations by default to prevent SSRF.
- Respect robots.txt for link crawling. The root URL and robots/sitemap probes may be fetched to establish policy, but disallowed page URLs must not be crawled.
- Default limits: `maxPages=500`, `concurrency=4`, `requestTimeoutMs=15000`, `maxRedirects=10`, `maxResponseBytes=5_000_000`, `userAgent="SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)"`.
- P1 Browser fallback is opt-in via `CRAWLER_BROWSER_ENABLED=false` by default; HTTP parsing remains primary.
- CI must continue to pass Prisma validation/migration, TypeScript typecheck, Vitest/Supertest tests, and build.

---

## Planned File Structure

```text
src/modules/crawler/
  crawl.schema.ts            request validation and limits
  crawl.types.ts             shared crawler contracts
  crawl.repository.ts        Prisma persistence only
  crawl.service.ts           run lifecycle and enqueue contract
  crawl.routes.ts            REST endpoints
  crawl.worker.ts            BullMQ processor orchestration
  url-normalizer.ts          canonical URL identity rules
  network-policy.ts          protocol/host/IP SSRF checks
  robots.service.ts          robots fetch + allow/disallow policy
  sitemap.service.ts         sitemap discovery and XML parsing
  http-fetcher.ts            bounded HTTP request/redirect handling
  html-parser.ts             deterministic technical signal extraction
  browser-renderer.ts        optional Chromium fallback
  crawl-engine.ts            queue/visited/frontier orchestration
  crawl.mapper.ts            persistence DTO mapping
src/views/crawls/
  index.ejs
  show.ejs
src/views/pages/
  index.ejs
  show.ejs
```

---

### Task 1: Add crawler persistence models and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_crawler_foundation/migration.sql`
- Test: `tests/integration/crawler.persistence.test.ts`

**Interfaces:**
- Consumes: existing `Project.id`.
- Produces: Prisma models `CrawlRun`, `Page`, `PageSnapshot`, `HttpResult`, `RenderResult`, `RobotsResult`, `SitemapSource`, `SitemapUrl` and enums used by all later P1 tasks.

- [ ] **Step 1: Write a failing persistence test**

Create a project, then create one crawl run, one page, and two snapshots for the same normalized URL. Assert the page count is `1` and snapshot count is `2`.

```ts
expect(await prisma.page.count({ where: { projectId } })).toBe(1);
expect(await prisma.pageSnapshot.count({ where: { pageId } })).toBe(2);
```

- [ ] **Step 2: Run the test and confirm schema failure**

```bash
npm test -- tests/integration/crawler.persistence.test.ts
```

Expected: FAIL because crawler Prisma models do not exist.

- [ ] **Step 3: Add enums**

```prisma
enum CrawlRunStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
}

enum CrawlRunType {
  FULL
  INCREMENTAL
  MANUAL
  SCHEDULED
  SINGLE_PAGE
}

enum FetchMethod {
  HTTP
  BROWSER
}
```

- [ ] **Step 4: Add `CrawlRun`**

Required fields:

```text
id UUID
projectId UUID
runType
status
seedUrl
maxPages
pagesDiscovered
pagesCrawled
pagesSucceeded
pagesFailed
startedAt?
finishedAt?
errorMessage?
crawlerVersion
createdAt
updatedAt
```

Relations: `Project.crawlRuns`, `CrawlRun.snapshots`, `CrawlRun.robotsResults`, `CrawlRun.sitemapSources`.

- [ ] **Step 5: Add stable `Page` identity**

Required fields:

```text
id UUID
projectId UUID
url
normalizedUrl
host
path
pageType?
firstSeenAt
lastSeenAt
isActive
createdAt
updatedAt
```

Add `@@unique([projectId, normalizedUrl])` and indexes on `[projectId, host]`, `[projectId, isActive]`.

- [ ] **Step 6: Add `PageSnapshot` and one-to-one technical records**

`PageSnapshot` must store factual parsed fields:

```text
id UUID
pageId UUID
crawlRunId UUID
finalUrl
statusCode
contentType?
title?
metaDescription?
canonicalUrl?
metaRobots?
h1?
h1Count
h2Count
h3Count
wordCount
language?
internalLinksCount
externalLinksCount
imagesCount
imagesWithoutAlt
schemaCount
htmlHash?
contentHash?
responseTimeMs?
htmlSizeBytes?
rendered
indexable
capturedAt
parserVersion
```

`HttpResult` one-to-one with snapshot stores request URL, final URL, status, redirect chain JSON, headers JSON, response bytes, latency, fetch error.

`RenderResult` one-to-one with snapshot stores attempted, succeeded, reason, render time and browser version.

- [ ] **Step 7: Add robots and sitemap persistence**

`RobotsResult` records crawl run, URL, status code, content hash, raw text, fetched time and parse error.

`SitemapSource` records crawl run, sitemap URL, status, type (`INDEX`/`URLSET`), parse error, discovered URL count.

`SitemapUrl` records source, normalized URL, `lastmod?`, `changefreq?`, `priority?` with unique `[sitemapSourceId, normalizedUrl]`.

- [ ] **Step 8: Generate migration and run verification**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate dev --name add_crawler_foundation
npm test -- tests/integration/crawler.persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add prisma tests/integration/crawler.persistence.test.ts
git commit -m "feat: add crawler persistence models"
```

---

### Task 2: Implement URL normalization and safe network policy

**Files:**
- Create: `src/modules/crawler/url-normalizer.ts`
- Create: `src/modules/crawler/network-policy.ts`
- Create: `src/modules/crawler/crawl.types.ts`
- Test: `tests/unit/url-normalizer.test.ts`
- Test: `tests/unit/network-policy.test.ts`

**Interfaces:**
- Produces: `normalizeCrawlUrl(input: string): string`, `isInProjectScope(url: URL, primaryDomain: string): boolean`, `assertPublicHttpTarget(url: URL): Promise<void>`.

- [ ] **Step 1: Write normalization tests**

Cover exact behavior:

```text
HTTPS host lowercased
fragment removed
default ports removed
empty path becomes /
query parameters preserved but sorted by key/value
trailing slash preserved for non-root paths
credentials rejected
mailto/javascript/data rejected
```

Example:

```ts
expect(normalizeCrawlUrl('HTTPS://Example.COM:443/a?b=2&a=1#x'))
  .toBe('https://example.com/a?a=1&b=2');
```

- [ ] **Step 2: Write SSRF/network-policy tests**

Reject:

```text
http://127.0.0.1
http://localhost
http://169.254.169.254
http://10.0.0.1
http://172.16.0.1
http://192.168.1.1
http://[::1]
file:///etc/passwd
```

Allow a mocked public DNS result such as `93.184.216.34`.

- [ ] **Step 3: Implement URL normalization**

Use WHATWG `URL`; do not decode and re-encode path segments manually. Remove hash and credentials, lowercase host, sort `searchParams`, and reject non-HTTP(S).

- [ ] **Step 4: Implement project scope**

`isInProjectScope()` returns true for exact `primaryDomain` and its direct `www.` alias only. External hosts, unrelated subdomains, and look-alike suffixes such as `example.com.attacker.test` return false.

- [ ] **Step 5: Implement public-network assertion**

Resolve A and AAAA records using `node:dns/promises`. Reject when any resolved address is loopback, private, link-local, multicast, unspecified, documentation-only, or cloud metadata address. Re-run the check after redirects before requesting the next URL.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/unit/url-normalizer.test.ts tests/unit/network-policy.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/crawler tests/unit/url-normalizer.test.ts tests/unit/network-policy.test.ts
git commit -m "feat: add safe crawler URL policy"
```

---

### Task 3: Add bounded HTTP fetcher and redirect tracking

**Files:**
- Create: `src/modules/crawler/http-fetcher.ts`
- Modify: `src/modules/crawler/crawl.types.ts`
- Test: `tests/unit/http-fetcher.test.ts`

**Interfaces:**
- Consumes: `assertPublicHttpTarget()`.
- Produces:

```ts
export interface FetchResult {
  requestUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string | null;
  contentType: string | null;
  bytes: number;
  responseTimeMs: number;
  redirectChain: Array<{ from: string; to: string; statusCode: number }>;
  errorCode: string | null;
}

export async function fetchPage(url: string, options: FetchOptions): Promise<FetchResult>;
```

- [ ] **Step 1: Write tests with a local mock HTTP server**

Cover 200 HTML, 301→200 redirect, redirect loop/max redirect, timeout, oversized response, non-HTML response, and 500 response. The local test server is allowed only because the fetcher's network guard is injected/mocked in unit tests.

- [ ] **Step 2: Implement manual redirect handling**

Use native `fetch` with `redirect: 'manual'`. Before every request and every redirect target, call the injected public-target guard. Cap at `maxRedirects=10`.

- [ ] **Step 3: Bound response time and size**

Use `AbortSignal.timeout(requestTimeoutMs)`. Stream the body and stop once `maxResponseBytes` is exceeded; return `errorCode='RESPONSE_TOO_LARGE'` without keeping partial HTML as valid content.

- [ ] **Step 4: Normalize headers**

Store lowercase header names. Preserve `content-type`, `content-length`, `x-robots-tag`, `location`, cache headers and other response headers as factual JSON.

- [ ] **Step 5: Verify**

```bash
npm test -- tests/unit/http-fetcher.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/crawler/http-fetcher.ts src/modules/crawler/crawl.types.ts tests/unit/http-fetcher.test.ts
git commit -m "feat: add bounded HTTP crawler fetcher"
```

---

### Task 4: Implement robots.txt and sitemap discovery

**Files:**
- Create: `src/modules/crawler/robots.service.ts`
- Create: `src/modules/crawler/sitemap.service.ts`
- Modify: `package.json`
- Test: `tests/unit/robots.service.test.ts`
- Test: `tests/unit/sitemap.service.test.ts`

**Interfaces:**
- Produces `loadRobotsPolicy(origin, userAgent)`, `discoverSitemaps(robotsText, origin)`, `parseSitemap(xml, sourceUrl)`.

- [ ] **Step 1: Install parser dependencies**

```bash
npm install robots-parser fast-xml-parser
```

- [ ] **Step 2: Write robots tests**

Cover allow-all when robots is `404`, explicit `Disallow`, explicit `Allow`, `Sitemap:` directives, and malformed content. A 5xx robots fetch must be recorded as unavailable and must not be treated as a fabricated allow/disallow rule.

- [ ] **Step 3: Implement robots fetch and policy**

Fetch `<origin>/robots.txt` through `fetchPage()`. Return `{ fetched, statusCode, rawText, isAllowed(url), sitemapUrls, parseError }`.

- [ ] **Step 4: Write sitemap tests**

Cover `urlset`, `sitemapindex`, namespace-qualified XML, `lastmod`, malformed XML and duplicate URLs.

- [ ] **Step 5: Implement sitemap parser**

Use `fast-xml-parser`. Normalize discovered URLs, keep only in-scope public HTTP(S) URLs, deduplicate, and preserve sitemap metadata. Support sitemap indexes recursively with a hard limit of `50` sitemap documents per crawl run.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/unit/robots.service.test.ts tests/unit/sitemap.service.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/modules/crawler/robots.service.ts src/modules/crawler/sitemap.service.ts tests/unit/robots.service.test.ts tests/unit/sitemap.service.test.ts
git commit -m "feat: add robots and sitemap discovery"
```

---

### Task 5: Implement deterministic HTML parser

**Files:**
- Create: `src/modules/crawler/html-parser.ts`
- Modify: `package.json`
- Test: `tests/unit/html-parser.test.ts`

**Interfaces:**
- Produces `parseHtml(html, pageUrl, responseHeaders): ParsedPageSignals`.

- [ ] **Step 1: Install Cheerio**

```bash
npm install cheerio
```

- [ ] **Step 2: Write fixture-driven tests**

Cover:

```text
title
meta description
canonical
meta robots + X-Robots-Tag
H1 text and H1/H2/H3 counts
visible text word count
html lang
internal/external links
image count + missing/empty alt
JSON-LD script count
indexable boolean
```

- [ ] **Step 3: Define exact indexability rule for P1**

`indexable=false` only when factual crawl signals prove one of:

```text
HTTP status is outside 200-299
meta robots includes noindex
X-Robots-Tag includes noindex
```

Canonical differences, duplicate content, robots disallow, and thin content are not converted to SEO issues in P1.

- [ ] **Step 4: Implement parser**

Use Cheerio. Resolve relative canonical and link URLs against `pageUrl`. Do not execute scripts. Remove `script`, `style`, `noscript`, `template`, SVG and hidden document metadata before word-count extraction.

- [ ] **Step 5: Hash content**

Use SHA-256 for normalized HTML (`htmlHash`) and normalized visible text (`contentHash`).

- [ ] **Step 6: Verify**

```bash
npm test -- tests/unit/html-parser.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/modules/crawler/html-parser.ts tests/unit/html-parser.test.ts
git commit -m "feat: parse technical page signals"
```

---

### Task 6: Add optional browser rendering fallback

**Files:**
- Create: `src/modules/crawler/browser-renderer.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `tests/unit/browser-renderer.test.ts`

**Interfaces:**
- Produces `shouldRenderFallback(fetchResult, parsedSignals): boolean` and `renderPage(url, options): RenderedPageResult`.

- [ ] **Step 1: Add environment switch**

```dotenv
CRAWLER_BROWSER_ENABLED=false
```

Parse as boolean in `env.ts`. Disabled means the crawler never launches Chromium.

- [ ] **Step 2: Define fallback conditions**

Fallback may run only when enabled and the HTTP response is 2xx HTML but one of these is true:

```text
body length < 500 bytes
visible word count < 20 and HTML contains script tags
empty title + empty H1 + script-heavy page
```

Do not browser-render 4xx/5xx, PDFs, images, or robots-disallowed URLs.

- [ ] **Step 3: Add runtime Playwright dependency**

```bash
npm install playwright
```

Do not install browser binaries in CI yet; unit tests mock the renderer. Document server setup command `npx playwright install --with-deps chromium`.

- [ ] **Step 4: Implement renderer**

Launch Chromium with a fresh context, JavaScript enabled, no persistent profile, `serviceWorkers: 'block'`, and timeout `20000ms`. Abort image/font/media requests to reduce load. Re-check URL scope and public-network policy before navigation.

- [ ] **Step 5: Verify unit tests and typecheck**

```bash
npm test -- tests/unit/browser-renderer.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/crawler/browser-renderer.ts src/config/env.ts .env.example package.json package-lock.json tests/unit/browser-renderer.test.ts
git commit -m "feat: add optional browser crawl fallback"
```

---

### Task 7: Build crawl engine, repository, and real BullMQ worker

**Files:**
- Create: `src/modules/crawler/crawl.repository.ts`
- Create: `src/modules/crawler/crawl.mapper.ts`
- Create: `src/modules/crawler/crawl-engine.ts`
- Create: `src/modules/crawler/crawl.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/integration/crawl-engine.test.ts`
- Test: `tests/unit/crawl-worker.test.ts`

**Interfaces:**
- Consumes all Tasks 1-6.
- Produces `executeCrawlRun(crawlRunId: string): Promise<void>` and a real processor for queue name `crawl`.

- [ ] **Step 1: Write an integration crawl fixture server**

Fixture site must expose:

```text
/robots.txt
/sitemap.xml
/                200 HTML linking /about and external.test
/about           200 HTML canonical /about
/redirect        301 -> /about
/missing         404
```

Inject network policy for the local test host only.

- [ ] **Step 2: Write engine assertions**

After one crawl:

```text
CrawlRun status COMPLETED
pagesDiscovered >= 2
pagesCrawled matches fetched in-scope pages
one stable Page row per normalized URL
one PageSnapshot per fetched page
robots result persisted
sitemap source + sitemap URLs persisted
external URL not crawled
```

- [ ] **Step 3: Implement repository methods**

Required methods:

```ts
getRun(id)
markRunRunning(id)
markRunCompleted(id, stats)
markRunFailed(id, message)
upsertPage(projectId, normalizedUrl, observedUrl)
createSnapshot(input)
saveRobotsResult(input)
saveSitemapSource(input)
saveSitemapUrls(sourceId, urls)
```

`upsertPage` updates `lastSeenAt` but never overwrites historical snapshots.

- [ ] **Step 4: Implement crawl frontier**

Use an in-memory FIFO frontier per job with `Set<string>` for queued/visited normalized URLs. Seed order:

```text
project root URL
sitemap URLs
internal links discovered from fetched pages
```

Stop adding URLs after `maxPages` unique in-scope URLs. Process at concurrency `4`; never spawn unbounded promises.

- [ ] **Step 5: Persist every attempted fetch**

A 404/500 still creates a `PageSnapshot` + `HttpResult`. Network failures increment `pagesFailed`; store error details without inventing status codes.

- [ ] **Step 6: Replace no-op crawl worker**

`startWorkers()` must create the `crawl` worker with `executeCrawlRun(job.data.crawlRunId)`. Other P2+ queues remain no-op; `visibility` remains disabled.

- [ ] **Step 7: Ensure failure lifecycle**

Any uncaught crawl-job exception marks the run `FAILED`, stores a safe error message, and rethrows so BullMQ records job failure.

- [ ] **Step 8: Verify**

```bash
npm test -- tests/integration/crawl-engine.test.ts tests/unit/crawl-worker.test.ts
npm run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/crawler src/queue/worker-bootstrap.ts tests/integration/crawl-engine.test.ts tests/unit/crawl-worker.test.ts
git commit -m "feat: execute crawler jobs"
```

---

### Task 8: Add crawl service and REST API

**Files:**
- Create: `src/modules/crawler/crawl.schema.ts`
- Create: `src/modules/crawler/crawl.service.ts`
- Create: `src/modules/crawler/crawl.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/crawls.api.test.ts`

**Interfaces:**
- Produces:

```text
POST /api/projects/:id/crawls
GET  /api/projects/:id/crawls
GET  /api/crawls/:crawlId
GET  /api/crawls/:crawlId/pages
POST /api/pages/:pageId/crawl
```

- [ ] **Step 1: Write failing API tests**

`POST /api/projects/:id/crawls` with `{ "runType":"MANUAL", "maxPages":100 }` must return HTTP `202` with `{ id, status:'QUEUED' }` and enqueue exactly one `crawl` job containing `crawlRunId`.

- [ ] **Step 2: Validate crawl request**

```ts
z.object({
  runType: z.enum(['FULL','INCREMENTAL','MANUAL','SCHEDULED','SINGLE_PAGE']).default('MANUAL'),
  maxPages: z.number().int().min(1).max(5000).default(500),
  seedUrl: z.string().url().optional()
})
```

`seedUrl` must normalize into the project crawl scope.

- [ ] **Step 3: Add active-run conflict rule**

Only one `QUEUED` or `RUNNING` full/manual crawl is allowed per project. A second request returns HTTP `409` with code `CRAWL_ALREADY_ACTIVE`.

- [ ] **Step 4: Enqueue durable job**

Use BullMQ job id `crawl:<crawlRunId>` to prevent accidental duplicate enqueue for the same run.

- [ ] **Step 5: Implement list/detail/page APIs**

Return pagination with `limit` max 100 and cursor/offset contract consistent across crawl/page endpoints. Do not return raw HTML in list responses.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/integration/crawls.api.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/crawler/crawl.schema.ts src/modules/crawler/crawl.service.ts src/modules/crawler/crawl.routes.ts src/app.ts tests/integration/crawls.api.test.ts
git commit -m "feat: add crawl API"
```

---

### Task 9: Add Crawl History and Page Center UI

**Files:**
- Modify: `src/web/routes.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Create: `src/views/crawls/index.ejs`
- Create: `src/views/crawls/show.ejs`
- Create: `src/views/pages/index.ejs`
- Create: `src/views/pages/show.ejs`
- Modify: `src/public/css/app.css`
- Test: `tests/integration/crawler.web.test.ts`

**Interfaces:**
- Produces web pages `/projects/:id/crawls`, `/crawls/:crawlId`, `/projects/:id/pages`, `/pages/:pageId`.

- [ ] **Step 1: Write failing web tests**

Verify Crawl History table headings:

```text
状态
类型
开始时间
完成时间
发现页面
已抓取
成功
失败
```

Page Center headings:

```text
URL
HTTP
Title
Indexable
最近抓取
```

- [ ] **Step 2: Implement crawl history page**

Show run status badge and factual counts. `QUEUED/RUNNING` counts may be partial and must be labeled as current progress.

- [ ] **Step 3: Implement crawl detail page**

Show run metadata, robots result, sitemap counts, page result table, and failure message if status is `FAILED`.

- [ ] **Step 4: Implement Page Center and page detail**

Page detail shows latest snapshot plus snapshot history. Do not display SEO Score or SEO Issue severity in P1 because P2 has not run.

- [ ] **Step 5: Activate P1 navigation**

Enable `页面中心` and `抓取历史` under 项目. Keep SEO Audit pages marked `尚未接入` until P2.

- [ ] **Step 6: Verify**

```bash
npm test -- tests/integration/crawler.web.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/web/routes.ts src/views src/public/css/app.css tests/integration/crawler.web.test.ts
git commit -m "feat: add crawl and page UI"
```

---

### Task 10: Add crawl observability, docs, and full P1 verification

**Files:**
- Modify: `README.md`
- Modify: `docs/development/p0-local-setup.md` or create `docs/development/p1-crawler-setup.md`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml` only if new deterministic crawler checks are needed
- Test: all P1 tests

**Interfaces:**
- Produces operator instructions and the P1 release gate.

- [ ] **Step 1: Document crawler environment variables**

Document exact defaults:

```dotenv
CRAWLER_USER_AGENT=SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)
CRAWLER_MAX_PAGES=500
CRAWLER_CONCURRENCY=4
CRAWLER_REQUEST_TIMEOUT_MS=15000
CRAWLER_MAX_RESPONSE_BYTES=5000000
CRAWLER_BROWSER_ENABLED=false
```

- [ ] **Step 2: Document production safety**

Include SSRF blocking, robots behavior, exact-host scope, rate/concurrency limits, browser installation command, and statement that P1 produces factual crawl data only.

- [ ] **Step 3: Add crawl log events**

Use structured `console`/logger-compatible objects with event names:

```text
crawl.started
crawl.page.fetched
crawl.page.failed
crawl.browser.fallback
crawl.completed
crawl.failed
```

Never log full raw HTML, cookies, authorization headers, or query secrets.

- [ ] **Step 4: Run full verification**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 5: Run Playwright smoke suite separately**

```bash
npm run test:e2e
```

Expected: existing P0 smoke tests pass. If crawler E2E specs are added, they must use a deterministic local fixture site and must not hit public production websites from CI.

- [ ] **Step 6: Commit**

```bash
git add README.md docs .env.example src .github tests package.json package-lock.json prisma
git commit -m "docs: complete P1 crawler milestone"
```

---

## P1 Acceptance Criteria

P1 is complete only when all are true:

1. A project can create a durable crawl run through API and UI.
2. The BullMQ `crawl` worker executes real crawl work rather than the P0 no-op processor.
3. The crawler refuses unsafe/non-public targets and does not recursively crawl arbitrary external hosts.
4. robots.txt and sitemap XML are fetched, parsed and persisted as factual observations.
5. HTTP redirects, response headers, response time, body size and errors are stored without fabrication.
6. Each normalized URL has one stable `Page`; each crawl produces append-only `PageSnapshot` history.
7. HTML technical signals include title, meta description, canonical, robots, headings, word count, links, images, JSON-LD count and indexability facts.
8. Optional browser fallback is disabled by default and runs only under the specified deterministic fallback conditions.
9. Crawl History and Page Center expose real crawl data; SEO scores/issues remain absent until P2.
10. PostgreSQL migration, Prisma validation, typecheck, unit/integration tests and build pass in CI.
11. No DeepSeek, GEO score, SEO rule scoring, Prompt sampling, Citation monitoring or AI Visibility logic is added in P1.

## P1 Non-Goals

- SEO severity and issue aggregation — P2.
- Core Web Vitals / Lighthouse lab testing — later Technical SEO extension.
- Google Search Console/Bing/Baidu webmaster APIs — later integration phase.
- Backlink crawling — separate future subsystem.
- JavaScript rendering for every URL — browser rendering remains fallback only.
- Distributed crawler fleets — keep one modular-monolith worker architecture until load proves otherwise.
- AI interpretation of crawl results — P4 DeepSeek AI Gateway.

## Post-P1 Handoff

After P1 review and merge, create a separate P2 implementation plan for `SEO Rule Engine + Audit UI`. P2 consumes the factual `PageSnapshot`/HTTP/robots/sitemap data created here and must never reach back into the crawler to invent or mutate crawl facts.
