# P6-A Prompt Monitor & Sampling Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the P6-A foundation for versioned prompt management and bounded, budget-controlled official-API AI visibility sampling on the reserved `visibility` queue.

**Architecture:** P6-A introduces a persistence domain separate from P4/P5 AI advisory tasks. `VisibilityProjectSettings`, `VisibilityProviderConfig`, `VisibilityPromptSet`, `VisibilityPrompt`, `VisibilityRun`, and `PlatformObservation` persist sampling policy, immutable prompt versions, run requests, and normalized provider observations. A provider-neutral adapter registry executes paid web-grounded samples through the existing reserved `visibility` BullMQ queue; API sampling is always labeled `channel=API`, provider reasoning is discarded, and CI uses fixture adapters only.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest/Playwright, native `fetch`-style HTTP provider adapters.

**Spec:** `docs/superpowers/specs/2026-08-19-p6-ai-visibility-design.md`

## Global Constraints

- P6 authoritative observations require actual supported provider API calls; P3 readiness and P4/P5 advisory output are not visibility observations.
- API samples must be labeled as API samples, never as ChatGPT/Gemini/Claude/Perplexity consumer-product rankings.
- Initial channel is `API`; `CONSUMER_UI` is reserved and not implemented in P6-A.
- P6 remains Advanced/Enterprise only through existing `AI_VISIBILITY` / `PROMPT_MONITOR` gates.
- No provider secrets are persisted in project tables.
- No provider reasoning/thought/search-planning traces are persisted, logged, or rendered.
- Missing/unsupported/refused/failed/budget-skipped samples are not zeros.
- Duplicate queue delivery for one sampling unit must not create a second paid request.
- Paid provider attempts default to 1; retry must be explicit/auditable.
- CI must never call live OpenAI, Gemini, Perplexity, Anthropic, or DeepSeek endpoints.
- DeepSeek web grounding remains `UNSUPPORTED_WEB_GROUNDING` in P6-A.
- Per-run observation and budget ceilings must fail closed before a paid request.
- Historical `costMicros`, `costCurrency`, and `pricingVersion` are immutable observation facts.
- P1-P5 regression behavior must remain unchanged.

---

## File Structure

### Persistence

- `prisma/models/visibility.prisma` — P6-A enums and persistence models.
- `prisma/migrations/<timestamp>_add_visibility_sampling_core/migration.sql` — PostgreSQL DDL/FKs/indexes.

### Sampling domain

- `src/modules/visibility/visibility.types.ts` — provider-neutral enums/types and normalized request/response contracts.
- `src/modules/visibility/visibility.repository.ts` — project-scoped persistence and atomic claim/complete/fail operations.
- `src/modules/visibility/visibility-settings.service.ts` — settings/provider config validation.
- `src/modules/visibility/visibility-prompts.service.ts` — prompt-set creation and immutable prompt versioning.
- `src/modules/visibility/visibility-run.service.ts` — run creation, provider matrix expansion, stable sampling-unit keys, queue enqueue.
- `src/modules/visibility/visibility-budget.ts` — deterministic preflight ceiling checks.
- `src/modules/visibility/visibility.worker.ts` — visibility queue execution using injected adapter registry.
- `src/modules/visibility/visibility-observability.ts` — safe bounded operational events.

### Providers

- `src/modules/visibility/providers/provider.ts` — adapter interface/error types.
- `src/modules/visibility/providers/provider-registry.ts` — provider/config dispatch.
- `src/modules/visibility/providers/openai.provider.ts` — OpenAI Responses + web search normalization.
- `src/modules/visibility/providers/gemini.provider.ts` — Gemini Grounding with Google Search normalization.
- `src/modules/visibility/providers/perplexity.provider.ts` — Perplexity Sonar normalization.
- `src/modules/visibility/providers/anthropic.provider.ts` — Anthropic Messages + web search normalization.
- `src/modules/visibility/providers/deepseek.provider.ts` — explicit unsupported-web-grounding adapter only.

### Product/API/UI

