# P6 AI Visibility Advanced Module — Design

Date: 2026-08-19
Status: Proposed design approved in chat; written-spec review pending
Repository: `liufaxing1978-droid/seogeo`

## 1. Goal

Build a project-scoped AI Visibility subsystem that measures how an owned brand/domain/entity appears in real, externally sampled AI answers and source citations.

P6 is intentionally distinct from:

- P3 GEO readiness, which evaluates deterministic owned-site readiness;
- P4/P5 DeepSeek advisory analysis, which explains already-persisted facts;
- P5-B competitor content comparison, which compares crawled owned/competitor pages;
- P5-C reporting, which aggregates already-persisted facts.

P6 introduces a new class of authoritative fact: **external AI platform observations** gathered through supported official APIs.

## 2. Core truth boundary

P6 may claim a platform observation only when the system actually executed a supported provider API request and persisted the resulting answer/citation metadata.

The UI and API must never label API sampling as consumer-product sampling.

Examples:

- valid: `OpenAI API visibility`, `Gemini API visibility`, `Perplexity API visibility`, `Anthropic API visibility`;
- invalid unless separately implemented: `ChatGPT web ranking`, `Gemini App ranking`, `Claude.ai ranking`, `Perplexity web UI ranking`.

The `channel` field is mandatory on every observation.

Initial channel:

- `API`

Reserved future channel:

- `CONSUMER_UI`

A provider/model/channel combination is a distinct sample population and must not be merged into another population without an explicit aggregation formula.

## 3. Provider capability decision

P6.1 uses official web-grounded APIs only.

### OpenAI

Use the Responses API with the built-in `web_search` tool. Persist source URLs and provider response identifiers when returned.

### Google Gemini

Use Gemini API Grounding with Google Search. Persist grounded source/citation metadata returned by the API.

### Perplexity

Use Sonar/Sonar Pro. Persist top-level `citations`, `search_results`, answer content, provider response ID and usage metadata.

### Anthropic

Use the Anthropic Messages API with the server-side web-search tool. Persist returned source/citation blocks and aggregate server-tool usage.

### DeepSeek

DeepSeek remains the internal advisory model used by P4/P5. As of the design date, official DeepSeek API documentation exposes chat/model/tool-call capabilities but does not document the consumer web/app Internet Search feature as an API search/grounding tool.

P6 therefore records DeepSeek web-grounding support as:

- `UNSUPPORTED_WEB_GROUNDING`

No DeepSeek consumer-web-search observation may be synthesized or inferred from the normal DeepSeek Chat API.

## 4. External-provider references reviewed

Primary documentation reviewed during design:

- OpenAI API quickstart / built-in web search: `https://platform.openai.com/docs/quickstart/make-your-first-api-request`
- Gemini Grounding with Google Search: `https://ai.google.dev/gemini-api/docs/google-search`
- Perplexity Sonar quickstart: `https://docs.perplexity.ai/docs/getting-started/quickstart`
- Perplexity Sonar prompt/citation guidance: `https://docs.perplexity.ai/docs/sonar/prompt-guide`
- Anthropic API pricing / web search availability: `https://docs.anthropic.com/en/docs/about-claude/pricing`
- DeepSeek API chat completion: `https://api-docs.deepseek.com/api/create-chat-completion`
- DeepSeek API model/pricing capabilities: `https://api-docs.deepseek.com/quick_start/pricing/`

These are capability references only. Runtime adapters must still fail closed when a provider changes an API contract.

## 5. P6 decomposition

P6 is split into four sequential sub-phases.

### P6-A — Prompt Monitor & Sampling Core

Deliver:

- project visibility settings and provider configurations;
- prompt sets;
- versioned prompts;
- platform adapters;
- manual sampling runs;
- scheduled sampling primitives;
- budget/cost ceilings;
- provider/model/channel/locale/country dimensions;
- durable raw observations;
- `visibility` BullMQ worker.

No visibility score is authoritative until P6-A observations exist.

### P6-B — Citation & Mention Intelligence

Deliver deterministic extraction from saved provider answers:

- owned-brand mentions;
- owned-domain mentions;
- owned-entity mentions;
- competitor mentions;
- citation URLs;
- citation domains;
- citation order/position when the provider supplies a stable order;
- source occurrence counts;
- unsupported/unknown citation states.

