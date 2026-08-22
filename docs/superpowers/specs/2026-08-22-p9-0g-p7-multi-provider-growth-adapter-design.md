# P9-0G P7 Multi-Provider Growth Adapter Design

Date: 2026-08-22
Status: Approved design
Repository: `liufaxing1978-droid/seogeo`
Base: `main@608f8d7de7e8744a5f609de5ca80600dc302e25b`
Branch: `feat/p9-0g-growth-adapter`

## 1. Purpose

P9-0G upgrades P7 Growth source ingestion so Growth can consume the provider-aware unified search facts introduced in P9-0F without changing P7's authoritative identities, lifecycle, topic clustering, deterministic score formula, evidence-quality semantics, or UNKNOWN behavior.

The selected architecture is an **authority-lane adapter**. It separates search evidence into explicit lanes:

1. a scoring lane whose provider, fact grain, and metric semantics are explicitly compatible with the existing P7 V1 score contract;
2. corroborating provider lanes that contribute bounded provider/market provenance and coverage context but do not alter the V1 numeric score; and
3. a narrowly scoped **legacy GSC compatibility lane** used only for historical projects that still have no enabled `ProjectMarket` configuration.

P9-0G never combines provider numbers merely because they share names such as clicks or impressions.

## 2. Hard boundaries

P9-0G MUST NOT:

- change `GROWTH_SCORE_V1` weights, thresholds, normalization, ranking eligibility, or evidence-quality logic;
- reinterpret Bing query/page/site metrics as Google query-page metrics;
- synthesize `QUERY_PAGE` facts from separate `QUERY` and `PAGE` facts;
- add clicks, impressions, CTR, or positions from different providers into one scoring aggregate;
- treat `UNKNOWN`, `KNOWN_EMPTY`, or `NOT_SUPPORTED` as numeric zero;
- replace provider-specific position semantics with generic `POSITION`;
- let AI choose, merge, reconcile, or reinterpret authoritative search facts;
- rewrite historical Growth snapshots, identities, lifecycle events, or topic snapshots;
- mark an authoritative GSC snapshot failed because downstream unified materialization failed;
- invent a market or locale for a historical project that has no `ProjectMarket` row;
- silently fall back to raw GSC after a configured-market unified-fact contradiction;
- introduce a Prisma schema change solely to implement P9-0G unless implementation proves the existing JSON provenance fields cannot represent the required contract.

## 3. Authority boundaries

P7 remains authoritative for:

- Growth opportunity identity;
- opportunity snapshots and lifecycle;
- score breakdowns;
- evidence quality and coverage;
- topic clustering;
- deterministic opportunity detection;
- UNKNOWN semantics.

P9-0F remains authoritative for normalized search facts and their provider/market/locale/property/source/metric/evidence provenance.

Existing GSC tables remain authoritative for raw Google Search Console daily snapshots and query-page facts.

The P9-0A migration created `ProjectMarket` but did not backfill historical projects. Therefore P9-0G must preserve pre-P9 historical GSC scoring for projects that still have no enabled market configuration rather than making those projects newly ineligible.

## 4. Frozen P7 V1 scoring contract

`GROWTH_SCORE_V1` remains unchanged:

- demand: 30
- positionPotential: 25
- ctrGap: 20
- siteGap: 15
- gscTrend: 6
- p6Visibility: 4

P9-0G changes source ingestion, not scoring mathematics.

The following compatibility surfaces remain unchanged:

- `GROWTH_SCORE_V1`;
- `GROWTH_OPPORTUNITY_V1`;
- existing `gscTrend` persisted breakdown field names;
- historical opportunity identity keys;
- existing lifecycle semantics;
- existing `selectedGscSnapshotIds` materialization result field.

Prefer additive versioned provenance rather than renaming persisted P7 fields.

## 5. Authority lanes

### 5.1 Configured-market scoring lane