- `src/modules/visibility/visibility.routes.ts` — Advanced/Enterprise REST API.
- `src/modules/visibility/visibility.web.repository.ts` — bounded web view data.
- `src/modules/visibility/visibility.web.routes.ts` — project-scoped EJS routes.
- `src/views/visibility/index.ejs` — AI Visibility/P6-A overview and recent runs.
- `src/views/visibility/prompts.ejs` — Prompt Monitor configuration.
- `src/views/visibility/runs/show.ejs` — run/observation detail.
- `src/app.ts` — route mounting.
- `src/queue/worker-bootstrap.ts` — activate `visibility` worker.
- `src/views/partials/sidebar.ejs` — activate AI Visibility and Prompt Monitor navigation.

---

## Task 1: P6-A Persistence Foundation

**Files:**
- Create: `tests/integration/visibility.persistence.test.ts`
- Create: `prisma/models/visibility.prisma`
- Create: `prisma/migrations/<timestamp>_add_visibility_sampling_core/migration.sql`

**Interfaces:**
- Produces Prisma models `VisibilityProjectSettings`, `VisibilityProviderConfig`, `VisibilityPromptSet`, `VisibilityPrompt`, `VisibilityRun`, `PlatformObservation` used by all later tasks.
- Produces enums for provider/channel/grounding/run/observation statuses.

- [ ] **Step 1: Write the failing persistence contract**

Create fixtures proving:

```ts
const settings = await prisma.visibilityProjectSettings.create({
  data: {
    projectId: project.id,
    dailyBudgetMicros: 2_000_000,
    defaultRunBudgetMicros: 500_000,
    maxObservationsPerRun: 100,
    defaultCurrency: 'USD',
    schedulingEnabled: false
  }
});

const provider = await prisma.visibilityProviderConfig.create({
  data: {
    projectId: project.id,
    provider: 'OPENAI',
    enabled: true,
    model: 'gpt-5-mini',
    channel: 'API',
    groundingMode: 'WEB_SEARCH',
    maxConcurrency: 2,
    providerOptionsJson: {}
  }
});

const set = await prisma.visibilityPromptSet.create({
  data: { projectId: project.id, name: 'Unbranded discovery' }
});

const prompt = await prisma.visibilityPrompt.create({
  data: {
    projectId: project.id,
    promptSetId: set.id,
    promptKey: 'best-traditional-culture-site',
    version: 1,
    promptText: 'Which websites explain Chinese folk religious traditions well?',
    promptHash: 'fixture-hash'
  }
});

const run = await prisma.visibilityRun.create({
  data: {
    projectId: project.id,
    promptSetId: set.id,
    runType: 'MANUAL',
    requestedProviderConfigs: [{ providerConfigId: provider.id }],
    maxObservations: 10,
    budgetCeilingMicros: 100_000,
    currency: 'USD',
    policySnapshotJson: { dailyBudgetMicros: 2_000_000 }
  }
});

const observation = await prisma.platformObservation.create({
  data: {
    projectId: project.id,
    visibilityRunId: run.id,
    visibilityPromptId: prompt.id,
    promptVersion: 1,
    samplingUnitKey: `visibility:${run.id}:${prompt.id}:OPENAI:gpt-5-mini:API:en-US:US`,
    provider: 'OPENAI',
    model: 'gpt-5-mini',
    channel: 'API',
    groundingMode: 'WEB_SEARCH',
    status: 'COMPLETED',
    answerText: 'fixture',
    answerHash: 'fixture-answer-hash',
    citationsJson: [],
    searchMetadataJson: {},
    costMicros: 1234,
    costCurrency: 'USD',
    pricingVersion: 'openai-2026-08'
  }
});
```

Assert:

- one settings row per project;
- provider config uniqueness on `(projectId, provider, model, channel, groundingMode)`;
- prompt uniqueness on `(promptSetId, promptKey, version)`;
- observation uniqueness on `samplingUnitKey`;
- deleting the project cascades all P6 rows;
- deleting P6 rows never deletes P0-P5 source rows.

- [ ] **Step 2: Run the test and observe RED**

Run:

```bash
npm test -- tests/integration/visibility.persistence.test.ts
```

Expected RED: Prisma client has no visibility models/enums.

- [ ] **Step 3: Add minimal Prisma schema**

Required enum values:

