# P9-0E China AI Visibility Providers

## Purpose

P9-0E extends the provider-neutral P6 visibility sampling layer with official, programmable China-market AI search surfaces while preserving the existing `VisibilityProviderAdapter`, worker isolation, prompt versioning, budgets, citation evidence states, and `PlatformObservation` persistence boundary.

The release adds three provider identities:

- `BAIDU_QIANFAN`
- `QWEN`
- `TENCENT_HUNYUAN`

It also adds a server-authored provider capability contract so configuration rows describe what the registered adapter can actually measure rather than what a client claims it can measure.

P9-0E measures **API observations**. It does not scrape or claim ranking equivalence with Baidu consumer AI products, the Tongyi/Qwen consumer application, Tencent Yuanbao, or any other authenticated consumer UI.

## Capability contract

`VisibilityProviderCapability` contains:

```text
MODEL_ONLY
WEB_GROUNDED
SEARCH_API
CITATION_NATIVE
CONSUMER_OBSERVATION
```

The default registry after P9-0E contains nine adapters:

| Provider | Channel | Capability set | P9-0E state |
| --- | --- | --- | --- |
| OpenAI | API | `WEB_GROUNDED`, `CITATION_NATIVE` | existing adapter retained |
| Gemini | API | `WEB_GROUNDED`, `CITATION_NATIVE` | existing adapter retained |
| Perplexity | API | `WEB_GROUNDED`, `CITATION_NATIVE` | existing adapter retained |
| Anthropic | API | `WEB_GROUNDED`, `CITATION_NATIVE` | existing adapter retained |
| DeepSeek | API | `MODEL_ONLY` | explicit unsupported web-grounding adapter retained |
| Microsoft | API | `WEB_GROUNDED`, `CITATION_NATIVE` | P9-0D adapter retained |
| Baidu Qianfan | API | `WEB_GROUNDED`, `SEARCH_API`, `CITATION_NATIVE` | added |
| Alibaba Qwen | API | `WEB_GROUNDED`, `CITATION_NATIVE` | added |
| Tencent Hunyuan / TokenHub | API | `WEB_GROUNDED`, `CITATION_NATIVE` | added |

No default API adapter declares `CONSUMER_OBSERVATION`.

`VisibilityProviderConfig.capabilities` is persisted from the registered server adapter selected by `(provider, model, channel)`. It is not accepted as client authority. A request that carries an extra capability claim cannot cause `CONSUMER_OBSERVATION` or another unsupported capability to be stored.

## Credentials and provider options

Authentication material remains server-side:

```text
BAIDU_QIANFAN_API_KEY=
DASHSCOPE_API_KEY=
TENCENT_TOKENHUB_API_KEY=
```

These values belong in deployment secret management or the process environment. They must not be placed in `providerOptionsJson`, prompts, observations, citation metadata, logs, or user-visible configuration payloads.

The existing recursive secret-key rejection remains active for provider options. Keys resembling `key`, `token`, `secret`, `authorization`, or `cookie` fail validation.

Non-secret provider options are narrowly allowlisted:

| Provider | Allowed provider options |
| --- | --- |
| `BAIDU_QIANFAN` | none |
| `QWEN` | `workspaceId`, `region` |
| `TENCENT_HUNYUAN` | `searchContextSize` |

For Qwen, `workspaceId` is required by the Beijing native DashScope endpoint and `region` is currently restricted by the adapter to `cn-beijing`.

For Tencent TokenHub, `searchContextSize` accepts `low`, `medium`, or `high`; the default is `medium`.

## Baidu Qianfan AI Search

Adapter:

```text
src/modules/visibility/providers/baidu-qianfan.provider.ts
```

Official API surface:

```text
POST https://qianfan.baidubce.com/v2/ai_search/web_summary
```

Official documentation reviewed:

- `https://cloud.baidu.com/doc/qianfan/s/Kmiy99ziv`

