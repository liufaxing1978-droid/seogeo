# P9-0G P7 Multi-Provider Growth Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task with review checkpoints.

**Goal:** Upgrade P7 Growth search-performance ingestion to consume P9-0F unified search facts for configured-market projects while preserving historical no-market GSC behavior, keeping `GROWTH_SCORE_V1` numerically unchanged, and attaching bounded multi-provider provenance without cross-provider score fusion.

**Architecture:** Introduce a focused `growth-search-source.adapter.ts` authority-lane boundary. The adapter selects either `CONFIGURED_MARKET` or `UNCONFIGURED_LEGACY`, materializes configured GSC snapshots through the existing P9-0F `SearchFactMaterializer`, validates/deduplicates exact Google query-page facts for the existing P7 scoring contract, reads Bing facts only as corroborating provenance, and returns `QueryPageFactLike[]` plus versioned provenance to `growth.service.ts`. P7 score math, opportunity identities, lifecycle, detectors, topic clustering, and UNKNOWN rules stay untouched.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Prisma 6.14/PostgreSQL, Vitest 3.2, existing P7 Growth modules, P9-0F SearchFact repository/materializer, GitHub Actions (`verify`, `production-audit`, `e2e`).

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0g-p7-multi-provider-growth-adapter-design.md`

## Global Constraints

- Branch: `feat/p9-0g-growth-adapter`, forked from `main@608f8d7de7e8744a5f609de5ca80600dc302e25b`.
- Do not modify `src/modules/growth/growth-score.ts`, its weights, thresholds, formula version, or UNKNOWN normalization.
- Do not add provider/market to `GrowthOpportunityIdentity` or rewrite historical Growth records.
- Do not synthesize Bing `QUERY_PAGE`, CTR, or Google position.
- Do not sum/average metrics across providers.
- `UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` never become zero.
- Never introduce generic `POSITION`; preserve `GOOGLE_SEARCH_CONSOLE_POSITION`, `BING_AVG_CLICK_POSITION`, and `BING_AVG_IMPRESSION_POSITION` separately.
- Configured-market mode must never fall back to raw GSC after unified materialization/read/validation failure.
- Legacy raw-GSC compatibility is allowed only when there are zero enabled `ProjectMarket` rows and must record `UNCONFIGURED_LEGACY` without inventing market/locale.
- A downstream SearchFact failure must never change authoritative raw GSC snapshot status.
- Do not call external search APIs, AI providers, or credential vaults from the adapter.
- Prefer existing JSON `sourceProvenance`; no Prisma migration is expected.
- Each behavior change follows test-only RED commit → observed exact-head CI failure → minimal GREEN commit → exact-head CI green.
- Final readiness requires exact final head `verify`, `production-audit`, and `e2e` success plus release diff review. Do not merge automatically.

## File Structure

New production file:
- `src/modules/growth/growth-search-source.adapter.ts` — source-mode selection, GSC handoff, unified Google scoring validation/dedupe, Bing corroborating summaries, versioned provenance.

Possible focused type extension:
- `src/modules/growth/growth.types.ts` — only if shared public adapter types improve clarity; keep `QueryPageFactLike` unchanged.

Modified integration point:
- `src/modules/growth/growth.service.ts` — replace direct selected-window `gscQueryPageFact.findMany()` read with adapter output; attach `searchFacts` provenance. Do not change downstream scoring/detector logic.

New tests:
- `tests/unit/growth-search-source.adapter.test.ts`
- `tests/integration/growth-search-source.handoff.test.ts`
- `tests/integration/growth-search-source.bing.test.ts`
- `tests/integration/growth.multi-provider-materialization.test.ts`

Existing regression tests to preserve:
- `tests/integration/growth.materialization.test.ts`
- `tests/integration/growth.special-materialization.test.ts`
- `tests/integration/growth.new-content-materialization.test.ts`
- `tests/integration/growth.lifecycle.test.ts`
- `tests/unit/growth.score.test.ts`
- `tests/unit/growth.evidence.test.ts`

Documentation:
- `docs/development/p9-0g-p7-multi-provider-growth-adapter.md`

---

## Task 1 — Pure authority-lane adapter contract

**Files**
- Create: `tests/unit/growth-search-source.adapter.test.ts`
- Create: `src/modules/growth/growth-search-source.adapter.ts`
- Modify only if necessary: `src/modules/growth/growth.types.ts`

### Step 1: Write the RED contract test

The test imports the not-yet-created adapter module and locks these public constants/types/behaviors:

```ts
import { describe, expect, it } from 'vitest';
import {
  GROWTH_SEARCH_PROVENANCE_VERSION,
  adaptGoogleScoringFacts
} from '../../src/modules/growth/growth-search-source.adapter.js';
import type { SearchFactView } from '../../src/modules/search-facts/search-fact.types.js';

