# P9-0G P7 Multi-Provider Growth Adapter Design

Date: 2026-08-22
Status: Approved design
Repository: `liufaxing1978-droid/seogeo`
Base: `main@608f8d7de7e8744a5f609de5ca80600dc302e25b`
Branch: `feat/p9-0g-growth-adapter`

## 1. Purpose

P9-0G upgrades P7 Growth source ingestion so Growth can consume the provider-aware unified search facts introduced in P9-0F without changing P7's authoritative identities, lifecycle, topic clustering, deterministic score formula, evidence-quality semantics, or UNKNOWN behavior.

The selected architecture is an **authority-lane adapter**.

The adapter separates search facts into explicit lanes:

1. a scoring lane containing only facts whose provider, fact grain, and metric semantics are explicitly compatible with the existing P7 V1 scoring contract; and
2. corroborating lanes containing other authoritative provider facts that contribute provenance and source-coverage context but do not alter the V1 numeric score.

P9-0G does not combine provider numbers merely because they share names such as clicks or impressions.

## 2. Hard boundaries

P9-0G MUST NOT:

- change `GROWTH_SCORE_V1` weights, thresholds, normalization, ranking eligibility, or evidence-quality logic;
- reinterpret Bing query/page/site metrics as Google query-page metrics;
- synthesize `QUERY_PAGE` facts from separate `QUERY` and `PAGE` facts;
- add clicks, impressions, CTR, or positions from different providers into one scoring aggregate;
- treat `UNKNOWN`, `KNOWN_EMPTY`, or `NOT_SUPPORTED` as numeric zero;
- replace provider-specific position semantics with a generic `POSITION` metric;
- let AI choose, merge, reconcile, or reinterpret provider facts;
- rewrite historical Growth snapshots, identities, lifecycle events, or topic snapshots;
- mark an authoritative GSC snapshot failed because downstream unified materialization failed;
- require a Prisma schema migration solely for P9-0G unless implementation uncovers a contract that cannot be represented in existing JSON provenance fields.

## 3. Existing authority boundaries

P7 remains authoritative for:

- Growth opportunity identity;
- opportunity snapshot lifecycle;
- score breakdowns;
- evidence quality and coverage;
- lifecycle state;
- topic clustering;
- deterministic opportunity detection;
- UNKNOWN semantics.

P9-0F remains authoritative for normalized search facts and preserves:

- provider;
- market;
- locale;
- property identity;
- source snapshot/batch reference;
- source observation reference;
- source cutoff;
- completeness;
- fact grain;
- metric semantic;
- evidence state.

Existing GSC persistence remains authoritative for raw Google Search Console daily snapshots and query-page facts. P9-0G consumes those facts through P9-0F without deleting or reinterpreting the original GSC tables.

## 4. Current P7 V1 score contract remains frozen

`GROWTH_SCORE_V1` remains unchanged:

- demand: 30
- positionPotential: 25
- ctrGap: 20
- siteGap: 15
- gscTrend: 6
- p6Visibility: 4

P9-0G changes only the source adapter feeding the existing search-performance components.

The following public names also remain unchanged in P9-0G V1 for backward compatibility:

- `GROWTH_SCORE_V1`
- `GROWTH_OPPORTUNITY_V1`
- `GROWTH_MATERIALIZATION_V1` unless a later implementation plan intentionally versions the materialization contract because serialized provenance shape changes require it
- `gscTrend` field names in persisted P7 score breakdowns
- historical `selectedGscSnapshotIds` in materialization results

The implementation plan must prefer additive provenance metadata over renaming existing persisted score-breakdown fields.

## 5. Authority-lane model

### 5.1 Scoring lane V1

The V1 scoring lane accepts only completed unified facts satisfying all of these conditions:

- provider: `GOOGLE_SEARCH_CONSOLE`
- fact kind: `QUERY_PAGE`
- exact project identity match
- source observation linked to the selected authoritative GSC stable-window snapshot set
- query and canonical page present
- metrics required by the existing query-page scoring contract use the exact semantics:
  - `CLICKS`
  - `IMPRESSIONS`
  - `CTR`
  - `GOOGLE_SEARCH_CONSOLE_POSITION`
- each consumed scoring metric has evidence state `KNOWN_PRESENT`
- each numeric value is finite and valid for its semantic

Those facts are adapted to the existing `QueryPageFactLike` contract and passed unchanged into the existing aggregation/scoring functions.

This guarantees that a GSC fixture producing a score before P9-0G produces the same query-page aggregate, score breakdown, score, priority, evidence coverage, and ranking eligibility after P9-0G.

### 5.2 Corroborating lanes V1

Completed unified facts from other providers are consumed as corroborating evidence/provenance lanes when they match the project/window scope.

Initial Bing facts include:

- `QUERY`
- `PAGE`
- `SITE`

