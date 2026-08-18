# P4 DeepSeek AI Gateway + Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-safe AI Gateway backed by DeepSeek and use it to explain deterministic P2 SEO and P3 GEO facts without allowing AI output to overwrite factual crawler/audit state.

**Architecture:** Business modules never call DeepSeek directly. SEO/GEO/Entity intelligence modules build bounded immutable fact snapshots with explicit source references, create durable `AiTask` records, and enqueue the existing `ai` BullMQ queue. The AI worker calls `AI Gateway → Provider Interface → DeepSeek Provider`, stores provider metadata/token usage and validated structured analysis, and exposes read-only intelligence through REST/UI. Deterministic P1/P2/P3 facts remain authoritative.

**Tech Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL, Prisma 6.x multi-file schema, Redis/BullMQ, Zod, native `fetch`, Vitest, Supertest, Playwright, DeepSeek OpenAI-compatible Chat Completions API.

**Spec:** `docs/superpowers/specs/2026-08-18-seo-geo-platform-design.md`

## Global Constraints

- System entry remains `seo.xingshantang.org`; analyzed domains are project data.
- P1 crawler facts, P2 SEO rule results/issues/scores and P3 GEO rule results/scores remain authoritative and immutable from P4.
- P4 may explain, summarize, prioritize and propose changes; it may not manufacture HTTP/robots/sitemap/ranking/citation/visibility facts.
- P4 may not mark a P2 SEO issue `RESOLVED` or a P3 readiness condition fixed. Verification still requires a new deterministic crawl/audit.
- DeepSeek calls must go through `AI Gateway → Provider Interface → DeepSeek Provider`; no business module imports the provider directly.
- DeepSeek API key is server-only environment configuration. Never store or log the key.
- Current official DeepSeek models verified on 2026-08-18 are `deepseek-v4-flash` and `deepseek-v4-pro`; model IDs are environment-configurable so future model changes do not require business-module edits.
- Legacy `deepseek-chat` / `deepseek-reasoner` names are not used in new P4 code.
- `FAST` routing defaults to `deepseek-v4-flash` with thinking disabled. `REASONING` defaults to `deepseek-v4-pro` with thinking enabled and `reasoning_effort=high`.
- Provider `reasoning_content` must never be persisted, logged or exposed in the product. P4 stores final content and aggregate reasoning-token usage only when supplied by the provider.
- JSON tasks must use DeepSeek JSON Output and must include explicit JSON instructions/example shape in the prompt.
- CI never calls the live DeepSeek API. Provider transport is dependency-injected and tested against deterministic mock responses.
- Paid AI jobs do not use broad BullMQ automatic retries. Explicit provider errors are classified; manual retry creates a new run. This avoids hidden duplicate paid requests after ambiguous timeouts.
- P4 is available on STANDARD/ADVANCED/ENTERPRISE through an `AI_ANALYSIS` feature. P6 AI Visibility remains separately gated.
- Input fact snapshots are bounded. Raw HTML, cookies, authorization headers, sessions and secrets are never sent to DeepSeek by P4.

---

## File Structure

### Persistence

- `prisma/models/ai-gateway.prisma` — AI task/run/provider-call/analysis models and enums.
- `prisma/migrations/<timestamp>_add_ai_gateway_foundation/migration.sql` — durable P4 schema.

### Gateway

- `src/modules/ai/ai.types.ts` — provider-neutral request/response/error/task contracts.
- `src/modules/ai/ai.config.ts` — model routing and limits derived from environment.
- `src/modules/ai/provider.ts` — provider interface.
- `src/modules/ai/provider-registry.ts` — provider resolution; initially DeepSeek only.
- `src/modules/ai/deepseek.provider.ts` — OpenAI-format DeepSeek transport.
- `src/modules/ai/structured-output.ts` — JSON parse + Zod validation.
- `src/modules/ai/ai.repository.ts` — durable task/run/call/result writes and reads.
- `src/modules/ai/ai.service.ts` — idempotent task creation/enqueue and manual retry.
- `src/modules/ai/ai.worker.ts` — BullMQ `ai` processor.
- `src/modules/ai/ai-observability.ts` — structured safe lifecycle events.

