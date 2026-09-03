# Keywords V1.1 P9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-triggered, auditable IndexNow URL submission and persisted crawler-health status without changing existing crawl or sitemap facts.

**Architecture:** Add P9 records next to `CrawlRun`; use existing BullMQ conventions. Submission persists a batch before enqueueing and accepts only project-local canonical URLs. Health projection reads completed crawl facts and writes a versioned snapshot.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, BullMQ/Redis, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-keywords-v11-p9-indexnow-sitemap-crawler-health-design.md`

## Global Constraints

- No submission code mutates CrawlRun, Page, PageSnapshot, robots or sitemap historical facts.
- Reject off-domain, unobserved, non-canonical and duplicate URLs before a provider call.
- IndexNow acceptance never claims indexing, crawling, ranking or publication.
- Generic search-provider URL/sitemap writes remain fail-closed; no OAuth or token persistence.
- Use only an additive migration; do not merge main or deploy Production.

---

### Task 1: P9 persistence

**Files:** Modify `prisma/schema.prisma`; create `prisma/migrations/<timestamp>_add_indexnow_submission_and_crawler_health/migration.sql`; test `tests/integration/indexnow-crawler-health.persistence.test.ts`.

- [ ] Write RED persistence checks: `to_regclass('"IndexNowSubmissionBatch"')` and `to_regclass('"CrawlerHealthSnapshot"')` must be present.
- [ ] Run `npx vitest run tests/integration/indexnow-crawler-health.persistence.test.ts`; expect relation-missing failure.
- [ ] Add `IndexNowSubmissionBatch`, child URL rows, `CrawlerHealthSnapshot`, status enums and Project/CrawlRun relations. Add only tables, indexes, FKs and checks.
- [ ] Run `npx prisma generate && npx prisma migrate deploy && npx vitest run tests/integration/indexnow-crawler-health.persistence.test.ts`; expect pass.
- [ ] Commit: `git add prisma tests/integration/indexnow-crawler-health.persistence.test.ts && git commit -m "feat(crawler): persist IndexNow submissions and health"`.

### Task 2: Immutable crawler-health projection

**Files:** Create `src/modules/crawler/crawler-health.service.ts`; modify `src/modules/crawler/crawl-engine.ts`; test `tests/integration/crawler-health.service.test.ts`.

- [ ] Write RED tests covering HEALTHY, DEGRADED, FAILED and UNKNOWN from persisted crawl/robots/sitemap counters, plus equality checks proving sitemap rows remain unchanged.
- [ ] Run `npx vitest run tests/integration/crawler-health.service.test.ts`; expect missing service failure.
- [ ] Implement `CrawlerHealthService.project(crawlRunId): Promise<CrawlerHealthSnapshot>` with `calculationVersion: 'P9_CRAWLER_HEALTH_V1'`; call it only after `markRunCompleted`.
- [ ] Run `npx vitest run tests/integration/crawler-health.service.test.ts tests/integration/crawl-engine.test.ts`; expect pass.
- [ ] Commit: `git add src/modules/crawler tests/integration/crawler-health.service.test.ts && git commit -m "feat(crawler): project persisted crawler health"`.

### Task 3: Fail-closed IndexNow service and worker

**Files:** Create `src/modules/indexnow/indexnow.service.ts`, `indexnow.worker.ts`, `indexnow.gateway.ts`; modify `src/worker.ts`; test `tests/integration/indexnow.service.test.ts` and `indexnow.worker.test.ts`.

- [ ] Write RED service tests: foreign/noncanonical URL gives `INDEXNOW_URL_NOT_ELIGIBLE`; duplicate request reuses a durable batch; CrawlRun equality is unchanged; missing key/keyLocation gives `INDEXNOW_NOT_CONFIGURED`.
- [ ] Run `npx vitest run tests/integration/indexnow.service.test.ts`; expect failure.
- [ ] Implement persist-before-enqueue `IndexNowSubmissionService.create({ projectId, urls, actorUserId })` and gateway `submit({ host, key, keyLocation, urlList })`; only safe response status/error metadata is stored.
- [ ] Write RED worker tests: accepted response completes all batch URLs; transient failure retries at most three attempts; exhaustion marks batch and URLs FAILED.
- [ ] Implement `executeIndexNowBatch(batchId, dependencies?)`, queue job id `indexnow-${batch.id}`, attempts `3`, and URL-free observability events.
- [ ] Run `npx vitest run tests/integration/indexnow.service.test.ts tests/integration/indexnow.worker.test.ts && npm run typecheck`; expect pass.
- [ ] Commit: `git add src/modules/indexnow src/worker.ts tests/integration/indexnow.* && git commit -m "feat(indexnow): queue auditable URL submission"`.

### Task 4: Guarded API and truthful crawler UI

**Files:** Modify `src/modules/crawler/crawl.routes.ts`, crawler web repository/routes and `src/views/crawls/*.ejs`; test `tests/integration/indexnow.api.test.ts` and `tests/integration/crawler.web.test.ts`.

- [ ] Write RED API/UI tests: `PROJECT_READ` sees only project-local batch/health state; CSRF/write guard creates a `QUEUED` batch; HTML says `提交已接受不代表已收录` and never says an accepted URL is indexed.
- [ ] Run `npx vitest run tests/integration/indexnow.api.test.ts tests/integration/crawler.web.test.ts`; expect missing-route/UI failure.
- [ ] Add GET read endpoints plus guarded POST create/retry endpoint. Render latest persisted health and submission history; no render request starts a crawl or provider call.
- [ ] Run `npx vitest run tests/integration/indexnow.api.test.ts tests/integration/crawler.web.test.ts && npx playwright test tests/e2e/seo-audit.spec.ts --workers=1`; expect pass.
- [ ] Commit: `git add src/modules/crawler src/views/crawls tests/integration/indexnow.api.test.ts tests/integration/crawler.web.test.ts && git commit -m "feat(crawler): show submission and health status"`.

### Task 5: Full verification and exact-head CI

- [ ] Run `git diff --check && npx prisma validate && npx prisma migrate deploy` against the isolated test database.
- [ ] Run `npm run typecheck && npm test && npm run build && PLAYWRIGHT_CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npx playwright test --workers=1`.
- [ ] Read remote SHA, push with explicit `--force-with-lease`, then wait for PR #193 required CI checks.
- [ ] Record CI results. Do not merge main or deploy Production.