```prisma
enum VisibilityProvider { OPENAI GEMINI PERPLEXITY ANTHROPIC DEEPSEEK }
enum VisibilityChannel { API CONSUMER_UI }
enum VisibilityGroundingMode { WEB_SEARCH SEARCH_GROUNDING SONAR WEB_SEARCH_TOOL UNSUPPORTED_WEB_GROUNDING }
enum VisibilityConfigStatus { ACTIVE PAUSED ARCHIVED }
enum VisibilityRunStatus { QUEUED RUNNING COMPLETED PARTIAL FAILED CANCELLED }
enum VisibilityRunType { MANUAL SCHEDULED }
enum PlatformObservationStatus { PENDING RUNNING COMPLETED REFUSED UNSUPPORTED FAILED INCOMPLETE BUDGET_SKIPPED }
```

Required model rules:

- `VisibilityProjectSettings.projectId` unique FK to Project with cascade delete.
- `VisibilityProviderConfig` indexed by project/enabled/provider.
- `VisibilityPromptSet` project FK/cascade.
- `VisibilityPrompt` prompt-set FK/cascade and project ID for scoped queries.
- `VisibilityRun` project/prompt-set FKs and immutable request-policy JSON fields.
- `PlatformObservation` unique `samplingUnitKey`; project/run/prompt FKs; bounded-answer persistence fields; no reasoning field.

- [ ] **Step 4: Add migration with explicit FKs/indexes**

Migration must match Prisma schema and use Project FK cascade semantics.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- tests/integration/visibility.persistence.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add prisma tests/integration/visibility.persistence.test.ts
git commit -m "feat: add P6 visibility persistence foundation"
```

---

## Task 2: Project Settings, Provider Configs, and Immutable Prompt Versions

**Files:**
- Create: `tests/integration/visibility.configuration.test.ts`
- Create: `src/modules/visibility/visibility-settings.service.ts`
- Create: `src/modules/visibility/visibility-prompts.service.ts`
- Create: `src/modules/visibility/visibility.types.ts`

**Interfaces:**
- Produces `VisibilitySettingsService.getOrCreate(projectId)`.
- Produces `VisibilitySettingsService.update(projectId, input)`.
- Produces `VisibilitySettingsService.upsertProviderConfig(projectId, input)`.
- Produces `VisibilityPromptService.createPromptSet(projectId, input)`.
- Produces `VisibilityPromptService.createPromptVersion(projectId, input)`.

- [ ] **Step 1: Write failing configuration tests**

Test:

```ts
const settings = await settingsService.getOrCreate(project.id);
expect(settings).toMatchObject({
  maxObservationsPerRun: 100,
  defaultCurrency: 'USD',
  schedulingEnabled: false
});
```

Then prove:

```ts
await expect(settingsService.update(project.id, {
  maxObservationsPerRun: 0
})).rejects.toMatchObject({ code: 'INVALID_VISIBILITY_MAX_OBSERVATIONS' });

await expect(settingsService.upsertProviderConfig(project.id, {
  provider: 'OPENAI',
  model: 'gpt-5-mini',
  channel: 'CONSUMER_UI',
  groundingMode: 'WEB_SEARCH',
  enabled: true,
  maxConcurrency: 2
})).rejects.toMatchObject({ code: 'UNSUPPORTED_VISIBILITY_CHANNEL' });
```

Prompt version rules:

```ts
const v1 = await promptService.createPromptVersion(project.id, {
  promptSetId: set.id,
  promptKey: 'discovery',
  promptText: 'Which sites explain Chinese folk religion?',
  locale: 'en-US',
  country: 'US'
});
expect(v1.version).toBe(1);

const v2 = await promptService.createPromptVersion(project.id, {
  promptSetId: set.id,
  promptKey: 'discovery',
  promptText: 'Which sites best explain Chinese folk religion?',
  locale: 'en-US',
  country: 'US'
});
expect(v2.version).toBe(2);
expect(v1.promptText).not.toBe(v2.promptText);
```

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/integration/visibility.configuration.test.ts
```

Expected: modules missing.

- [ ] **Step 3: Implement settings validation**

Use Zod or explicit validation with these hard limits:

- `maxObservationsPerRun`: 1..500;
- `dailyBudgetMicros`: nullable, otherwise non-negative integer;
- `defaultRunBudgetMicros`: nullable, otherwise non-negative integer;
- `maxConcurrency`: 1..10;
- only channel `API` accepted in P6-A;
- providerOptionsJson allowlisted per provider and must reject keys containing `key`, `token`, `secret`, `authorization`, `cookie` case-insensitively.

- [ ] **Step 4: Implement immutable prompt versioning**

