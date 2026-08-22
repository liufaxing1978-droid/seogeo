# P9-0F Unified Search Facts Implementation Plan

> **Execution note (2026-08-22):** `prisma.config.ts` sets `schema: 'prisma'`, so Prisma uses the multi-file schema directory. New P9-0F declarations belong only in `prisma/models/search-facts.prisma`; do **not** duplicate them into `prisma/schema.prisma`. This note supersedes any earlier root-schema mirroring wording.

The approved task sequence remains: semantic/schema contract → durable Bing source boundary → pure GSC/Bing normalizers → immutable materialization → provider-aware read contract → documentation/exact-head CI/release review.

## Hard constraints

- Branch: `feat/p9-0f-unified-search-facts`, forked from `main@a6d1fd648b0d836ef590d33492bdc44df18a190f`.
- P9-0F is search-engine performance evidence only; P9-0E `PlatformObservation` remains separate.
- Existing `GscDailySnapshot` and `GscQueryPageFact` remain authoritative and unchanged.
- P7 scoring/evidence implementations stay unchanged.
- Google position, Bing average-click position, and Bing average-impression position remain distinct semantics.
- `UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` are not zero.
- Completed normalized snapshots are immutable; normalization changes create a new version.
- Bing source persistence is allowlisted from typed observation fields only; never persist credentials, auth headers, arbitrary upstream bodies, or secret-bearing errors.
- No cross-provider deduplication or scoring in P9-0F; P9-0G owns those decisions.
- Every major behavior follows RED → observed CI failure → minimal GREEN.
- Final readiness requires exact-head `verify`, `production-audit`, and `e2e` success. Do not merge automatically.

## Task 1 — persistence and semantic contract

Create:
- `tests/unit/search-fact.contract.test.ts`
- `src/modules/search-facts/search-fact.types.ts`
- `prisma/models/search-facts.prisma`
- `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql`

Required semantics:
- normalization version `SEARCH_FACT_NORMALIZATION_V1`
- fact kinds `QUERY_PAGE | QUERY | PAGE | SITE`
- source kinds `GSC_DAILY_SNAPSHOT | PROVIDER_OBSERVATION_BATCH`
- metric semantics `CLICKS | IMPRESSIONS | CTR | GOOGLE_SEARCH_CONSOLE_POSITION | BING_AVG_CLICK_POSITION | BING_AVG_IMPRESSION_POSITION`
- evidence states `KNOWN_PRESENT | KNOWN_EMPTY | UNKNOWN | NOT_SUPPORTED`
- completeness `COMPLETE | TOP_ROWS_ONLY | PROVIDER_UNSPECIFIED | UNKNOWN`

Schema models:
- `SearchProviderObservationBatch`
- `SearchProviderObservationRecord`
- `SearchFactSnapshot`
- `SearchFact`
- `SearchFactMetric`

Migration is additive only; no `DROP`, `TRUNCATE`, `DELETE`, or rewrites of existing GSC/Growth/visibility data.

Verification:
```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- tests/unit/search-fact.contract.test.ts
```

## Task 2 — durable allowlisted Bing source boundary

Create:
- `tests/integration/search-provider-source.repository.test.ts`
- `src/modules/search-facts/search-provider-source.repository.ts`

Persist only typed Bing `QUERY_STATS`, `PAGE_STATS`, and `SITE_TRAFFIC_DAILY` fields. Deterministically hash/sort observations. Reject mixed completeness, duplicate keys, source dates after cutoff, invalid credential-bearing property URLs, and non-Bing observations. Exact replays return the same batch and do not duplicate rows.

Verification:
```bash
npm run typecheck
npm test -- tests/integration/search-provider-source.repository.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

## Task 3 — pure Google and Bing normalizers

Create:
- `tests/unit/search-fact.google-normalizer.test.ts`
- `tests/unit/search-fact.bing-normalizer.test.ts`
- `src/modules/search-facts/normalizers/google-search-fact.normalizer.ts`
- `src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts`

Google: reuse persisted GSC normalized query/canonical page verbatim; map clicks, impressions, CTR, and GSC position to explicit semantics.

Bing: map `QUERY_STATS→QUERY`, `PAGE_STATS→PAGE`, `SITE_TRAFFIC_DAILY→SITE`; never fabricate query-page joins or CTR. Null Bing position fields become `numericValue=null` + `UNKNOWN` under their provider-specific semantics.

Verification:
```bash
npm run typecheck
npm test -- tests/unit/search-fact.google-normalizer.test.ts tests/unit/search-console.worker.test.ts
npm test -- tests/unit/search-fact.bing-normalizer.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

## Task 4 — immutable idempotent materialization

Create:
- `tests/integration/search-fact.materializer.test.ts`
- `src/modules/search-facts/search-fact.repository.ts`
- `src/modules/search-facts/search-fact.materializer.ts`

GSC source must be completed and match project/property identity. Bing source batch must match provider/project/market/locale/property identity. Snapshot hashes use stable source identity + ordered normalized drafts, never `now()`. Writes are transactional. `KNOWN_PRESENT` requires finite non-negative numeric value; all non-present evidence states require `numericValue=null`.

Repeated materialization of the same source/version returns the existing completed snapshot. A new normalization version creates a new immutable snapshot.

Verification:
```bash
npm run typecheck
npm test -- tests/integration/search-fact.materializer.test.ts tests/integration/search-provider-source.repository.test.ts
```

## Task 5 — provider-aware read contract for P9-0G

Create:
- `tests/integration/search-fact.repository.test.ts`

Modify:
- `src/modules/search-facts/search-fact.types.ts`
- `src/modules/search-facts/search-fact.repository.ts`

Expose completed facts filtered by project/provider/market/locale/property/fact kind/metric semantic/canonical page/normalized query/source date range. Returned views retain provider, market, locale, property, source kind/ref, source observation ref, cutoff, completeness, normalization version, and full metric set.

Verification includes unchanged P7 regressions:
```bash
npm run typecheck
npm test -- tests/integration/search-fact.repository.test.ts tests/unit/growth.score.test.ts tests/unit/growth.evidence.test.ts
```

## Task 6 — documentation and exact-head release gate

Create `docs/development/p9-0f-unified-search-facts.md` documenting authority boundaries, mappings, semantic/evidence/completeness rules, nullable metric rule, provenance, immutable versioning, separation from AI visibility, unchanged P7, additive rollback guidance, and P9-0G handoff.

Focused verification:
```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- \
  tests/unit/search-fact.contract.test.ts \
  tests/unit/search-fact.google-normalizer.test.ts \
  tests/unit/search-fact.bing-normalizer.test.ts \
  tests/integration/search-provider-source.repository.test.ts \
  tests/integration/search-fact.materializer.test.ts \
  tests/integration/search-fact.repository.test.ts \
  tests/unit/search-console.worker.test.ts \
  tests/unit/bing-search-provider.adapter.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
npm run build
```

Final exact-head GitHub Actions must show:
```text
verify             success
production-audit   success
e2e                success
```

Release review must confirm: no P7 formula changes, no AI-visibility migration, no GSC deletion/rewrite, no generic `POSITION`, no unknown→zero conversion, no secret-bearing payload persistence, no cross-provider scoring/dedup, additive migration only. Mark Draft → Ready only after exact-head green. Human approval remains required for merge.