Baidu documents this route as an API that combines large-model generation with real-time web retrieval. P9-0E uses Bearer API-key authentication and sends a non-streaming user message plus an instruction to answer from current web-search evidence while preserving source attribution.

Normalized fields:

- `provider = BAIDU_QIANFAN`
- `providerResponseId` from upstream `request_id`
- answer text from the assistant response
- citations from upstream `references[]`
- duplicate citation URLs removed deterministically
- `sourceType = baidu_qianfan_reference`

Safe search metadata:

```text
surface = BAIDU_QIANFAN_AI_SEARCH_WEB_SUMMARY
webGroundingEnabled = true
searchApi = true
```

The adapter does not fabricate token, search-unit, cost, currency, or pricing values when the contract does not expose provider-neutral facts for them.

This observation means the official Qianfan AI Search API was sampled. It does **not** mean a Baidu consumer AI answer surface or ranking was measured.

## Alibaba Qwen / Model Studio DashScope

Adapter:

```text
src/modules/visibility/providers/qwen.provider.ts
```

P9-0E uses the China (Beijing) native DashScope text-generation endpoint:

```text
POST https://{workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation
```

Official documentation reviewed:

- `https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope`
- `https://help.aliyun.com/zh/model-studio/web-search/`

The request enables internet search and asks the API to return source information and citation markers:

```json
{
  "parameters": {
    "result_format": "message",
    "enable_search": true,
    "search_options": {
      "enable_source": true,
      "enable_citation": true,
      "citation_format": "[ref_<number>]"
    }
  }
}
```

Normalized evidence comes from:

```text
output.search_info.search_results
```

The adapter preserves only bounded source facts such as URL, title, position, normalized answer text, unambiguous usage values, and safe surface metadata. It does not persist hidden reasoning or provider search-planning traces.

Safe search metadata:

```text
surface = ALIBABA_CLOUD_MODEL_STUDIO_DASHSCOPE
webGroundingEnabled = true
region = cn-beijing
```

This is an Alibaba Cloud Model Studio / DashScope API observation. It is **not** a Tongyi/Qwen consumer-app ranking measurement.

## Tencent Hunyuan via TokenHub

Adapter:

```text
src/modules/visibility/providers/tencent-hunyuan.provider.ts
```

P9-0E uses the official TokenHub Responses API:

```text
POST https://tokenhub.tencentmaas.com/v1/responses
```

Official documentation reviewed:

- `https://cloud.tencent.com/document/product/1823/132358`
- `https://cloud.tencent.com/document/product/1823/133813`

Tencent documents TokenHub联网搜索 as supporting Responses API web search through a `web_search` tool, with structured source attribution in response annotations.

The normalized request shape is:

```json
{
  "model": "<configured-model>",
  "input": "<measurement-prompt>",
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "medium"
    }
  ]
}
```

The adapter reads assistant text only from `message` / `output_text` output items. `reasoning` output items are ignored and never persisted as search metadata.

Native `url_citation` annotations are normalized with:

```text
sourceType = tencent_tokenhub_url_citation
```

Search-unit normalization prefers the explicit upstream `usage.tool_usage.web_search_call` value when available. If that field is absent, an explicit `web_search_call` output item may be counted as a bounded fallback. No inferred search usage is invented from answer text.

Safe search metadata:

```text
surface = TENCENT_TOKENHUB
groundingProvider = TOKENHUB_WEB_SEARCH
webGroundingEnabled = true
requestedModel = <configured-model>
```

This is a TokenHub API observation. It is **not** Tencent Yuanbao consumer ranking.

## Citation evidence semantics

All three adapters use the existing provider-neutral evidence states:

- one or more normalized native citations/sources -> `KNOWN_PRESENT`
- an explicitly present but empty native citation/source collection -> `KNOWN_EMPTY`
- successful response without a conclusive native citation/source collection -> `UNKNOWN`
- unsupported grounding mode -> `NOT_APPLICABLE`

P9-0E never infers a citation merely because a URL-like string or citation marker appears in answer text.