### Intelligence

- `src/modules/ai/prompts/prompt-registry.ts` — versioned prompt definitions.
- `src/modules/ai/seo-intelligence.ts` — deterministic SEO fact packet + output schema.
- `src/modules/ai/geo-intelligence.ts` — deterministic GEO fact packet + output schema.
- `src/modules/ai/entity-intelligence.ts` — semantic entity suggestions that do not mutate deterministic entities.

### API / Web

- `src/modules/ai/ai.routes.ts` — REST endpoints.
- `src/web/ai-read.repository.ts` — web read models.
- `src/views/ai/index.ejs` — AI Analysis Center.
- `src/views/ai/detail.ejs` — persisted analysis detail.
- modify `src/web/routes.ts`, `src/app.ts`, `src/queue/worker-bootstrap.ts`, `src/auth/feature-flags.ts`, `src/views/partials/sidebar.ejs`, `src/views/partials/topbar.ejs`.

### Configuration / Docs

- modify `src/config/env.ts`, `.env.example`, `README.md`.
- create `docs/development/p4-ai-gateway.md`.

---

### Task 1: Durable AI persistence foundation

**Files:**
- Create: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/<timestamp>_add_ai_gateway_foundation/migration.sql`
- Test: `tests/integration/ai.persistence.test.ts`

**Interfaces:**
- Produces Prisma models `AiTask`, `AiTaskRun`, `AiProviderCall`, `AiAnalysisResult`.
- Produces enums `AiTaskType`, `AiTaskStatus`, `AiRunStatus`, `AiProviderName`, `AiMode`, `AiResponseFormat`.

- [ ] **Step 1: Write the failing persistence test**

```ts
const task = await prisma.aiTask.create({
  data: {
    projectId: project.id,
    taskType: 'SEO_AUDIT_ANALYSIS',
    status: 'QUEUED',
    requestKey: `seo:${seoAudit.id}:v1`,
    promptVersion: 'seo-audit-analysis-v1',
    factSnapshot: { auditId: seoAudit.id, score: 78 },
    sourceReferences: [{ type: 'SEO_AUDIT', id: seoAudit.id }]
  }
});
const run = await prisma.aiTaskRun.create({
  data: {
    aiTaskId: task.id,
    attemptNo: 1,
    provider: 'DEEPSEEK',
    model: 'deepseek-v4-flash',
    mode: 'FAST',
    responseFormat: 'JSON',
    status: 'RUNNING',
    promptVersion: task.promptVersion,
    requestHash: 'fixture-hash'
  }
});
expect(run.aiTaskId).toBe(task.id);
```

Also assert:
- unique `(projectId, requestKey)` prevents duplicate logical tasks;
- unique `(aiTaskId, attemptNo)` prevents duplicate runs;
- provider call can persist HTTP status, provider response ID, latency and token/cache usage;
- analysis result stores validated structured output and source references;
- deleting an AI task cascades only P4-owned rows and leaves P1/P2/P3 facts intact.

- [ ] **Step 2: Run the test and confirm RED**

Run: `npm test -- --run tests/integration/ai.persistence.test.ts`
Expected: compile/Prisma failure because P4 AI models do not exist.

- [ ] **Step 3: Implement the schema**

Use these durable shapes:

```prisma
enum AiTaskType {
  SEO_AUDIT_ANALYSIS
  GEO_READINESS_ANALYSIS
  ENTITY_ENRICHMENT
}

enum AiTaskStatus { QUEUED RUNNING COMPLETED FAILED }
enum AiRunStatus { RUNNING COMPLETED FAILED }
enum AiProviderName { DEEPSEEK }
enum AiMode { FAST REASONING }
enum AiResponseFormat { TEXT JSON }