const metric = (
  metricSemantic: SearchFactView['metrics'][number]['metricSemantic'],
  numericValue: number | null,
  evidenceState: SearchFactView['metrics'][number]['evidenceState'] = 'KNOWN_PRESENT'
) => ({ metricSemantic, numericValue, evidenceState, sourceField: metricSemantic });

const googleFact = (overrides: Partial<SearchFactView> = {}): SearchFactView => ({
  snapshotId: 'normalized-global',
  projectId: 'project-1',
  provider: 'GOOGLE_SEARCH_CONSOLE',
  marketCode: 'GLOBAL',
  locale: 'zh-CN',
  propertyRef: 'sc-domain:example.com',
  propertyType: 'DOMAIN',
  sourceKind: 'GSC_DAILY_SNAPSHOT',
  sourceRef: 'gsc-snapshot-1',
  sourceObservationRef: 'gsc-fact-1',
  sourceCutoffAt: new Date('2026-08-01T00:00:00.000Z'),
  sourceCompleteness: 'TOP_ROWS_ONLY',
  normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
  factKey: 'q-page-1',
  factKind: 'QUERY_PAGE',
  sourceDate: new Date('2026-07-31T00:00:00.000Z'),
  query: '六壬',
  normalizedQuery: '六壬',
  queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
  page: 'https://example.com/guide',
  canonicalPage: 'https://example.com/guide',
  canonicalizationVersion: 'GSC_PERSISTED_CANONICAL_PAGE_V1',
  metrics: [
    metric('CLICKS', 2),
    metric('IMPRESSIONS', 20),
    metric('CTR', 0.1),
    metric('GOOGLE_SEARCH_CONSOLE_POSITION', 8)
  ],
  ...overrides
});
```

Required assertions:

1. `GROWTH_SEARCH_PROVENANCE_VERSION === 'GROWTH_SEARCH_PROVENANCE_V1'`.
2. Exact valid Google `QUERY_PAGE` maps to:
   ```ts
   {
     date: new Date('2026-07-31T00:00:00.000Z'),
     normalizedQuery: '六壬',
     canonicalPage: 'https://example.com/guide',
     clicks: 2,
     impressions: 20,
     ctr: 0.1,
     position: 8
   }
   ```
3. Bing provider input is rejected from Google scoring adaptation.
4. Missing `CTR` throws `GROWTH_SEARCH_SCORING_METRIC_MISSING`.
5. `GOOGLE_SEARCH_CONSOLE_POSITION` with `UNKNOWN + null` throws `GROWTH_SEARCH_SCORING_METRIC_UNKNOWN`; it must not produce `position: 0`.
6. Extra provider-specific Bing position does not replace missing Google position.
7. Two projections with the same `sourceObservationRef`, source date, and source fact identity plus identical query/page/metrics score once.
8. If those same raw-observation duplicates disagree on any scoring metric, query/page, source date, or normalization identity, throw `GROWTH_SEARCH_SOURCE_CONFLICT`.
9. A fact whose `sourceRef` is not in the selected GSC snapshot set throws `GROWTH_SEARCH_SOURCE_MISMATCH` rather than being silently ignored.

### Step 2: Run the RED test

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts
npm run typecheck
```

Expected RED: TypeScript/Vitest cannot resolve `growth-search-source.adapter.js` or exported contract members because the module does not exist yet.

