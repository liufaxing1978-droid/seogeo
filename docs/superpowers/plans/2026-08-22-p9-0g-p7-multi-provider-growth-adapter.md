# P9-0G P7 Multi-Provider Growth Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task with review checkpoints.

**Goal:** Make P7 Growth consume P9-0F unified search facts for configured-market projects while preserving historical no-market GSC behavior, `GROWTH_SCORE_V1`, existing opportunity identities/lifecycle/topic logic, and UNKNOWN semantics.

**Architecture:** Add one authority-lane adapter between stable-window selection and P7 aggregation. `CONFIGURED_MARKET` mode materializes/reads exact Google query-page SearchFacts for scoring and reads Bing only as bounded corroborating provenance. `UNCONFIGURED_LEGACY` mode exists only when there are zero enabled `ProjectMarket` rows and keeps the historical raw-GSC read without inventing a market/locale. The adapter never performs scoring or opportunity detection.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Prisma 6.14/PostgreSQL, Vitest 3.2, existing P7 Growth modules, existing P9-0F `SearchFactMaterializer`/`SearchFactRepository`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0g-p7-multi-provider-growth-adapter-design.md`

## Global Constraints

- Branch: `feat/p9-0g-growth-adapter`, base `main@608f8d7de7e8744a5f609de5ca80600dc302e25b`.
- Do not modify `src/modules/growth/growth-score.ts`, `GROWTH_SCORE_V1`, weights, thresholds, ranking eligibility, or evidence-quality math.
- Do not add provider/market to `GrowthOpportunityIdentity` or rewrite historical Growth snapshots/lifecycle/topic rows.
- Do not synthesize Bing `QUERY_PAGE`, CTR, or Google position.
- Do not combine numeric metrics across providers.
- `UNKNOWN`, `KNOWN_EMPTY`, `NOT_SUPPORTED` never become zero.
- No generic `POSITION`; provider-specific position semantics remain distinct.
- Once configured-market mode is selected, unified materialization/read/validation failures fail closed; no raw-GSC fallback.
- Legacy raw-GSC mode is allowed only when zero enabled `ProjectMarket` rows exist; it records `UNCONFIGURED_LEGACY` and invents no market/locale.
- Downstream SearchFact failures never mutate authoritative raw GSC snapshot status.
- Adapter makes no external provider/AI calls and accesses no credentials.
- No Prisma migration is expected; additive JSON `sourceProvenance` is sufficient.
- Every behavior uses test-only RED commit → observed exact-head CI failure → minimal GREEN → exact-head CI green.
- Final Ready requires exact final head `verify`, `production-audit`, `e2e` success and release review. Never auto-merge.

## Planned Code Surface

Create:
- `src/modules/growth/growth-search-source.adapter.ts`
- `tests/unit/growth-search-source.adapter.test.ts`
- `tests/integration/growth-search-source.handoff.test.ts`
- `tests/integration/growth-search-source.bing.test.ts`
- `tests/integration/growth.multi-provider-materialization.test.ts`
- `docs/development/p9-0g-p7-multi-provider-growth-adapter.md`

Modify:
- `src/modules/growth/growth.service.ts`
- `tests/integration/growth.materialization.test.ts` only to assert additive legacy provenance.

Do not modify `growth.types.ts`; adapter-local types reference the existing unchanged `QueryPageFactLike`.

---

## Task 1 — Pure authority-lane scoring contract

**Files**
- Create `tests/unit/growth-search-source.adapter.test.ts`
- Create `src/modules/growth/growth-search-source.adapter.ts`

### RED

Create a unit fixture of `SearchFactView` and import:

```ts
import {
  GROWTH_SEARCH_PROVENANCE_VERSION,
  adaptGoogleScoringFacts
} from '../../src/modules/growth/growth-search-source.adapter.js';
```

Lock all of these behaviors:

1. provenance version is `GROWTH_SEARCH_PROVENANCE_V1`;
2. valid `GOOGLE_SEARCH_CONSOLE + QUERY_PAGE + GSC_DAILY_SNAPSHOT` maps exact `CLICKS`, `IMPRESSIONS`, `CTR`, `GOOGLE_SEARCH_CONSOLE_POSITION` to the unchanged `QueryPageFactLike`;
3. Bing input is rejected from Google scoring adaptation;
4. missing required metric throws `GROWTH_SEARCH_SCORING_METRIC_MISSING`;
5. required metric with non-`KNOWN_PRESENT` evidence throws `GROWTH_SEARCH_SCORING_METRIC_UNKNOWN` and never returns zero;
6. Bing position cannot substitute for missing Google position;
7. identical multi-market projections of one raw observation score once;
8. divergent projections of the same raw observation throw `GROWTH_SEARCH_SOURCE_CONFLICT`;
9. a `sourceRef` outside the selected authoritative GSC snapshot set throws `GROWTH_SEARCH_SOURCE_MISMATCH`.

Use raw-scoring identity:

```ts
JSON.stringify([
  fact.sourceObservationRef,
  fact.sourceDate.toISOString(),
  fact.factKey
])
```

Run:

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts
npm run typecheck
```