with provider-specific metrics such as:

- `CLICKS`
- `IMPRESSIONS`
- `BING_AVG_CLICK_POSITION`
- `BING_AVG_IMPRESSION_POSITION`

These facts do not feed `scoreDemand`, `scorePositionPotential`, `scoreCtrGap`, the existing GSC trend component, CTR-curve construction, cannibalization numeric calculations, or query-page candidate generation in P9-0G V1.

They are nevertheless truly consumed by Growth through provider-aware provenance and source-coverage summaries, so multi-provider source visibility is no longer external to P7 materialization.

### 5.3 Future scoring lanes

A future provider may enter a scoring lane only through an explicit, reviewed compatibility policy proving that its fact grain and metric semantics are compatible with a particular P7 component.

Compatibility must be declared per component, not inferred from field names.

A future provider with a trustworthy query-page fact may receive an independent scoring lane. P9-0G does not define cross-provider numeric fusion.

## 6. New adapter boundary

Introduce a focused module, expected path:

`src/modules/growth/growth-search-source.adapter.ts`

Its responsibilities are:

1. receive the project and resolved stable-window boundaries;
2. receive or resolve the selected authoritative GSC snapshot set;
3. ensure required P9-0F GSC materializations exist idempotently;
4. read completed unified search facts for the window;
5. validate scoring-lane compatibility and fail closed on contradictions;
6. adapt the Google scoring lane into `QueryPageFactLike[]`;
7. collect provider-aware corroborating provenance summaries;
8. return a deterministic result to `growth.service.ts`.

The adapter does not calculate Growth scores and does not detect opportunities.

An expected conceptual output is:

```ts
type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};
```

The exact TypeScript type names may differ during implementation, but the responsibility boundary must remain equivalent.

## 7. Stable-window authority and GSC compatibility

P9-0G retains the existing P7 stable-window resolver and authoritative GSC snapshot-selection rules.

The sequence remains:

1. resolve current/previous stable windows;
2. resolve the active connected GSC property using the existing deterministic rule;
3. select exactly one authoritative completed GSC snapshot per expected day using the existing `syncVersion`/id tiebreak behavior;
4. fail materialization as `INELIGIBLE` if required GSC stable-window days are missing;
5. materialize the selected GSC snapshots into P9-0F if needed;
6. read scoring facts through the unified fact repository;
7. verify that the resulting unified scoring facts trace back exactly to the selected authoritative GSC snapshot set.

P9-0G therefore changes the fact-read boundary, not the existing stable-window definition.

`selectedGscSnapshotIds` remains returned for backward compatibility and diagnostics.

## 8. Unified materialization handoff

P9-0F provides idempotent Google and Bing materializers, but existing GSC completion currently does not automatically guarantee that a `SearchFactSnapshot` exists before Growth runs.

P9-0G must close this handoff without corrupting upstream authority.

### 8.1 Required behavior

For each selected authoritative GSC snapshot used by Growth:

- resolve enabled `ProjectMarket` rows for the project;
- choose the market/locale projections Growth is allowed to materialize according to the deterministic policy defined below;
- call P9-0F GSC materialization idempotently;
- treat an existing matching completed normalized snapshot as success;
- reject conflicts or invalid source identity;
- never mutate the GSC snapshot status as compensation for downstream failure.

### 8.2 Market/locale policy

P9-0G MUST NOT hard-code `GLOBAL` or a locale in the GSC worker.

Market/locale comes from enabled `ProjectMarket` configuration.

For P9-0G V1, scoring-lane projection follows this deterministic policy:

- if no enabled `ProjectMarket` exists, Growth retains the existing GSC-backed behavior and records unified projection state as unavailable rather than silently inventing a market;
- if one enabled market/locale exists, use it as the scoring projection;
- if multiple enabled market/locales exist for the same project and the underlying GSC source cannot distinguish them, materialize the same authoritative GSC source into each configured projection for provenance, but deduplicate scoring by raw source observation identity so the GSC numeric signal contributes only once;
- all projections remain visible in provenance.

This preserves configuration truth without multiplying numeric weight.

### 8.3 Failure semantics

If raw GSC data is authoritative and complete but unified materialization fails because of a downstream persistence/conflict error:

- the raw GSC snapshot remains `COMPLETED`;
- the Growth run fails closed or returns a deterministic ineligible/error state according to the implementation contract;
- the failure is retryable only when the underlying reason is retryable;
- no direct fallback to reading raw GSC facts is allowed after a unified-materialization contradiction, because that would silently bypass the new authority boundary.

A pure absence caused by no `ProjectMarket` configuration is not equivalent to a contradictory unified fact and must be surfaced distinctly.

## 9. Deterministic deduplication

### 9.1 Scoring-lane dedupe

