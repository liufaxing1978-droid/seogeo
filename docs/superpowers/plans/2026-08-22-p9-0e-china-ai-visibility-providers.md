# P9-0E China AI Visibility Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit visibility-provider capabilities plus official web-grounded Baidu Qianfan, Alibaba Qwen, and Tencent Hunyuan/TokenHub adapters without representing API observations as consumer-app rankings.

**Architecture:** Preserve `VisibilityProviderAdapter` and `PlatformObservation` as the provider-neutral execution/persistence boundaries. Add a server-authored capability contract on adapters/configs, then implement three fixture-testable HTTP adapters that normalize each official source structure into the existing `VisibilitySampleResponse`. Credentials stay server-side; provider options stay non-secret and narrowly allowlisted.

**Tech Stack:** TypeScript, Node.js fetch, Vitest, Prisma/PostgreSQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0e-china-ai-visibility-providers-design.md`

## Global Constraints

- Base implementation on `main@ea5b206c1d1d29ff2989047c0b4a7c4b4313eb51`.
- Never write directly to `main`.
- Never auto-merge the P9-0E pull request.
- Never label an API sample as consumer-product ranking.
- No provider in P9-0E declares `CONSUMER_OBSERVATION`.
- Do not persist API keys/tokens in `providerOptionsJson` or observations.
- Unsupported capability/evidence remains explicit; never fabricate citation, cost, token, search-unit, or ranking facts.
- Final readiness requires `verify`, `production-audit`, and `e2e` successful on the exact PR head.

---

### Task 1: Capability Contract and Provider Enum

**Files:**
- Modify: `prisma/models/visibility.prisma`
- Create: `prisma/migrations/20260822065000_add_china_ai_visibility_providers/migration.sql`
- Modify: `src/modules/visibility/providers/provider.ts`
- Modify: existing provider adapter files under `src/modules/visibility/providers/*.provider.ts`
- Create: `tests/unit/visibility.provider-capabilities.test.ts`

**Interfaces:**
- Produces Prisma enum `VisibilityProviderCapability` with `MODEL_ONLY`, `WEB_GROUNDED`, `SEARCH_API`, `CITATION_NATIVE`, `CONSUMER_OBSERVATION`.
- Produces adapter property `readonly capabilities: readonly VisibilityProviderCapability[]`.
- Extends `VisibilityProvider` with `BAIDU_QIANFAN`, `QWEN`, `TENCENT_HUNYUAN`.
- Adds `capabilities VisibilityProviderCapability[] @default([])` to `VisibilityProviderConfig`.

- [ ] **Step 1: Write the failing capability test**

Create a Vitest that imports the existing adapters and asserts exact capability arrays:

```ts
expect(new DeepSeekVisibilityProvider().capabilities).toEqual(['MODEL_ONLY']);
expect(new OpenAIVisibilityProvider({ apiKey: 'fixture' }).capabilities).toEqual([
  'WEB_GROUNDED',
  'CITATION_NATIVE'
]);
expect(new MicrosoftVisibilityProvider({ accessToken: 'fixture' }).capabilities).toEqual([
  'WEB_GROUNDED',
  'CITATION_NATIVE'
]);
```

The same test must assert no current adapter contains `CONSUMER_OBSERVATION`.

- [ ] **Step 2: Push the RED test and verify CI fails for the missing contract**

Expected failure: TypeScript/Vitest cannot find `capabilities` and/or the new Prisma enum/provider values.

- [ ] **Step 3: Add the schema and adapter capability property**

Update Prisma enums and `VisibilityProviderAdapter`. Add readonly arrays to OpenAI, Gemini, Perplexity, Anthropic, DeepSeek, and Microsoft without changing sampling behavior.

- [ ] **Step 4: Add the PostgreSQL migration**

Migration must add provider enum values, create `VisibilityProviderCapability`, and add a non-null enum-array column with empty-array default. Do not include destructive rollback SQL.

- [ ] **Step 5: Verify the capability test and schema/typecheck are green**

Run via PR CI after the implementation commit. Do not call Task 1 complete until the exact commit shows the expected test/typecheck passing.

---

### Task 2: Baidu Qianfan AI Search Adapter

**Files:**
- Create: `src/modules/visibility/providers/baidu-qianfan.provider.ts`
- Create: `tests/unit/visibility.baidu-qianfan-provider.test.ts`

**Interfaces:**
- Produces `BaiduQianfanVisibilityProvider implements VisibilityProviderAdapter`.
- Constructor accepts `{ apiKey?: string; transport?: BaiduQianfanVisibilityTransport }`.
- Uses `BAIDU_QIANFAN_API_KEY` fallback.
- Supports only `WEB_SEARCH` grounding.
- Capabilities: `['WEB_GROUNDED', 'SEARCH_API', 'CITATION_NATIVE']`.

- [ ] **Step 1: Write RED fixture tests**

Fixtures must prove request construction, response normalization, dedupe, `KNOWN_PRESENT`, explicit empty `references: []` -> `KNOWN_EMPTY`, missing key -> auth failure before network, HTTP 401/403/429/500 mapping, transport failure mapping, malformed success response mapping, and unsupported grounding with zero network.

The expected request body is:

```ts
{
  messages: [{ role: 'user', content: request.prompt }],
  stream: false,
  instruction: 'Answer using current web search evidence and preserve source attribution.'
}
```

The adapter posts to `https://qianfan.baidubce.com/v2/ai_search/web_summary`.

- [ ] **Step 2: Verify RED**

Expected failure: module `baidu-qianfan.provider.js` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Normalize `choices[0].message.content` as answer text; normalize `references[]` URL/title entries with `sourceType: 'baidu_qianfan_reference'`; `providerResponseId` comes from `request_id`; record search metadata:

```ts
{
  surface: 'BAIDU_QIANFAN_AI_SEARCH_WEB_SUMMARY',
  webGroundingEnabled: true,
  searchApi: true
}
```

Do not invent token/cost/search-unit values.

- [ ] **Step 4: Verify GREEN**

Run the Baidu unit test plus full Typecheck/Vitest through CI.

---

### Task 3: Alibaba Qwen / DashScope Adapter

**Files:**
- Create: `src/modules/visibility/providers/qwen.provider.ts`
- Create: `tests/unit/visibility.qwen-provider.test.ts`

**Interfaces:**
- Produces `QwenVisibilityProvider implements VisibilityProviderAdapter`.
- Constructor accepts `{ apiKey?: string; transport?: QwenVisibilityTransport }`.
- Uses `DASHSCOPE_API_KEY` fallback.
- `providerOptions.workspaceId` is required for the Beijing native endpoint; `providerOptions.region` accepts `cn-beijing` initially.
- Supports only `WEB_SEARCH` grounding.
- Capabilities: `['WEB_GROUNDED', 'CITATION_NATIVE']`.

- [ ] **Step 1: Write RED fixture tests**

Assert the request URL is:

```text
https://{workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation
```

Assert request body includes:

```ts
{
  model: request.model,
  input: { messages: [{ role: 'user', content: request.prompt }] },
  parameters: {
    result_format: 'message',
    enable_search: true,
    search_options: {
      enable_source: true,
      enable_citation: true,
      citation_format: '[ref_<number>]'
    }
  }
}
```

Fixtures must cover source normalization from `output.search_info.search_results`, citation evidence states, auth/rate limit/upstream/transport/malformed failures, missing `workspaceId`, and unsupported grounding with zero network.

- [ ] **Step 2: Verify RED**

Expected failure: module `qwen.provider.js` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Normalize answer from `output.choices[0].message.content`, source URLs/titles from `output.search_info.search_results`, usage only when upstream values are unambiguous, and metadata:

```ts
{
  surface: 'ALIBABA_CLOUD_MODEL_STUDIO_DASHSCOPE',
  webGroundingEnabled: true,
  region: 'cn-beijing'
}
```

- [ ] **Step 4: Verify GREEN**

Run the Qwen unit test plus full Typecheck/Vitest through CI.

---

### Task 4: Tencent Hunyuan via TokenHub Adapter

**Files:**
- Create: `src/modules/visibility/providers/tencent-hunyuan.provider.ts`
- Create: `tests/unit/visibility.tencent-hunyuan-provider.test.ts`

**Interfaces:**
- Produces `TencentHunyuanVisibilityProvider implements VisibilityProviderAdapter`.
- Constructor accepts `{ apiKey?: string; transport?: TencentHunyuanVisibilityTransport }`.
- Uses `TENCENT_TOKENHUB_API_KEY` fallback.
- Posts to `https://tokenhub.tencentmaas.com/v1/responses`.
- Supports only `WEB_SEARCH` grounding.
- Capabilities: `['WEB_GROUNDED', 'CITATION_NATIVE']`.

- [ ] **Step 1: Write RED fixture tests**

Assert request body:

```ts
{
  model: request.model,
  input: request.prompt,
  tools: [{ type: 'web_search', search_context_size: 'medium' }]
}
```

`searchContextSize` accepts `low|medium|high`, default `medium`.

Fixtures must normalize `output[].type === 'message'`, `content[].type === 'output_text'`, `annotations[].type === 'url_citation'`, explicit `web_search_call` items, usage when unambiguous, citation evidence states, auth/rate-limit/upstream/transport/malformed failures, and unsupported grounding with zero network.

- [ ] **Step 2: Verify RED**

Expected failure: module `tencent-hunyuan.provider.js` does not exist.

- [ ] **Step 3: Implement the minimal adapter**

Use metadata:

```ts
{
  surface: 'TENCENT_TOKENHUB',
  groundingProvider: 'TOKENHUB_WEB_SEARCH',
  webGroundingEnabled: true,
  requestedModel: request.model
}
```

Do not claim Tencent Yuanbao consumer ranking.

- [ ] **Step 4: Verify GREEN**

Run the Tencent unit test plus full Typecheck/Vitest through CI.

---

### Task 5: Registry, Settings, Provider Options, and Persisted Capabilities

**Files:**
- Modify: `src/modules/visibility/providers/default-registry.ts`
- Modify: `src/modules/visibility/visibility-settings.service.ts`
- Modify: `tests/unit/visibility.default-provider-registry.test.ts`
- Modify or create settings-service unit/integration coverage as appropriate.

**Interfaces:**
- `DefaultVisibilityProviderRegistryOptions` adds `baiduQianfanApiKey`, `dashscopeApiKey`, and `tencentTokenHubApiKey`.
- Registry order appends `BAIDU_QIANFAN`, `QWEN`, `TENCENT_HUNYUAN` after existing providers.
- Settings option allowlist adds `QWEN: workspaceId, region`, `TENCENT_HUNYUAN: searchContextSize`, `BAIDU_QIANFAN: none`.
- Provider config upsert derives `capabilities` from the registered adapter contract, not request input.

- [ ] **Step 1: Write RED registry/settings tests**

Assert all nine adapters are registered and exact capability sets are returned. Assert a provider config cannot submit secret-like options and cannot submit a client-authored capability override.

- [ ] **Step 2: Verify RED**

Expected failure: new registry options/providers/settings mappings are missing.

- [ ] **Step 3: Implement registry/settings wiring**

Register three adapters and derive persisted capabilities using the provider registry adapter selected by `(provider, model, channel)`.

- [ ] **Step 4: Verify GREEN**

Run focused tests and confirm Prisma/typecheck/full Vitest through CI.

---

### Task 6: Configuration Documentation and Exact-Head Release Gate

**Files:**
- Modify: `.env.example`
- Create: `docs/development/p9-0e-china-ai-visibility-providers.md`
- Update this plan checkboxes only if useful; no runtime behavior depends on it.

**Interfaces:**
- Documents `BAIDU_QIANFAN_API_KEY`, `DASHSCOPE_API_KEY`, `TENCENT_TOKENHUB_API_KEY` as server-side secrets.
- Documents Qwen `workspaceId`/`region` and Tencent `searchContextSize` as non-secret options.
- Documents API-observation vs consumer-ranking boundary.

- [ ] **Step 1: Add `.env.example` keys and implementation documentation**

Document official endpoint provenance, capability matrix, evidence semantics, failure behavior, security boundaries, and non-destructive PostgreSQL rollback guidance.

- [ ] **Step 2: Run exact-head CI**

On the final PR head, require all jobs:

```text
verify             success
production-audit   success
e2e                success
```

- [ ] **Step 3: Mark PR Ready only after exact-head green**

Record the exact head SHA and workflow run ID in the PR body. Leave the PR unmerged until a separate human merge command.