Commit test only:

```text
test: define P9-0G growth search source contract
```

Push and record the pull-request workflow failure for the exact test-only head before writing production code.

### Step 3: Implement the minimum pure adapter primitives

Create `src/modules/growth/growth-search-source.adapter.ts` with:

```ts
import type { MarketCode, PrismaClient } from '@prisma/client';
import type {
  SearchFactCompleteness,
  SearchFactKind,
  SearchFactProviderCode,
  SearchFactView
} from '../search-facts/search-fact.types.js';
import type { QueryPageFactLike } from './growth.types.js';

export const GROWTH_SEARCH_PROVENANCE_VERSION = 'GROWTH_SEARCH_PROVENANCE_V1' as const;
export type GrowthSearchSourceMode = 'CONFIGURED_MARKET' | 'UNCONFIGURED_LEGACY';

export type GrowthSearchMarketProjection = {
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
};

export type GrowthSearchCorroboratingLane = {
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  factKinds: SearchFactKind[];
  snapshotIds: string[];
  sourceCompleteness: SearchFactCompleteness[];
};

export type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};
```

Implement `adaptGoogleScoringFacts(facts, selectedGscSnapshotIds)` as a pure exported helper. Require provider/fact kind/source kind, exact selected source refs, non-empty normalized query/canonical page, exact four required semantics, `KNOWN_PRESENT`, finite non-negative clicks/impressions/position, CTR within `[0,1]`, and deterministic duplicate validation.

Use a stable raw-scoring identity such as:

```ts
JSON.stringify([
  fact.sourceObservationRef,
  fact.sourceDate.toISOString(),
  fact.factKey
])
```

Canonicalize a candidate for duplicate equality using the source date, normalized query, canonical page, query/canonicalization versions, and sorted four scoring metrics. Multiple market projections with identical canonical candidates return one `QueryPageFactLike`.

Do not accept Bing facts in this helper.

