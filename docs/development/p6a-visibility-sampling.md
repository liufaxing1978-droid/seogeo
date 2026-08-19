# P6-A Visibility Sampling Operator Guide

## Boundary

P6-A measures externally sampled AI answers through supported official APIs. It is separate from P3 GEO readiness and the P4/P5 DeepSeek advisory gateway.

Every P6-A observation is labeled with its provider, model and `channel=API`. An API observation must never be presented as a consumer-product result such as “ChatGPT web ranking”, “Gemini App ranking”, “Claude.ai ranking” or “Perplexity web UI ranking”.

`CONSUMER_UI` is reserved for a future separately implemented channel and is rejected by the P6-A configuration service.

## Provider secrets

Provider API keys are server-side environment variables only:

```text
OPENAI_API_KEY=
GEMINI_API_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
```

They are not stored in `VisibilityProviderConfig`, returned by visibility APIs, rendered by the UI, or written to observability events.

DeepSeek remains available to the separate P4/P5 advisory gateway, but P6-A does not use the normal DeepSeek Chat API as evidence of web-grounded visibility.

## Supported P6-A grounding

| Provider | Channel | Grounding mode | P6-A state |
| --- | --- | --- | --- |
| OpenAI | API | `WEB_SEARCH` | supported |
| Gemini | API | `SEARCH_GROUNDING` | supported |
| Perplexity | API | `SONAR` | supported |
| Anthropic | API | `WEB_SEARCH_TOOL` | supported |
| DeepSeek | API | `UNSUPPORTED_WEB_GROUNDING` | explicitly unsupported |

DeepSeek’s adapter is intentionally zero-network for web-grounding sampling. Until an official DeepSeek API exposes the required search/grounding capability, no consumer web-search result may be synthesized from DeepSeek Chat completions.

## Prompt versioning

Visibility prompts are measurement instruments.

- Prompt Sets group related prompts.
- Prompt text is immutable once a version is created.
- Editing measurement wording creates a new version.
- Each sampling observation records the exact prompt ID/version used.
- Locale and country are persisted as sampling dimensions.

Changing an old prompt record in place would invalidate historical comparisons and is therefore not supported.

## Run and queue behavior

Manual runs expand a deterministic matrix:

```text
active prompt versions × enabled API provider configurations
```

One `PlatformObservation` is persisted for every sampling unit before queue execution.

Queue:

```text
visibility
```

Job ID:

```text
visibility-observation-<observationId>
```

Paid provider jobs use `attempts=1`.

`samplingUnitKey` is unique. The worker claims only observations in `PENDING` state. A duplicate BullMQ delivery therefore cannot execute the paid provider request a second time after the first worker has claimed the observation.

Any deliberate retry must be implemented as a new auditable sampling lineage rather than silently replaying a paid call.

## Budget semantics

P6-A supports:

- project daily budget ceilings;
- default per-run budget ceilings;
- explicit per-run budget ceilings;
- maximum observations per run;
- provider concurrency limits.

Before an adapter call, the worker performs a deterministic budget preflight using recorded spend plus the provider’s conservative next-call estimate.

If a finite hard ceiling exists and the next request cannot be safely admitted, the provider is not called and the observation becomes `BUDGET_SKIPPED`.

Historical provider usage facts are immutable:

- `costMicros`
- `costCurrency`
- `pricingVersion`
- token/search usage

A later provider price-table change must not reprice old observations.

## Observation statuses

`PlatformObservation.status` meanings:

- `PENDING` — persisted but not claimed by a worker.
- `RUNNING` — atomically claimed for execution.
- `COMPLETED` — provider returned a usable completed observation.
- `REFUSED` — provider explicitly refused the request.
- `UNSUPPORTED` — requested grounding capability is unsupported.
- `FAILED` — provider/normalization execution failed.
- `INCOMPLETE` — provider returned an incomplete/non-final response.
- `BUDGET_SKIPPED` — deterministic budget preflight blocked the paid call.

`REFUSED`, `UNSUPPORTED`, `FAILED`, `INCOMPLETE` and `BUDGET_SKIPPED` are not visibility zeros. Future P6 metrics must define their eligible denominator explicitly.

## Run statuses

- `QUEUED` — observations persisted and enqueue completed.
- `RUNNING` — at least one observation has been claimed.
- `COMPLETED` — all observations completed successfully.
- `PARTIAL` — at least one observation completed and at least one ended non-successfully.
- `FAILED` — no observation completed successfully, or queue enqueue failed.
- `CANCELLED` — reserved run terminal state.

Final run state is derived from persisted observation statuses, not from an LLM.

## Persisted provider facts

A normalized observation may contain bounded:

- provider response ID;
- answer text and answer hash;
- provider-native citation/source metadata;
- safe search metadata;
- token/search usage;
- latency;
- historical cost/currency/pricing version;
- stable status/error code.

Provider reasoning, thought blocks and search-planning traces are removed before persistence where applicable.

## Safe observability

Allowed operational events:

```text
visibility.run.queued
visibility.run.started
visibility.observation.started
visibility.observation.completed
visibility.observation.unsupported
visibility.observation.failed
visibility.run.completed
visibility.run.partial
visibility.run.failed
```

The observability serializer uses an explicit allowlist. Allowed fields are limited to bounded operational metadata such as:

- project/run/observation IDs;
- provider/model/channel;
- prompt ID/version;
- status/error code;
- latency;
- aggregate token/search/cost counts.

Never log through P6 observability:

- `Authorization` headers;
- API keys/tokens/secrets;
- cookies/session credentials;
- prompt text;
- answer text;
- provider raw bodies;
- reasoning/thought/chain-of-thought;
- search-planning traces.

Final run events are emitted only when the database terminal-state transition succeeds, preventing duplicate terminal events from duplicate job delivery.

## P6-A web surface

The P6-A project UI exposes only the sampling-core views:

- `/projects/:id/visibility` — API sampling readiness, Provider configuration summary, budget state and recent sampling runs;
- `/projects/:id/visibility/prompts` — Prompt Set configuration and immutable Prompt versions;
- `/projects/:id/visibility/runs/:runId` — normalized API observation, citation-source, usage and historical cost facts for one run.

The UI must keep the `API 采样` label explicit. Visiting these pages or creating Prompt configuration does not enqueue a provider request; only the controlled run API starts sampling.

`Citation 监控` and `Share of Voice` remain navigation placeholders for P6-B/P6-C. P6-A does not render Mention Rate, Citation Rate, Share of Voice, consumer-product rankings or any metric inferred from missing observations.

## Feature gates

P6-A uses the existing Advanced/Enterprise gates:

- `AI_VISIBILITY`
- `PROMPT_MONITOR`

Standard projects must fail before any paid visibility run is persisted or queued.

`CITATION_MONITOR` and `COMPETITOR_SOV` remain future P6-B/P6-C capabilities and are not activated by P6-A.

## CI rule

CI must never issue a live OpenAI, Gemini, Perplexity, Anthropic or DeepSeek provider request.

Provider adapter tests use injected fixture transports. Worker tests use fixture adapters. Visiting AI Visibility/Prompt Monitor pages does not start provider sampling.

The P6-A release gate requires:

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

In addition, release evidence must show:

- duplicate queue delivery invokes a paid adapter at most once;
- budget-skipped observations invoke the adapter zero times;
- Standard projects cannot enqueue visibility work;
- DeepSeek unsupported grounding invokes no network call;
- API-vs-consumer labeling remains explicit;
- prompt/answer/provider reasoning is absent from observability logs.
