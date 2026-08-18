# P4 DeepSeek AI Gateway + Intelligence

P4 adds a provider-neutral AI Gateway backed by DeepSeek. It explains and prioritizes deterministic P2 SEO and P3 GEO facts without allowing AI output to become authoritative crawler, audit, entity, citation, visibility, ranking or traffic facts.

## Architecture boundary

Business modules do not call DeepSeek directly.

```text
P2 SEO / P3 GEO deterministic facts
        ↓
bounded immutable fact snapshot + source references
        ↓
SEO / GEO / Entity Intelligence
        ↓
durable AiTask + BullMQ ai queue
        ↓
AI worker
        ↓
AI Gateway → Provider Registry → DeepSeek Provider
        ↓
JSON parse + Zod validation
        ↓
AiProviderCall + AiAnalysisResult
        ↓
REST API / AI Analysis Center
```

P1/P2/P3 persisted facts remain authoritative. P4 may summarize, explain, prioritize and propose changes. It may not mark a P2 issue resolved, mark a P3 condition fixed, or manufacture HTTP, robots, sitemap, ranking, citation, visibility, SOV or traffic facts. Verification always requires a new deterministic crawl/audit.

P4 AI Analysis is also separate from P6 AI Visibility. P6 is reserved for real Prompt × Platform sampling, external citation observation and monitored visibility/SOV.