## Unsupported grounding

The China adapters support only the existing `WEB_SEARCH` visibility grounding mode.

When another grounding mode is supplied, each adapter returns the normalized `UNSUPPORTED` result with `NOT_APPLICABLE` evidence and performs zero provider network calls.

This keeps unsupported combinations explicit instead of silently substituting another search surface.

## Failure behavior

All China adapters preserve the existing P6 stable error boundary:

- missing server credential -> `VISIBILITY_PROVIDER_AUTH_FAILED` before network
- HTTP 401/403 -> `VISIBILITY_PROVIDER_AUTH_FAILED`
- HTTP 429 -> `VISIBILITY_PROVIDER_RATE_LIMITED`
- other non-2xx upstream responses -> `VISIBILITY_PROVIDER_FAILED`
- transport failures -> `VISIBILITY_PROVIDER_FAILED`
- malformed successful responses -> `VISIBILITY_PROVIDER_MALFORMED_RESPONSE`

Raw upstream bodies, authorization headers, API keys, exception details, hidden reasoning, and private provider traces are not copied into persisted normalized error data.

Provider failures remain observation-scoped through the existing worker and registry boundaries. A failure in one China provider does not rewrite another provider's successful observation.

## Persistence boundary

`PlatformObservation` remains the authoritative provider-neutral observation table. P9-0E does not create Baidu-, Alibaba-, or Tencent-specific observation tables.

The schema expansion is limited to:

- adding `BAIDU_QIANFAN`, `QWEN`, and `TENCENT_HUNYUAN` to `VisibilityProvider`
- adding `VisibilityProviderCapability`
- adding the non-null capability array to `VisibilityProviderConfig`

Historical provider observations remain unchanged.

## Security and compliance boundary

P9-0E does not:

- scrape consumer Baidu AI interfaces;
- scrape Tongyi/Qwen consumer applications;
- scrape Tencent Yuanbao;
- automate private authenticated browser traffic;
- use private or reverse-engineered endpoints;
- store API credentials in provider configuration rows;
- accept client-authored capability claims as persistence authority;
- persist reasoning/search-planning traces;
- fabricate missing citations, costs, token counts, search units, or ranking positions;
- collapse one provider's evidence semantics into another provider's identity.

## Rollback

Application rollback can remove the three China adapters from the default registry and disable their provider configurations.

Routine rollback must **not** destructively remove the new PostgreSQL enum values or capability enum after deployed databases may contain those values. Removing enum members would require rewriting historical/configuration data and carries higher operational risk than leaving unused enum values in place.

The provider-neutral `PlatformObservation` model requires no destructive rollback transformation.

## Verification coverage

P9-0E fixture tests cover:

- exact request construction for all three provider APIs
- server-side credential fail-closed behavior
- native source/citation normalization and URL deduplication
- `KNOWN_PRESENT`, `KNOWN_EMPTY`, and `UNKNOWN` evidence states
- auth, rate-limit, upstream, transport, and malformed-response errors
- unsupported grounding with zero network calls
- provider-specific option validation
- nine-provider default registry inclusion
- exact server-authored capability sets
- rejection of secret-like provider options
- prevention of client-authored capability escalation
- full existing visibility worker/integration regression coverage

CI uses injected fixture transports and does not call the live Baidu, Alibaba, or Tencent services.

## Release gate

P9-0E is ready for review only when the **exact final documentation/configuration head** passes all three CI jobs:

1. `verify`
   - Prisma validate
   - Prisma generate
   - migrations deploy
   - TypeScript typecheck
   - full Vitest suite
   - production build
2. `production-audit`
   - deployable runtime dependency install
   - Prisma CLI absence check
   - production dependency audit
3. `e2e`
   - Prisma generation and migration
   - Chromium installation
   - browser smoke tests

A green run on an earlier implementation commit is insufficient. After the final exact head is green, PR #151 may be marked Ready for review, but it remains unmerged until a separate explicit human merge command.