Mention/citation facts are derived from the persisted provider answer and provider citation metadata, not from DeepSeek interpretation.

### P6-C — Visibility Metrics & Competitor Share of Voice

Compute versioned metrics from P6 observations only.

Initial metric families:

- Mention Rate;
- Citation Rate;
- Platform Coverage;
- Prompt Coverage;
- Owned Citation Domain Rate;
- Competitor Mention Share;
- Competitor Citation Share;
- Share of Voice.

Every persisted metric snapshot must include:

- formula version;
- sample count;
- eligible sample count;
- unknown/error count;
- provider/model/channel dimensions;
- time window;
- source observation IDs.

No metric may silently treat `UNKNOWN`, failed samples, unsupported grounding, or provider refusal as zero.

### P6-D — History, Dashboard, Alerts & Report Integration

Deliver:

- project AI Visibility dashboard;
- provider/model/channel drill-down;
- prompt drill-down;
- citation-source explorer;
- competitor SOV view;
- trend history;
- change alerts;
- P5 report integration using already-persisted P6 facts.

P5 reports may read P6 snapshots only after P6 metrics exist. P5 report generation must never trigger a live provider sample.

## 6. Data model

### VisibilityProjectSettings

One project-level P6 policy row.

Fields:

- `projectId` (unique)
- `dailyBudgetMicros?`
- `defaultRunBudgetMicros?`
- `maxObservationsPerRun`
- `defaultCurrency` (initially `USD`)
- `schedulingEnabled`
- timestamps

This model holds durable safety policy. A `VisibilityRun` copies the relevant effective limits into its own immutable request snapshot so later settings changes do not alter historical interpretation.

### VisibilityProviderConfig

Durable project/provider configuration without secrets.

Fields:

- `id`
- `projectId`
- `provider`: `OPENAI | GEMINI | PERPLEXITY | ANTHROPIC | DEEPSEEK`
- `enabled`
- `model`
- `channel`: initially `API`
- `groundingMode`
- `maxConcurrency`
- `defaultLocale?`
- `defaultCountry?`
- `providerOptionsJson` (allowlisted non-secret options only)
- timestamps

Uniqueness:

- `(projectId, provider, model, channel, groundingMode)`

API keys are never stored here. They remain server-side secret configuration.

### VisibilityPromptSet

Represents a project-owned collection of prompts.

Fields:

- `id`
- `projectId`
- `name`
- `description?`
- `status`: `ACTIVE | PAUSED | ARCHIVED`
- `defaultLocale?`
- `defaultCountry?`
- timestamps

### VisibilityPrompt

A durable, versioned sampling prompt.

Fields:

- `id`
- `projectId`
- `promptSetId`
- `promptKey`
- `version`
- `promptText`
- `locale?`
- `country?`
- `status`: `ACTIVE | PAUSED | ARCHIVED`
- `promptHash`
- timestamps

Uniqueness:

- `(promptSetId, promptKey, version)`

Prompt text is user/project configuration, not provider reasoning.

### VisibilityRun

One bounded sampling batch.

Fields:

- `id`
- `projectId`
- `status`: `QUEUED | RUNNING | COMPLETED | PARTIAL | FAILED | CANCELLED`
- `runType`: `MANUAL | SCHEDULED`
- `promptSetId`
- `requestedProviderConfigs` JSON
- `maxObservations`
- `budgetCeilingMicros?`
- `currency`
- `policySnapshotJson`
- `startedAt?`
- `finishedAt?`
- `errorCode?`
- timestamps

A run must never exceed configured hard observation/budget caps.

### PlatformObservation

The authoritative external sample record.

Fields:

- `id`
- `projectId`
- `visibilityRunId`
- `visibilityPromptId`
- `promptVersion`
- `provider`: `OPENAI | GEMINI | PERPLEXITY | ANTHROPIC | DEEPSEEK`
- `model`
- `channel`: `API | CONSUMER_UI`
- `groundingMode`: `WEB_SEARCH | SEARCH_GROUNDING | SONAR | WEB_SEARCH_TOOL | UNSUPPORTED_WEB_GROUNDING`
- `locale?`
- `country?`
- `status`: `COMPLETED | REFUSED | UNSUPPORTED | FAILED | INCOMPLETE`
- `providerResponseId?`
- `answerText?` (bounded)
- `answerHash?`
- `citationsJson`
- `searchMetadataJson`
- `promptTokens?`
- `completionTokens?`
- `totalTokens?`
- `searchUnits?`
- `costMicros?`
- `costCurrency?`
- `pricingVersion?`
- `latencyMs?`
- `errorCode?`
- `observedAt`
- timestamps

