# P3 GEO Engine Operations Guide

## Purpose

P3 is the deterministic GEO-readiness layer of SEO GEO. It consumes persisted P1 crawler facts and selected deterministic P2 facts to answer whether a site is structurally ready to be understood, extracted, attributed and accessed by AI/search systems.

P3 does **not** answer whether ChatGPT, Gemini, Perplexity, DeepSeek, Doubao, Baidu AI or another answer platform actually mentioned or cited the project. Real Prompt × Platform sampling belongs to P6 AI Visibility.

The P3 pipeline is:

```text
Completed P1 CrawlRun / PageSnapshot / robots / structured signals
  → GeoAuditRun
  → deterministic Citability / Entity / AI Crawler / Brand / Content GEO analysis
  → versioned GeoRuleResult facts
  → GEO_READINESS_V1 + persisted score components
  → GEO Overview / Citability / Entity / AI Crawler views
```

DeepSeek is not called by P3 business logic. P4 may later explain P3 facts through the AI Gateway, but it must not overwrite deterministic P3 observations.

## Source-of-truth boundaries

P3 may read:

- P1 `CrawlRun`, `Page`, `PageSnapshot`, HTTP, robots, sitemap and render facts.
- P1 structured page signals derived from explicit JSON-LD and `og:site_name`.
- Selected deterministic P2 facts when the GEO rule definition explicitly needs them.

P3 owns:

- `GeoAuditRun`
- `GeoRule` / `GeoRuleVersion` / `GeoRuleResult`
- `CitabilityResult`
- stable `Entity` records and audit-linked observations/relations
- `AiCrawlerResult`
- `BrandAuthorityResult` (owned-site readiness semantics)
- `GeoScore` / `GeoScoreComponent`

Deleting or recalculating P3 derived data must not mutate P1/P2 historical observations.

`UNKNOWN` is a first-class result. Missing evidence is not converted to a fake PASS, FAIL or zero score.

## GEO_READINESS_V1

The stored score type is:

```text
GEO_READINESS_V1
```

Formula version:

```text
GEO_READINESS_V1_NORMALIZED_AVAILABLE
```

Nominal dimension weights are:

- Citability — 30%
- Entity Authority / Clarity — 25%
- Technical AI Readiness — 20%
- Brand Authority / Consistency — 15%
- Content GEO Quality — 10%

Only dimensions with eligible deterministic evidence participate in a calculation. If one whole dimension is unavailable, the score engine normalizes over the available weight instead of substituting zero. If no dimension is available, the GEO score remains unavailable.

AI Visibility is not a P3 score component.

## Citability semantics

P3 Citability measures citation readiness and extractability from deterministic page structure. It is not an observed AI citation rate.

Available P1 signals can support checks such as:

- clear H1 presence
- heading structure
- page thinness
- external/source-link presence
- canonical identity
- indexability and successful HTML response
- selected structural readiness signals

Semantic sub-dimensions that P1 cannot prove remain unavailable. In particular, answer-first quality, factual density and definition clarity are stored as `NULL` when no deterministic source fact exists. P3 does not invent semantic scores to complete a dashboard.

## Entity extraction

P3 entity extraction is deterministic-first. Stable entities are created only from explicit structured/owned signals such as JSON-LD/schema names, types, IDs, URLs, `sameAs` values and explicit structured publisher/author/provider relationships.

The P1 bridge stores bounded structured entity signals in `PageStructuredSignal` rather than persisting an unrestricted raw JSON-LD body solely for P3.

P3 does not create entities from free page prose or from `og:site_name` alone. Semantic free-text NER is deferred to P4 and, when introduced, must remain distinguishable from deterministic observations.

## AI crawler readiness

P3 evaluates stored site policy facts. It does not contact AI vendors or simulate their crawlers during a GEO audit.

The initial robots-controlled catalog includes identities whose control semantics were explicitly implemented and tested:

- OAI-SearchBot
- GPTBot
- Google-Extended
- ClaudeBot
- Claude-SearchBot
- PerplexityBot

