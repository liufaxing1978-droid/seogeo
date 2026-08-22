# P9-0D Global AI Visibility Expansion

## Purpose

P9-0D extends the existing provider-neutral P6 AI visibility sampling layer without replacing its observation model, worker isolation, budget controls, prompt versioning, or citation normalization boundary.

The implementation reality on the true P9 base differs from the original high-level P9 design assumption: OpenAI, Gemini, Perplexity, Anthropic, and the explicit DeepSeek unsupported adapter already existed in P6-A before P9-0D started. P9-0D therefore does **not** duplicate those adapters. Its concrete provider expansion is Microsoft 365 Copilot through the official Work IQ Chat API, while the full regression suite continues to validate the existing providers.

## Provider matrix after P9-0D

| Provider | Channel | Grounding mode | State | P9-0D change |
| --- | --- | --- | --- | --- |
| OpenAI | API | `WEB_SEARCH` | supported | existing adapter retained |
| Gemini | API | `SEARCH_GROUNDING` | supported | existing adapter retained |
| Perplexity | API | `SONAR` | supported | existing adapter retained |
| Anthropic | API | `WEB_SEARCH_TOOL` | supported | existing adapter retained |
| DeepSeek | API | `UNSUPPORTED_WEB_GROUNDING` | explicitly unsupported | existing zero-network adapter retained |
| Microsoft | API | `WEB_SEARCH` | supported through Work IQ | added by P9-0D |

No API sample in this table is a consumer-product ranking. In particular, a Microsoft Work IQ observation must never be labeled as a consumer Copilot UI ranking.

## Microsoft provider identity

P9-0D adds the `MICROSOFT` value to `VisibilityProvider`.

The adapter is:

```text
src/modules/visibility/providers/microsoft.provider.ts
```

It participates in the existing `VisibilityProviderRegistry` and therefore uses the same provider-neutral sampling orchestration as OpenAI, Gemini, Perplexity, Anthropic, and DeepSeek.

P9-0D does not introduce a second visibility broker, a second observation table, or a Microsoft-specific run model.

## Official Work IQ surface

The Microsoft adapter uses the production Work IQ REST endpoints documented by Microsoft:

```text
POST https://workiq.svc.cloud.microsoft/rest/conversations
POST https://workiq.svc.cloud.microsoft/rest/conversations/{conversationId}/chat
```

The first request creates a Microsoft 365 Copilot conversation using an empty JSON body. The second request sends the measurement prompt synchronously.

P9-0D enables web grounding for the measurement turn with:

```json
{
  "contextualResources": {
    "webContext": {
      "isWebEnabled": true
    }
  }
}
```

The request also supplies the required `locationHint.timeZone`. The provider option allowlist permits only:

```text
timeZone
```

for the Microsoft provider. If no valid `timeZone` option is supplied, the adapter uses `UTC`.

Official references reviewed for P9-0D:

- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/overview`
- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/copilotroot-post-conversations`
- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/rest/copilotconversation-chat`
- `https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/api/ai-services/chat/resources/copilotconversationattribution`

## Authentication boundary

The Work IQ Chat API requires delegated authentication for a work or school account and the documented `WorkIQAgent.Ask` permission. Application-only authentication is not supported by the documented route.

P9-0D accepts a delegated access token through the server-side environment variable:

```text
MICROSOFT_WORK_IQ_ACCESS_TOKEN=
```

The token is never stored in `VisibilityProviderConfig`, never added to the normalized HTTP request object exposed to fixture tests, and never persisted in `PlatformObservation`.

P9-0D deliberately does not implement Microsoft interactive OAuth consent, refresh-token persistence, or token renewal. A deployment that enables Microsoft sampling must supply a valid delegated token through an approved server-side credential mechanism. Expired, missing, or ineligible credentials fail closed as provider authentication failures rather than producing synthetic observations.

## Work IQ grounding semantics

Work IQ can use Microsoft 365 enterprise grounding and web search grounding. P9-0D explicitly turns web grounding on for the sampled turn, but it does not claim that the resulting response is a pure public-web-only ranking surface.

Normalized metadata therefore identifies the API surface explicitly:

```text
surface = MICROSOFT_365_COPILOT_WORK_IQ
groundingProvider = BING_WEB_SEARCH
webGroundingEnabled = true
```

This metadata means that Bing-backed web grounding was enabled inside the Work IQ Copilot request. It does **not** mean:

- a Bing SERP rank was measured;
- the consumer Copilot web UI was scraped;
- the response is equivalent to a consumer Copilot product ranking;
- enterprise grounding was disabled or absent.

Any future Microsoft Foundry Web Search / Grounding with Bing Search adapter must use a distinct surface identifier rather than reusing the Work IQ identity.

## Citation normalization

Work IQ response messages expose `attributions`. P9-0D normalizes only attributions whose:

```text
attributionType = citation
```

and that contain a non-empty `seeMoreWebUrl`.

Normalized citation fields are:

- `url` ← `seeMoreWebUrl`;
- `title` ← `providerDisplayName` when present;
- `position` ← `null` because Work IQ does not expose a stable comparable citation rank through this contract;
- `sourceType` ← `microsoft_attribution`.

Duplicate citation URLs are removed deterministically.

Citation evidence semantics remain the existing provider-neutral states:

- at least one normalized citation → `KNOWN_PRESENT`;
- an explicitly empty attribution collection → `KNOWN_EMPTY`;
- missing/ambiguous attribution evidence → `UNKNOWN`;
- unsupported grounding mode → `NOT_APPLICABLE`.

P9-0D does not infer a citation from plain answer text.

## Response normalization

A successful Work IQ sample persists only bounded normalized facts:

- conversation ID as `providerResponseId`;
- final answer text;
- normalized citation list;
- citation evidence state;
- safe surface/grounding metadata;
- total latency across conversation creation and synchronous chat.

Work IQ does not currently supply a provider-neutral token/search-unit/cost contract used by this adapter, so those normalized fields remain `null` rather than being estimated or fabricated.

## Error behavior

Stable provider error mapping follows the existing P6 contract:

- HTTP 401/403 → `VISIBILITY_PROVIDER_AUTH_FAILED`;
- HTTP 429 → `VISIBILITY_PROVIDER_RATE_LIMITED`;
- other non-2xx HTTP responses → `VISIBILITY_PROVIDER_FAILED`;
- malformed create/chat responses → `VISIBILITY_PROVIDER_MALFORMED_RESPONSE`;
- transport exceptions → `VISIBILITY_PROVIDER_FAILED`.

Raw provider bodies, bearer tokens, and transport exception details are not copied into persisted error messages.

If a non-`WEB_SEARCH` grounding mode is requested, the adapter performs zero network calls and returns a normalized `UNSUPPORTED` observation response.

## Provider isolation

Microsoft is registered as one more adapter in the existing `VisibilityProviderRegistry`. P9-0D does not change the worker's per-observation isolation model.

A Microsoft authentication, rate-limit, transport, or normalization failure therefore remains scoped to that provider observation and does not convert successful observations from other providers into Microsoft failures.

## Persistence

P9-0D keeps the existing provider-neutral persistence authority:

```text
PlatformObservation
```

No Microsoft-specific observation table is created.

The only database schema expansion is the provider enum migration:

```sql
ALTER TYPE "VisibilityProvider" ADD VALUE 'MICROSOFT';
```

This preserves historical OpenAI, Gemini, Perplexity, Anthropic, and DeepSeek observation rows unchanged.

## Configuration safety

`VisibilityProviderConfig.providerOptionsJson` is still subject to the existing secret-key rejection rule. Microsoft allows only the non-secret `timeZone` option through this JSON surface.

Authentication material must remain outside provider options. Keys containing token/key/secret/authorization/cookie-like names continue to fail validation.

## Test coverage

P9-0D adds deterministic fixture tests for:

- Work IQ conversation creation;
- synchronous chat request construction;
- web-grounding enablement;
- time-zone propagation;
- citation normalization and URL deduplication;
- explicit empty citation evidence;
- missing delegated token fail-closed behavior;
- 401/403 authentication mapping;
- 429 rate-limit mapping;
- generic upstream failure mapping;
- transport failure normalization;
- unsupported grounding zero-network behavior;
- default registry inclusion.

The full Vitest suite remains the regression gate for the pre-existing OpenAI, Gemini, Perplexity, Anthropic, DeepSeek, visibility worker, normalization, metrics, and higher-level modules.

CI never calls the live Work IQ service. Microsoft tests use an injected fixture transport.

## Security and compliance boundary

P9-0D does not:

- scrape `copilot.microsoft.com` or any authenticated Copilot UI;
- use undocumented Microsoft endpoints;
- reverse-engineer private browser traffic;
- store Microsoft delegated credentials in visibility database rows;
- persist hidden reasoning or search-planning traces;
- fabricate missing citation, token, cost, or ranking data;
- identify a Work IQ API sample as consumer Copilot ranking.

## Compatibility with P6 and later P9 phases

P6 remains authoritative for visibility prompt versioning, provider configurations, runs, budgets, observations, citation evidence, metrics, and history.

P9-0D only widens the provider family that can produce those observations.

P9-0F may later consume Microsoft observations through the same provider-aware evidence boundary. It must preserve `provider=MICROSOFT`, the Work IQ surface metadata, locale/country dimensions, exact observation lineage, and evidence state rather than collapsing Microsoft facts into another provider's semantics.

## Rollback

Application rollback can remove the Microsoft adapter from the default registry and disable Microsoft provider configurations.

The PostgreSQL enum value should not be destructively removed in a routine rollback because deployed databases may already contain `MICROSOFT` rows. Leaving an unused enum value is safer than rewriting historical observations.

Existing provider rows and the `PlatformObservation` schema require no rollback transformation.

## Release gate

P9-0D is complete only when the exact feature head passes all three CI jobs:

1. `verify`
   - Prisma validate;
   - Prisma generate;
   - migrations deploy;
   - TypeScript typecheck;
   - full Vitest suite;
   - production build.
2. `production-audit`
   - runtime-only dependency install;
   - Prisma CLI absence check;
   - high-severity production dependency audit.
3. `e2e`
   - Prisma generation and migration;
   - Chromium installation;
   - full browser smoke suite.

A green run on an earlier commit is not sufficient. The final documentation/configuration head must itself pass the three exact-head jobs before the PR is marked ready for review.
