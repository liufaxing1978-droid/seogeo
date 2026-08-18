# SEO GEO

SEO GEO is an independent SEO + GEO platform for technical auditing, GEO readiness, AI-assisted analysis, and—on Advanced plans—AI Visibility monitoring.

- System target: `seo.xingshantang.org`
- Analyzed domains are project data and are separate from the system entry domain.
- Advanced AI Visibility is a separately gated module.
- Current milestone: **P0 platform foundation**.
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

## P0 boundaries

P0 contains project management, persistence, feature gates, queue foundations, the approved admin shell, diagnostics and tests. It deliberately does **not** implement crawler ingestion, SEO audit logic, GEO audit logic, DeepSeek analysis, content intelligence, or AI Visibility sampling.

Roadmap:

- P1 Crawler + Technical SEO ingestion
- P2 SEO Rule Engine + Audit UI
- P3 GEO Engine + Citability + Entity
- P4 DeepSeek AI Gateway + Intelligence
- P5 Content, competitor analysis, reports
- P6 AI Visibility Advanced module