When the project has one or more enabled `ProjectMarket` rows, the V1 scoring lane accepts only completed unified facts satisfying all of these conditions:

- provider `GOOGLE_SEARCH_CONSOLE`;
- fact kind `QUERY_PAGE`;
- exact project identity match;
- source traceable to the selected authoritative GSC stable-window snapshots;
- query and canonical page present;
- exact metric semantics `CLICKS`, `IMPRESSIONS`, `CTR`, and `GOOGLE_SEARCH_CONSOLE_POSITION`;
- each consumed scoring metric has evidence state `KNOWN_PRESENT`;
- each numeric value is finite and valid for its semantic.

These facts adapt to the existing `QueryPageFactLike` contract and feed the unchanged P7 aggregation/scoring code.

### 5.2 Legacy GSC compatibility lane

If and only if the project has **zero enabled `ProjectMarket` rows**, P9-0G preserves historical P7 behavior by reading the already-selected authoritative raw GSC query-page facts through an explicit legacy adapter path.

Rules:

- this path uses the same existing stable-window snapshot selection and `QueryPageFactLike` mapping as pre-P9 P7;
- it records `marketScope: UNCONFIGURED_LEGACY` in new bounded provenance;
- it does not fabricate `GLOBAL`, `CN`, `zh-CN`, `en`, or any other market/locale;
- it does not consume Bing or other market-scoped corroborating facts because there is no configured market scope to bind them safely;
- once at least one enabled `ProjectMarket` exists, this legacy path is disabled and configured-market unified facts become mandatory;
- after configured-market mode is active, unified-fact contradictions must fail closed and cannot fall back to raw GSC.

This compatibility lane exists only to prevent P9-0G from breaking historical GSC-backed P7 opportunities. It is not a second long-term provider model.

### 5.3 Corroborating provider lanes

For configured-market projects, completed unified facts from other providers are consumed as corroborating provenance when they match the project/window/market scope.

Initial Bing fact kinds are:

- `QUERY`;
- `PAGE`;
- `SITE`.

Provider-specific metrics include:

- `CLICKS`;
- `IMPRESSIONS`;
- `BING_AVG_CLICK_POSITION`;
- `BING_AVG_IMPRESSION_POSITION`.

These facts do not feed demand, position potential, CTR gap, GSC trend, CTR curves, cannibalization numeric calculations, or query-page candidate generation in P9-0G V1.

### 5.4 Future scoring lanes

A future provider may enter a scoring lane only through an explicit reviewed compatibility policy proving that its fact grain and metric semantics are compatible with a particular P7 component. Compatibility is declared per component and never inferred from similar field names.

P9-0G defines no cross-provider numeric fusion.

## 6. New adapter boundary

Introduce a focused module, expected path:

`src/modules/growth/growth-search-source.adapter.ts`

Responsibilities:

1. receive project and stable-window boundaries;
2. receive/resolve the selected authoritative GSC snapshot set;
3. determine configured-market mode versus legacy compatibility mode;
4. in configured-market mode, ensure required P9-0F GSC materializations exist idempotently;
5. read completed unified search facts for the window;
6. validate scoring-lane compatibility and fail closed on contradictions;
7. adapt the scoring lane into `QueryPageFactLike[]`;
8. collect bounded provider-aware corroborating provenance;
9. return deterministic search-source output to `growth.service.ts`.

The adapter does not calculate Growth scores and does not detect opportunities.

Conceptual output:

```ts
type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};
```

Exact type names may differ, but the boundary must remain equivalent.

## 7. Stable-window authority

P9-0G retains the existing P7 stable-window resolver and GSC snapshot-selection rules.

Sequence:

1. resolve current/previous stable windows;
2. resolve the active connected GSC property using the existing deterministic rule;
3. select exactly one authoritative completed GSC snapshot per expected day using the existing `syncVersion`/id tiebreak;
4. return `INELIGIBLE` if required stable-window days are missing;
5. choose configured-market or legacy mode;
6. configured-market mode: materialize selected snapshots into P9-0F and read scoring facts from unified facts;
7. legacy mode: read the selected raw GSC facts through the explicit compatibility adapter;
8. verify the scoring facts trace to exactly the selected authoritative GSC snapshot set.