`promptHash = sha256(JSON.stringify({promptText, locale, country}))`.

Creating a new version must read the current max version for `(promptSetId,promptKey)` and insert `version+1`; never update previous text/hash.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.configuration.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility tests/integration/visibility.configuration.test.ts
git commit -m "feat: add P6 visibility configuration services"
```

---

## Task 3: Provider-Neutral Adapter Contract and Registry

**Files:**
- Create: `tests/unit/visibility.provider-registry.test.ts`
- Create: `src/modules/visibility/providers/provider.ts`
- Create: `src/modules/visibility/providers/provider-registry.ts`

**Interfaces:**

```ts
export interface VisibilitySampleRequest {
  prompt: string;
  model: string;
  locale: string | null;
  country: string | null;
  groundingMode: VisibilityGroundingMode;
  providerOptions: Record<string, unknown>;
}

export interface VisibilityCitationSource {
  url: string;
  title: string | null;
  position: number | null;
  sourceType: string | null;
}

export interface VisibilitySampleResponse {
  status: 'COMPLETED' | 'REFUSED' | 'UNSUPPORTED' | 'INCOMPLETE';
  providerResponseId: string | null;
  answerText: string | null;
  citations: VisibilityCitationSource[];
  searchMetadata: Record<string, unknown>;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  searchUnits: number | null;
  costMicros: number | null;
  costCurrency: string | null;
  pricingVersion: string | null;
  latencyMs: number | null;
}

export interface VisibilityProviderAdapter {
  readonly provider: VisibilityProvider;
  readonly channel: 'API';
  supportsWebGrounding(mode: VisibilityGroundingMode): boolean;
  estimateCostMicros(request: VisibilitySampleRequest): number | null;
  sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse>;
}
```

- [ ] **Step 1: Write RED registry tests**

Test duplicate provider/model adapter rejection, unknown adapter fail-closed behavior, and DeepSeek unsupported behavior.

```ts
expect(() => registry.get('OPENAI', 'gpt-5-mini', 'API')).toThrow(/adapter/i);
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility.provider-registry.test.ts
```

- [ ] **Step 3: Implement registry and safe provider errors**

Create stable error codes:

- `VISIBILITY_PROVIDER_UNAVAILABLE`
- `VISIBILITY_WEB_GROUNDING_UNSUPPORTED`
- `VISIBILITY_PROVIDER_RATE_LIMITED`
- `VISIBILITY_PROVIDER_AUTH_FAILED`
- `VISIBILITY_PROVIDER_FAILED`
- `VISIBILITY_PROVIDER_MALFORMED_RESPONSE`

Do not include request Authorization values or raw provider response bodies in error messages.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/unit/visibility.provider-registry.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/providers src/modules/visibility/visibility.types.ts tests/unit/visibility.provider-registry.test.ts
git commit -m "feat: add P6 visibility provider contract"
```

---

## Task 4: Run Creation, Sampling Units, and Paid-Request Idempotency

**Files:**
- Create: `tests/integration/visibility.run-service.test.ts`
- Create: `src/modules/visibility/visibility.repository.ts`
- Create: `src/modules/visibility/visibility-run.service.ts`

**Interfaces:**
- Produces `VisibilityRunService.createManualRun(projectId, input)`.
- Produces `VisibilityRepository.claimPendingObservation(observationId)` returning exactly one claimant.
- Produces stable sampling-unit keys.

- [ ] **Step 1: Write RED run tests**

For a prompt set with 2 active prompts and 2 enabled provider configs:

```ts
const run = await service.createManualRun(project.id, {
  promptSetId: set.id,
  providerConfigIds: [openAi.id, gemini.id],
  maxObservations: 4,
  budgetCeilingMicros: 100_000
});

expect(await prisma.platformObservation.count({ where: { visibilityRunId: run.id } })).toBe(4);
```

Prove duplicate service/enqueue delivery cannot create a second observation for one sampling unit.

Prove Standard projects fail before run/observation creation with `FEATURE_NOT_AVAILABLE`.

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/integration/visibility.run-service.test.ts
```

- [ ] **Step 3: Implement stable sampling-unit keys**

Canonical key input:

```ts
{
  runId,
  promptId,
  provider,
  model,
  channel,
  locale: locale ?? '',
  country: country ?? ''
}
```

Persist one `PlatformObservation(status=PENDING)` per matrix unit before queue execution.

- [ ] **Step 4: Implement atomic claim**

Use `updateMany({ where: { id, status: 'PENDING' }, data: { status: 'RUNNING' }})` and proceed only when count is 1.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.run-service.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility tests/integration/visibility.run-service.test.ts
git commit -m "feat: add P6 visibility run orchestration"
```