### Step 4: Run GREEN verification

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts
npm run typecheck
```

Expected: both pass; existing scoring file remains untouched.

Commit:

```text
feat: add P9-0G growth search source contract
```

Push and require exact-head `verify`, `production-audit`, and `e2e` green before Task 2.

---

## Task 2 — Source mode and configured GSC unified handoff

**Files**
- Create: `tests/integration/growth-search-source.handoff.test.ts`
- Modify: `src/modules/growth/growth-search-source.adapter.ts`

### Step 1: Write RED integration tests

Use Prisma fixtures with one project, GSC connection/property, selected completed GSC snapshots/facts, and source dates in the requested window. Configured-mode snapshots must include `sourceFreshness: date` because the existing `SearchFactMaterializer` requires it.

Construct the adapter as:

```ts
const adapter = new GrowthSearchSourceAdapter(prisma);
const result = await adapter.load({
  projectId,
  propertyId,
  selectedGscSnapshotIds,
  sourceDateFrom,
  sourceDateTo
});
```

Lock these cases:

1. **Legacy mode:** zero enabled `ProjectMarket` rows returns `UNCONFIGURED_LEGACY`, reads only raw selected GSC query-page facts, creates zero `SearchFactSnapshot` rows, and returns empty corroborating lanes.
2. **One configured market:** an enabled `GLOBAL/zh-CN` row selects `CONFIGURED_MARKET`, materializes every selected raw GSC snapshot with `SEARCH_FACT_NORMALIZATION_V1`, reads scoring through `SearchFactRepository.listCompletedFacts`, and returns the same numeric `QueryPageFactLike` values.
3. **Multi-market projection:** `GLOBAL/zh-CN` + `HK/zh-Hant` create two normalized projections per raw GSC snapshot but scoring facts are deduplicated to one raw observation each; both projections remain in provenance.
4. **Disabled market ignored:** disabled `ProjectMarket` does not select configured mode by itself and is never projected.
5. **Configured failure has no raw fallback:** inject a materializer dependency whose `materializeGoogleSnapshot()` throws `SEARCH_FACT_PERSISTENCE_CONFLICT`; adapter rejects. It must not return raw facts.
6. **Raw GSC status is unchanged:** after injected downstream failure, selected `GscDailySnapshot.status` remains `COMPLETED`.
7. **Project/property mismatch fails closed:** selected snapshot from another project/property throws `GROWTH_SEARCH_SOURCE_MISMATCH`.

For failure injection, extend constructor with bounded dependency overrides:

```ts
export type GrowthSearchSourceDeps = {
  materializer?: Pick<SearchFactMaterializer, 'materializeGoogleSnapshot'>;
  repository?: Pick<SearchFactRepository, 'listCompletedFacts'>;
};
```

Default to real P9-0F objects:

```ts
this.materializer = deps.materializer ?? new SearchFactMaterializer(db);
this.repository = deps.repository ?? new SearchFactRepository(db);
```

### Step 2: Run RED

```bash
npm test -- tests/integration/growth-search-source.handoff.test.ts
npm run typecheck
```

Expected RED: `GrowthSearchSourceAdapter`/`load()` is missing.

Commit test only:

```text
test: define P9-0G GSC handoff behavior
```

Observe exact-head CI failure.

### Step 3: Implement minimum handoff

`GrowthSearchSourceAdapter.load()` must:

1. validate non-empty project/property IDs, valid date range, non-empty unique selected snapshot IDs;
2. load enabled `ProjectMarket` rows sorted by `marketCode`, `locale`, `id`;
3. load selected GSC snapshots constrained by exact project/property and verify every requested id is found and `COMPLETED`;
4. if enabled-market count is zero, query raw `gscQueryPageFact` for exact selected snapshot IDs and return `UNCONFIGURED_LEGACY` provenance;
5. otherwise materialize every `(selected snapshot × enabled market)` using:
   ```ts
   {
     snapshotId,
     marketCode,
     locale,
     normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
   }
   ```
6. read completed Google `QUERY_PAGE` facts for the project/window/property through `SearchFactRepository`, then restrict them to `sourceRef` in the selected raw GSC snapshot set;
7. call `adaptGoogleScoringFacts()`;
8. build configured scoring provenance from deterministic sorted unique normalized snapshot IDs, source refs, and market projections.

Do not catch a configured materialization conflict and do not issue a raw GSC query as fallback.

### Step 4: GREEN

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts tests/integration/growth-search-source.handoff.test.ts
npm run typecheck
```

Commit:

```text
feat: add configured and legacy Growth source handoff
```

Push; exact-head three-job CI must be green before Task 3.

---

## Task 3 — Bing corroborating provider lane

**Files**
- Create: `tests/integration/growth-search-source.bing.test.ts`
- Modify: `src/modules/growth/growth-search-source.adapter.ts`

### Step 1: Write RED tests

Fixture flow:

1. create configured project + `ProjectMarket(GLOBAL, zh-CN)`;
2. create and materialize selected GSC source using real P9-0F materializer;
3. persist Bing typed observations using `SearchProviderSourceRepository.persistBingBatch()`;
4. materialize Bing batch using `SearchFactMaterializer.materializeBingBatch()`;
5. call `GrowthSearchSourceAdapter.load()`.

Assertions:

- `scoringFacts` are byte-for-byte/deep-equal before and after Bing materialization;
- `provenance.corroboratingLanes` contains `BING_WEBMASTER / GLOBAL / zh-CN / propertyRef` with only `QUERY`, `PAGE`, `SITE` fact kinds actually present;
- bounded provenance carries snapshot IDs/completeness but not raw `payloadJson`, query collections, auth data, or metric bodies;
- `BING_AVG_CLICK_POSITION` and `BING_AVG_IMPRESSION_POSITION` never become scoring `position`;
- a Bing QUERY and Bing PAGE sharing query/page-looking values never create a `QUERY_PAGE` scoring fact;
- an `UNKNOWN + null` Bing position remains only source provenance and never zero;
- a Bing fact from another project or a configured market not enabled on this project is excluded;
- only completed normalized SearchFact snapshots contribute;
- overlapping corroborating logical facts use deterministic latest `sourceCutoffAt`, with snapshot/source reference tiebreakers, without deduping across providers.