`selectedGscSnapshotIds` remains available for backward compatibility and diagnostics.

## 8. Unified materialization handoff

P9-0F provides idempotent Google/Bing materializers, but GSC completion does not currently guarantee a `SearchFactSnapshot` exists before Growth runs.

### 8.1 Configured-market behavior

For each selected authoritative GSC snapshot:

- resolve all enabled `ProjectMarket` rows;
- materialize the same authoritative GSC source into each configured market/locale projection when the upstream GSC source itself cannot distinguish those markets;
- use P9-0F idempotent materialization;
- treat an existing exact completed normalized snapshot as success;
- reject source conflicts or invalid identities;
- never mutate the raw GSC snapshot status as compensation for downstream failure.

### 8.2 No-market behavior

Because P9-0A did not backfill historical projects, zero enabled `ProjectMarket` rows selects `UNCONFIGURED_LEGACY` mode. No unified projection is created because doing so would require inventing market/locale truth.

The implementation must expose this state in provenance and tests so the compatibility path cannot become an invisible permanent bypass.

### 8.3 Failure semantics

In configured-market mode, if raw GSC data is authoritative/complete but unified materialization fails:

- raw GSC remains `COMPLETED`;
- Growth fails closed or returns the implementation's deterministic adapter error/ineligible state;
- retry policy follows the underlying deterministic reason;
- raw GSC fallback is forbidden.

Legacy mode is selected only before any configured-market materialization attempt and only because the project has no enabled market configuration. It is not a fallback after failure.

## 9. Deterministic deduplication

### 9.1 Scoring-lane dedupe

One raw GSC observation may appear in multiple unified snapshots because one source can be projected into multiple market/locale contexts.

Scoring identity is the authoritative raw observation reference plus source date/fact identity, not market projection.

If duplicate scoring candidates share the same raw source identity and have identical query/page/metrics/evidence, score one representative while retaining all projection provenance.

If those duplicates disagree on query, canonical page, metric semantic/value, evidence state, normalization identity, or source date, fail closed. Never choose a winner.

### 9.2 Corroborating-lane dedupe

Logical corroborating identity:

- provider;
- marketCode;
- locale;
- propertyRef;
- factKind;
- sourceDate;
- factKey.

For duplicate logical corroborating facts, select the latest `sourceCutoffAt`, then deterministic snapshot/source-reference tiebreakers. Never dedupe across different providers.

## 10. Provenance contract

New Growth snapshots continue to use existing JSON `sourceProvenance` with additive versioned search-source metadata.

Configured-market conceptual shape:

```json
{
  "materializationVersion": "GROWTH_MATERIALIZATION_V1",
  "evidenceVersion": "GROWTH_EVIDENCE_V1",
  "gscSnapshotIds": ["..."],
  "searchFacts": {
    "version": "GROWTH_SEARCH_PROVENANCE_V1",
    "mode": "CONFIGURED_MARKET",
    "scoringLane": {
      "provider": "GOOGLE_SEARCH_CONSOLE",
      "factKind": "QUERY_PAGE",
      "snapshotIds": ["..."],
      "sourceRefs": ["..."],
      "marketProjections": [
        {"marketCode": "GLOBAL", "locale": "zh-CN", "propertyRef": "..."}
      ]
    },
    "corroboratingLanes": [
      {
        "provider": "BING_WEBMASTER",
        "marketCode": "GLOBAL",
        "locale": "zh-CN",
        "propertyRef": "...",
        "factKinds": ["QUERY", "PAGE", "SITE"],
        "snapshotIds": ["..."],
        "sourceCompleteness": ["PROVIDER_UNSPECIFIED"]
      }
    ]
  }
}
```