A raw GSC observation may appear in multiple unified snapshots because one source can be projected to multiple enabled market/locale contexts.

Scoring dedupe identity is the authoritative raw observation reference plus source date/fact identity, not market projection.

If duplicate scoring candidates share the same authoritative source observation identity and contain identical query/page/metrics, keep one deterministic representative for scoring and retain all projection provenance.

If duplicates sharing the same authoritative source observation identity disagree on query, canonical page, metric semantic, metric value, evidence state, normalization identity, or source date, fail closed with an explicit adapter conflict. Do not select a winner.

### 9.2 Corroborating-lane dedupe

Corroborating provider facts are not numerically scored, but provenance should not contain accidental duplicate observations from overlapping batches.

The logical corroborating identity is:

- provider
- marketCode
- locale
- propertyRef
- factKind
- sourceDate
- factKey

When multiple completed snapshots carry the same logical corroborating identity, select the record with the latest `sourceCutoffAt`; use snapshot/source references as deterministic tiebreakers.

Do not deduplicate across different providers.

## 10. Provenance contract

New Growth snapshots remain the P7 authority but should carry versioned search-source provenance in existing JSON `sourceProvenance` fields.

An expected conceptual shape is:

```json
{
  "materializationVersion": "GROWTH_MATERIALIZATION_V1",
  "evidenceVersion": "GROWTH_EVIDENCE_V1",
  "gscSnapshotIds": ["..."],
  "searchFacts": {
    "version": "GROWTH_SEARCH_PROVENANCE_V1",
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
        "sourceCutoffAt": "...",
        "sourceCompleteness": ["PROVIDER_UNSPECIFIED"]
      }
    ]
  }
}
```

Exact field names may be refined in implementation, but provenance must retain enough references to audit exactly which provider facts were visible and which lane affected scoring.

Corroborating provider metrics should not be copied wholesale into Growth snapshot JSON. Persist references and bounded summaries rather than duplicating raw payloads.

## 11. Opportunity identity and historical compatibility

P9-0G does not add provider or market to existing `GrowthOpportunityIdentity` keys.

Reasons:

- historical GSC-backed opportunity identities must remain stable;
- the current opportunity concept represents a logical page/query optimization need, not a provider-specific task instance;
- provider provenance belongs in snapshots/evidence, not the identity key in V1.

Historical snapshots are immutable and are not backfilled.

New snapshots may contain richer search-fact provenance while retaining the same opportunity identity and scoring formula version.

If future provider-specific planning needs provider-specific optimization objects, P9-A may reference provider/market scope without rewriting P7 historical identities.

## 12. Bing-only and non-query-page projects

A project with Bing facts but no compatible GSC query-page scoring lane must not receive fabricated `QUERY_PAGE_GROWTH` opportunities.

In P9-0G V1:

- Bing facts can be read and summarized as provider coverage/provenance;
- Bing query/page/site metrics do not create synthetic query-page pairs;
- no Google position is inferred from Bing positions;
- no CTR is synthesized unless the provider fact explicitly contains an authoritative CTR semantic supported by a future compatibility policy;
- missing compatible scoring-lane data remains explicit and does not become zero.

This is intentionally conservative.

## 13. Interaction with existing Growth logic

The following P7 calculations continue to use only the scoring-lane `QueryPageFactLike` aggregates:

- current/previous aggregate construction;
- demand percentiles;
- project CTR curve;
- position potential;
- CTR gap;
- GSC trend;
- normal opportunity detectors;
- keyword cannibalization query/page calculations;
- topic member numeric rollups;
- topic snapshot impressions/clicks/CTR/position.

Existing non-search evidence remains unchanged:

- P2 SEO
- P3 GEO/entity/citability
- P5 content/competitor
- P6 visibility/alerts

P9-0G must not route Bing facts into `scoreSiteGap` or P6 visibility as a workaround.

## 14. Error handling and UNKNOWN semantics

The adapter must distinguish at least these conditions conceptually:

- stable-window source coverage missing;
- no enabled market configuration;
- unified source materialization absent but materializable;
- unified source materialization conflict;
- scoring fact missing required metric semantic;
- scoring metric evidence is non-present/unknown;
- duplicate authoritative source observations disagree;
- source project/property/window identity mismatch.

Contradictory or malformed facts fail closed.

Valid non-present metric evidence never becomes zero.

Existing P7 behavior where unavailable score components become `UNKNOWN` remains authoritative. The implementation must not convert source absence into a numeric penalty.

## 15. Security and data minimization

P9-0G reads persisted facts only. It must not:

- call external search provider APIs directly;
- access provider credentials;
- persist auth headers/tokens;
- duplicate arbitrary provider payloads into Growth provenance;
- invoke AI to resolve source conflicts.

Observability, if added, must contain bounded identifiers/reason codes rather than raw query collections or provider response bodies.

