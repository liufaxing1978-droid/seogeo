# P6-A Final Release Verification

Status: **PENDING FINAL CI**

This document records the final P6-A release gate for Prompt Monitor & Sampling Core. It does not mark P6-A complete until the final release branch passes the complete CI matrix and is merged to `main`.

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

The current release candidate intentionally does **not** include:

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

Prompt/answer/provider reasoning is excluded from P6 observability. Provider secrets remain server-side environment configuration and are not persisted in visibility project tables.

## Paid-request safety evidence

Existing green tests must continue to prove:

- duplicate queue delivery invokes a paid adapter at most once;
- `BUDGET_SKIPPED` invokes the adapter zero times;
- unsupported grounding invokes the adapter zero times;
- Standard projects cannot enqueue visibility work;
- paid BullMQ jobs use `attempts=1`;
- provider adapter tests use injected fixture transports, not live endpoints.

## Final commands

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

## Completion rule

Only after the release-candidate CI is fully green may the release branch update `README.md` to:

```text
P6-A Prompt Monitor & Sampling Core — complete
P6-B Citation & Mention Intelligence — next
```

That README change creates a new final head. The new final head must again pass fresh `verify`, `e2e`, and `production-audit` jobs before merge.