Legacy conceptual shape:

```json
{
  "searchFacts": {
    "version": "GROWTH_SEARCH_PROVENANCE_V1",
    "mode": "UNCONFIGURED_LEGACY",
    "scoringLane": {
      "provider": "GOOGLE_SEARCH_CONSOLE",
      "source": "RAW_GSC_COMPATIBILITY",
      "gscSnapshotIds": ["..."]
    },
    "corroboratingLanes": []
  }
}
```

Corroborating provider metrics should not be copied wholesale into Growth JSON. Persist references and bounded summaries rather than arbitrary provider payloads.

## 11. Opportunity identity and historical compatibility

P9-0G does not add provider or market to existing `GrowthOpportunityIdentity` keys.

Historical snapshots remain immutable and are not backfilled.

New snapshots may carry richer provider provenance while retaining the same opportunity identity and score formula version.

P9-A may later reference provider/market scope without rewriting P7 historical identities.

## 12. Bing-only and non-query-page projects

A configured project with Bing facts but no compatible GSC query-page scoring lane must not receive fabricated `QUERY_PAGE_GROWTH` opportunities.

P9-0G V1 may expose Bing provider coverage/provenance, but:

- separate query/page facts cannot create a synthetic query-page pair;
- Bing positions cannot become Google position;
- CTR is not synthesized unless a future explicit compatible fact semantic exists;
- missing compatible scoring data remains unknown/unavailable rather than zero.

## 13. Interaction with existing Growth logic

Only scoring-lane `QueryPageFactLike` aggregates feed:

- current/previous aggregate construction;
- demand percentiles;
- project CTR curve;
- position potential;
- CTR gap;
- GSC trend;
- normal opportunity detectors;
- keyword cannibalization calculations;
- topic member numeric rollups;
- topic snapshot impressions/clicks/CTR/position.

Existing P2/P3/P5/P6 evidence remains unchanged.

Bing corroborating facts must not be routed into `scoreSiteGap` or P6 visibility as a workaround.

## 14. Error and UNKNOWN semantics

The adapter must distinguish at least:

- stable-window GSC coverage missing;
- `UNCONFIGURED_LEGACY` mode;
- configured-market unified materialization absent but materializable;
- unified materialization conflict;
- required scoring metric missing;
- required scoring metric present with non-`KNOWN_PRESENT` evidence;
- contradictory duplicate raw source observation;
- source project/property/window mismatch.

Contradictory/malformed configured-market facts fail closed.

Valid non-present evidence never becomes zero.

Existing P7 behavior where unavailable components become `UNKNOWN` remains authoritative.

## 15. Security and data minimization

P9-0G does not call search provider APIs directly and does not access provider credentials.

It must not persist auth headers/tokens, arbitrary provider response bodies, or AI reasoning into Growth provenance.

If observability is added, payloads remain bounded identifiers/reason codes rather than raw provider payloads or query collections.

## 16. Expected code surface

Primary expected changes:

- new `src/modules/growth/growth-search-source.adapter.ts`;
- focused source/provenance types in the adapter or `growth.types.ts`;
- `src/modules/growth/growth.service.ts` source-ingestion integration;
- adapter and Growth integration tests;
- P9-0G development documentation.

Possible limited change:

- a small P9-0F repository/materializer helper if required for deterministic reconciliation without duplicating materialization logic.

Not expected:

- Growth score formula edits;
- Growth Prisma schema changes;
- P6 visibility changes;
- raw GSC schema rewrites;
- search-provider client changes;
- AI provider changes.

## 17. TDD implementation sequence

1. **Source-mode and adapter contract RED/GREEN**
   - configured-market vs `UNCONFIGURED_LEGACY` selection;
   - exact scoring semantic mapping;
   - UNKNOWN/null preservation.