### Step 2: RED

```bash
npm test -- tests/integration/growth-search-source.bing.test.ts
```

Expected RED: corroborating lanes are absent/empty because adapter does not yet load them.

Commit test only:

```text
test: define P9-0G Bing corroborating lane
```

Observe exact-head CI failure.

### Step 3: Implement minimum corroborating collector

In configured mode only, read completed SearchFacts over the same date window. Restrict corroborating facts to:

- provider not equal to `GOOGLE_SEARCH_CONSOLE` for V1 collector; initial expected provider is `BING_WEBMASTER`;
- marketCode/locale pair present in enabled `ProjectMarket` rows;
- `QUERY | PAGE | SITE` only for Bing;
- exact project.

Dedup logical identity:

```ts
JSON.stringify([
  provider,
  marketCode,
  locale,
  propertyRef,
  factKind,
  sourceDate.toISOString(),
  factKey
])
```

Choose greatest `sourceCutoffAt`; if equal use deterministic `snapshotId/sourceRef/sourceObservationRef` lexical tiebreak. Summarize by provider/market/locale/property with sorted unique factKinds, snapshotIds, and sourceCompleteness.

Do not copy `metrics` or source payloads into provenance.

### Step 4: GREEN

```bash
npm test -- \
  tests/unit/growth-search-source.adapter.test.ts \
  tests/integration/growth-search-source.handoff.test.ts \
  tests/integration/growth-search-source.bing.test.ts
npm run typecheck
```

Commit:

```text
feat: add Bing corroborating Growth provenance
```

Push and require exact-head three-job CI green.

---

## Task 4 — Integrate authority-lane adapter into P7 Growth materialization

**Files**
- Modify: `src/modules/growth/growth.service.ts`
- Modify: `tests/integration/growth.materialization.test.ts`
- Create: `tests/integration/growth.multi-provider-materialization.test.ts`

### Step 1: Extend the historical legacy test as RED

Keep the existing fixture with **no `ProjectMarket` rows** unchanged. Add only additive provenance assertions:

```ts
expect(snapshot.sourceProvenance).toMatchObject({
  gscSnapshotIds: expect.arrayContaining(selectedIds),
  searchFacts: {
    version: 'GROWTH_SEARCH_PROVENANCE_V1',
    mode: 'UNCONFIGURED_LEGACY',
    scoringLane: {
      provider: 'GOOGLE_SEARCH_CONSOLE',
      source: 'RAW_GSC_COMPATIBILITY',
      gscSnapshotIds: expect.arrayContaining(selectedIds)
    },
    corroboratingLanes: []
  }
});
```

Do not add `sourceFreshness` or ProjectMarket to this legacy fixture; it exists specifically to prove pre-P9 historical compatibility.

Expected RED: existing `growth.service.ts` does not attach `searchFacts` provenance.

Commit this test-only change and observe exact-head CI failure.

### Step 2: Add configured parity RED test

Create `tests/integration/growth.multi-provider-materialization.test.ts` using the same 56-day query-page shape as `growth.materialization.test.ts`, but:

- every GSC snapshot has `sourceFreshness: date`;
- project has `ProjectMarket { GLOBAL, zh-CN, enabled: true }`;
- optionally persist/materialize a Bing batch in the same current window.

Run the configured fixture first without Bing, capture persisted opportunity snapshot + breakdown + topic snapshot values, then in a separate equivalent project fixture add Bing and assert the same numeric expectations.

Lock known historical behavior from the fixture rather than comparing two code paths at runtime:

- `formulaVersion = GROWTH_SCORE_V1`;
- one `RANKING_UPSIDE` query-page opportunity;
- normalized query and canonical page unchanged;
- aggregate current impressions/clicks/CTR/position equal the legacy fixture mathematics;
- score breakdown component values, score, priority, evidence coverage/quality, ranking eligibility match the pre-0G fixture expectations;
- configured provenance mode is `CONFIGURED_MARKET`;
- Bing-equipped fixture has a Bing corroborating lane but identical numeric snapshot/breakdown/topic values.