model AiTask {
  id               String       @id @default(uuid()) @db.Uuid
  projectId        String       @db.Uuid
  taskType         AiTaskType
  status           AiTaskStatus @default(QUEUED)
  requestKey       String
  promptVersion    String
  factSnapshot     Json
  sourceReferences Json
  errorCode        String?
  errorMessage     String?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
  runs             AiTaskRun[]
  @@unique([projectId, requestKey])
  @@index([projectId, createdAt])
}

model AiTaskRun {
  id             String           @id @default(uuid()) @db.Uuid
  aiTaskId       String           @db.Uuid
  attemptNo      Int
  provider       AiProviderName
  model          String
  mode           AiMode
  responseFormat AiResponseFormat
  status         AiRunStatus
  promptVersion  String
  requestHash    String
  startedAt      DateTime         @default(now())
  finishedAt     DateTime?
  errorCode      String?
  errorMessage   String?
  task           AiTask           @relation(fields: [aiTaskId], references: [id], onDelete: Cascade)
  calls          AiProviderCall[]
  result         AiAnalysisResult?
  @@unique([aiTaskId, attemptNo])
}
```

`AiProviderCall` stores attempt metadata and usage only. `AiAnalysisResult` is one-to-one with `AiTaskRun` and stores `resultType`, `summary`, `structuredOutput`, `sourceReferences`, provider/model/promptVersion. Do not add fields for API key or `reasoning_content`.

- [ ] **Step 4: Add and apply the migration**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Expected: all succeed.

- [ ] **Step 5: Run GREEN verification**

Run: `npm test -- --run tests/integration/ai.persistence.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma tests/integration/ai.persistence.test.ts
git commit -m "feat: add P4 AI persistence foundation"
```

---

### Task 2: Provider-neutral AI Gateway contracts and configuration

**Files:**
- Create: `src/modules/ai/ai.types.ts`
- Create: `src/modules/ai/ai.config.ts`
- Create: `src/modules/ai/provider.ts`
- Create: `src/modules/ai/provider-registry.ts`
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Test: `tests/unit/ai.config.test.ts`
- Test: `tests/unit/ai.provider-registry.test.ts`

**Interfaces:**

```ts
export type AiMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type AiGatewayMode = 'FAST' | 'REASONING';
export type AiGatewayFormat = 'TEXT' | 'JSON';

export interface AiProviderRequest {
  messages: AiMessage[];
  model: string;
  mode: AiGatewayMode;
  responseFormat: AiGatewayFormat;
  maxOutputTokens: number;
  projectUserId?: string;
}

export interface AiProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens: number | null;
}

export interface AiProviderResponse {
  provider: 'DEEPSEEK';
  model: string;
  responseId: string | null;
  content: string;
  finishReason: string | null;
  latencyMs: number;
  usage: AiProviderUsage;
}

export interface AiProvider {
  readonly name: 'DEEPSEEK';
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}
```

- [ ] **Step 1: Write failing config tests**

Assert defaults:

```ts
expect(config.fastModel).toBe('deepseek-v4-flash');
expect(config.reasoningModel).toBe('deepseek-v4-pro');
expect(config.baseUrl).toBe('https://api.deepseek.com');
expect(config.maxInputChars).toBe(200_000);
expect(config.maxOutputTokens).toBe(8192);
```

Assert application startup does not require `DEEPSEEK_API_KEY`; provider calls fail cleanly only when invoked without a key.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/unit/ai.config.test.ts tests/unit/ai.provider-registry.test.ts`
Expected: missing P4 modules.

- [ ] **Step 3: Add environment fields**

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_FAST_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=180000
AI_MAX_INPUT_CHARS=200000
AI_MAX_OUTPUT_TOKENS=8192
```

`DEEPSEEK_API_KEY` must be optional in the environment schema so crawler/SEO/GEO-only deployments still start.

- [ ] **Step 4: Implement provider-neutral contracts and registry**

Registry accepts constructed providers for tests and returns DeepSeek for P4 requests. Business modules consume the registry/gateway service, never `DeepSeekProvider` directly.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --run tests/unit/ai.config.test.ts tests/unit/ai.provider-registry.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/env.ts .env.example src/modules/ai tests/unit/ai.*
git commit -m "feat: define P4 AI Gateway contracts"
```