Expected RED: module/export missing.

Commit test only:
`test: define P9-0G growth search source contract`

Push and record the exact-head PR CI failure before production code.

### GREEN

Create `growth-search-source.adapter.ts` with these exact public types:

```ts
import type { MarketCode, PrismaClient } from '@prisma/client';
import type {
  SearchFactCompleteness,
  SearchFactKind,
  SearchFactProviderCode,
  SearchFactView
} from '../search-facts/search-fact.types.js';
import type { QueryPageFactLike } from './growth.types.js';

export const GROWTH_SEARCH_PROVENANCE_VERSION =
  'GROWTH_SEARCH_PROVENANCE_V1' as const;

export type GrowthSearchSourceMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY';

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

export type GrowthSearchConfiguredProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'CONFIGURED_MARKET';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    factKind: 'QUERY_PAGE';
    snapshotIds: string[];
    sourceRefs: string[];
    marketProjections: GrowthSearchMarketProjection[];
  };
  corroboratingLanes: GrowthSearchCorroboratingLane[];
};

export type GrowthSearchLegacyProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'UNCONFIGURED_LEGACY';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    source: 'RAW_GSC_COMPATIBILITY';
    gscSnapshotIds: string[];
  };
  corroboratingLanes: [];
};

export type GrowthSearchProvenanceV1 =
  | GrowthSearchConfiguredProvenance
  | GrowthSearchLegacyProvenance;

export type GrowthSearchSourceInput = {
  projectId: string;
  propertyId: string;
  selectedGscSnapshotIds: readonly string[];
  sourceDateFrom: Date;
  sourceDateTo: Date;
};

export type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};
```

Implement exported pure:

```ts
export function adaptGoogleScoringFacts(
  facts: readonly SearchFactView[],
  selectedGscSnapshotIds: ReadonlySet<string>
): QueryPageFactLike[]
```

Require exact provider/fact/source kinds, selected source refs, non-empty normalized query/canonical page, exactly one of each required scoring semantic, valid finite values, CTR `[0,1]`, non-negative clicks/impressions/position. Duplicate equality includes source date, normalized query/page, query/canonicalization versions, and sorted required metric tuples. Identical projections retain one scoring row; contradiction fails closed.

Run:

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts
npm run typecheck
```

Commit:
`feat: add P9-0G growth search source contract`

Require exact-head three-job CI green.

---

## Task 2 — Source mode and configured GSC handoff

**Files**
- Create `tests/integration/growth-search-source.handoff.test.ts`
- Modify `src/modules/growth/growth-search-source.adapter.ts`

### RED

Use real Prisma fixtures. Configured GSC snapshots include `sourceFreshness: date`; legacy fixtures deliberately may omit it because legacy must not invoke P9-0F materialization.

Lock:

1. zero enabled `ProjectMarket` → `UNCONFIGURED_LEGACY`, raw selected GSC facts only, zero SearchFact snapshots, no corroborating lanes;
2. one enabled `GLOBAL/zh-CN` → `CONFIGURED_MARKET`, every selected snapshot materialized with `SEARCH_FACT_NORMALIZATION_V1`, scoring facts read through SearchFact repository;
3. two enabled markets → two normalized projections per raw GSC snapshot but one scoring row per raw observation; both projections in provenance;
4. disabled market alone does not enable configured mode;
5. injected configured materializer conflict rejects and never falls back raw;
6. raw selected GSC snapshot remains `COMPLETED` after downstream failure;
7. project/property/source-window mismatch fails `GROWTH_SEARCH_SOURCE_MISMATCH`.

Constructor dependency boundary:

```ts
export type GrowthSearchSourceDeps = {
  materializer?: Pick<SearchFactMaterializer, 'materializeGoogleSnapshot'>;
  repository?: Pick<SearchFactRepository, 'listCompletedFacts'>;
};

