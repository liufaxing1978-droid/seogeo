# P6-A Final Release Verification

Status: **INTEGRATED GATE PASSED — FINAL README HEAD MUST PASS FRESH CI BEFORE MERGE**

This document records the final P6-A release gate for Prompt Monitor & Sampling Core.

The integrated release candidate at commit `a5b56cb44a94d7cc471334c40f87e20b0a0e59e7` passed GitHub CI run **#964** (`32221199818`):

- `verify` — success;
- `e2e` — success;
- `production-audit` — success.

The successful `verify` job included Prisma validate/generate/migrate deploy, TypeScript typecheck, the full Vitest suite and build. The successful `e2e` job installed Chromium and passed browser smoke tests. The successful production audit verified the deployable runtime dependency tree.

After that integrated gate passed, `README.md` was allowed to mark:

```text
P6-A Prompt Monitor & Sampling Core — complete
P6-B Citation & Mention Intelligence — next
```

That README/documentation update creates the final release head. The PR must not merge until that final head again passes fresh `verify`, `e2e`, and `production-audit` jobs.

## Static boundary review

The P6-A implementation is limited to:

- project visibility settings and provider configurations;
- immutable Prompt Sets and Prompt versions;
- bounded manual visibility runs;
- `PlatformObservation` persistence;
- provider-neutral sampling adapters;
- official API adapters for OpenAI, Gemini, Perplexity and Anthropic;
- explicit zero-network unsupported web grounding for DeepSeek;
- deterministic budget/idempotency controls;
- the `visibility` BullMQ worker;
- Advanced/Enterprise REST and Web surfaces;
- safe lifecycle observability and operator documentation.

The release candidate intentionally does **not** include:

- `MentionObservation` extraction;
- `CitationObservation` extraction;
- `VisibilitySnapshot` metric computation;
- Mention Rate / Citation Rate;
- Competitor Share of Voice calculations;
- P6-B/P6-C dashboard implementation;
- consumer UI/browser-account automation;
- consumer credentials/session storage;
- DeepSeek web-search emulation.

## Truth and labeling boundary

Every P6-A external sample is an official-provider API observation with `channel=API`.

The UI and API must not present an API sample as a ChatGPT/Gemini/Claude/Perplexity consumer-product ranking.

`CONSUMER_UI` is reserved in the schema for future work but P6-A provider configuration rejects every non-API channel.

Prompt/answer/provider reasoning is excluded from P6 observability. Provider secrets remain server-side environment configuration and are not persisted in visibility project tables. Provider option keys are allowlisted and secret-like option names are rejected.

DeepSeek's P6-A adapter reports unsupported web grounding and performs no network-backed search emulation.

## Paid-request safety evidence

Green automated tests cover these required boundaries:

- duplicate queue delivery invokes a paid adapter at most once;
- `BUDGET_SKIPPED` invokes the adapter zero times;
- unsupported grounding invokes the adapter zero times;
- Standard projects cannot enqueue visibility work;
- paid BullMQ jobs use `attempts=1`;
- provider adapter tests use injected fixture transports, not live endpoints;
- safe observability excludes prompt text, answer text, provider raw bodies, reasoning and secrets.

## Release commands

The release candidate must pass all of:

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

GitHub CI maps these to the `verify`, `e2e`, and `production-audit` jobs.

## Final merge rule

The final README head must have fresh successful `verify`, `e2e`, and `production-audit` jobs. Only then may PR #76 be marked ready and merged to `main`.
