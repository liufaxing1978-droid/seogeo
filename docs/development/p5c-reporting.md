# P5-C Reporting Operator Guide

## Boundary

P5-C creates reproducible project report snapshots from already persisted P2 SEO, P3 GEO, P5-A Content and P5-B Competitor data. Report generation itself performs database aggregation only: it does not crawl sites and does not call DeepSeek.

Deterministic facts and AI advisory material are stored separately. AI output never becomes an authoritative report fact.

P6 remains separate. P5-C does not provide AI Visibility, prompt rank, citation share, Share of Voice, search-engine ranking or traffic estimates.

## Snapshot model

`ReportSnapshot` stores:

- project ID
- `PROJECT_SUMMARY` report type
- `PROJECT_REPORT_V1` report version
- deterministic `factSnapshot`
- separate `advisorySnapshot`
- source references
- optional `executiveAiTaskId`
- creation time

Each report generation creates a new snapshot. Historical reports are not rewritten when project facts later change.

## Deterministic facts

The V1 report includes bounded aggregates for:

- latest SEO score
- current open SEO issue counts by severity
- latest completed GEO score when available
- content-document count
- open content-opportunity counts by priority
- active competitor count
- latest competitor comparison gap-state counts

Missing GEO or other facts remain `null` / `UNKNOWN`. Missing evidence is never converted to a measured zero.

## Advisory section

Up to 10 recently completed AI tasks may contribute only task/result identifiers, summary text and persisted source references to the advisory section. Full prompts, provider reasoning and hidden fact packets are not copied into reports.

## Executive summary

Optional task type: `REPORT_EXECUTIVE_SUMMARY`.

Prompt: `project-report-summary-v1`.

The task goes through the existing P4 AI queue, worker, provider registry and DeepSeek provider. Source references are validated against the report packet. The model is explicitly prohibited from inventing:

- AI Visibility
- prompt rank
- citation share
- Share of Voice
- search rankings
- organic traffic

The report stores only the AI task ID; provider history remains owned by P4.

## Feature gates

`REPORTING` is available to Standard, Advanced and Enterprise projects.

`ADVANCED_REPORTS` remains unchanged and is reserved for future advanced scheduling, bundles, distribution or automation.

## API

- `POST /api/v1/projects/:projectId/reports`
- `GET /api/v1/projects/:projectId/reports`
- `GET /api/v1/projects/:projectId/reports/:reportId`
- `GET /api/v1/projects/:projectId/reports/:reportId/export.json`
- `POST /api/v1/projects/:projectId/reports/:reportId/ai-summary`

JSON export returns the stored snapshot rather than recomputing current facts.

## Web

- `/projects/:id/reports`
- `/projects/:id/reports/:reportId`

The detail page separates “确定性事实” from “AI 建议 / Executive Summary”, offers JSON download and a browser print action.

## Observability

Allowed events:

- `report.generated`
- `report.ai_summary.queued`

Allowed fields are bounded project/report/task identifiers, report version and aggregate source count. Never log report JSON, advisory JSON, prompts, AI output, Authorization headers, cookies or provider reasoning.

## Release checks

Before P5 is marked complete:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The production dependency audit must also pass. CI must not call live DeepSeek or live competitor sites.