export class GrowthSearchSourceAdapter {
  constructor(private readonly db: PrismaClient, deps: GrowthSearchSourceDeps = {})
  async load(input: GrowthSearchSourceInput): Promise<GrowthSearchSourceResult>
}
```

Run:

```bash
npm test -- tests/integration/growth-search-source.handoff.test.ts
npm run typecheck
```

Expected RED: `GrowthSearchSourceAdapter/load` missing.

Commit test only:
`test: define P9-0G GSC handoff behavior`

Observe exact-head RED CI.

### GREEN

`load()` algorithm:

1. validate project/property ids, ordered valid date range, non-empty unique selected snapshot ids;
2. query enabled `ProjectMarket` sorted by `marketCode`, `locale`, `id`;
3. load requested GSC snapshots constrained to exact project/property and verify all requested ids are present and completed;
4. no enabled market: query `gscQueryPageFact` by exact selected ids/project and map existing persisted normalized query/page/clicks/impressions/ctr/position to `QueryPageFactLike`; return explicit legacy provenance;
5. configured: materialize every selected snapshot × enabled market using existing `SearchFactMaterializer.materializeGoogleSnapshot({snapshotId, marketCode, locale, normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION})`;
6. read completed Google QUERY_PAGE SearchFacts over exact project/window/property through existing `SearchFactRepository.listCompletedFacts`;
7. reject any scoring candidate not linked to selected GSC refs, then call `adaptGoogleScoringFacts`;
8. return sorted unique configured snapshot ids/source refs/projections.

Default dependencies are actual `SearchFactMaterializer(db)` and `SearchFactRepository(db)`. Do not catch configured conflicts to raw fallback.

Run:

```bash
npm test -- tests/unit/growth-search-source.adapter.test.ts tests/integration/growth-search-source.handoff.test.ts
npm run typecheck
```

Commit:
`feat: add configured and legacy Growth source handoff`

Require exact-head three-job CI green.

---

## Task 3 — Bing corroborating lane

**Files**
- Create `tests/integration/growth-search-source.bing.test.ts`
- Modify `src/modules/growth/growth-search-source.adapter.ts`

### RED

Configured fixture:
- real ProjectMarket;
- real GSC source/materialization;
- real `SearchProviderSourceRepository.persistBingBatch`;
- real `SearchFactMaterializer.materializeBingBatch`.

Lock:

1. adding Bing does not change `scoringFacts`;
2. provenance contains bounded `BING_WEBMASTER` lane for enabled matching market/locale/property and only actual `QUERY/PAGE/SITE` kinds;
3. provenance contains snapshot ids/completeness only, not metrics/payload bodies/query collections/credentials;
4. Bing positions never enter scoring `position`;
5. Bing QUERY + PAGE never synthesize QUERY_PAGE;
6. UNKNOWN Bing position remains nonnumeric and never zero;
7. other-project or disabled-market facts excluded;
8. RUNNING/incomplete SearchFact snapshots excluded by repository contract;
9. overlapping corroborating logical facts select latest `sourceCutoffAt`, deterministic ref tiebreak, never dedupe across providers.

Corroborating logical identity:

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

Run:

```bash
npm test -- tests/integration/growth-search-source.bing.test.ts
```

Expected RED: corroborating lanes absent.

Commit test only:
`test: define P9-0G Bing corroborating lane`

Observe exact-head RED CI.

### GREEN

In configured mode, read completed facts in the same project/window; retain only provider facts whose `(marketCode, locale)` is enabled. For Bing, permit provenance kinds `QUERY`, `PAGE`, `SITE` only. Deduplicate by the identity above, choosing greatest cutoff, then lexical snapshot/source/sourceObservation refs. Summarize sorted unique `factKinds`, `snapshotIds`, `sourceCompleteness`. Never copy metrics or raw provider payloads into Growth provenance.

Run:

```bash
npm test -- \
  tests/unit/growth-search-source.adapter.test.ts \
  tests/integration/growth-search-source.handoff.test.ts \
  tests/integration/growth-search-source.bing.test.ts