Never persist chain-of-thought/reasoning traces.

If a provider returns reasoning/thought/search planning fields, adapters must discard them before persistence.

Historical `costMicros`, `costCurrency`, and `pricingVersion` are immutable facts once recorded. A provider price change never rewrites old observations.

### MentionObservation

Deterministically derived from a completed `PlatformObservation`.

Fields:

- `id`
- `projectId`
- `platformObservationId`
- `subjectType`: `OWNED_BRAND | OWNED_DOMAIN | OWNED_ENTITY | COMPETITOR`
- `subjectId?`
- `subjectValue`
- `mentionType`: `EXACT | NORMALIZED_ALIAS | DOMAIN`
- `occurrenceCount`
- `firstPosition?`
- `extractorVersion`
- timestamps

### CitationObservation

Deterministically derived from provider citation/search metadata.

Fields:

- `id`
- `projectId`
- `platformObservationId`
- `url`
- `normalizedUrl`
- `domain`
- `position?`
- `title?`
- `sourceType?`
- `isOwnedDomain`
- `competitorId?`
- `extractorVersion`
- timestamps

A URL visible only in generated prose must not automatically become an authoritative provider citation unless the provider API marks it as a citation/source or the metric explicitly measures prose URLs separately.

### VisibilitySnapshot

Versioned metric snapshot.

Fields:

- `id`
- `projectId`
- `snapshotType`
- `formulaVersion`
- `windowStart`
- `windowEnd`
- `dimensionsJson`
- `metricsJson`
- `sampleCount`
- `eligibleSampleCount`
- `unknownCount`
- `sourceObservationIdsJson`
- `calculatedAt`

## 7. Sampling matrix

A sampling unit is:

`VisibilityPrompt × ProviderConfig`

ProviderConfig contains:

- provider;
- model;
- channel;
- grounding mode;
- locale/country;
- optional supported provider search controls.

The system must persist each unit separately.

A single prompt sampled on OpenAI and Gemini creates two observations, not one merged answer.

## 8. Provider adapter interface

Introduce a provider-neutral P6 sampling interface separate from the P4 DeepSeek advisory gateway.

Conceptual contract:

```ts
interface VisibilityProviderAdapter {
  provider: VisibilityProvider;
  channel: 'API';
  supportsWebGrounding(): boolean;
  sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse>;
}
```

The normalized response includes only persistence-safe facts:

- provider response ID;
- bounded answer text;
- normalized citation/search-source records;
- usage/cost facts;
- latency;
- finish/refusal/unsupported state.

No provider-specific reasoning trace enters the normalized response.

## 9. Queue and execution

Use the already reserved BullMQ queue:

- `visibility`

P6-A activates a real visibility worker in `worker-bootstrap.ts`.

Execution principles:

- paid provider attempts default to `1`;
- explicit/manual retry creates a new observation attempt lineage rather than silently duplicating cost;
- hard per-run observation cap;
- hard project/day budget cap;
- provider-specific concurrency cap;
- rate-limit failures use stable error codes;
- worker does not block HTTP request lifecycle;
- no provider API is called in CI.

## 10. Idempotency

Visibility sampling is intentionally time-varying, so idempotency differs from P4/P5 AI tasks.

A duplicate queue delivery for the same requested sampling unit must not create a second paid request.

Use a stable sampling-unit key such as:

`visibility:<runId>:<promptId>:<provider>:<model>:<channel>:<locale>:<country>`

Retries after an actual failed provider call must be explicit and auditable.

## 11. Cost and budget safety

P6 is a paid external sampling subsystem.

Required safeguards:

- project daily budget ceiling;
- per-run budget ceiling;
- max observations per run;
- provider enable/disable controls;
- per-provider concurrency limits;
- persisted aggregate token/search usage;
- persisted historical currency and pricing-version metadata;
- fail closed when budget is exhausted.

Budget checks use already-recorded spend plus a conservative preflight estimate for the next sampling unit. If the estimate would cross a hard ceiling, the unit is skipped with an explicit budget status and no provider request is made.

