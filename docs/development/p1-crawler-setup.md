# P1 Crawler Operations Guide

## Purpose

P1 is the factual website-ingestion layer for SEO GEO. It discovers and fetches project URLs, records HTTP/render observations, robots.txt and sitemap data, parses deterministic technical page signals, and stores append-only page history. It does not calculate SEO/GEO scores or ask an AI model to infer crawl facts.

## Runtime configuration

Copy `.env.example` and tune these crawler values only when operational requirements justify it:

```dotenv
CRAWLER_USER_AGENT=SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)
CRAWLER_MAX_PAGES=500
CRAWLER_CONCURRENCY=4
CRAWLER_REQUEST_TIMEOUT_MS=15000
CRAWLER_MAX_RESPONSE_BYTES=5000000
CRAWLER_BROWSER_ENABLED=false
```

`CRAWLER_MAX_PAGES` is the default page limit when a crawl request does not provide one. API validation still enforces a hard per-run maximum of 5000. `CRAWLER_CONCURRENCY` is constrained to 1–16. Request timeout and response-size limits prevent a single target from holding a worker indefinitely or exhausting memory.

## Network and SSRF safety

Crawler targets must use HTTP or HTTPS. Before requests, hostnames are resolved and non-public destinations are rejected. The policy blocks loopback, RFC1918/private networks, link-local ranges, cloud metadata destinations, multicast/unspecified/documentation ranges, IPv6 local/private ranges, and IPv4-mapped IPv6 forms that resolve back to blocked IPv4 space.

Redirects are followed manually and every redirect target is checked again before the next request. A URL that begins on a public host is therefore not trusted merely because the first hop was safe.

Project scope is intentionally narrow: the exact configured project host plus its direct `www.` alias. Arbitrary subdomains, external domains, and look-alike suffixes are not recursively crawled.

## robots.txt and sitemaps

The crawler probes `/robots.txt` to establish policy and records the observed response. Disallowed non-seed page URLs are not crawled. Sitemap URLs declared by robots.txt are fetched only when they remain inside project scope. Sitemap indexes are bounded so malformed or hostile sitemap graphs cannot grow without limit.

Stored robots/sitemap values are observations from real responses. Missing, invalid, blocked, or failed responses remain represented as failure/unknown facts; the crawler must not fabricate an HTTP status or sitemap contents.

## HTTP limits

The HTTP fetcher uses manual redirects, a default 15 second timeout, a 5 MB response-body ceiling, and at most 10 redirects. Response headers, response time, body size, redirect chain and fetch error codes are persisted as factual crawl data. Network failures do not become invented HTTP status codes.

## Browser rendering fallback

Browser rendering is disabled by default:

```dotenv
CRAWLER_BROWSER_ENABLED=false
```

When explicitly enabled, the fallback uses Playwright Chromium only for deterministic JS-heavy/low-content conditions. The normal HTTP parser remains primary. On a production worker that enables browser fallback, install Chromium and its system dependencies:

```bash
npx playwright install --with-deps chromium
```

Browser navigation still applies project-scope and public-network checks. Persistent browser profiles are not used, service workers are blocked, and image/font/media requests are aborted to reduce resource consumption.

## Structured crawl events

Crawler lifecycle logging uses structured objects with these event names:

- `crawl.started`
- `crawl.page.fetched`
- `crawl.page.failed`
- `crawl.browser.fallback`
- `crawl.completed`
- `crawl.failed`

Page event URLs are sanitized to scheme + host + pathname. Query strings and fragments are omitted from logs to reduce accidental secret leakage. Do not add raw HTML, cookies, authorization headers, session values, or query secrets to crawler logs.

## Data ownership

`Page` is the stable identity for a normalized project URL. Every crawl creates new `PageSnapshot`/HTTP/render observations instead of overwriting historical snapshots. This history is the source for later trend and regression analysis.

The crawler owns factual collection only. P2 may read P1 facts and create deterministic SEO rule results/issues, but it must not mutate historical crawler observations to make an audit pass.

## Verification

The P1 release gate is:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
```

Run the browser smoke suite separately when Chromium is installed:

```bash
npm run test:e2e
```

Crawler integration tests use deterministic local fixture servers. CI must not crawl public production sites as part of the test suite.

## P1/P2 boundary

P1 exposes real Crawl History and Page Center data. SEO Score, severity, issue aggregation and fix guidance remain a P2 responsibility. DeepSeek is not part of P1 and will only enter later through the AI Gateway.
