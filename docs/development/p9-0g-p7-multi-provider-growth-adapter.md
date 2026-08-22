# P9-0G P7 Multi-Provider Growth Adapter

## Purpose

P9-0G changes how P7 Growth obtains persisted search-performance facts without changing the P7 scoring model itself.

The adapter introduces an explicit authority-lane boundary between P9-0F unified search facts and the existing P7 Growth materializer:

- Google Search Console `QUERY_PAGE` facts are the only P9-0G V1 search scoring lane.
- Bing Webmaster facts are corroborating-only provider provenance.
- Historical projects with no enabled `ProjectMarket` rows keep a narrowly scoped raw-GSC compatibility lane.

`GROWTH_SCORE_V1`, Growth opportunity identities, lifecycle behavior, topic clustering, evidence-quality logic, ranking eligibility, and UNKNOWN semantics remain authoritative in P7 and are unchanged by P9-0G.

## Authority boundaries

P9-0G preserves the existing ownership split:

- `GscDailySnapshot` and `GscQueryPageFact` remain the authoritative persisted Google source records.
- P9-0F `SearchFactSnapshot`, `SearchFact`, and `SearchFactMetric` remain authoritative for provider-aware normalized search facts and provenance.
- P7 remains authoritative for Growth aggregation, scoring, opportunity detection, topic rollups, immutable Growth snapshots, and lifecycle.
- P9-0G only selects, validates, adapts, deduplicates, and records search-source provenance.

The adapter does not calculate Growth scores and does not let search-provider names or similar metric labels imply numeric compatibility.

## Frozen P7 scoring contract

P9-0G does not modify `GROWTH_SCORE_V1`.

The existing V1 components and weights remain:

| Component | Weight |
| --- | ---: |
| demand | 30 |
| positionPotential | 25 |
| ctrGap | 20 |
| siteGap | 15 |
| gscTrend | 6 |
| p6Visibility | 4 |

P9-0G also leaves these compatibility surfaces unchanged:

- `GROWTH_OPPORTUNITY_V1`
- existing opportunity identity keys
- existing `gscTrend` breakdown naming
- existing lifecycle transitions
- existing topic identity semantics
- `selectedGscSnapshotIds` in the materialization result

The implementation changes source ingestion, not score mathematics.

## Source mode selection

`GrowthSearchSourceAdapter` has two explicit modes.

### `CONFIGURED_MARKET`

This mode is selected when the project has one or more enabled `ProjectMarket` rows.

Configured mode requires unified P9-0F facts. For every authoritative selected GSC daily snapshot, P9-0G materializes an idempotent P9-0F Google projection for every enabled project market/locale and then reads completed unified facts for the configured scope.

Once configured mode is selected, the adapter does **not** fall back to raw GSC if unified materialization or validation fails. A contradiction or malformed unified fact fails closed.

### `UNCONFIGURED_LEGACY`

This mode is selected only when the project has zero enabled `ProjectMarket` rows.

It preserves the historical P7 behavior by reading the already-selected raw GSC query-page facts and adapting them directly into the existing `QueryPageFactLike` contract.

Legacy mode deliberately does not invent a market or locale. It does not assume `GLOBAL`, `CN`, `zh-CN`, `en`, or any other geographic truth. Because there is no configured market scope, it also does not attach Bing corroborating lanes.

Legacy mode is a compatibility path, not a fallback after configured-mode failure.

## Stable-window and GSC authority

The existing P7 stable-window resolver remains in charge of the Growth date windows and authoritative GSC source selection.

The sequence remains:

1. resolve current and previous stable windows;
2. select the active connected GSC property with the existing deterministic rule;
3. select one completed authoritative GSC snapshot per required day using the existing snapshot ordering;
4. return `INELIGIBLE` when required stable-window coverage is missing;
5. hand the selected authoritative snapshot set to `GrowthSearchSourceAdapter`;
6. choose configured or legacy mode;
7. adapt only facts traceable to the selected authoritative source set;
8. continue through the unchanged P7 aggregation/scoring/detector/topic/lifecycle pipeline.

P9-0G does not change an authoritative `GscDailySnapshot` from `COMPLETED` merely because downstream normalized materialization fails.

## Configured Google scoring lane

Configured P9-0G V1 accepts only unified facts with the exact compatible contract:

```text
provider = GOOGLE_SEARCH_CONSOLE
factKind = QUERY_PAGE
sourceKind = GSC_DAILY_SNAPSHOT
```

Every consumed fact must trace back to one of the selected authoritative GSC snapshot IDs and must retain a non-empty source observation reference and fact key.

Required dimensional identity:

- source date
- normalized query
- canonical page
- query normalization version
- canonicalization version

Required metric semantic allowlist:

```text
CLICKS
IMPRESSIONS
CTR
GOOGLE_SEARCH_CONSOLE_POSITION
```

Each required metric must occur exactly once, have `evidenceState = KNOWN_PRESENT`, and carry a finite non-negative numeric value. CTR must also remain within `[0, 1]`.