---

## Task 5: Budget Preflight and Historical Cost Accounting

**Files:**
- Create: `tests/unit/visibility.budget.test.ts`
- Create: `tests/integration/visibility.budget.integration.test.ts`
- Create: `src/modules/visibility/visibility-budget.ts`

**Interfaces:**

```ts
export interface VisibilityBudgetDecision {
  allowed: boolean;
  reason: 'WITHIN_BUDGET' | 'RUN_BUDGET_EXCEEDED' | 'DAILY_BUDGET_EXCEEDED';
  recordedSpendMicros: number;
  estimatedNextMicros: number;
}
```

- [ ] **Step 1: Write formula RED tests**

```ts
expect(checkBudget({ ceilingMicros: 100, recordedSpendMicros: 80, estimatedNextMicros: 20 }).allowed).toBe(true);
expect(checkBudget({ ceilingMicros: 100, recordedSpendMicros: 80, estimatedNextMicros: 21 })).toMatchObject({ allowed: false, reason: 'RUN_BUDGET_EXCEEDED' });
```

- [ ] **Step 2: Write persistence RED test**

Persist previous completed observations with historical `costMicros`; prove daily spend includes only recorded observations in the project/day window and does not reprice historical calls.

- [ ] **Step 3: Observe RED**

```bash
npm test -- tests/unit/visibility.budget.test.ts tests/integration/visibility.budget.integration.test.ts
```

- [ ] **Step 4: Implement budget preflight**

Rules:

- null ceiling means no configured ceiling for that dimension;
- unknown estimate with a finite hard budget must fail closed unless provider config explicitly has a conservative configured estimate;
- equality is allowed (`recorded + estimate === ceiling`);
- a rejected sample transitions `PENDING -> BUDGET_SKIPPED` without calling provider.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/visibility.budget.test.ts tests/integration/visibility.budget.integration.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility/visibility-budget.ts tests
git commit -m "feat: enforce P6 visibility budgets"
```

---

## Task 6: Visibility Queue and Fixture Worker

**Files:**
- Create: `tests/integration/visibility.worker.test.ts`
- Create: `src/modules/visibility/visibility.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `tests/unit/worker-bootstrap.test.ts`

**Interfaces:**
- Produces `processVisibilityJob(job)`.
- Produces `executeVisibilityObservation(observationId, dependencies)` with injectable registry/budget clock.

- [ ] **Step 1: Write RED worker test with fake adapter**

Fake adapter:

```ts
class FixtureOpenAiAdapter implements VisibilityProviderAdapter {
  provider = 'OPENAI' as const;
  channel = 'API' as const;
  supportsWebGrounding() { return true; }
  estimateCostMicros() { return 1200; }
  async sample() {
    return {
      status: 'COMPLETED' as const,
      providerResponseId: 'resp-fixture',
      answerText: 'Xingshantang is one source.',
      citations: [{ url: 'https://xingshantang.org/article', title: 'Article', position: 1, sourceType: 'web' }],
      searchMetadata: {},
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 1200,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 15
    };
  }
}
```

Assert observation becomes COMPLETED and persists normalized data.

Duplicate worker delivery must not call adapter twice.

- [ ] **Step 2: Add refusal/failure/unsupported/budget-skip fixtures**

Verify each maps to the correct status without converting it to a zero-valued success observation.

- [ ] **Step 3: Observe RED**

```bash
npm test -- tests/integration/visibility.worker.test.ts tests/unit/worker-bootstrap.test.ts
```

- [ ] **Step 4: Implement worker**

Execution order:

1. load observation/run/config/prompt;
2. atomic claim PENDING;
3. validate channel/support;
4. estimate/check run and daily budgets;
5. if budget blocked, persist BUDGET_SKIPPED and stop;
6. call adapter once;
7. bound answer text length before persistence;
8. compute `answerHash` from persisted bounded answer text;
9. persist provider-native normalized citation/search metadata and usage/cost;
10. update run aggregate status when all observations are terminal.

