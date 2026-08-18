# P0 Local Setup

## Prerequisites

- Node.js 22+
- PostgreSQL 17 (or compatible supported PostgreSQL)
- Redis 7+

## Environment

```bash
cp .env.example .env
```

Default development values expect:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/seogeo
REDIS_URL=redis://localhost:6379
```

Create the `seogeo` database before migration.

## Install and migrate

```bash
npm install
npx prisma validate
npx prisma generate
npx prisma migrate dev
```

## Verify

```bash
npm run typecheck
npm test
npm run build
```

For browser smoke tests, install Chromium once:

```bash
npx playwright install chromium
npm run test:e2e
```

## Start

```bash
npm run dev
```

Open `http://localhost:3000`.

## Health endpoints

- `GET /health/live` verifies the Node process is serving requests.
- `GET /health/ready` verifies both PostgreSQL and Redis are reachable.

## Create the first project

Visit `/projects/new` and enter:

- 项目名称
- slug
- 主域名, without `http://` or `https://`
- 行业 (optional)
- 默认语言
- 目标国家
- 时区
- 套餐

`STANDARD` does not include AI Visibility. `ADVANCED` and `ENTERPRISE` pass the P0 AI Visibility permission probe, but no AI-platform sampling is implemented until P6.