No generic `POSITION` semantic is accepted. Bing position metrics cannot satisfy `GOOGLE_SEARCH_CONSOLE_POSITION`.

If a required scoring metric is missing, duplicated, unknown, malformed, or contradictory, configured mode fails closed.

## Multi-market Google projection and scoring dedupe

A single raw GSC observation may be materialized into multiple P9-0F market/locale projections because the upstream GSC source does not necessarily distinguish the project's configured markets.

P9-0G retains all valid market projections in provenance but scores the authoritative raw observation only once.

Scoring dedupe identity is based on the raw source observation identity, source date, and fact key rather than the market projection. Duplicate projections are accepted only when their adapted query/page identity, normalization identity, and four Google scoring metrics agree exactly.

If two projections claim the same raw observation identity but disagree, P9-0G raises a source conflict instead of choosing a numeric winner.

This prevents configured multi-market projection from multiplying:

- demand
- clicks or impressions
- project CTR curve samples
- CTR gap
- GSC trend
- normal opportunity candidates
- cannibalization inputs
- topic impressions/clicks/CTR/position

## Bing corroborating lane

Configured projects may expose completed `BING_WEBMASTER` unified facts in bounded corroborating provenance.

P9-0G V1 accepts the real Bing fact grains:

```text
QUERY
PAGE
SITE
```

Bing does not enter the P7 scoring lane. P9-0G does not:

- join a Bing `QUERY` fact and `PAGE` fact into a synthetic `QUERY_PAGE` fact;
- synthesize CTR from Bing clicks and impressions;
- reinterpret `BING_AVG_CLICK_POSITION` as Google position;
- reinterpret `BING_AVG_IMPRESSION_POSITION` as Google position;
- add Bing clicks or impressions to Google demand or topic totals;
- route Bing metrics into `scoreSiteGap` or P6 visibility as a back door;
- let Bing create special query-page opportunities.

Therefore adding extreme Bing numeric values must leave `GROWTH_SCORE_V1`, opportunity type, ranking eligibility, Growth identity, and topic numeric rollups unchanged.

## Bing corroborating dedupe

Logical Bing corroborating identity is:

```text
provider
marketCode
locale
propertyRef
factKind
sourceDate
factKey
```

When multiple completed facts share that identity, P9-0G selects the newest `sourceCutoffAt`.

Equal cutoffs are resolved deterministically by lexical ordering of snapshot/source references. Dedupe never crosses provider boundaries.

The selected corroborating facts are summarized into provider/market lanes rather than copied into Growth provenance as raw metric payloads.

## UNKNOWN and nullable semantics

P9-0G preserves P9-0F and P7 UNKNOWN semantics.

P9-0F non-present evidence states remain distinct from numeric zero:

```text
KNOWN_EMPTY
UNKNOWN
NOT_SUPPORTED
```

These states require `numericValue = null` in P9-0F and are never converted to zero by the Growth adapter.

For the Google scoring lane, a required scoring metric must be `KNOWN_PRESENT`; otherwise configured scoring fails closed. This prevents a missing or unknown required Google metric from silently becoming a zero-valued Growth input.

Bing nullable provider metrics remain corroborating evidence only and never affect Google scoring components.

## Growth service integration

`growth.service.ts` keeps the existing stable-window selection and then performs one search-source handoff:

```ts
const searchSource = await new GrowthSearchSourceAdapter(prisma).load({
  projectId,
  propertyId: property.id,
  selectedGscSnapshotIds,
  sourceDateFrom: windowStart,
  sourceDateTo: windowEnd
});

const facts = searchSource.scoringFacts;
```

Only `searchSource.scoringFacts` feed the existing current/previous filtering, aggregate construction, demand percentiles, CTR curve, scoring, detectors, topics, and lifecycle logic.

The service also fails closed on malformed adapted dates: only real `Date` values inside the requested current/previous windows are allowed into the corresponding scoring aggregates.

No network provider function is invoked by the Growth materializer.

## Provenance contract

P9-0G adds versioned bounded search-source metadata under the existing immutable Growth `sourceProvenance` JSON.

The provenance version is:

```text
GROWTH_SEARCH_PROVENANCE_V1
```

### Configured example

```json
{
  "materializationVersion": "GROWTH_MATERIALIZATION_V1",
  "evidenceVersion": "GROWTH_EVIDENCE_V1",
  "gscSnapshotIds": ["raw-gsc-snapshot-id"],
  "searchFacts": {
    "version": "GROWTH_SEARCH_PROVENANCE_V1",
    "mode": "CONFIGURED_MARKET",
    "scoringLane": {
      "provider": "GOOGLE_SEARCH_CONSOLE",
      "factKind": "QUERY_PAGE",
      "snapshotIds": ["normalized-search-fact-snapshot-id"],
      "sourceRefs": ["raw-gsc-snapshot-id"],
      "marketProjections": [
        {
          "marketCode": "GLOBAL",
          "locale": "zh-CN",
          "propertyRef": "https://example.com/"
        }
      ]
    },
    "corroboratingLanes": [
      {
        "provider": "BING_WEBMASTER",
        "marketCode": "GLOBAL",
        "locale": "zh-CN",
        "propertyRef": "https://example.com/",
        "factKinds": ["PAGE", "QUERY"],
        "snapshotIds": ["bing-search-fact-snapshot-id"],
        "sourceCompleteness": ["PROVIDER_UNSPECIFIED"]
      }
    ]
  }
}
```