Do not log answer text.

- [ ] **Step 5: Activate reserved queue**

Change worker bootstrap from excluding visibility to:

```ts
if (name === 'visibility') return new Worker<VisibilityJobData>(name, processVisibilityJob, { connection, concurrency: 2 });
```

- [ ] **Step 6: Verify GREEN**

```bash
npm test -- tests/integration/visibility.worker.test.ts tests/unit/worker-bootstrap.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/visibility src/queue/worker-bootstrap.ts tests
git commit -m "feat: activate P6 visibility worker"
```

---

## Task 7: OpenAI Web-Grounded API Adapter

**Files:**
- Create: `tests/unit/visibility.openai-provider.test.ts`
- Create: `src/modules/visibility/providers/openai.provider.ts`

**Interfaces:**
- Implements `VisibilityProviderAdapter` for provider `OPENAI`, channel `API`, grounding mode `WEB_SEARCH`.

- [ ] **Step 1: Write RED normalization tests using saved fixtures**

Inject HTTP transport. Fixture must include:

- provider response ID;
- output text;
- provider-native URL citation annotations/source metadata;
- usage totals;
- no reasoning persistence fields.

Assert normalized response has only bounded answer/citations/usage.

- [ ] **Step 2: Test malformed/auth/rate-limit mappings**

Map HTTP/provider failures to stable visibility provider errors without raw Authorization/body leakage.

- [ ] **Step 3: Observe RED**

```bash
npm test -- tests/unit/visibility.openai-provider.test.ts
```

- [ ] **Step 4: Implement adapter**

Use server-side `OPENAI_API_KEY`; request Responses API with built-in `web_search`. Do not expose project-defined base URLs.

- [ ] **Step 5: Verify no live network in test**

```bash
npm test -- tests/unit/visibility.openai-provider.test.ts
```

All calls must use injected fixture transport.

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility/providers/openai.provider.ts tests/unit/visibility.openai-provider.test.ts
git commit -m "feat: add OpenAI visibility adapter"
```

---

## Task 8: Gemini Grounded Search Adapter

**Files:**
- Create: `tests/unit/visibility.gemini-provider.test.ts`
- Create: `src/modules/visibility/providers/gemini.provider.ts`

**Interfaces:**
- Implements provider `GEMINI`, channel `API`, grounding mode `SEARCH_GROUNDING`.

- [ ] **Step 1: Write fixture RED tests**

Fixture includes `groundingMetadata`, source URIs/titles, answer text, usage metadata.

Assert duplicate source URIs are normalized/deduplicated while preserving first provider order.

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/unit/visibility.gemini-provider.test.ts
```

- [ ] **Step 3: Implement adapter with injected HTTP transport**

Use server-side Gemini API key; enable Google Search grounding using the official API request shape supported at implementation time.

- [ ] **Step 4: Verify GREEN and no live calls**

```bash
npm test -- tests/unit/visibility.gemini-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/providers/gemini.provider.ts tests/unit/visibility.gemini-provider.test.ts
git commit -m "feat: add Gemini visibility adapter"
```

---

## Task 9: Perplexity Sonar Adapter

**Files:**
- Create: `tests/unit/visibility.perplexity-provider.test.ts`
- Create: `src/modules/visibility/providers/perplexity.provider.ts`

**Interfaces:**
- Implements provider `PERPLEXITY`, channel `API`, grounding mode `SONAR`.

- [ ] **Step 1: Write RED fixture tests**

Fixture includes answer, top-level `citations`, `search_results`, ID, usage.

Assert native citations/search results are persisted as normalized source metadata rather than inferred from prose URLs.

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/unit/visibility.perplexity-provider.test.ts
```

- [ ] **Step 3: Implement adapter**

Use server-side Perplexity key, model from provider config, injected transport, stable failure mappings.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/unit/visibility.perplexity-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/providers/perplexity.provider.ts tests/unit/visibility.perplexity-provider.test.ts
git commit -m "feat: add Perplexity visibility adapter"
```

---

## Task 10: Anthropic Web Search Adapter and DeepSeek Unsupported Adapter

**Files:**
- Create: `tests/unit/visibility.anthropic-provider.test.ts`
- Create: `tests/unit/visibility.deepseek-provider.test.ts`
- Create: `src/modules/visibility/providers/anthropic.provider.ts`
- Create: `src/modules/visibility/providers/deepseek.provider.ts`

