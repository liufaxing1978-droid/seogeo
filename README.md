# 兴善堂 SEO GEO

Independent SEO / GEO platform for `seo.xingshantang.org`.

Current milestone: **P6-B Citation & Mention Intelligence — complete**. Next milestone: **P6-C Visibility Metrics & Competitor Share of Voice — next**.

## Architecture

- Node.js 22
- TypeScript
- Express 5
- EJS
- PostgreSQL / Prisma
- Redis / BullMQ
- Zod
- Vitest / Supertest / Playwright
- DeepSeek through a provider-neutral advisory AI Gateway
- Official-provider adapters through the separate P6 visibility sampling pipeline

## Core boundary

Deterministic crawler, SEO, GEO, content, competitor and reporting facts remain authoritative. AI may explain, summarize, prioritize and recommend, but it does not determine crawl/HTTP facts, SEO/GEO issue state, readiness scores, competitor metrics or verified-fix state.

P6 external visibility observations are authoritative only when the system actually performs a supported official-provider API sample and persists the normalized result. API sampling is never labeled as a consumer-product web/app ranking.

Provider reasoning is never persisted, logged or rendered.

## P4 DeepSeek AI Gateway

P4 provides the project-scoped AI Analysis Center and durable advisory AI task execution.

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

The application starts without `DEEPSEEK_API_KEY`; only an actual advisory AI request fails safely when no key is configured.

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

## P6-A Prompt Monitor & Sampling Core

P6-A provides the Advanced/Enterprise foundation for externally sampled AI Visibility observations.

Delivered capabilities:

- project-level visibility settings and budget ceilings;
- API-only provider configurations without persisted secrets;
- immutable versioned Prompt Sets / Prompts;
- bounded manual sampling runs and stable sampling-unit idempotency;
- dedicated `visibility` BullMQ worker with paid attempts set to 1;
- preflight daily/run budget enforcement;
- normalized official API adapters for OpenAI, Gemini, Perplexity and Anthropic;
- explicit zero-network `UNSUPPORTED_WEB_GROUNDING` behavior for DeepSeek;
- project-scoped REST API;
- AI Visibility and Prompt Monitor web UI with explicit `API 采样` labeling;
- safe lifecycle observability with an allowlist that excludes prompt/answer bodies, secrets and provider reasoning.

P6-A does **not** calculate Mention Rate, Citation Rate or Share of Voice. P6-B adds deterministic, replayable Mention and Citation facts over persisted P6-A observations. Rate, trend and Share-of-Voice metrics remain P6-C responsibilities.

Provider secrets remain server-side environment variables:

```text
OPENAI_API_KEY=
GEMINI_API_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
```

Operational details:

- `docs/development/p6a-visibility-sampling.md`
- `docs/development/p6a-release-verification.md`

## P6-B Citation & Mention Intelligence

P6-B materializes deterministic, replayable Mention and Citation facts from persisted P6-A observations without live provider calls, external citation fetching, LLM extraction, embeddings or fuzzy semantic inference.

Evidence states preserve the distinction between `KNOWN_EMPTY`, `UNKNOWN` and `NOT_ELIGIBLE`; prose URLs never become Citations unless provider-native citation/search metadata supports them. Historical extractions are immutable across subject configuration changes, and subject snapshots are versioned by `subjectSetHash`.

Advanced/Enterprise Citation Monitor surfaces expose project-scoped subject configuration, extraction refresh/backfill, Mention facts, Citation facts, evidence state and provenance. Standard projects are blocked before restricted reads or side effects. P6-B does not calculate Mention Rate, Citation Rate, trends, weighted visibility or Share of Voice.

Operational details: `docs/development/p6b-citation-mention-intelligence.md`.

## Feature gates

Base project features available to Standard / Advanced / Enterprise include:

- SEO Audit
- GEO Audit
- Content Intelligence
- Competitor Intelligence
- Reporting
- AI Analysis

P6 Advanced / Enterprise monitoring gates remain separate:

- AI Visibility
- Prompt Monitor
- Citation Monitor
- Competitor Share of Voice

P6-A activates AI Visibility and Prompt Monitor. P6-B activates Citation Monitor. Competitor Share of Voice remains a P6-C capability.

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

Release gates use:

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

P6-A additionally requires proof that duplicate delivery cannot duplicate a paid adapter call, budget-skipped observations make zero provider calls, Standard projects cannot enqueue visibility sampling, DeepSeek unsupported grounding makes zero network calls, provider secrets are not persisted, API sampling is not mislabeled as consumer-product ranking, and CI uses fixture transports instead of live provider APIs.

P6-B additionally requires proof that extraction makes zero provider/network calls, `UNKNOWN` is never coerced to zero, historical extractions remain immutable after subject changes, prose URLs are never promoted to Citations, Standard cannot enqueue or read restricted Citation Monitor intelligence, prior P1–P6-A regression coverage remains green, and no P6-C metric model/calculator is introduced.

## Roadmap

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — complete
- P2 SEO Rule Engine + Audit UI — complete
- P3 GEO Engine + Citability + Entity — complete
- P4 DeepSeek AI Gateway + Intelligence — complete
- P5 Content, competitor analysis, reports — complete
- P6-A Prompt Monitor & Sampling Core — complete
- P6-B Citation & Mention Intelligence — complete
- P6-C Visibility Metrics & Competitor Share of Voice — next
- P6-D History, Dashboard, Alerts & Report Integration — planned