---

### Task 3: DeepSeek provider transport

**Files:**
- Create: `src/modules/ai/deepseek.provider.ts`
- Test: `tests/unit/deepseek.provider.test.ts`

**Interfaces:**
- Consumes `AiProviderRequest`.
- Produces `AiProviderResponse` with final `content` and aggregate usage only.
- Provider constructor accepts injectable `fetchImpl`, clock and sleep function for deterministic tests.

- [ ] **Step 1: Write failing transport tests**

Test a FAST JSON request and assert outgoing body contains:

```ts
expect(body).toMatchObject({
  model: 'deepseek-v4-flash',
  thinking: { type: 'disabled' },
  response_format: { type: 'json_object' },
  max_tokens: 4096
});
```

Test a REASONING request:

```ts
expect(body).toMatchObject({
  model: 'deepseek-v4-pro',
  thinking: { type: 'enabled' },
  reasoning_effort: 'high'
});
```

Mock a response containing `reasoning_content` and assert the returned provider response has no field containing that text.

Mock usage:

```json
{
  "prompt_tokens": 100,
  "completion_tokens": 50,
  "total_tokens": 150,
  "prompt_cache_hit_tokens": 70,
  "prompt_cache_miss_tokens": 30,
  "completion_tokens_details": { "reasoning_tokens": 20 }
}
```

and assert exact normalized usage.

- [ ] **Step 2: Add error-classification tests**

Expected mapping:

```text
400/422 → INVALID_REQUEST (terminal)
401     → AUTH (terminal)
402     → BALANCE (terminal)
429     → RATE_LIMIT (retryable classification)
500     → UPSTREAM (manual retry)
503     → OVERLOADED (retryable classification)
Abort   → TIMEOUT (manual retry)
```

Automatic provider retry is allowed only for explicit 429/503, maximum two additional attempts with bounded backoff. Do not automatically repeat ambiguous timeouts or HTTP 500 requests.

- [ ] **Step 3: Run RED**

Run: `npm test -- --run tests/unit/deepseek.provider.test.ts`
Expected: provider missing.

- [ ] **Step 4: Implement native-fetch transport**

POST to:

```text
${DEEPSEEK_BASE_URL}/chat/completions
Authorization: Bearer <server-only key>
Content-Type: application/json
```

Use `AbortController` with configured timeout. Parse non-streaming JSON response. Treat missing/empty final content as `EMPTY_RESPONSE`. Never log request authorization or returned reasoning text.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- --run tests/unit/deepseek.provider.test.ts && npm run typecheck`
Expected: PASS with zero network calls.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ai/deepseek.provider.ts tests/unit/deepseek.provider.test.ts
git commit -m "feat: add DeepSeek provider transport"
```

---

### Task 4: Versioned prompts and structured-output validation

**Files:**
- Create: `src/modules/ai/prompts/prompt-registry.ts`
- Create: `src/modules/ai/structured-output.ts`
- Test: `tests/unit/ai.structured-output.test.ts`
- Test: `tests/unit/ai.prompt-registry.test.ts`

**Interfaces:**

```ts
export interface PromptDefinition {
  id: string;
  version: string;
  mode: 'FAST' | 'REASONING';
  responseFormat: 'JSON';
  system: string;
  buildUserMessage(facts: unknown): string;
}

export function parseStructuredOutput<T>(
  content: string,
  schema: z.ZodType<T>
): T;
```

- [ ] **Step 1: Write RED tests**

Require every JSON prompt to contain the literal word `JSON` and an example output shape. Require the parser to reject malformed JSON and schema-invalid JSON with `INVALID_AI_OUTPUT`.

- [ ] **Step 2: Define initial prompt IDs**

```text
seo-audit-analysis-v1
geo-readiness-analysis-v1
entity-enrichment-v1
```