User-triggered fetch identities with different robots semantics are not mixed into the same readiness score.

For every supported identity the evaluator may persist:

- robots policy availability/allowance
- page-level meta robots allowance when a factual signal exists
- X-Robots allowance when a factual signal exists
- reachable state from stored project page facts
- final `PASS / FAIL / UNKNOWN`

An absent or unimplemented policy remains `UNKNOWN`.

## Brand readiness

P3 Brand readiness is owned-site identity readiness, not earned external authority.

Deterministic signals include organization schema, official URL, `sameAs`, consistent site identity, explicit publisher observations and About-page presence where those facts exist.

P3 does not claim third-party brand authority, external mentions, sentiment or Share of Voice without real external data.

## GEO audit execution

Production GEO audits run asynchronously through BullMQ. PostgreSQL remains the business source of truth for audit state and results.

The audit lifecycle is:

```text
QUEUED → RUNNING → COMPLETED
                 ↘ FAILED
```

A GEO audit requires a completed P1 crawl. The worker evaluates deterministic dimensions, replaces audit-local rule results idempotently, persists a new audit-linked score snapshot and leaves prior P1/P2 history intact.

## REST API

Implemented project-scoped GEO endpoints include:

- `POST /api/v1/projects/:projectId/geo-audits`
- `GET /api/v1/projects/:projectId/geo/summary`
- `GET /api/v1/projects/:projectId/geo/audits`
- `GET /api/v1/geo/audits/:auditRunId`
- `GET /api/v1/projects/:projectId/geo/citability`
- `GET /api/v1/projects/:projectId/geo/entities`
- `GET /api/v1/projects/:projectId/geo/ai-crawlers`
- `GET /api/v1/projects/:projectId/geo/opportunities`

Web routes include:

- `/projects/:id/geo`
- `/projects/:id/geo/citability`
- `/projects/:id/geo/entities`
- `/projects/:id/geo/ai-crawlers`

The GEO Overview explicitly renders AI Visibility as not sampled rather than displaying a fabricated zero.

## Structured observability

P3 emits aggregate lifecycle events:

- `geo.audit.started`
- `geo.citability.calculated`
- `geo.entities.observed`
- `geo.ai_crawler.evaluated`
- `geo.score.calculated`
- `geo.audit.completed`
- `geo.audit.failed`

Logs contain IDs, engine/formula versions and aggregate counts/scores needed for operations. Do not add raw HTML, page bodies, full rule evidence, cookies, authorization values, session data or sensitive query parameters to GEO logs.

Failure text is flattened and bounded before logging.

## UI boundary

P3 provides:

- GEO Overview
- Citability detail
- Entity detail
- AI Crawler detail
- deterministic GEO opportunities backed by persisted FAIL rule results

The UI must keep the distinction visible:

```text
GEO Readiness = deterministic site readiness from P1/P2 facts
AI Visibility = observed answer-platform performance from real P6 sampling
```

The two metrics must never be silently substituted for each other.

## Release verification

The P3 release gate is:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI also audits the deployable runtime dependency tree separately from the development/migration toolchain.

A P3 release is complete only when the main verification job, production runtime audit and Chromium Playwright E2E are all green.

## P3 / P4 boundary

P4 introduces:

```text
Business module
  → AI Gateway
  → Provider Interface
  → DeepSeek Provider
```

P4 may use P1/P2/P3 facts to explain opportunities, produce semantic enrichment or draft recommendations. It may not change HTTP/robots facts, deterministic GEO rule results, `GEO_READINESS_V1`, or claim that an issue is fixed without a new deterministic audit.

## P3 / P6 boundary

P6 introduces real repeated Prompt × Platform sampling, raw answer snapshots, parsed answers, brand/competitor mentions, observed citations, position, Share of Voice and AI Visibility.

Those future performance metrics are independent of historical `GEO_READINESS_V1` snapshots. If a later composite performance score is introduced, it must use a new explicitly versioned metric rather than rewriting P3 history.
