# SEO GEO

SEO GEO is an independent SEO + GEO platform for technical auditing, GEO readiness, AI-assisted analysis, and—on Advanced plans—AI Visibility monitoring.

- System target: `seo.xingshantang.org`
- Analyzed domains are project data and are separate from the system entry domain.
- Advanced AI Visibility is a separately gated module.
- Current milestone: **P1 Crawler + Technical SEO ingestion**.
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

## Roadmap

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — current
- P2 SEO Rule Engine + Audit UI
- P3 GEO Engine + Citability + Entity
- P4 DeepSeek AI Gateway + Intelligence
- P5 Content, competitor analysis, reports
- P6 AI Visibility Advanced module