Every system prompt must state:

```text
Use only the supplied facts.
Do not invent crawl, HTTP, ranking, citation, visibility or traffic facts.
Do not claim an issue is fixed unless the supplied deterministic facts say so.
Return JSON matching the supplied example.
```

- [ ] **Step 3: Implement parser and registry**

Keep prompt versions immutable. A semantic prompt change creates `v2`; never silently change an existing version after persisted runs reference it.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/unit/ai.structured-output.test.ts tests/unit/ai.prompt-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/prompts src/modules/ai/structured-output.ts tests/unit/ai.*
git commit -m "feat: add versioned AI prompts and output validation"
```

---

### Task 5: Durable AI task service, repository and BullMQ worker

**Files:**
- Create: `src/modules/ai/ai.repository.ts`
- Create: `src/modules/ai/ai.service.ts`
- Create: `src/modules/ai/ai.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/integration/ai.task-service.test.ts`
- Test: `tests/unit/ai.worker.test.ts`

**Interfaces:**

```ts
export interface CreateAiTaskInput {
  projectId: string;
  taskType: 'SEO_AUDIT_ANALYSIS' | 'GEO_READINESS_ANALYSIS' | 'ENTITY_ENRICHMENT';
  requestKey: string;
  promptVersion: string;
  factSnapshot: unknown;
  sourceReferences: Array<{ type: string; id: string }>;
}

export async function createAndEnqueueAiTask(input: CreateAiTaskInput): Promise<AiTask>;
export async function processAiJob(job: Job<AiJobData>): Promise<void>;
```

- [ ] **Step 1: Write failing idempotency tests**

Create the same logical request twice and assert one `AiTask` and one BullMQ job ID:

```text
ai-task-<taskId>
```

- [ ] **Step 2: Write failing worker tests**

Worker contract:
1. load task;
2. no-op if already `COMPLETED`;
3. mark RUNNING;
4. resolve prompt + provider/model/mode;
5. create run attempt;
6. call gateway;
7. persist provider metadata/usage;
8. validate structured JSON;
9. persist analysis result;
10. mark task/run COMPLETED;
11. on failure, persist sanitized error and mark FAILED.

BullMQ worker itself uses `attempts: 1` for paid AI execution. User/manual retry creates `attemptNo + 1` rather than an invisible queue retry.

- [ ] **Step 3: Run RED**

Run: `npm test -- --run tests/integration/ai.task-service.test.ts tests/unit/ai.worker.test.ts`
Expected: missing service/worker.

- [ ] **Step 4: Implement repository/service/worker**

`factSnapshot` is the exact bounded input snapshot used for the task. `sourceReferences` contains IDs only. Compute a stable SHA-256 `requestHash` from prompt version + model route + normalized fact snapshot.

- [ ] **Step 5: Wire the existing `ai` queue**

Replace the current placeholder `ai` worker in `worker-bootstrap.ts` with `Worker<AiJobData>('ai', processAiJob, ...)`.

- [ ] **Step 6: Verify GREEN**

Run: `npm test -- --run tests/integration/ai.task-service.test.ts tests/unit/ai.worker.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ai src/queue/worker-bootstrap.ts tests
git commit -m "feat: add durable AI task execution"
```

---

### Task 6: SEO Intelligence fact packet and analysis

**Files:**
- Create: `src/modules/ai/seo-intelligence.ts`
- Test: `tests/integration/ai.seo-intelligence.test.ts`

**Interfaces:**

```ts
export const SeoAnalysisSchema = z.object({
  summary: z.string().min(1),
  priorities: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    title: z.string().min(1),
    reason: z.string().min(1),
    sourceRefs: z.array(z.string()).min(1)
  })).max(10),
  recommendations: z.array(z.object({
    title: z.string().min(1),
    action: z.string().min(1),
    sourceRefs: z.array(z.string()).min(1)
  })).max(12)
});