### Step 3: Implement minimal service integration

In `growth.service.ts` import and construct the adapter using the existing shared Prisma client:

```ts
import { GrowthSearchSourceAdapter } from './growth-search-source.adapter.js';

const growthSearchSourceAdapter = new GrowthSearchSourceAdapter(prisma);
```

After stable-window coverage succeeds, replace only the direct raw fact read:

```ts
const searchSource = await growthSearchSourceAdapter.load({
  projectId,
  propertyId: property.id,
  selectedGscSnapshotIds,
  sourceDateFrom: windowStart,
  sourceDateTo: windowEnd
});
const facts = searchSource.scoringFacts;
```

Keep this downstream code unchanged:

```ts
const currentFacts = facts.filter(...);
const previousFacts = facts.filter(...);
const currentAggregates = aggregateQueryPageFacts(currentFacts)...;
```

Extend the existing provenance object only:

```ts
const provenance = {
  materializationVersion: GROWTH_MATERIALIZATION_VERSION,
  evidenceVersion: GROWTH_EVIDENCE_VERSION,
  gscSnapshotIds: selectedGscSnapshotIds,
  searchFacts: searchSource.provenance
};
```

Do not rename `gscTrend`, version the score formula, change opportunity identity, or modify detector inputs.

### Step 4: GREEN

```bash
npm test -- \
  tests/integration/growth.materialization.test.ts \
  tests/integration/growth.multi-provider-materialization.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
npm run typecheck
```

Commit:

```text
feat: route P7 Growth through unified search facts
```

Push and require exact-head CI green.

---

## Task 5 — Special opportunity, topic, lifecycle, and no-synthetic-provider regressions

**Files**
- Prefer no production changes.
- Modify/add focused assertions only if a regression is not already covered by existing tests.

### Step 1: Run preserved P7 behavior tests

```bash
npm test -- \
  tests/integration/growth.special-materialization.test.ts \
  tests/integration/growth.new-content-materialization.test.ts \
  tests/integration/growth.lifecycle.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
```

These existing fixtures have no `ProjectMarket` and therefore must remain in `UNCONFIGURED_LEGACY` behavior without requiring fixture rewrites.

Expected GREEN. If a behavior fails, use `superpowers:systematic-debugging` before changing implementation; do not alter legacy fixtures merely to force configured mode.

### Step 2: Add one focused configured-mode regression only if needed

If Task 4 configured test does not already exercise special rollups, add a configured-market test proving that:

- multi-market GSC projections do not double query impressions used by cannibalization;
- Bing query/page facts do not increase query demand or create a special query-page candidate;
- topic total impressions/clicks/CTR/position come only from deduplicated Google scoring facts.

The expected numeric totals must match a single raw GSC source, not the number of market projections.

### Step 3: Verification and commit

```bash
npm test -- \
  tests/integration/growth.special-materialization.test.ts \
  tests/integration/growth.new-content-materialization.test.ts \
  tests/integration/growth.lifecycle.test.ts \
  tests/integration/growth.multi-provider-materialization.test.ts
```

If a test file was added/changed, commit:

```text
test: lock P7 multi-provider regression boundaries
```

Push; exact-head three-job CI must remain green.

---

## Task 6 — Development documentation and full regression

**Files**
- Create: `docs/development/p9-0g-p7-multi-provider-growth-adapter.md`

Document:

- P7 remains score/identity/lifecycle authority;
- P9-0F remains normalized search-fact authority;
- configured vs `UNCONFIGURED_LEGACY` selection;
- configured GSC handoff through `SearchFactMaterializer`;
- no raw fallback after configured failure;
- legacy path never invents market/locale;
- Google scoring semantic allowlist;
- multi-market raw-observation dedupe and conflict fail-closed behavior;
- Bing corroborating-only role and bounded provenance;
- UNKNOWN/null handling;
- source-provenance version `GROWTH_SEARCH_PROVENANCE_V1`;
- no credentials/external calls/AI reconciliation;
- rollback: remove service adapter integration to restore pre-0G code only before new configured-mode snapshots are relied upon; never delete/rewrite historical SearchFact/Growth data;
- no Prisma migration required.

