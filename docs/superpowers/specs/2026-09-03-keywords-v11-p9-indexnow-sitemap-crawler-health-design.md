# Keywords V1.1 P9: IndexNow, Sitemap and Crawler Health Design

## Scope and decision

P9 adds an auditable, human-triggered URL submission workflow and a persisted crawler-health read model. It reuses existing `CrawlRun`, robots, sitemap and page-snapshot facts. It does not rewrite those facts, mutate a customer site, change a sitemap, or make provider submission callable through the generic search-provider registry.

The implementation is deliberately narrower than a provider-sync subsystem: only IndexNow is eligible for an executable adapter, and only when its required environment configuration is present. Existing search-provider URL and sitemap capability declarations remain fail-closed.

## Existing capabilities reused

- `CrawlRun`, `Page`, `PageSnapshot`, `RobotsTxtSnapshot`, `SitemapSource` and `SitemapUrl` retain first-party crawl observations.
- The crawler already has bounded URL/network policy and persists malformed, unavailable and empty sitemap evidence without inventing success.
- SEO rules already distinguish unavailable, invalid and empty sitemap facts.
- The existing worker and queue mechanisms provide asynchronous execution patterns.

## Data model

Add append-only submission records rather than modifying crawl tables:

- `IndexNowSubmissionBatch`: project, canonical host/key identity, `PENDING | QUEUED | COMPLETED | FAILED`, attempt count, bounded retry scheduling, response metadata safe for persistence, and timestamps.
- `IndexNowSubmissionUrl`: batch-owned, project-scoped canonical URL, per-URL status and error code. A uniqueness constraint prevents duplicate URLs inside a batch.
- `CrawlerHealthSnapshot`: project and CrawlRun reference, observed crawl outcome, robots outcome, sitemap outcome, page counters and a deterministic status (`HEALTHY | DEGRADED | FAILED | UNKNOWN`). It stores input references and calculation version, never inferred HTTP or sitemap values.

The migration is additive. New foreign keys use project-scoped lookups and `onDelete: Cascade` only where the owner is already project-scoped. No existing data is transformed or backfilled as a condition of deployment.

## Submission flow

1. A member with an explicit content/operations capability submits selected project URLs.
2. The service resolves each URL to a project-local canonical page fact. Off-domain, unobserved, non-canonical or duplicate URLs are rejected with explicit errors; they are not sent.
3. It creates one durable batch and URL rows, then queues a worker job. Creating a batch never changes page, sitemap or crawl state.
4. The worker checks the IndexNow runtime configuration. Missing configuration fails the batch closed with an actionable configuration code.
5. The worker invokes the IndexNow adapter with the exact approved URLs. It records only safe response status/error metadata, marks each URL and the batch terminally, and emits observability events.
6. Transient failures receive a bounded retry with an explicit attempt count. Permanent failures and exhausted retries remain visible as `FAILED`; no retry rewrites the original crawl facts.

Submission success means the IndexNow endpoint accepted the request. It does not mean a search engine crawled, indexed, ranked or published the URL.

## Crawler health flow

When a crawl completes, the health projector reads that run's persisted robots/sitemap/page results and writes a snapshot. The UI/API show the latest snapshot and link back to the concrete CrawlRun. It reports unknowns as unknown and must not perform a new crawl while rendering.

## Interfaces and UI

- Project-scoped API reads require `PROJECT_READ`.
- Submission creation/retry requires the existing explicit write/operations guard and CSRF protection.
- Web forms mirror the API guard and redirect only after durable batch creation.
- The Crawler/SEO view renders latest health, sitemap evidence and submission states. It contains no automatic submission, no page-publishing control and no static demo state.

## Failure, retry and observability

- Adapter configuration missing, invalid endpoint responses, network errors and retry exhaustion map to stable codes.
- The worker records `QUEUED`, attempts, terminal state and timestamps for every batch.
- Retry is bounded and deterministic; a manual retry creates a new attempt only for a failed durable batch.
- Observability emits queue, attempt, completed and failed events without URLs containing secrets.

## Verification

Tests are written RED-first for project isolation, URL eligibility, idempotency, missing configuration, accepted/rejected/transient responses, retry bounds, immutable crawl facts and health-state derivation. Then run the affected tests, complete Vitest, typecheck, Prisma validation/migration deploy, build, E2E, and exact-head CI.

## Explicit non-goals

- sitemap generation or editing;
- automatic URL submission from crawl, publication or content generation;
- claims of indexing, ranking or crawl completion based on submission acceptance;
- OAuth/token storage or enabling generic provider URL/sitemap submission;
- Production deployment, main merge or Production data changes.