export async function createSeoAnalysisTask(projectId: string, auditRunId: string): Promise<AiTask>;
```

- [ ] **Step 1: Write RED fact-boundary test**

Fixture one completed SEO audit and assert the AI task snapshot contains only persisted facts such as:
- audit ID / score / score components;
- issue ID, rule code/name, severity/status, affected-page count;
- bounded affected URLs where useful;
- deterministic comparison state.

Assert the snapshot does **not** contain raw HTML, cookies, authorization data or any invented traffic/ranking field.

- [ ] **Step 2: Implement bounded snapshot builder**

Use at most 30 top issues and at most 10 affected URLs per issue. Enforce global `AI_MAX_INPUT_CHARS`; if exceeded, reduce URL/detail arrays deterministically before rejecting the request.

Request key:

```text
seo-audit:<auditRunId>:seo-audit-analysis-v1
```

- [ ] **Step 3: Verify source-reference integrity**

Every AI priority/recommendation must reference supplied source IDs. Validation rejects a returned source ref not present in the task snapshot.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/integration/ai.seo-intelligence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/seo-intelligence.ts tests/integration/ai.seo-intelligence.test.ts
git commit -m "feat: add DeepSeek SEO intelligence facts"
```

---

### Task 7: GEO Intelligence fact packet and analysis

**Files:**
- Create: `src/modules/ai/geo-intelligence.ts`
- Test: `tests/integration/ai.geo-intelligence.test.ts`

**Interfaces:**

```ts
export const GeoAnalysisSchema = z.object({
  summary: z.string().min(1),
  opportunities: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    dimension: z.enum(['CITABILITY', 'ENTITY', 'AI_CRAWLER', 'BRAND', 'CONTENT_GEO']),
    title: z.string().min(1),
    recommendation: z.string().min(1),
    sourceRefs: z.array(z.string()).min(1)
  })).max(12),
  unavailableFacts: z.array(z.string()).max(20)
});

export async function createGeoAnalysisTask(projectId: string, geoAuditRunId: string): Promise<AiTask>;
```

- [ ] **Step 1: Write RED P3-boundary test**

Snapshot may include:
- `GEO_READINESS_V1` score and components;
- deterministic failing GeoRuleResults;
- Citability scores including explicit unavailable/null semantic dimensions;
- Entity observations/relations;
- AI crawler PASS/FAIL/UNKNOWN facts;
- owned-site Brand readiness facts.

Assert snapshot contains no fake `aiVisibility`, external citation count, SOV or platform position.

- [ ] **Step 2: Implement bounded snapshot**

Preserve `UNKNOWN`/`null` exactly. The prompt explicitly instructs the model to describe unavailable facts as unavailable, never zero.

Request key:

```text
geo-audit:<geoAuditRunId>:geo-readiness-analysis-v1
```

- [ ] **Step 3: Validate returned refs**