### Focused verification

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- \
  tests/unit/growth-search-source.adapter.test.ts \
  tests/integration/growth-search-source.handoff.test.ts \
  tests/integration/growth-search-source.bing.test.ts \
  tests/integration/growth.materialization.test.ts \
  tests/integration/growth.multi-provider-materialization.test.ts \
  tests/integration/growth.special-materialization.test.ts \
  tests/integration/growth.new-content-materialization.test.ts \
  tests/integration/growth.lifecycle.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts \
  tests/integration/search-fact.materializer.test.ts \
  tests/integration/search-fact.repository.test.ts
npm run build
```

Then full regression:

```bash
npm test
npm run build
```

Commit:

```text
docs: document P9-0G growth adapter
```

Push and confirm exact-head CI.

---

## Task 7 — Draft PR release gate and Ready transition

### Step 1: PR lifecycle

Create or keep one Draft PR:

- title: `P9-0G: add multi-provider Growth adapter`
- base: `main`
- head: `feat/p9-0g-growth-adapter`

PR body must summarize authority lanes, legacy compatibility, configured no-fallback, Bing corroborating-only behavior, and explicit unchanged P7 formula boundaries.

### Step 2: Exact-head verification

On the final PR head, fetch the pull-request-triggered workflow run and require:

```text
verify             success
production-audit   success
e2e                success
```

Inside `verify`, confirm fresh success for:

- Prisma validate
- Prisma generate
- Prisma migrate deploy
- Typecheck
- full Vitest suite
- Build

Do not use an earlier head's CI as release evidence.

### Step 3: Mandatory review skills

Before claiming completion, read/use:

- `superpowers:verification-before-completion`
- `superpowers:requesting-code-review`

Perform full diff review against `main@608f8d7de7e8744a5f609de5ca80600dc302e25b` and explicitly verify:

- `src/modules/growth/growth-score.ts` unchanged;
- no `GROWTH_SCORE_V1` weight/threshold/formula changes;
- no Growth opportunity identity key change;
- no historical snapshot/lifecycle/topic rewrite/backfill;
- no Growth/SearchFact destructive Prisma migration;
- no generic `POSITION` semantic;
- no UNKNOWN/empty/not-supported → zero conversion;
- no cross-provider numeric summation/average/max used as P7 score input;
- no synthetic Bing query-page join or CTR;
- Bing position semantics never feed Google position scoring;
- no AI source reconciliation;
- Growth adapter does not access provider credentials or external APIs;
- legacy mode invents no market/locale;
- configured mode never falls back to raw GSC after unified failure;
- downstream failure never changes raw GSC `COMPLETED` authority;
- cross-project facts cannot enter scoring or provenance;
- corroborating provenance is bounded and contains no raw provider payload bodies.

### Step 4: Final PR metadata

Update PR body with:

- exact final head SHA;
- exact workflow run number/id;
- `verify / production-audit / e2e` success;
- focused test summary;
- release-review checklist result.

Only then transition Draft → Ready.

**Do not merge.** Stop at Ready and wait for separate explicit human `合并` authorization.

## Definition of Done

P9-0G is done only when all of the following are true:

- configured-market Growth search ingestion reads scoring data from P9-0F unified facts;
- zero-enabled-market historical projects retain explicit `UNCONFIGURED_LEGACY` raw-GSC parity;
- same GSC source projected to multiple markets scores once;
- contradictory projections fail closed;
- Bing is visible in bounded corroborating provenance but cannot mutate V1 numeric scores;
- no synthetic provider facts are created;
- existing P7 opportunity identities, lifecycle, topic logic, score formula, and UNKNOWN behavior remain unchanged;
- final exact-head `verify`, `production-audit`, and `e2e` are green;
- release diff review has no blocker;
- PR is Ready, not merged, awaiting explicit human merge authorization.
