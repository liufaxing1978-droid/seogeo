# 兴善堂 SEO GEO

Independent SEO / GEO platform for `seo.xingshantang.org`.

Current milestone: **P5 Content, competitor analysis, reports — release candidate pending final CI gate**.

## Architecture

- Node.js 22
- TypeScript
- Express 5
- EJS
- PostgreSQL / Prisma
- Redis / BullMQ
- Zod
- Vitest / Supertest / Playwright
- DeepSeek through a provider-neutral AI Gateway

## Core boundary

Deterministic crawler, SEO, GEO, content, competitor and reporting facts remain authoritative. AI may explain, summarize, prioritize and recommend, but it does not determine crawl/HTTP facts, SEO/GEO issue state, readiness scores, competitor metrics or verified-fix state.

Provider reasoning is never persisted, logged or rendered.

## P4 DeepSeek AI Gateway

P4 provides the project-scoped AI Analysis Center and durable AI task execution.

Environment:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_FAST_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=180000
AI_MAX_INPUT_CHARS=200000
AI_MAX_OUTPUT_TOKENS=8192
```

The application starts without `DEEPSEEK_API_KEY`; only an actual AI request fails safely when no key is configured.

Model routes:

- FAST → `deepseek-v4-flash`
- REASONING → `deepseek-v4-pro`

The routes are configurable through environment variables.

Operational details: `docs/development/p4-ai-gateway.md`.

## P5 Content Intelligence

P5-A materializes versioned content facts from persisted P1 snapshots, evaluates deterministic content signals/opportunities and exposes project-scoped Content Center pages and APIs.

Explicit failed/non-HTML snapshots preserve content facts as UNKNOWN rather than creating false thin-content/title/H1 failures. Schema evidence remains UNKNOWN unless a deterministic source supplies it.

Optional Content Brief and Content Optimization tasks use the existing P4 AI Gateway. A successful provider call is persisted with aggregate usage before the validated AI result, ContentBrief materialization and final COMPLETED state are committed atomically.

Operational details: `docs/development/p5a-content-intelligence.md`.

## P5 Competitor Intelligence

P5-B persists competitor facts separately from owned-site facts, uses bounded same-domain crawling with P1 safety/parser primitives and creates `COMPETITOR_COMPARISON_V1` deterministic gap snapshots.

Owned metrics that P5 does not deterministically possess—such as HTTP success share, structured-data presence share and indexability share—remain UNKNOWN rather than being fabricated from missing data.

Optional `COMPETITOR_GAP_ANALYSIS` uses the P4 AI Gateway only to explain saved gaps. It cannot invent rankings, traffic, citations, AI Visibility or Share of Voice.

Operational details: `docs/development/p5b-competitor-intelligence.md`.

## P5 Reporting

P5-C creates immutable `PROJECT_REPORT_V1` snapshots from persisted SEO, GEO, Content and Competitor data. Deterministic facts and AI advisory summaries are stored and displayed separately.

Report generation itself is database-only; it does not crawl or call DeepSeek. Optional Executive Summary uses the P4 AI task pipeline.

Operational details: `docs/development/p5c-reporting.md`.

## Feature gates

Base project features available to Standard / Advanced / Enterprise include:

- SEO Audit
- GEO Audit
- Content Intelligence
- Competitor Intelligence
- Reporting
- AI Analysis

P6 monitoring gates remain separate:

- AI Visibility
- Prompt Monitor
- Citation Monitor
- Competitor Share of Voice

`ADVANCED_REPORTS` remains reserved for future advanced scheduling/bundling/distribution rather than the base P5 report snapshot feature.

## Development

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Release verification

The release gate requires all of the following on the final P5 head:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

CI must not call live DeepSeek or live competitor sites.

## Roadmap

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — complete
- P2 SEO Rule Engine + Audit UI — complete
- P3 GEO Engine + Citability + Entity — complete
- P4 DeepSeek AI Gateway + Intelligence — complete
- P5 Content, competitor analysis, reports — release candidate; complete only after final CI green and merge
- P6 AI Visibility Advanced module — next after P5 release