Reject recommendations that cite source IDs not supplied in the fact packet.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/integration/ai.geo-intelligence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/geo-intelligence.ts tests/integration/ai.geo-intelligence.test.ts
git commit -m "feat: add DeepSeek GEO intelligence facts"
```

---

### Task 8: Semantic entity enrichment as suggestions only

**Files:**
- Create: `src/modules/ai/entity-intelligence.ts`
- Test: `tests/integration/ai.entity-intelligence.test.ts`

**Interfaces:**

```ts
export const EntityEnrichmentSchema = z.object({
  suggestions: z.array(z.object({
    entityId: z.string().uuid(),
    suggestedDescription: z.string().min(1).nullable(),
    suggestedAliases: z.array(z.string()).max(10),
    rationale: z.string().min(1),
    sourceRefs: z.array(z.string()).min(1)
  })).max(20)
});
```

- [ ] **Step 1: Write RED non-mutation test**

Run an entity enrichment task against existing P3 entities, persist a valid AI result, then assert deterministic `Entity`, `EntityAlias`, `EntityObservation`, `EntityRelation` rows are unchanged.

- [ ] **Step 2: Build enrichment snapshot**

Use deterministic entity IDs/types/names/official URLs/explicit aliases and observations only. Do not send unrestricted page bodies.

- [ ] **Step 3: Persist suggestions only in `AiAnalysisResult`**

P4 does not auto-apply suggested aliases or descriptions. A later human-reviewed workflow can adopt suggestions in a separately designed task.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- --run tests/integration/ai.entity-intelligence.test.ts`
Expected: PASS and deterministic entity tables byte-for-byte equivalent before/after except timestamps unrelated to the test must not change.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai/entity-intelligence.ts tests/integration/ai.entity-intelligence.test.ts
git commit -m "feat: add safe entity intelligence suggestions"
```

---

### Task 9: REST API, feature gating and AI Analysis Center UI

**Files:**
- Create: `src/modules/ai/ai.routes.ts`
- Create: `src/web/ai-read.repository.ts`
- Create: `src/views/ai/index.ejs`
- Create: `src/views/ai/detail.ejs`
- Modify: `src/app.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/auth/feature-flags.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/views/partials/topbar.ejs`
- Test: `tests/integration/ai.api.test.ts`
- Test: `tests/integration/ai.web.test.ts`
- Test: `tests/e2e/ai.spec.ts`

**Interfaces:**

REST endpoints:

```text
POST /api/v1/projects/:projectId/ai/seo-analysis
POST /api/v1/projects/:projectId/ai/geo-analysis
POST /api/v1/projects/:projectId/ai/entity-enrichment
GET  /api/v1/projects/:projectId/ai/tasks
GET  /api/v1/ai/tasks/:taskId
POST /api/v1/ai/tasks/:taskId/retry
```

Web routes:

```text
/projects/:id/ai
/projects/:id/ai/tasks/:taskId
```

- [ ] **Step 1: Write API RED tests**

Assert project scoping, source audit ownership, idempotent task creation, task reads, manual retry and no API key exposure in any JSON response.

- [ ] **Step 2: Add `AI_ANALYSIS` feature**

`STANDARD`, `ADVANCED`, `ENTERPRISE` all include `AI_ANALYSIS`. Do not reuse `AI_VISIBILITY`; P4 analysis and P6 monitored visibility are separate capabilities.

- [ ] **Step 3: Implement REST routes**

POST routes create/enqueue durable tasks and return `202` with task ID/status. Reads return persisted facts/results only. Retry is rejected for a currently RUNNING task and creates a new run attempt only for FAILED tasks.

- [ ] **Step 4: Write Web RED tests**

AI Analysis Center must display:
- provider status without showing key;
- current model route names;
- SEO/GEO/Entity analysis actions;
- recent task status;
- latest summaries/results;
- source-reference links back to SEO/GEO pages when resolvable.

- [ ] **Step 5: Implement UI and navigation**

Replace the existing DeepSeek `#` sidebar placeholder with the real project-scoped AI Analysis Center. Do not wire P6 AI Visibility placeholders to P4 routes.

- [ ] **Step 6: Add Chromium smoke flow**