## 16. Expected code surface

Primary expected changes:

- new `src/modules/growth/growth-search-source.adapter.ts`
- focused Growth search-source types, either in the adapter or `growth.types.ts`
- `src/modules/growth/growth.service.ts` source-ingestion integration
- tests for adapter contracts and full Growth materialization compatibility
- P9-0G development documentation

Possible limited change:

- small P9-0F repository/materializer helper only if required to perform deterministic batch reconciliation without duplicating logic

Not expected:

- Growth score formula edits
- Growth Prisma schema changes
- P6 visibility changes
- GSC raw schema rewrites
- search-provider API client changes
- AI provider changes

## 17. TDD implementation sequence

The implementation plan should divide work into small RED/GREEN tasks and preserve exact-head CI evidence.

Recommended sequence:

1. **Adapter contract RED/GREEN**
   - explicit scoring compatibility policy
   - exact semantic mapping
   - UNKNOWN/null preservation

2. **GSC unified handoff RED/GREEN**
   - selected stable-window snapshots materialize idempotently
   - enabled market projections
   - upstream GSC completion remains untouched on downstream failure

3. **Scoring dedupe RED/GREEN**
   - multi-market projection does not multiply GSC score
   - contradictory duplicate raw observation fails closed

4. **Bing corroborating lane RED/GREEN**
   - Bing facts appear in provenance
   - score remains byte-for-byte/numerically identical to GSC-only baseline
   - no fabricated query-page fact

5. **Growth service integration RED/GREEN**
   - existing P7 fixtures reproduce prior opportunities/scores
   - stable-window and lifecycle behavior remain unchanged

6. **Historical/read compatibility GREEN**
   - no schema rewrite
   - old snapshots remain readable
   - existing P7 unit/integration tests continue passing

7. **Documentation + release gate**
   - exact final head `verify`
   - exact final head `production-audit`
   - exact final head `e2e`
   - release diff review for boundary violations

## 18. Required test invariants

At minimum, automated tests must prove:

1. **GSC score parity**
   The same authoritative GSC fixture yields the same aggregate, score breakdown, total score, priority, evidence quality, evidence coverage, ranking eligibility, detector output, and topic rollup before and after the adapter.

2. **No multi-market double count**
   Materializing one GSC source into multiple market projections does not change numeric P7 results.

3. **Bing provenance without score mutation**
   Adding valid Bing query/page/site facts changes provider provenance/coverage only; it does not change the GSC-derived score.

4. **Provider-specific position semantics remain distinct**
   `BING_AVG_CLICK_POSITION` and `BING_AVG_IMPRESSION_POSITION` never feed `GOOGLE_SEARCH_CONSOLE_POSITION` or generic position scoring in P9-0G V1.

5. **UNKNOWN is not zero**
   A Bing unknown position remains null/unknown; a missing/unknown scoring-lane metric does not become 0.

6. **No synthetic query-page**
   Separate Bing query and page facts cannot produce a `QUERY_PAGE` candidate.

7. **Conflict fails closed**
   Duplicate unified projections of one raw GSC observation with divergent values are rejected rather than arbitrarily deduped.

8. **No cross-project leakage**
   Search facts from another project never enter scoring or corroborating provenance.

9. **Only completed normalized facts are consumed**
   RUNNING/PENDING/FAILED search-fact snapshots cannot influence Growth.

10. **Historical P7 formula remains unchanged**
    Existing `growth.score.test.ts`, evidence tests, lifecycle tests, detector tests, and topic tests continue passing without expectation changes caused by provider mixing.

## 19. Release review checklist

Before P9-0G can be marked Ready for review, confirm on the exact final PR head:

- no `GROWTH_SCORE_V1` weight/threshold change;
- no opportunity identity rewrite;
- no historical Growth snapshot rewrite/backfill;
- no generic `POSITION` metric;
- no UNKNOWN-to-zero conversion;
- no cross-provider numeric summation;
- no synthetic Bing query-page construction;
- no AI source reconciliation;
- no provider credential access in Growth;
- no GSC completion rollback caused by downstream materialization;
- no destructive Prisma migration;
- exact-head `verify`, `production-audit`, and `e2e` all succeed.

## 20. Definition of done

P9-0G is complete when:

- P7 Growth search-performance ingestion reads through the unified search-fact boundary;
- GSC scoring remains numerically compatible with the historical P7 V1 behavior;
- Bing facts are consumed as explicit provider-aware corroborating provenance without affecting V1 numeric score;
- market/locale provenance is preserved without double-counting a raw source;
- contradictions fail closed;
- UNKNOWN semantics remain intact;
- historical snapshots remain immutable;
- all exact-head CI gates pass;
- the PR is reviewed and marked Ready only after final exact-head verification;
- merge occurs only after separate explicit human authorization.