A provider price-table change must not rewrite historical cost facts.

## 12. Prompt design rules

Visibility prompts are measurement instruments.

Rules:

- version every prompt change;
- never silently edit an already-sampled version;
- preserve locale/country dimensions;
- avoid injecting owned-brand hints unless the prompt intentionally measures branded recall;
- keep branded and unbranded prompt sets distinct;
- competitor-comparison prompts must list competitors only when the measurement methodology explicitly requires it;
- template variables must be materialized and hashed before execution.

## 13. Mention extraction

P6-B mention extraction must be deterministic.

Owned subjects come from explicit project configuration and existing P3 entities/aliases where appropriate.

Initial normalization:

- Unicode normalization;
- case folding where language-appropriate;
- punctuation/whitespace normalization;
- exact configured aliases;
- domain normalization.

Do not use an LLM to decide whether a fuzzy semantic phrase “probably means” the owned brand for authoritative metrics.

A future advisory semantic classifier may flag review candidates, but those do not enter deterministic metrics until accepted into an alias/configuration set.

## 14. Citation extraction

Citation authority order:

1. provider-native citation/source metadata;
2. provider-native search result metadata explicitly associated with the answer;
3. otherwise `UNKNOWN`.

Do not fabricate a citation relationship from ordinary generated text.

Normalize citation URLs using the existing deterministic URL-normalization principles where applicable, while preserving the original URL.

## 15. Initial metric formulas

All formulas are versioned as `AI_VISIBILITY_V1` unless otherwise stated.

### Mention Rate

`eligible observations with >=1 owned mention / eligible observations`

### Citation Rate

`eligible grounded observations with >=1 owned-domain citation / eligible grounded observations`

### Platform Coverage

`platform configurations with >=1 owned mention or owned citation / eligible platform configurations sampled`

### Prompt Coverage

`distinct eligible prompts with >=1 owned mention or owned citation / distinct eligible prompts sampled`

### Competitor Mention Share

For an explicitly configured comparison set:

`owned mention occurrences / total configured-subject mention occurrences`

### Competitor Citation Share

`owned-domain citation occurrences / total configured-subject citation occurrences`

### Share of Voice

P6 V1 SOV is a transparent, observation-based metric, not a market-share claim.

Default V1 definition:

`owned subject visibility points / all configured subject visibility points`

Visibility points are defined by formula version and may combine mention/citation indicators only when the UI displays the exact formula and sample counts.

No hidden proprietary weighting in V1.

## 16. UNKNOWN and eligibility semantics

The following are not zeros:

- provider unsupported grounding;
- API failure;
- rate-limit failure;
- budget-skipped sample;
- provider refusal;
- missing citation metadata;
- incomplete response.

Every metric defines its eligible denominator explicitly.

The UI must show sample size and UNKNOWN/error counts beside the metric.

## 17. Feature gates

Existing advanced gates remain authoritative:

- `AI_VISIBILITY`
- `PROMPT_MONITOR`
- `CITATION_MONITOR`
- `COMPETITOR_SOV`

P6 remains available only to `ADVANCED` and `ENTERPRISE` under the current feature matrix.

`STANDARD` must receive a normal feature-not-available response and must not enqueue paid visibility work.

## 18. REST design

P6-A/B/C target API surface:

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
- `GET /api/v1/projects/:projectId/visibility/citations`
- `GET /api/v1/projects/:projectId/visibility/mentions`
- `GET /api/v1/projects/:projectId/visibility/snapshots`
- `GET /api/v1/projects/:projectId/visibility/overview`

Manual retry endpoints must identify the original observation/run lineage.

## 19. Web UI

Project navigation:

- AI Visibility
- Prompt 监控
- Citation 监控
- Share of Voice

### AI Visibility overview

Display:

- Mention Rate;
- Citation Rate;
- Platform Coverage;
- Prompt Coverage;
- sample count;
- UNKNOWN/error count;
- last sample time;
- provider coverage;
- trend.

### Prompt Monitor

Display prompt set, prompt version, provider/model/channel, recent observation result and historical hit rate.

### Citation Monitor

Display source domains, owned citations, competitor citations, citation frequency, provider, prompt and time dimensions.

### Share of Voice

Display transparent formula version, sample size, owned share and configured competitor shares.