E2E uses a deterministic persisted completed AI result fixture. It must not call the live provider.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- --run tests/integration/ai.api.test.ts tests/integration/ai.web.test.ts
npm run test:e2e
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src tests
git commit -m "feat: add P4 AI Analysis Center"
```

---

### Task 10: Observability, operator docs and P4 release gate

**Files:**
- Create: `src/modules/ai/ai-observability.ts`
- Create: `docs/development/p4-ai-gateway.md`
- Modify: `README.md`
- Test: `tests/integration/ai.observability.test.ts`

**Interfaces:**

Structured event names:

```text
ai.task.queued
ai.task.started
ai.provider.request.completed
ai.provider.request.failed
ai.output.validated
ai.task.completed
ai.task.failed
```

- [ ] **Step 1: Write observability RED test**

Capture structured log events for one successful mocked-provider task and assert:
- task/project/run/provider/model/prompt version IDs are present;
- token counts/latency may be present;
- API key, Authorization header, full prompt, full fact snapshot, provider `reasoning_content` and full AI output are absent.

- [ ] **Step 2: Implement safe events**

Use bounded/flattened error messages. Provider errors expose stable error category + HTTP status when available, not upstream response bodies that could contain sensitive content.

- [ ] **Step 3: Write operator documentation**

Document:
- environment variables;
- V4 model routing and why IDs are configurable;
- API key server-only handling;
- FAST vs REASONING mode;
- JSON Output validation;
- paid-call retry policy;
- source-reference/fact-boundary rules;
- no persistence of `reasoning_content`;
- queue/worker behavior;
- troubleshooting for 401/402/429/500/503/timeouts;
- P4 vs P6 boundary.

- [ ] **Step 4: Update README milestone**

Roadmap after release:

```text
P0 complete
P1 complete
P2 complete
P3 complete
P4 DeepSeek AI Gateway + Intelligence — complete
P5 Content, competitor analysis, reports — next
P6 AI Visibility Advanced
```

- [ ] **Step 5: Run final release verification**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI must also show the production runtime dependency audit green. No live DeepSeek API key is present in CI.

- [ ] **Step 6: Range-check the PR**

Changed files must be limited to P4 AI persistence/gateway/intelligence/API/UI/tests/docs plus explicit queue/feature/env integration. No P5 content-generation workflow or P6 Prompt/Citation/Visibility sampling is allowed.

- [ ] **Step 7: Commit and merge only after fresh green evidence**

```bash
git add .
git commit -m "docs: complete P4 AI Gateway release gate"
```

---

## P4 Acceptance Criteria

1. Business modules cannot call DeepSeek without the AI Gateway/provider interface.
2. The application starts without an API key; an AI request without a configured key fails safely and durably.
3. New code uses configurable `deepseek-v4-flash` / `deepseek-v4-pro` defaults and does not hard-code deprecated model names.
4. `FAST` and `REASONING` modes map to explicit model/thinking configuration.
5. CI makes zero live DeepSeek requests.
6. API keys, authorization headers and provider reasoning text are never persisted/logged/rendered.
7. Provider usage records prompt/completion/total/cache token counts when available.
8. Structured AI output is JSON-parsed and Zod-validated before persistence as an analysis result.
9. SEO intelligence only consumes persisted P2 facts and cannot resolve issues.
10. GEO intelligence preserves UNKNOWN/unavailable P3 facts and cannot fabricate AI Visibility/citations/SOV.
11. Entity enrichment persists suggestions only and cannot silently mutate deterministic P3 entity facts.
12. Each analysis result stores prompt version, model/provider and source references sufficient to trace the deterministic facts it analyzed.
13. Paid jobs are idempotent and do not use hidden broad queue retries.
14. STANDARD plan can use AI analysis; P6 visibility gates remain unchanged.
15. Full Prisma/TypeScript/Vitest/build/runtime-audit/Chromium E2E release gate is green before P4 is marked complete.

## Official DeepSeek API Baseline Verified 2026-08-18

Implementation assumptions were checked against DeepSeek official API documentation on 2026-08-18:

- OpenAI-compatible base URL remains `https://api.deepseek.com`.
- Current model IDs are `deepseek-v4-flash` and `deepseek-v4-pro`.
- Both support thinking/non-thinking modes and JSON Output.
- Thinking control uses `thinking.type`; reasoning effort supports `high`/`max`.
- Usage includes prompt/completion/total tokens and prompt cache hit/miss counts; reasoning token details may be available.
- JSON Output requires `response_format: { type: "json_object" }` plus explicit JSON instructions in the prompt.
- Error classes include 400, 401, 402, 422, 429, 500 and 503.

Because provider APIs evolve, exact model IDs remain environment configuration rather than business-code constants.

## Handoff to P5

P5 may consume validated P4 analysis to produce content briefs, content optimization and competitor/report workflows. P5 must continue to distinguish deterministic source facts from AI recommendations and must not introduce P6 AI Visibility sampling early.