### Legacy example

```json
{
  "searchFacts": {
    "version": "GROWTH_SEARCH_PROVENANCE_V1",
    "mode": "UNCONFIGURED_LEGACY",
    "scoringLane": {
      "provider": "GOOGLE_SEARCH_CONSOLE",
      "source": "RAW_GSC_COMPATIBILITY",
      "gscSnapshotIds": ["raw-gsc-snapshot-id"]
    },
    "corroboratingLanes": []
  }
}
```

Provider payload bodies, metric collections, credentials, authorization data, cookies, and AI reasoning are not copied into Growth provenance.

## Project and market isolation

The source adapter validates the selected GSC property and selected completed daily snapshots against the requested project and property.

Configured unified reads are constrained by:

- project
- provider
- enabled market
- locale
- property reference
- source date range
- scoring fact kind where applicable

Disabled `ProjectMarket` rows are not queried. Cross-project facts cannot satisfy the adapter's configured reads. A selected raw GSC snapshot that does not belong to the requested project/property or stable-window range is rejected before scoring.

## Configured failure semantics

Configured mode is intentionally fail-closed.

Examples include:

- selected GSC source identity mismatch;
- selected GSC snapshot not completed;
- normalized Google fact source not traceable to the selected snapshot set;
- required Google metric missing;
- required Google metric with non-`KNOWN_PRESENT` evidence;
- contradictory multi-market projection;
- malformed fact/query/page/normalization identity;
- invalid numeric metric value.

A configured failure does not switch to `UNCONFIGURED_LEGACY`. The raw source snapshot also remains authoritative and completed; P9-0G does not roll it back as compensation for downstream failure.

## Security and data minimization

P9-0G is a database-only Growth source adapter.

It does not:

- call Google, Bing, Baidu, or other search-provider APIs;
- decrypt or read provider credentials;
- persist auth headers/tokens/cookies in Growth provenance;
- persist arbitrary upstream provider response bodies;
- persist AI chain-of-thought or AI reconciliation decisions;
- scrape consumer search interfaces.

Growth provenance contains bounded identifiers and provider/market coverage summaries only.

## Schema and migration impact

P9-0G requires **no Prisma schema migration**.

It uses the existing P9-0F unified search-fact schema and the existing JSON provenance fields on Growth snapshots. P7 Growth rows are not rewritten or backfilled.

## Historical compatibility

Existing historical Growth snapshots, opportunity identities, lifecycle events, and topic snapshots remain immutable and are not migrated.

Historical no-market projects continue to materialize through explicit `UNCONFIGURED_LEGACY` mode. New configured-market materializations may carry richer provider provenance while retaining the same P7 opportunity identity and formula version.

Provider and market scope are not added to `GrowthOpportunityIdentity` keys in P9-0G.

## Rollback guidance

P9-0G rollback is additive and code-path based.

A rollback may remove or disable the P9-0G Growth adapter integration in a later code change, but it must not:

- delete P9-0F normalized search facts;
- delete provider observation batches;
- rewrite completed raw GSC snapshots;
- rewrite or delete immutable Growth snapshots;
- rewrite Growth identities/lifecycle/topic history;
- run a destructive data backfill to erase `searchFacts` provenance.

Historical normalized facts and Growth provenance remain useful audit evidence even if a later release changes the active source-selection policy.

## Verification coverage

P9-0G regression coverage locks the following behaviors:

- configured projects materialize selected GSC sources into P9-0F and score unified Google facts;
- projects with no enabled market retain exact raw-GSC legacy behavior;
- configured failures do not silently fall back to raw GSC;
- one raw Google observation projected to multiple markets contributes once to scoring;
- conflicting projections fail closed;
- exact Google metric semantics are required;
- unknown required Google scoring metrics are not converted to zero;
- Bing query/page/site facts remain corroborating-only;
- Bing cannot synthesize query-page scoring facts or CTR;
- Bing numeric extremes do not change P7 score/opportunity/topic results;
- disabled markets, unfinished normalized snapshots, and cross-project facts are excluded by the relevant source boundaries;
- Growth materialization makes zero external provider/AI calls;
- existing cannibalization, new-content, topic, lifecycle, score, and evidence regressions remain green;
- P9-0F materializer/repository regression tests remain green.

## Release gate

P9-0G is releasable only after the final exact PR head has fresh successful GitHub Actions results for:

```text
verify
production-audit
e2e
```

The `verify` job must include successful Prisma validation/generation/migration deployment, TypeScript typecheck, full Vitest, and build.

PR #153 remains Draft until the final exact-head CI and release diff review are clean. P9-0G must remain unmerged until a separate explicit human `合并` command.