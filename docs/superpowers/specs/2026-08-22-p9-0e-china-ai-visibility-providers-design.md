# P9-0E China AI Visibility Providers Design

Date: 2026-08-22
Status: Approved for implementation
Repository: `liufaxing1978-droid/seogeo`
Base: `main@ea5b206c1d1d29ff2989047c0b4a7c4b4313eb51`

## 1. Goal

Extend the existing provider-neutral visibility sampling layer with first-class mainland-China AI visibility providers backed only by official programmable search-capable APIs, while making provider capability semantics explicit and preventing API samples from being represented as consumer-app rankings.

## 2. Scope

P9-0E adds three priority China providers:

- `BAIDU_QIANFAN`
- `QWEN`
- `TENCENT_HUNYUAN`

It also introduces capability declarations for visibility adapters/configuration using these values:

- `MODEL_ONLY`
- `WEB_GROUNDED`
- `SEARCH_API`
- `CITATION_NATIVE`
- `CONSUMER_OBSERVATION`

No provider in this phase declares `CONSUMER_OBSERVATION`.

## 3. Official provider surfaces

### 3.1 Baidu Qianfan AI Search

Use the official Baidu Qianfan intelligent search generation endpoint:

- `POST https://qianfan.baidubce.com/v2/ai_search/web_summary`
- bearer API-key authentication
- non-streaming requests for deterministic fixture parsing
- web results are returned in `references[]`
- answer text is returned in `choices[].message.content`

Capabilities:

- `WEB_GROUNDED`
- `SEARCH_API`
- `CITATION_NATIVE`

Official reference: https://cloud.baidu.com/doc/qianfan/s/Kmiy99ziv

### 3.2 Alibaba Cloud Model Studio / Qwen

Use the official DashScope native text-generation API with web search enabled:

- `enable_search: true`
- `search_options.enable_source: true`
- `search_options.enable_citation: true`
- returned sources are read from `output.search_info.search_results`

The Beijing native endpoint requires a non-secret Workspace ID and uses the configured DashScope API key for authorization.

Capabilities:

- `WEB_GROUNDED`
- `CITATION_NATIVE`

Official references:

- https://help.aliyun.com/en/model-studio/web-search
- https://help.aliyun.com/en/model-studio/qwen-api-via-dashscope

### 3.3 Tencent TokenHub / Hy3

Use the current Tencent TokenHub API instead of building new code against the legacy Hunyuan search-enhancement surface.

Primary surface:

- `POST https://tokenhub.tencentmaas.com/v1/responses`
- model defaults remain configuration-driven and are not hard-coded
- `tools: [{ type: "web_search" }]`
- citations are returned as URL annotations on output text
- web search calls are explicit response items

This surface supports Hy3 when the required web-search resource is enabled. `searchMetadata.surface` records `TENCENT_TOKENHUB` and the requested model so observations do not imply consumer Yuanbao ranking.

Capabilities:

- `WEB_GROUNDED`
- `CITATION_NATIVE`

Official references:

- https://cloud.tencent.com/document/product/1823/132358
- https://cloud.tencent.com/document/product/1823/135873
- https://cloud.tencent.com/document/product/1823/131382

## 4. Capability model

Capabilities are server-authored adapter declarations, not client assertions.

`VisibilityProviderAdapter` gains a readonly capability set. The values are stored as a Prisma enum and persisted on `VisibilityProviderConfig` so a configuration snapshot can state what the selected provider is contractually capable of.

Rules:

- `MODEL_ONLY` means no official web-grounded/search evidence is available through this adapter.
- `WEB_GROUNDED` means an official API can use public web retrieval to ground generation.
- `SEARCH_API` means the provider exposes search as a first-class programmable search surface rather than only model augmentation.
- `CITATION_NATIVE` means the provider returns source/citation structures that can be normalized without inference.
- `CONSUMER_OBSERVATION` is reserved for interfaces whose contract directly represents consumer product observations. P9-0E assigns it to none of the providers.

Existing adapters keep their current sampling behavior. Their capability declarations are added without changing observation semantics.

## 5. Credentials and options

Secrets remain server-only:

- `BAIDU_QIANFAN_API_KEY`
- `DASHSCOPE_API_KEY`
- `TENCENT_TOKENHUB_API_KEY`

Non-secret provider options are narrowly allowlisted:

- Baidu: none initially
- Qwen: `workspaceId`, `region`
- Tencent: `searchContextSize`

`providerOptionsJson` continues to reject secret-like keys recursively.

## 6. Normalized evidence semantics

All three adapters return `VisibilitySampleResponse` and persist through the existing provider-neutral `PlatformObservation` model.

Citation rules:

- valid official source URL -> normalized citation
- duplicate URLs -> one citation
- explicit empty source collection after a completed web-grounded response -> `KNOWN_EMPTY`
- native sources present -> `KNOWN_PRESENT`
- missing/ambiguous source structure -> `UNKNOWN`
- unsupported grounding mode -> `NOT_APPLICABLE`

No citation, cost, token, search-unit, or ranking fact is fabricated when the upstream API does not provide it.

## 7. Consumer-ranking boundary

P9-0E observations are API observations. They must never be labeled as rankings from:

- 文心一言 / 百度 consumer AI products
- 通义 consumer applications
- 腾讯元宝

`CONSUMER_OBSERVATION` remains absent. Search metadata records the actual API surface and grounding mechanism.

## 8. Error contract

Each adapter follows the existing stable error mapping:

- missing or rejected credential -> `VISIBILITY_PROVIDER_AUTH_FAILED`
- HTTP 429 -> `VISIBILITY_PROVIDER_RATE_LIMITED`
- malformed success body -> `VISIBILITY_PROVIDER_MALFORMED_RESPONSE`
- transport or other upstream failures -> `VISIBILITY_PROVIDER_FAILED`
- unsupported grounding mode -> `UNSUPPORTED` with zero network calls

Raw credentials and upstream secret-bearing error details must not be propagated.

## 9. Schema and migration

Extend `VisibilityProvider` with the three China providers.

Add `VisibilityProviderCapability` enum with the five capability values and add a capability array field to `VisibilityProviderConfig` with an empty-array default for migration safety. Service-side upsert derives the value from the registered adapter/provider contract rather than trusting input.

PostgreSQL rollback policy is non-destructive: application rollback may stop using the new enum values, but rollback documentation must not prescribe destructive removal of enum members from a database that may already contain observations/configs.

## 10. Tests and release gate

TDD order:

1. capability contract tests
2. Baidu fixture contract tests
3. Qwen fixture contract tests
4. Tencent fixture contract tests
5. Prisma/provider registry/settings integration
6. documentation and environment examples

Final release gate is the exact PR head with all three CI jobs successful:

- `verify`
- `production-audit`
- `e2e`

The PR may be marked Ready after exact-head green. It must not be auto-merged.
