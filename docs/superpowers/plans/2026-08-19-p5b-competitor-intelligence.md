# P5-B Competitor Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build bounded deterministic competitor crawling/comparison and advisory DeepSeek gap explanation.

**Architecture:** Competitors are project-scoped identities with independent crawl/snapshot records. Crawling reuses P1 `fetchPage`/`parseHtml`, comparison uses only persisted P5-A owned facts plus competitor snapshots, and AI uses the existing P4 Gateway after deterministic gaps exist.

**Tech Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL, Prisma 6.x, Redis/BullMQ, Zod, Vitest, Supertest, Playwright, existing P1 crawler utilities and P4 AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-19-p5b-competitor-intelligence-design.md`

## Global Constraints

- Same-host bounded crawl; default 25, hard max 100 pages.
- Reuse P1 SSRF/network policy and HTML parser.
- Persist no raw HTML, cookies, Authorization, sessions or secrets.
- No invented ranking, traffic, citation, visibility or SOV facts.
- `UNKNOWN` propagates when comparable metrics are unavailable.
- AI explanations use existing P4 Gateway only.
- Feature gate exactly `COMPETITOR_INTELLIGENCE`; P6 `COMPETITOR_SOV` remains separate.
- CI never calls live DeepSeek.

---

### Task 1: Competitor persistence
- Add Prisma enums/models `Competitor`, `CompetitorCrawl`, `CompetitorPageSnapshot`, `CompetitorComparison` and migration.
- Test project/domain uniqueness, crawl/snapshot identities, cascade boundaries.
- Verify Prisma and persistence tests.

### Task 2: Bounded competitor crawl
- Add `competitor` queue, service and worker.
- Reuse `fetchPage`, `parseHtml`, `normalizeCrawlUrl`.
- BFS same-host only; persist deterministic snapshots; max pages enforced.
- Unit/integration tests use injected fetcher; no external network in CI.

### Task 3: Deterministic comparison V1
- Add `COMPETITOR_COMPARISON_V1` aggregate engine.
- Compare pages sampled, 2xx share, word count, title/H1 presence, headings, internal links, structured-data presence, indexability.
- Persist gaps with source refs and UNKNOWN preservation.

### Task 4: Competitor gap AI
- Add `COMPETITOR_GAP_ANALYSIS`, migration, `competitor-gap-v1`, structured Zod output and source-ref validation.
- Exact request key `competitor-gap:<comparisonId>:competitor-gap-v1`.
- Route through existing P4 worker/Gateway only.

### Task 5: API + Web
- Add `COMPETITOR_INTELLIGENCE` to STANDARD/ADVANCED/ENTERPRISE.
- Implement project-scoped REST and `/projects/:id/competitors` UI.
- Add integration/E2E tests.

### Task 6: Observability + P5-B release gate
- Safe crawl/comparison lifecycle events, operator docs.
- Full Prisma/typecheck/test/build/E2E/production-audit verification.
- Range check excludes P5-C and P6.