2. **GSC unified handoff RED/GREEN**
   - configured-market selected snapshots materialize idempotently;
   - multi-market projections;
   - raw GSC completion remains untouched on downstream failure.

3. **Scoring dedupe RED/GREEN**
   - multi-market projection does not multiply GSC score;
   - contradictory duplicate raw observation fails closed.

4. **Bing corroborating lane RED/GREEN**
   - Bing facts appear in configured-market provenance;
   - score remains identical to GSC-only baseline;
   - no fabricated query-page fact.

5. **Growth service integration RED/GREEN**
   - configured-market unified path preserves prior numeric P7 behavior;
   - legacy no-market fixtures preserve historical raw GSC behavior;
   - stable-window/lifecycle/topic behavior remains unchanged.

6. **Historical/read compatibility GREEN**
   - no schema rewrite/backfill;
   - old snapshots remain readable;
   - existing P7 tests pass unchanged unless a test explicitly asserts new additive provenance.

7. **Documentation + exact-head release gate**
   - `verify` success;
   - `production-audit` success;
   - `e2e` success;
   - release diff review for boundary violations.

## 18. Required test invariants

Automated tests must prove at minimum:

1. **GSC score parity** — configured-market unified facts reproduce the same aggregate, breakdown, score, priority, evidence quality/coverage, ranking eligibility, detectors, and topic rollups as the historical GSC fixture.
2. **Legacy parity** — a project with zero enabled `ProjectMarket` rows keeps historical GSC P7 results and records `UNCONFIGURED_LEGACY` rather than inventing market truth.
3. **No post-failure fallback** — once configured-market mode is selected, a unified materialization/fact conflict does not fall back to raw GSC.
4. **No multi-market double count** — one GSC source projected into multiple markets does not change numeric results.
5. **Bing provenance without score mutation** — adding Bing changes corroborating provenance only.
6. **Provider position semantics remain distinct** — Bing position semantics never feed Google position scoring.
7. **UNKNOWN is not zero** — unknown/null evidence remains unknown/null.
8. **No synthetic query-page** — Bing query + page facts cannot create a query-page candidate.
9. **Conflict fails closed** — divergent projections of one raw GSC observation are rejected.
10. **No cross-project leakage** — another project's facts never enter scoring/provenance.
11. **Only completed unified facts are consumed** in configured-market mode.
12. **Historical P7 formula remains unchanged** — existing score/evidence/lifecycle/detector/topic tests remain green without provider-mixing expectation changes.

## 19. Release review checklist

Before P9-0G can be marked Ready on the exact final PR head, confirm:

- no `GROWTH_SCORE_V1` weight/threshold change;
- no opportunity identity rewrite;
- no historical snapshot rewrite/backfill;
- no generic `POSITION`;
- no UNKNOWN-to-zero conversion;
- no cross-provider numeric summation;
- no synthetic Bing query-page construction;
- no AI source reconciliation;
- no provider credential access in Growth;
- no invented market/locale for legacy projects;
- no configured-market raw-GSC fallback after unified failure;
- no GSC completion rollback caused by downstream materialization;
- no destructive Prisma migration;
- exact-head `verify`, `production-audit`, and `e2e` all succeed.

## 20. Definition of done

P9-0G is complete when:

- configured-market P7 Growth search-performance ingestion reads through P9-0F unified search facts;
- historical no-market projects retain explicit `UNCONFIGURED_LEGACY` GSC scoring compatibility without invented market/locale;
- GSC scoring remains numerically compatible with historical P7 V1 behavior;
- Bing facts are consumed as explicit provider-aware corroborating provenance without affecting the V1 score;
- market/locale provenance is preserved without double-counting raw sources;
- configured-market contradictions fail closed and cannot silently bypass unified facts;
- UNKNOWN semantics remain intact;
- historical snapshots remain immutable;
- exact-head CI gates pass;
- the PR is reviewed and marked Ready only after final exact-head verification;
- merge occurs only after separate explicit human authorization.