**Interfaces:**
- Anthropic implements provider `ANTHROPIC`, channel `API`, grounding mode `WEB_SEARCH_TOOL`.
- DeepSeek implements provider `DEEPSEEK` but always reports unsupported for P6 web grounding.

- [ ] **Step 1: Write Anthropic fixture RED tests**

Normalize web-search source/citation blocks and server-tool usage. Discard any thought/reasoning blocks.

- [ ] **Step 2: Write DeepSeek unsupported RED test**

```ts
expect(adapter.supportsWebGrounding('UNSUPPORTED_WEB_GROUNDING')).toBe(false);
await expect(adapter.sample(request)).resolves.toMatchObject({ status: 'UNSUPPORTED' });
```

No HTTP call is allowed from DeepSeek P6 adapter.

- [ ] **Step 3: Observe RED**

```bash
npm test -- tests/unit/visibility.anthropic-provider.test.ts tests/unit/visibility.deepseek-provider.test.ts
```

- [ ] **Step 4: Implement both adapters**

Anthropic uses server-side key and injected transport. DeepSeek is a zero-network explicit unsupported adapter.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/visibility.anthropic-provider.test.ts tests/unit/visibility.deepseek-provider.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility/providers tests/unit/visibility.*provider.test.ts
git commit -m "feat: complete P6-A provider adapters"
```

---

## Task 11: Advanced Feature-Gated REST API

**Files:**
- Create: `tests/integration/visibility.api.test.ts`
- Create: `src/modules/visibility/visibility.routes.ts`
- Modify: `src/app.ts`

**Interfaces:**

Endpoints delivered in P6-A:

- `GET /api/v1/projects/:projectId/visibility/settings`
- `PATCH /api/v1/projects/:projectId/visibility/settings`
- `GET /api/v1/projects/:projectId/visibility/providers`
- `PUT /api/v1/projects/:projectId/visibility/providers/:providerConfigId`
- `GET /api/v1/projects/:projectId/visibility/prompt-sets`
- `POST /api/v1/projects/:projectId/visibility/prompt-sets`
- `GET /api/v1/projects/:projectId/visibility/prompts`
- `POST /api/v1/projects/:projectId/visibility/prompts`
- `POST /api/v1/projects/:projectId/visibility/runs`
- `GET /api/v1/projects/:projectId/visibility/runs`
- `GET /api/v1/projects/:projectId/visibility/runs/:runId`
- `GET /api/v1/projects/:projectId/visibility/observations`

- [ ] **Step 1: Write RED API tests**

Advanced project:

```ts
await request(app)
  .post(`/api/v1/projects/${advanced.id}/visibility/prompt-sets`)
  .send({ name: 'Discovery' })
  .expect(201);
```

Standard project:

```ts
await request(app)
  .post(`/api/v1/projects/${standard.id}/visibility/runs`)
  .send({ promptSetId: set.id, providerConfigIds: [] })
  .expect(403);
```

Cross-project resource IDs must return 404/403 without data disclosure.

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/integration/visibility.api.test.ts
```

- [ ] **Step 3: Implement route validation and feature gates**

Use `AI_VISIBILITY` for run/overview access and `PROMPT_MONITOR` for prompt configuration endpoints.

Never return provider secrets because none are persisted.

- [ ] **Step 4: Mount API**

`app.use('/api/v1', createVisibilityRoutes(...))`.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.api.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility/visibility.routes.ts src/app.ts tests/integration/visibility.api.test.ts
git commit -m "feat: add P6-A visibility API"
```

---

## Task 12: AI Visibility / Prompt Monitor Web UI

**Files:**
- Create: `tests/integration/visibility.web.test.ts`
- Create: `tests/e2e/visibility-center.spec.ts`
- Create: `src/modules/visibility/visibility.web.repository.ts`
- Create: `src/modules/visibility/visibility.web.routes.ts`
- Create: `src/views/visibility/index.ejs`
- Create: `src/views/visibility/prompts.ejs`
- Create: `src/views/visibility/runs/show.ejs`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`

**Interfaces:**
- `/projects/:id/visibility`
- `/projects/:id/visibility/prompts`
- `/projects/:id/visibility/runs/:runId`

