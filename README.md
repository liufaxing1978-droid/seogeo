# SEO GEO

SEO GEO is an independent SEO + GEO platform for technical auditing, GEO readiness, AI-assisted analysis, and—on Advanced plans—AI Visibility monitoring.

- System target: `seo.xingshantang.org`
- Analyzed domains are project data and are separate from the system entry domain.
- Advanced AI Visibility is a separately gated module.
- Current milestone: **P2 SEO Rule Engine + Audit UI**.
- DeepSeek will be integrated through an AI Gateway in P4; business modules must not call it directly.

## Stack

Node.js 22, TypeScript, Express 5, EJS, PostgreSQL, Prisma, Redis, BullMQ, Zod, Vitest, Supertest, Playwright.

## Local setup

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run typecheck
npm test
npm run dev
```

Open `http://localhost:3000`.

## Useful commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Health

- `GET /health/live` — process liveness
- `GET /health/ready` — PostgreSQL + Redis readiness

## P1 Crawler

P1 provides durable crawl runs, a real BullMQ crawl worker, bounded HTTP fetching, redirect history, robots.txt and sitemap parsing, deterministic HTML technical signals, optional browser rendering fallback, Crawl History, Page Center, and append-only Page Snapshot history.

Crawler facts come from actual responses. P1 does not calculate SEO scores, create SEO severity issues, call DeepSeek, calculate GEO scores, or perform AI Visibility/Prompt/Citation sampling.

Production crawler setup and safety details are documented in `docs/development/p1-crawler-setup.md`.

## P2 SEO Audit

P2 consumes immutable P1 crawl observations and adds a versioned deterministic SEO rule catalog, raw rule results, stable SEO Issue identities, per-audit issue occurrences, explainable SEO Score components, audit comparison (`NEW / PERSISTENT / REGRESSED / FIXED`), BullMQ execution, REST APIs, SEO Audit UI, Issue Center, Issue Detail and Audit Compare.

An issue can be manually marked `IN_PROGRESS`, `PARTIALLY_FIXED` or `IGNORED`, but only a later deterministic audit can mark a previously failing issue `RESOLVED`. DeepSeek is not used to decide whether a rule passes or fails, how many pages are affected, issue severity, SEO Score, or whether a fix is verified.

P2 implementation and operating semantics are documented in `docs/development/p2-seo-audit.md`.

## Roadmap

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — complete
- P2 SEO Rule Engine + Audit UI — complete
- P3 GEO Engine + Citability + Entity — next
- P4 DeepSeek AI Gateway + Intelligence
- P5 Content, competitor analysis, reports
- P6 AI Visibility Advanced module