Never display an API observation as a consumer app ranking.

## 20. Scheduling and monitoring

P6-A persistence supports scheduled-run policy, but the first implementation milestone exposes manual runs before recurring scheduling UI.

Recommended defaults once scheduling is enabled:

- daily or weekly, not minute-level;
- project-defined provider matrix;
- budget-aware suppression;
- alert only on statistically/operationally meaningful change and sufficient sample size.

## 21. Observability

Allowed P6 operational events:

- `visibility.run.queued`
- `visibility.run.started`
- `visibility.observation.started`
- `visibility.observation.completed`
- `visibility.observation.unsupported`
- `visibility.observation.failed`
- `visibility.run.completed`
- `visibility.run.partial`
- `visibility.run.failed`
- `visibility.snapshot.created`

Safe fields:

- project ID;
- run/observation IDs;
- provider/model/channel;
- prompt ID/version;
- status/error code;
- latency;
- aggregate token/search/cost counts.

Never log:

- API keys;
- Authorization headers;
- provider reasoning/thought traces;
- unbounded answer bodies;
- cookies/session tokens;
- consumer product credentials.

## 22. Security

Provider API keys remain server-side environment/secret-store configuration.

P6 must not accept arbitrary provider base URLs from normal project users.

All project-scoped reads/writes must bind both `projectId` and resource ID.

Answer/citation persistence must apply configured size limits.

No consumer-account browser credential storage is introduced in P6.1.

## 23. CI and testing

CI must never call live OpenAI, Gemini, Perplexity, Anthropic or DeepSeek APIs.

Use fixture adapters for provider-contract tests.

Required test layers:

- provider normalization unit tests;
- persistence integration tests;
- run/idempotency/budget tests;
- mention/citation deterministic extraction tests;
- metric formula tests;
- project/feature-gate API tests;
- worker tests with injected fake adapters;
- Web integration tests;
- Chromium smoke tests.

Provider contract fixtures must include:

- grounded answer with citations;
- answer with no owned mention;
- refusal;
- rate-limit/provider failure;
- malformed/partial citation metadata;
- unsupported grounding;
- duplicate queue delivery;
- budget-preflight skip.

## 24. Migration / compatibility

P6 introduces new tables and provider-specific configuration but does not change the meaning of P1-P5 facts.

Existing reserved infrastructure is reused:

- `visibility` BullMQ queue;
- `AI_VISIBILITY`, `PROMPT_MONITOR`, `CITATION_MONITOR`, `COMPETITOR_SOV` feature gates;
- advanced UI navigation placeholders.

The P4 DeepSeek AI Gateway remains advisory-only and is not repurposed as the P6 sampling abstraction.

## 25. Release ordering

Implementation order:

1. P6-A settings/provider configs + prompt sets/prompts persistence;
2. provider-neutral sampling adapter contract;
3. fixture adapter + visibility queue/worker;
4. manual run API/UI + budget controls;
5. one real official API adapter at a time: OpenAI → Gemini → Perplexity → Anthropic;
6. P6-B deterministic mention/citation extraction;
7. P6-C metric snapshots + competitor SOV;
8. P6-D dashboard/history/report integration;
9. final P6 release gate.

DeepSeek web-grounding adapter remains disabled until official API support exists.

## 26. Final release gate

Before P6 is marked complete:

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

Additional P6 requirements:

- no live provider requests in CI;
- paid-request idempotency proven;
- budget ceiling tests green;
- provider reasoning not persisted/logged;
- API vs consumer UI labels verified;
- metric denominators/sample counts verified;
- UNKNOWN semantics verified;
- P1-P5 regression suite green.

## 27. Acceptance criteria

P6 is successful when an Advanced/Enterprise project can:

1. configure durable provider policy without storing provider secrets;
2. configure versioned unbranded/branded prompt sets;
3. run a bounded, budget-controlled official API sampling batch;
4. inspect each provider observation separately;
5. see deterministic owned/competitor mentions and native citations;
6. see transparent, sample-backed AI Visibility/SOV metrics;
7. see UNKNOWN/error counts instead of fabricated zeros;
8. inspect history/trends;
9. include persisted P6 facts in future project reports;
10. verify that no result is mislabeled as consumer-product ranking;
11. pass the full release gate without any live provider calls in CI.
