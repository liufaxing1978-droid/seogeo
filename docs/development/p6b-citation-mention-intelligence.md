# P6-B Citation & Mention Intelligence — Operator Guide

## Purpose

P6-B converts persisted P6-A `PlatformObservation` records into deterministic, replayable Mention and Citation facts. It does not sample providers and does not use DeepSeek, another LLM, embeddings, fuzzy semantic inference, or live URL fetching.

## Authority model

The only authoritative input is the persisted P6-A observation. Mention facts are derived from the persisted answer text using deterministic canonical/alias/domain matching. Citation facts are derived only from provider-native citation/search metadata already persisted on the observation.

A URL written in generated prose is not a Citation unless the provider-native evidence says it is a citation/source.

## Evidence states

P6-B intentionally distinguishes empty evidence from unknown or ineligible evidence:

- `EXTRACTED`: eligible evidence produced one or more facts.
- `KNOWN_EMPTY`: eligible extraction completed and positively produced zero facts.
- `UNKNOWN`: the persisted observation does not contain enough trustworthy evidence to decide.
- `NOT_ELIGIBLE`: provider/run status or grounding capability makes extraction ineligible.

`UNKNOWN` and `NOT_ELIGIBLE` must never be converted to zero. Provider failure, refusal, unsupported grounding, incomplete responses, and budget skip must not silently increase any future denominator.

## Citation evidence normalization

`PlatformObservation.citationEvidenceState` is authoritative for citation eligibility:

- `KNOWN_PRESENT`: native source/citation evidence exists.
- `KNOWN_EMPTY`: the provider contract positively reports an empty source collection.
- `UNKNOWN`: native evidence is ambiguous or insufficient.
- `NOT_APPLICABLE`: citation grounding is unsupported for that sampling configuration.

Existing observations are never guessed to be `KNOWN_EMPTY` solely because `citationsJson` happens to be empty.

## Subject registry

A project has an explicit monitored-subject registry:

- `OWNED_DOMAIN`
- `OWNED_BRAND`
- `OWNED_ENTITY`
- `COMPETITOR`

The project primary domain is bootstrapped as `OWNED_DOMAIN` only after the relevant plan gate passes. P3 entities and P5 competitors are never imported implicitly; they must be explicitly selected and must belong to the same project.

Aliases are normalized deterministically. If one active normalized alias can refer to more than one active subject, the service fails closed with `AMBIGUOUS_ALIAS`; it does not guess.

## Immutable extraction identity

Every extraction is identified by:

- `platformObservationId`
- `extractorVersion`
- `subjectSetHash`

The active subject configuration is canonically sorted and hashed. The exact snapshot used is stored in `subjectSnapshotJson` for historical reconstruction. Changing a subject or alias produces a different hash and therefore a new extraction. Historical extractions and their Mention/Citation rows remain immutable.

A queued observation extraction also carries the expected `subjectSetHash`. If the subject set changes before the worker starts, the worker fails closed with `VISIBILITY_SUBJECT_SNAPSHOT_STALE` and writes no derived facts.

## Queue and retry behavior

Dedicated queue: `visibility-extraction`.

Observation job ID:

`visibility-extract:<observationId>:<extractorVersion>:<subjectSetHash>`

Backfill job ID:

`visibility-backfill:<projectId>:<extractorVersion>:<subjectSetHash>:<cursor>`

Both job types use `attempts=2`. Worker concurrency is bounded at 4. Backfill uses ascending observation-ID cursor pagination, defaults to 50 observations, and hard-caps at 100. Backfill only enqueues observation-level extraction jobs; it never performs unbounded project extraction inline.

A `FAILED` extraction may be claimed again safely. A `COMPLETED` extraction is immutable and is returned unchanged.

## Network boundary

The extraction queue, worker, refresh endpoint, backfill endpoint, REST reads, web reads, retries, and CI are zero-network with respect to providers and external content. They must not call:

- OpenAI/Gemini/Perplexity/Anthropic/DeepSeek provider adapters
- the P4 AI Gateway
- `fetch` for citation URLs
- consumer ChatGPT/Gemini/Perplexity web UIs

Provider sampling remains exclusively a P6-A responsibility.

## API and web plan gates

P6-B subjects use `AI_VISIBILITY`; Citation Monitor extraction/read surfaces use `CITATION_MONITOR`. Standard projects receive `FEATURE_NOT_AVAILABLE` before any bootstrap, persistence, or enqueue side effect. Cross-project resource identifiers are reported as not found without revealing foreign project details.

REST list endpoints are project scoped and hard-capped at 100 rows. Safe serializers/selects do not expose prompt text, answer text, reasoning, provider raw bodies, cookies, secrets, or `subjectSnapshotJson`.

The Citation Monitor web UI shows factual Mention/Citation rows, evidence state, extractor version, and subject-set provenance. It does not compute or claim Mention Rate, Citation Rate, Share of Voice, ranking, trends, or weighted visibility.

## Safe observability

Allowed event names:

- `visibility.extraction.queued`
- `visibility.extraction.started`
- `visibility.extraction.completed`
- `visibility.extraction.failed`
- `visibility.extraction.backfill_queued`
- `visibility.subject.created`
- `visibility.subject.archived`
- `visibility.subject.alias_added`
- `visibility.subject.alias_ambiguous`

The serializer allowlist contains only IDs, extractor version, subject-set hash, statuses, counts, error code, and duration. Prompt/answer content, canonical subject values, aliases, provider bodies, API keys, cookies, and reasoning are dropped before logging.

## Operational diagnosis

When an extraction is not producing rows, inspect the extraction evidence status first. Do not infer a zero from an empty fact table. `UNKNOWN` indicates insufficient trustworthy persisted evidence. `NOT_ELIGIBLE` indicates the observation/run is outside extraction eligibility. `KNOWN_EMPTY` is the only empty state that positively means eligible-and-zero.

For stale subject-set failures, enqueue a new refresh/backfill after the configuration change; do not mutate the old queued job or historical extraction.

For deterministic materialization failures, preserve the failed extraction error code and retry through the same stable identity. The completion transaction prevents partial Mention/Citation materialization.

## P6-B release gate

Run on the exact final head:

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

Required evidence before marking P6-B complete:

1. provider/network call count during extraction tests is zero;
2. `UNKNOWN` never becomes zero;
3. old extraction remains immutable after subject configuration changes;
4. prose URL is never promoted to Citation;
5. Standard cannot bootstrap/enqueue/read Citation Monitor surfaces;
6. P1–P6-A regressions remain green;
7. no P6-C metric model, calculator, trend engine, or Share-of-Voice implementation is present;
8. fresh GitHub CI on the exact final head passes verify, production-audit, and Chromium E2E.

Only after this gate may README state that P6-B is complete and P6-C is next.
