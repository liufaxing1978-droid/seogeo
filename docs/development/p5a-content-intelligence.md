# P5-A Content Intelligence Operations

## Purpose

P5-A materializes owned-site content facts from persisted P1/P2/P3 data, evaluates versioned deterministic content signals/opportunities, and uses the existing P4 AI Gateway for advisory Content Brief and optimization analysis.

## Authority boundary

- P1 Page/PageSnapshot facts remain authoritative for crawl/content measurements.
- P2 SEO issues/scores remain authoritative for SEO state.
- P3 GEO/Citability/Entity facts remain authoritative for GEO state.
- P5-A may reference those facts, but does not overwrite or duplicate them as a second authority.
- DeepSeek output is advisory. It cannot mark SEO/GEO/content issues verified fixed.
- Only a later deterministic content refresh can set a ContentOpportunity to `VERIFIED_FIXED`.
- P6 AI Visibility / Prompt / Citation / SOV sampling is not part of P5-A.

## Persistence

P5-A owns:

- `ContentDocument` — one current materialized fact record per `(projectId,pageId)`.
- `ContentSignal` — versioned deterministic rule results.
- `ContentOpportunity` — stable actionable opportunity lifecycle.
- `ContentBrief` — validated structured AI brief linked to one existing P4 `AiTask`.

Unknown source facts remain `null`/`UNKNOWN`; they are never coerced to zero or FAIL.

## Deterministic ruleset

`CONTENT_RULESET_V1` includes:

- CONTENT_TITLE_PRESENT
- CONTENT_H1_PRESENT
- CONTENT_META_DESCRIPTION_PRESENT
- CONTENT_BODY_SUBSTANTIVE
- CONTENT_HEADING_STRUCTURE
- CONTENT_INTERNAL_LINK_SUPPORT
- CONTENT_STRUCTURED_DATA_SUPPORT
- CONTENT_ENTITY_SUPPORT
- CONTENT_CITABILITY_SUPPORT

Thresholds are named/versioned constants in `content-rules.ts`. A ruleset change requires a version change rather than silently changing historical interpretation.

## Refresh queue

Queue name: `content`.

Logical job id: `content-refresh-<projectId>`.

The worker:

1. reads latest persisted PageSnapshot rows for active project pages;
2. materializes ContentDocument facts;
3. reads persisted P3 entity/citability facts;
4. evaluates deterministic rules;
5. upserts signals/opportunities;
6. never performs network crawling.

The queue uses `attempts: 1`; operator retry should be explicit after diagnosing failure.

## Feature gate

Feature: `CONTENT_INTELLIGENCE`.

Enabled for STANDARD, ADVANCED, and ENTERPRISE. It is intentionally separate from P6 `AI_VISIBILITY`.

## AI integration

AI tasks use the existing P4 path:

`Content Intelligence -> AiTask -> ai queue -> AI worker -> AI Gateway -> Provider -> DeepSeek`

Task types:

- `CONTENT_BRIEF`
- `CONTENT_OPTIMIZATION_ANALYSIS`

Prompt IDs:

- `content-brief-v1`
- `content-optimization-v1`

Request identities:

- `content-brief:<contentDocumentId>:<contentHash>:content-brief-v1`
- `content-opt:<contentDocumentId>:<contentHash>:content-optimization-v1`

Fact packets are bounded and contain only persisted fact summaries plus source references. They do not include cookies, authorization headers, sessions, secrets, full raw HTML, or provider `reasoning_content`. Returned AI source references are validated against the supplied reference set before persistence.

CI uses mocked provider behavior only; no live DeepSeek call is allowed.

## REST

Project-scoped endpoints:

- `GET /api/v1/projects/:projectId/content/documents`
- `GET /api/v1/projects/:projectId/content/documents/:documentId`
- `POST /api/v1/projects/:projectId/content/refresh`
- `GET /api/v1/projects/:projectId/content/opportunities`
- `PATCH /api/v1/projects/:projectId/content/opportunities/:opportunityId`
- `POST /api/v1/projects/:projectId/content/documents/:documentId/brief`
- `POST /api/v1/projects/:projectId/content/documents/:documentId/optimization`
- `GET /api/v1/projects/:projectId/content/briefs`

Manual opportunity updates allow only `IN_PROGRESS` or `IGNORED`. `VERIFIED_FIXED` is deterministic-refresh-only.

## Web UI

- `/projects/:id/content`
- `/projects/:id/content/documents/:documentId`
- `/projects/:id/content/briefs/:briefId`

The UI visually separates deterministic facts/signals/opportunities from DeepSeek advisory output.

## Observability

Allowed lifecycle events:

- `content.refresh.queued`
- `content.refresh.started`
- `content.document.updated`
- `content.opportunity.updated`
- `content.refresh.completed`
- `content.refresh.failed`

Allowed payloads are bounded IDs, aggregate counts, and stable error codes. Do not log page body text, prompts, full AI output, cookies, Authorization values, secrets, API keys, or provider reasoning.

## Troubleshooting

If refresh does not start, inspect Redis connectivity and the `content` worker. A refresh job is idempotent while active/waiting/delayed. If a refresh fails, resolve the underlying database/queue issue and enqueue again explicitly.

If AI creation fails without a DeepSeek key, the application must remain healthy and the AI task must fail through the existing P4 safe error path. Never add a client-side API key.

If AI output validation fails, inspect only task/provider metadata and stable error codes; do not log the full provider reasoning or secrets.

## Release verification

Before P5-A is marked complete, confirm fresh success for:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Also confirm production runtime dependency audit is green, CI made zero live DeepSeek requests, and the final diff contains no P5-B competitor crawl implementation, P5-C reporting implementation, or P6 visibility sampling.
