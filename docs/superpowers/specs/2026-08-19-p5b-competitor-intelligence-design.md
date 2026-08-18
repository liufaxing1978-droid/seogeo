# P5-B Competitor Intelligence Design

## Goal

Add project-scoped competitor registration, bounded deterministic competitor crawling, comparable content/technical snapshots, versioned gap comparison, and optional DeepSeek explanation without inventing ranking, traffic, citation, visibility, or share-of-voice facts.

## Boundaries

- Reuse P1 `fetchPage` and `parseHtml`; do not build a second HTTP security layer.
- Competitor crawling is same-host only, breadth-first, bounded to 25 pages by default and 100 pages maximum.
- Do not store cookies, Authorization headers, sessions, secrets, or unbounded raw HTML.
- Persist only normalized deterministic page signals required for comparison.
- Owned-site P1/P2/P3/P5-A facts remain authoritative for the project.
- Competitor facts are a separate namespace and never become owned-site SEO/GEO facts.
- No third-party traffic/rank estimates are generated.
- No P6 Prompt/Citation/Visibility/SOV sampling.
- AI explanations must use the existing P4 AI Gateway and supplied comparison/source references only.

## Persistence

### Competitor

Project-owned competitor identity:
- `id`, `projectId`, `name`, `domain`, `status`, timestamps.
- unique `(projectId, domain)`.

### CompetitorCrawl

One bounded crawl attempt:
- `id`, `competitorId`, `status`, `seedUrl`, `maxPages`, `pagesCrawled`, `startedAt`, `finishedAt`, `errorMessage`, `crawlerVersion`, timestamps.

### CompetitorPageSnapshot

One deterministic result per normalized URL in one crawl:
- status/fetch error
- title/meta/canonical/H1
- word/heading/image/internal/external link/schema counts
- indexable/contentHash
- fetchedAt
- unique `(competitorCrawlId, normalizedUrl)`.

### CompetitorComparison

Versioned deterministic aggregate comparison:
- `projectId`, `competitorId`, `competitorCrawlId`
- `comparisonVersion = COMPETITOR_COMPARISON_V1`
- owned metrics JSON
- competitor metrics JSON
- gaps JSON
- sourceReferences JSON
- unique `(projectId, competitorCrawlId, comparisonVersion)`.

## Crawl

Dedicated BullMQ queue `competitor`.

Job ID: `competitor-crawl-<competitorCrawlId>`.

Worker:
1. validates project/competitor/crawl ownership;
2. starts with `https://<domain>/` unless explicit saved seed is present;
3. calls P1 `fetchPage`;
4. calls P1 `parseHtml` only for fetches with body;
5. enqueues unique in-scope internal links in BFS order;
6. persists bounded deterministic page snapshots;
7. stops at `maxPages`;
8. never follows off-domain links as crawl targets.

## Deterministic comparison V1

Owned aggregate uses current P5-A `ContentDocument` facts.
Competitor aggregate uses latest completed competitor crawl.

Comparable metrics:
- pages sampled
- successful 2xx share
- average word count where known
- title presence share
- H1 presence share
- average heading count
- average internal link count
- structured-data presence share
- indexable share

Gap output contains only arithmetic differences and categorical `AHEAD / BEHIND / EVEN / UNKNOWN` states using named tolerances. `UNKNOWN` propagates when a metric cannot be computed.

## AI gap explanation

AI task type: `COMPETITOR_GAP_ANALYSIS`.
Prompt: `competitor-gap-v1`.
Request key: `competitor-gap:<comparisonId>:competitor-gap-v1`.

AI receives only:
- deterministic owned metrics
- deterministic competitor metrics
- deterministic gap rows
- source references

AI may prioritize and explain gaps; it may not create rank, traffic, citation, AI visibility, or market-share claims.

## REST / Web

REST:
- `GET /api/v1/projects/:projectId/competitors`
- `POST /api/v1/projects/:projectId/competitors`
- `POST /api/v1/projects/:projectId/competitors/:competitorId/crawls`
- `GET /api/v1/projects/:projectId/competitors/:competitorId`
- `POST /api/v1/projects/:projectId/competitors/:competitorId/compare`
- `POST /api/v1/projects/:projectId/competitors/comparisons/:comparisonId/ai`

Web:
- `/projects/:id/competitors`
- `/projects/:id/competitors/:competitorId`

Feature gate: `COMPETITOR_INTELLIGENCE`, enabled STANDARD/ADVANCED/ENTERPRISE. P6 `COMPETITOR_SOV` stays separate.

## Release

Fresh green Prisma validate/generate/migrate, typecheck, unit/integration tests, build, Chromium E2E and production dependency audit. No live DeepSeek requests in CI.