npm run typecheck
```

Commit:
`feat: add Bing corroborating Growth provenance`

Require exact-head three-job CI green.

---

## Task 4 — Integrate adapter into Growth service and prove score parity

**Files**
- Modify `src/modules/growth/growth.service.ts`
- Modify `tests/integration/growth.materialization.test.ts`
- Create `tests/integration/growth.multi-provider-materialization.test.ts`

### RED A — historical legacy provenance

Keep existing `growth.materialization.test.ts` fixture unchanged: no ProjectMarket and no requirement to add `sourceFreshness`. Add assertion:

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

Expected RED: service does not yet use adapter/add provenance.

Commit test only and observe exact-head RED CI.

### RED B — configured parity and Bing non-mutation

Create `growth.multi-provider-materialization.test.ts` with 56-day source equivalent to legacy fixture, but each GSC snapshot has `sourceFreshness: date` and project has enabled `GLOBAL/zh-CN`.

Lock fixed expected P7 outputs from the existing fixture: one `RANKING_UPSIDE`, `GROWTH_OPPORTUNITY_V1`, `GROWTH_SCORE_V1`, same normalized query/page, same breakdown/score/priority/evidence coverage/quality/ranking eligibility and same topic totals as one raw GSC data set. Create an equivalent configured fixture with Bing SearchFacts and assert all numeric Growth outputs equal the GSC-only configured fixture while only corroborating provenance differs.

### GREEN

In `growth.service.ts`, after existing stable-window coverage succeeds:

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

Remove only the direct selected-window `prisma.gscQueryPageFact.findMany` block. Leave current/previous filtering, aggregation, percentiles, CTR curve, scoring, detectors, lifecycle, and topics unchanged.

Extend provenance only:

```ts
const provenance = {
  materializationVersion: GROWTH_MATERIALIZATION_VERSION,
  evidenceVersion: GROWTH_EVIDENCE_VERSION,
  gscSnapshotIds: selectedGscSnapshotIds,
  searchFacts: searchSource.provenance
};
```

Run:

```bash
npm test -- \
  tests/integration/growth.materialization.test.ts \
  tests/integration/growth.multi-provider-materialization.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
npm run typecheck
```

Commit:
`feat: route P7 Growth through unified search facts`

Require exact-head three-job CI green.

---

## Task 5 — Special opportunity/topic/lifecycle regression gate

**Files**
- No production change expected.
- Add assertions to `growth.multi-provider-materialization.test.ts` only if required to lock configured-mode rollups.

Run existing legacy tests unchanged:

```bash
npm test -- \
  tests/integration/growth.special-materialization.test.ts \
  tests/integration/growth.new-content-materialization.test.ts \
  tests/integration/growth.lifecycle.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
```

Expected GREEN. If any fails, invoke `superpowers:systematic-debugging` before changes; do not rewrite fixtures merely to force configured mode.

Configured regression must prove:
- multi-market GSC projections do not double demand/cannibalization/topic totals;
- Bing facts do not create a query-page/special opportunity;
- topic impressions/clicks/CTR/position use deduplicated scoring lane only.

If assertions are added, commit:
`test: lock P7 multi-provider regression boundaries`

Require exact-head three-job CI green.

---

## Task 6 — Documentation and full regression

**File**
- Create `docs/development/p9-0g-p7-multi-provider-growth-adapter.md`

Document authority boundaries, configured/legacy selection, GSC materialization handoff, configured no-fallback, legacy no-invented-market behavior, exact Google scoring semantic allowlist, multi-market dedupe/conflict, Bing corroborating-only behavior, UNKNOWN/null handling, provenance version, security/data minimization, no schema migration, and additive rollback guidance without deleting historical facts.

Focused verification:

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

Then:

```bash
npm test
npm run build
```

Commit:
`docs: document P9-0G growth adapter`

Require exact-head CI.

---

## Task 7 — Draft PR release gate

PR:
- title `P9-0G: add multi-provider Growth adapter`
- base `main`
- head `feat/p9-0g-growth-adapter`
- Draft until final exact-head verification/review.

Final exact-head GitHub Actions must show:

```text
verify             success
production-audit   success
e2e                success
```

Inside `verify`, require fresh Prisma validate/generate/migrate deploy, typecheck, full Vitest, build success.

Before completion, read/use:
- `superpowers:verification-before-completion`
- `superpowers:requesting-code-review`

Diff review against `main@608f8d7de7e8744a5f609de5ca80600dc302e25b` must explicitly confirm:
- `growth-score.ts` unchanged;
- no formula/weight/threshold changes;
- no opportunity identity change;
- no historical rewrite/backfill/destructive migration;
- no generic POSITION;
- no UNKNOWN→0;
- no cross-provider numeric fusion;
- no synthetic Bing QUERY_PAGE/CTR;
- Bing positions never feed Google position;
- no AI reconciliation;
- no credential/external-provider access;
- no invented legacy market/locale;
- no configured-mode raw-GSC fallback;
- raw GSC completion never rolled back by downstream failure;
- no cross-project leakage;
- provenance is bounded and excludes raw provider payloads.

Update PR body with final SHA, exact workflow run id/number, all three job results, focused test summary, and release review. Only then Draft → Ready.

**Do not merge.** Wait for explicit human `合并`.

## Definition of Done

P9-0G is complete only when configured Growth reads P9-0F unified Google scoring facts; historical no-market projects retain explicit legacy parity; multi-market projection scores once; contradictions fail closed; Bing is visible only as bounded corroborating provenance; existing P7 formula/identity/lifecycle/topic/UNKNOWN semantics remain unchanged; exact final head has all three CI jobs green; release review is clean; PR is Ready but unmerged pending explicit authorization.