## Environment variables

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_FAST_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=180000
AI_MAX_INPUT_CHARS=200000
AI_MAX_OUTPUT_TOKENS=8192
```

`DEEPSEEK_API_KEY` is optional at application startup. Crawler/SEO/GEO-only deployments must start without it. A real AI request without a configured key fails safely and durably.

The key is server-only. Do not put it in database rows, API responses, EJS templates, browser JavaScript, task snapshots or logs.

Model IDs are configuration, not business-code constants, so provider model changes can be handled without editing SEO/GEO/Entity intelligence modules.

## FAST and REASONING routing

- `FAST` defaults to `deepseek-v4-flash`, with thinking disabled.
- `REASONING` defaults to `deepseek-v4-pro`, with thinking enabled and `reasoning_effort=high`.

The provider uses the OpenAI-compatible DeepSeek Chat Completions endpoint. JSON tasks use `response_format: { "type": "json_object" }` and prompts explicitly request JSON with an example shape.

Provider `reasoning_content` is never persisted, logged or rendered. Aggregate reasoning-token usage may be retained when the provider supplies it.

## Versioned prompts and structured output

Initial prompt IDs:

```text
seo-audit-analysis-v1
geo-readiness-analysis-v1
entity-enrichment-v1
```

Persisted task runs reference prompt versions, so existing versions are immutable. Semantic prompt changes create a new version instead of silently changing an old definition.

Every JSON response is parsed and validated with its Zod schema before persistence. Malformed or schema-invalid output is classified as `INVALID_AI_OUTPUT`.

Prompts instruct the model to use only supplied facts, not invent crawl/ranking/citation/visibility/traffic facts, and not claim a fix unless deterministic facts already prove it.

## Fact boundaries

### SEO Intelligence

SEO analysis consumes persisted P2 facts such as audit IDs, score/components, issue/rule identity, severity/status, affected-page counts, bounded affected URLs and deterministic comparison state.

The packet is bounded to the most useful facts and is constrained by `AI_MAX_INPUT_CHARS`. Raw HTML, cookies, authorization data and invented ranking/traffic fields are excluded.

Returned priorities and recommendations must reference source IDs supplied in the task packet.

### GEO Intelligence

GEO analysis may consume `GEO_READINESS_V1`, deterministic GeoRuleResults, Citability readiness, Entity observations/relations, AI crawler policy facts and owned-site Brand readiness.

`UNKNOWN` and `null` remain unavailable/unknown, never zero. P4 does not fabricate AI Visibility, external citation counts, platform positions or SOV.

### Entity Intelligence

Entity enrichment uses deterministic entity IDs/types/names/official URLs/aliases/observations and persists suggestions only in `AiAnalysisResult`.

It does not mutate `Entity`, `EntityAlias`, `EntityObservation` or `EntityRelation`. Any future adoption of suggestions must be a separate human-reviewed workflow.

## Durable task lifecycle

Logical requests are idempotent using `(projectId, requestKey)`. A task has durable runs, provider call metadata and at most one validated analysis result per run.

BullMQ paid AI jobs use `attempts: 1`. The system does not hide broad paid-call retries behind the queue. A user/manual retry of a failed task creates a new run attempt and a deterministic retry job ID.

Worker lifecycle:

1. load task;
2. ignore terminal/ineligible state;
3. atomically claim QUEUED task;
4. resolve prompt/model/mode;
5. create durable run attempt;
6. call AI Gateway;
7. persist safe provider metadata and usage;
8. parse and validate JSON output;
9. persist analysis result;
10. mark run/task completed;
11. on failure, persist a sanitized error and mark failed.

## Provider retry policy

Provider error classification:

```text
400/422 → INVALID_REQUEST (terminal)
401     → AUTH (terminal)
402     → BALANCE (terminal)
429     → RATE_LIMIT
500     → UPSTREAM (manual retry)
503     → OVERLOADED
Abort   → TIMEOUT (manual retry)
```

Automatic provider retry is limited to explicit 429/503 responses, with bounded backoff and no more than two additional attempts. Ambiguous timeouts and HTTP 500 requests are not automatically repeated because they may have consumed a paid request upstream.

## Observability and logging safety

P4 structured lifecycle events:

```text
ai.task.queued
ai.task.started
ai.provider.request.completed
ai.provider.request.failed
ai.output.validated
ai.task.completed
ai.task.failed
```

Allowed event fields include task/project/run IDs, provider, model, prompt version, HTTP status, latency, aggregate token/cache usage and stable error categories.

Do not log:

- API keys or Authorization headers;
- full prompts;
- full fact snapshots;
- provider `reasoning_content`;
- full AI output;
- raw upstream error bodies that may contain sensitive content.

Error messages are bounded/flattened. Prefer stable error codes and HTTP status over raw provider response bodies.

## REST API

```text
POST /api/v1/projects/:projectId/ai/seo-analysis
POST /api/v1/projects/:projectId/ai/geo-analysis
POST /api/v1/projects/:projectId/ai/entity-enrichment
GET  /api/v1/projects/:projectId/ai/tasks
GET  /api/v1/ai/tasks/:taskId
POST /api/v1/ai/tasks/:taskId/retry
```

POST endpoints return `202` with durable task identity/status. Reads expose persisted safe results/metadata only. Project ownership/scoping is enforced before task reads/retries.

`AI_ANALYSIS` is available to STANDARD, ADVANCED and ENTERPRISE plans. It must not reuse the separate `AI_VISIBILITY` capability gate.

## Web UI

Project-scoped pages:

```text
/projects/:id/ai
/projects/:id/ai/tasks/:taskId
```

The AI Analysis Center shows provider availability without exposing a key, configured model route names, SEO/GEO/Entity analysis actions, recent task state and persisted summaries/results. Resolvable source references link back to deterministic SEO/GEO evidence.

Chromium smoke tests use deterministic persisted fixtures and never call the live DeepSeek provider.

## Troubleshooting

### 401 AUTH

Check that `DEEPSEEK_API_KEY` is configured in the server environment and has not been accidentally quoted/truncated. Never print the key while debugging.

### 402 BALANCE

The upstream account does not have sufficient balance/credit. The task remains a durable failure. Resolve provider billing and use explicit manual retry.

### 429 RATE_LIMIT

The provider may retry this error within the bounded provider retry policy. Persistent 429 failures should be treated as capacity/rate-limit pressure, not an application fact error.

### 500 UPSTREAM

Do not automatically repeat. Preserve the stable `UPSTREAM` category and use manual retry when appropriate.

### 503 OVERLOADED

The provider may retry this error within the bounded retry policy. If exhausted, record the durable failure and retry manually later.

### TIMEOUT

Timeouts are ambiguous: the provider may have received/processed the paid request. Do not automatically repeat. Record the safe timeout failure and use manual retry.

### INVALID_AI_OUTPUT

The provider returned malformed JSON or JSON that did not match the expected schema/source-reference contract. Keep the deterministic source facts unchanged and retry only through the explicit task flow.

## Release verification

P4 is not complete until fresh verification succeeds:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI must also show the production runtime dependency audit green. CI must not contain a live DeepSeek API key or perform a live provider request.

Before merge, range-check the release diff: it may contain P4 persistence/gateway/intelligence/API/UI/tests/docs plus explicit queue/feature/env integration. It must not introduce P5 content-generation workflows or P6 Prompt/Citation/Visibility sampling.