- [ ] **Step 1: Write RED integration test**

Assert Advanced project overview contains:

- `AI Visibility`;
- explicit `API 采样` label;
- provider/model/channel table;
- sample status/count;
- budget status;
- link to Prompt Monitor.

Assert it does **not** contain `ChatGPT 网页端排名`.

- [ ] **Step 2: Write RED Chromium smoke**

Create Advanced project, open AI Visibility, create prompt set/prompt, confirm sidebar active state, and verify no provider call occurs just by visiting/configuring pages.

- [ ] **Step 3: Implement web repository/routes/views**

P6-A overview does not display Mention Rate/Citation Rate/SOV yet; those belong to P6-B/C. It displays sampling readiness and observations only.

- [ ] **Step 4: Activate sidebar placeholders**

- `AI Visibility` → project visibility overview;
- `Prompt 监控` → project prompt monitor;
- keep `Citation 监控` and `Share of Voice` disabled/placeholders until P6-B/C.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.web.test.ts
npm run test:e2e -- tests/e2e/visibility-center.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility src/views/visibility src/views/partials/sidebar.ejs src/app.ts tests
git commit -m "feat: add P6-A visibility center"
```

---

## Task 13: Safe Observability and Operator Documentation

**Files:**
- Create: `tests/integration/visibility.observability.test.ts`
- Create: `src/modules/visibility/visibility-observability.ts`
- Create: `docs/development/p6a-visibility-sampling.md`

**Interfaces:**

Allowed events:

- `visibility.run.queued`
- `visibility.run.started`
- `visibility.observation.started`
- `visibility.observation.completed`
- `visibility.observation.unsupported`
- `visibility.observation.failed`
- `visibility.run.completed`
- `visibility.run.partial`
- `visibility.run.failed`

- [ ] **Step 1: Write RED observability test**

Allowed serialized fields:

- IDs;
- provider/model/channel;
- prompt ID/version;
- status/error code;
- latency;
- aggregate token/search/cost counts.

Assert logs never contain:

```text
Authorization
api_key
cookie=
answerText
promptText
reasoning
thought
search planning
full provider body
```

- [ ] **Step 2: Observe RED**

```bash
npm test -- tests/integration/visibility.observability.test.ts
```

- [ ] **Step 3: Implement safe event sink and integrate run/worker events**

Do not send prompt/answer bodies to observability.

- [ ] **Step 4: Write operator guide**

Document:

- provider secret environment variables;
- API-vs-consumer labeling rule;
- budget semantics;
- duplicate-delivery idempotency;
- observation statuses;
- DeepSeek unsupported web-grounding state;
- no-live-provider CI rule.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.observability.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility/visibility-observability.ts tests/integration/visibility.observability.test.ts docs/development/p6a-visibility-sampling.md
git commit -m "docs: harden P6-A operations and observability"
```

---

## Task 14: P6-A Release Gate

**Files:**
- Modify only files required by actual release failures.
- Update: `README.md` after all checks are green.

**Interfaces:**
- Produces the stable P6-A base consumed by future P6-B Mention/Citation Intelligence.

- [ ] **Step 1: Static boundary review**

Review `main..P6-A-head` and prove:

- no P6-B/C metric tables/extractors were accidentally implemented;
- no consumer UI/browser credential automation exists;
- no provider secret persistence exists;
- no DeepSeek web-search emulation exists;
- every observation carries `channel=API`;
- all paid sampling goes through `visibility` worker.

- [ ] **Step 2: Run full release commands**

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

Expected: all green.

- [ ] **Step 3: Confirm no live provider calls in CI**

Review provider tests and workflow logs. All provider normalization tests must use injected fake transport/fixtures.

- [ ] **Step 4: Confirm budget/idempotency evidence**

Required green tests include:

- duplicate queue delivery invokes adapter exactly once;
- budget-skipped sample invokes adapter zero times;
- Standard plan cannot enqueue visibility work;
- unsupported DeepSeek adapter invokes network zero times.

- [ ] **Step 5: Update README only after green**

Mark:

```text
P6-A Prompt Monitor & Sampling Core — complete
P6-B Citation & Mention Intelligence — next
```

Do not mark P6 overall complete.

- [ ] **Step 6: Final review and merge**

Use expected-head-SHA merge protection after fresh verify + production-audit + Chromium E2E success.
