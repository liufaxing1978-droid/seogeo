# P7-A Growth Opportunity Intelligence — Design

Date: 2026-08-20
Status: Approved direction in chat; written-spec review pending
Repository: `liufaxing1978-droid/seogeo`
Base: P0-P6 complete on `main` at `dd4b24a2e61bfc978d4eff380288777a48e47e61`

## 1. Goal

P7-A turns the deterministic facts already produced by P2/P3/P5/P6, plus real Google Search Console performance data, into a single auditable answer to:

> What should this project optimize next, and why is it more important than the other available opportunities?

P7-A is a **growth decision layer**, not another audit engine and not an automation executor.

The primary product object is an immutable, versioned `GROWTH_OPPORTUNITY_V1` snapshot built around a stable Query + Page identity, with deterministic scoring, evidence provenance, lifecycle tracking, topic rollups, keyword-cannibalization detection, and conservative new-content discovery.

The end-to-end boundary is:

```text
Google Search Console OAuth / Search Analytics API
  -> immutable daily GSC facts
  -> stable 28-day current + previous windows
  -> persisted P2/P3/P5/P6 deterministic facts
  -> deterministic opportunity detection / scoring / dedupe
  -> immutable Growth Opportunity snapshots
  -> lifecycle + page/topic/project rollups
  -> Growth Opportunity Center / dashboards / API
  -> optional user-triggered P4 DeepSeek explanation
```

P7-A decides **what deserves attention**. P8 will decide **how approved work is executed**. P9 may later coordinate autonomous agents over the same deterministic P7/P8 contracts.

## 2. Chosen approach

Use two new modules with a strict source-of-truth boundary:

```text
src/modules/search-console
src/modules/growth
```

`search-console` owns Google OAuth, Search Console property binding, daily synchronization, immutable GSC facts, source freshness, and synchronization health.

`growth` owns opportunity identity, immutable snapshots, evidence normalization/deduplication, score calculation, opportunity detection, keyword cannibalization, new-content detection, topic clustering/rollups, lifecycle reconciliation, API/UI reads, and optional advisory AI explanation.

Rejected alternatives:

1. **Put everything inside `growth`** — initially smaller, but mixes external-account/token concerns with deterministic decision logic and makes later P8/P9 boundaries harder to enforce.
2. **Scatter growth logic across SEO/Content/Visibility modules** — minimizes new files but duplicates prioritization semantics and makes cross-module evidence impossible to audit as one decision.
3. **Let AI rank opportunities** — rejected because identical persisted facts must produce identical ordering and because AI output must remain advisory rather than authoritative.

## 3. Core principles

P7-A follows the existing platform rules established through P6:

- authoritative facts are deterministic and replayable;
- immutable materialized facts are never silently rewritten;
- `UNKNOWN` is not zero;
- query/render paths do not trigger paid/external work;
- DeepSeek may explain, summarize, prioritize in prose, and recommend investigation, but it cannot change deterministic facts or score values;
- all high-value decisions retain provenance and formula/version metadata;
- historical interpretation is frozen to the evidence and formula version that existed when the snapshot was materialized;
- automation and site mutation are out of scope for P7-A.

## 4. Non-goals

P7-A does not:

- automatically edit titles, descriptions, content, canonical tags, redirects, internal links, schema, or CMS content;
- automatically execute 301 redirects or canonical changes for keyword cannibalization;
- automatically create pages for `NEW_CONTENT_OPPORTUNITY`;
- use DeepSeek to calculate Opportunity Score, choose Priority, detect cannibalization, decide Topic membership, or fabricate missing search demand;
- use external SEO keyword-volume databases in V1;
- integrate Bing Webmaster Tools or third-party rank trackers in V1;
- treat Google Search Console Search Analytics as a complete global keyword corpus;
- trigger P6 provider sampling during growth materialization;
- rerun P2/P3/P5 rules during normal Growth Center rendering;
- put Google OAuth access/refresh tokens into growth snapshots, logs, HTML, reports, or AI inputs;
- build P8 execution workflows or P9 autonomous orchestration.

## 5. Authoritative source boundary

P7-A may consume persisted, project-scoped facts from:

- Google Search Console daily Query + Page Search Analytics rows;
- P2 SEO issue/rule facts;
- P3 GEO readiness, Entity, and Citability facts;
- P5 Content Intelligence facts and deterministic content opportunities;
- P5 Competitor Intelligence facts when a deterministic page/topic relationship exists;
- P6 Visibility metrics, compatible comparisons, competitor SOV, and deterministic alerts;
- project/plan/feature-gate state;
- previously persisted P7-A opportunity, lifecycle, and topic facts.

P7-A must not convert missing upstream evidence into a PASS or zero score.

## 6. Google Search Console connection

### 6.1 Authorization

P7-A uses **Google OAuth 2.0** with Search Console read-only access.

The intended scope is:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

The OAuth flow must use anti-CSRF `state` validation. Long-lived credentials must be stored through the server-side encrypted credential/secret mechanism selected by the implementation plan, not in general business tables.

Business persistence stores only a reference to the credential material and safe connection metadata.

### 6.2 SearchConsoleConnection

Suggested fields:

- `id`
- `projectId`
- `googleAccountRef` — non-secret stable account reference where available
- `credentialRef` — opaque reference to encrypted OAuth credential material
- `status`
- `connectedAt`
- `revokedAt`
- `lastVerifiedAt`

Suggested statuses:

- `CONNECTED`
- `TOKEN_REVOKED`
- `PERMISSION_DENIED`
- `DISCONNECTED`

A revoked or unusable token fails closed. P7-A must not continue to present stale connection health as current.

### 6.3 SearchConsoleProperty

A Search Console property binding is separate from the OAuth connection.

Suggested fields:

- `id`
- `connectionId`
- `projectId`
- `propertyUri`
- `propertyType`
- `permissionState`
- `isActive`
- `lastSyncAt`

V1 supports one active primary Search Console property per project. The model must not prevent a later multi-property extension.

The server validates that the authorized account can read the selected property before activating the binding.

## 7. GSC daily fact model

### 7.1 GscDailySnapshot

Search Console is synchronized into daily immutable facts rather than queried on every Growth Center request.

Suggested fields:

- `id`
- `projectId`
- `propertyId`
- `date`
- `status`
- `syncVersion`
- `inputHash`
- `rowCount`
- `sourceFreshness`
- `startedAt`
- `completedAt`
- `createdAt`

Status:

```text
PENDING -> RUNNING -> COMPLETED | FAILED
```

A completed snapshot is immutable. If a source day must be re-imported because Google later exposes corrected/finalized data, a new version is created and the prior completed version remains auditable.

The authoritative current version selector is deterministic and must be recorded by downstream materialization provenance.

### 7.2 GscQueryPageFact

The V1 authoritative growth unit is Query + canonical Page.

Suggested fields:

- `id`
- `snapshotId`
- `projectId`
- `date`
- `query`
- `normalizedQuery`
- `page`
- `canonicalPage`
- `clicks`
- `impressions`
- `ctr`
- `position`

V1 scores the overall Query + Page view. Country/device dimensions may be retained by a future source model, but they do not create independent authoritative opportunity scores in P7-A V1.

Query normalization is deterministic and versioned. It includes safe normalization such as Unicode normalization, case normalization where applicable, whitespace/punctuation normalization, Simplified/Traditional alias normalization when a deterministic mapping is configured, and explicit project alias mapping. It does not use an LLM.

Canonical-page normalization must reuse or remain compatible with the project’s existing URL/canonical semantics. Canonically equivalent URLs must not become separate cannibalization actors.

## 8. Stable measurement windows

P7-A uses a default **28-day stable current window** and the immediately preceding **28-day comparison window**.

The default source cutoff excludes the most recent **3 calendar days** so recent incomplete Search Console data does not dominate prioritization.

Example on 2026-08-20:

```text
cutoff date: 2026-08-17
current window:  2026-07-21 .. 2026-08-17  (28 days)
previous window: 2026-06-23 .. 2026-07-20  (28 days)
```

Every materialized snapshot freezes:

- `currentWindowStart`
- `currentWindowEnd`
- `previousWindowStart`
- `previousWindowEnd`
- `dataCutoffAt`
- selected GSC daily snapshot/version provenance

The implementation must not relabel a different or incomplete range as the same 28-day contract.

## 9. Growth opportunity persistence

### 9.1 GrowthOpportunityIdentity

This is the long-lived identity for one logical opportunity. It does not store a mutable current score.

Suggested fields:

- `id`
- `projectId`
- `opportunityKey`
- `identityVersion`
- `primaryIdentityType`
- `normalizedQuery`
- `canonicalPage`
- `topicClusterId`
- `createdAt`

Normal Query + Page identity:

```text
projectId + opportunityType + normalizedQuery + canonicalPage
```

Keyword-cannibalization identity:

```text
projectId + KEYWORD_CANNIBALIZATION + normalizedQuery + sortedCanonicalPages
```

The serialized identity is hashed into a deterministic `opportunityKey`. Sorted page identity prevents Page A/Page B order changes from creating duplicates.

### 9.2 GrowthOpportunitySnapshot

Immutable authoritative version:

```text
GROWTH_OPPORTUNITY_V1
```

Suggested fields:

- `id`
- `opportunityIdentityId`
- `projectId`
- `snapshotVersion`
- `formulaVersion`
- `currentWindowStart`
- `currentWindowEnd`
- `previousWindowStart`
- `previousWindowEnd`
- `dataCutoffAt`
- `primaryType`
- `secondaryTypes`
- `score`
- `priority`
- `scoreState`
- `evidenceQuality`
- `evidenceCoverage`
- `rankingEligible`
- `createdAt`

A materialized snapshot is never updated in place. New stable windows create new snapshots under the same stable opportunity identity when the logical opportunity persists.

### 9.3 GrowthScoreBreakdown

Suggested fields:

- `snapshotId`
- `demandScore`
- `positionPotentialScore`
- `ctrGapScore`
- `siteGapScore`
- `trendVisibilityScore`
- `availableWeight`
- `evidenceCoverage`
- `weightedTotal`
- `formulaVersion`

All component states must be retained. A null score carries an explicit state such as `UNKNOWN` or `NOT_APPLICABLE`; null is not inferred to mean zero.

### 9.4 GrowthOpportunityEvidence

Suggested fields:

- `id`
- `snapshotId`
- `sourceModule`
- `sourceType`
- `sourceId`
- `sourceFactVersion`
- `ruleKey`
- `rootCauseKey`
- `evidenceState`
- `severity`
- `numericValue`
- `textSummary`
- `fingerprint`
- `createdAt`

Allowed source modules include:

- `GSC`
- `P2_SEO`
- `P3_GEO`
- `P3_ENTITY`
- `P3_CITABILITY`
- `P5_CONTENT`
- `P5_COMPETITOR`
- `P6_VISIBILITY`
- `P6_ALERT`

Evidence fingerprint is deterministic over the stable source identity, rule identity, and source fact version.

Multiple provenance rows may refer to the same root cause, but the scoring engine counts one root-cause evidence group once. For example, a P5 content rule that directly wraps the same P3 Citability fact may remain visible as provenance without double-counting the Citability deficit.

## 10. Opportunity lifecycle

Snapshot facts and workflow state are separated.

### 10.1 GrowthOpportunityLifecycle

Suggested statuses:

```text
NEW
REVIEWED
PLANNED
IN_PROGRESS
DONE
DISMISSED
RESOLVED
REOPENED
```

User-driven normal path:

```text
NEW -> REVIEWED -> PLANNED -> IN_PROGRESS -> DONE
```

`DISMISSED` is a manual side path.

`RESOLVED` and `REOPENED` are deterministic data-state transitions; they do not mutate old snapshots.

Suggested fields:

- `opportunityIdentityId`
- `status`
- `latestSnapshotId`
- `reviewedAt`
- `plannedAt`
- `startedAt`
- `doneAt`
- `dismissedAt`
- `resolvedAt`
- `reopenedAt`
- `updatedAt`

The system may not automatically mark `PLANNED` or `IN_PROGRESS` as `DONE`.

### 10.2 GrowthOpportunityLifecycleEvent

Every state change is append-only and auditable.

Event types include:

- `CREATED`
- `REVIEWED`
- `PLANNED`
- `STARTED`
- `DONE`
- `DISMISSED`
- `AUTO_RESOLVED`
- `AUTO_REOPENED`

Suggested fields:

- `id`
- `opportunityIdentityId`
- `actorType`
- `actorId`
- `fromStatus`
- `toStatus`
- `reasonCode`
- `createdAt`

### 10.3 Automatic resolution

An active opportunity may transition to `RESOLVED` only when deterministic evidence shows either:

- it no longer satisfies its trigger for **two consecutive stable materialization windows**; or
- its authoritative score remains below `25` for **two consecutive stable windows** and the trigger-specific evidence no longer indicates an actionable high-severity condition.

The two-window rule prevents one noisy window from erasing a real opportunity.

A manual `DISMISSED` opportunity does not auto-reopen in V1.

A previously `DONE` or `RESOLVED` opportunity that again satisfies the same stable identity trigger becomes `REOPENED`, preserving all prior lifecycle history.

## 11. Opportunity Catalog V1

P7-A V1 supports nine authoritative opportunity types.

### 11.1 `RANKING_UPSIDE`

A Query + Page has real demand and a position range with practical room to improve. Position 4-20 is the strongest V1 ranking-upside region.

### 11.2 `CTR_UNDERPERFORMANCE`

A Query + Page has sufficient demand and actual CTR materially below the project’s own expected CTR curve for the matching position bucket.

### 11.3 `SEO_GAP`

P2 provides deterministic SEO issue evidence attached to the relevant page. P7-A does not rerun the P2 rule engine.

### 11.4 `GEO_CITABILITY_GAP`

P3 provides deterministic GEO/Citability/Entity readiness evidence indicating an actionable page gap.

### 11.5 `CONTENT_GAP`

P5 Content Intelligence provides deterministic content evidence such as title/H1/basic completeness, content depth, heading structure, internal-link support, structured-data support, entity support, or citability support.

### 11.6 `AI_VISIBILITY_GAP`

Persisted P6 evidence shows weak/declining Mention Rate, Citation Rate, SOV, competitor SOV relationship, compatible visibility comparison, or deterministic visibility alerts.

P7-A never triggers provider sampling to create this opportunity.

### 11.7 `DECLINING_PERFORMANCE`

Current 28-day GSC performance is deterministically worse than the previous 28-day window in one or more of impressions, clicks, CTR, or average position.

### 11.8 `KEYWORD_CANNIBALIZATION`

One normalized Query is materially split across multiple canonical pages under the balanced deterministic detector in section 15.

### 11.9 `NEW_CONTENT_OPPORTUNITY`

A high-demand Query lacks a strong existing landing-page owner, has supporting P3/P5 coverage-gap evidence, and passes the conservative detector in section 16.

P7-A presents this as **“evaluate a dedicated content page”**, not as a command to create one.

## 12. Primary type and secondary types

A normal Query + Page produces one main opportunity snapshot, not one duplicate row per detected problem.

The snapshot may contain one `primaryType` and multiple `secondaryTypes`.

Example:

```text
query: 六壬
page: /liuren-history
score: 84 / HIGH
primaryType: RANKING_UPSIDE
secondaryTypes:
  - CTR_UNDERPERFORMANCE
  - CONTENT_GAP
  - GEO_CITABILITY_GAP
  - AI_VISIBILITY_GAP
```

`KEYWORD_CANNIBALIZATION` and `NEW_CONTENT_OPPORTUNITY` are special identities and are not merged into an unrelated single-page identity.

For a normal Query + Page, primary type is chosen deterministically by the triggered type contributing the greatest weighted opportunity signal. Ties use a versioned fixed catalog order. DeepSeek does not choose the primary type.

## 13. Opportunity Score V1

Formula:

```text
Opportunity Score =
  Demand                  * 30%
+ Position Potential      * 25%
+ CTR Gap                 * 20%
+ Site Gap                * 15%
+ Trend / Visibility Gap  * 10%
```

Each available dimension is normalized to 0-100 before weighting.

The formula version is persisted as a stable constant, initially:

```text
GROWTH_SCORE_V1
```

### 13.1 Demand Score — 30%

Demand is based on current-window Query + Page GSC impressions relative to other eligible Query + Page rows in the same project/window.

V1 percentile bands:

| Project demand band | Score |
| --- | ---: |
| Top 10% | 100 |
| Top 25% | 85 |
| Top 50% | 65 |
| Top 75% | 40 |
| Bottom 25% | 20 |
| 0 impressions | 0 |
| No valid GSC evidence | UNKNOWN |

The percentile thresholds used by a materialization are frozen in provenance so historical scores are not reinterpreted against future traffic distributions.

### 13.2 Position Potential — 25%

| GSC average position | Score |
| --- | ---: |
| 4-10 | 100 |
| 11-20 | 85 |
| 21-30 | 60 |
| 1-3 | 40 |
| 31-50 | 30 |
| >50 | 10 |
| Missing/invalid | UNKNOWN |

Position 1-3 remains valuable, but V1 treats it mainly as a CTR/defense opportunity rather than maximum ranking upside.

### 13.3 CTR Gap — 20%

P7-A uses the project’s own historical CTR curve, not a web-wide industry benchmark.

Initial position buckets:

```text
1
2
3
4-5
6-10
11-20
21-30
31-50
>50
```

For each bucket, `PROJECT_CTR_CURVE_V1` uses the median CTR of eligible historical Query + Page rows. V1 eligibility requires at least 10 impressions for an individual sample row and at least 30 eligible samples in the bucket. If a bucket lacks 30 eligible samples, expected CTR for that bucket is `UNKNOWN`; V1 does not silently borrow an industry curve.

For a known expected CTR:

```text
gapRatio = max(0, (expectedCtr - actualCtr) / expectedCtr)
```

If `expectedCtr <= 0`, CTR Gap is `UNKNOWN` rather than dividing by zero.

| Gap ratio | Score |
| --- | ---: |
| >=60% | 100 |
| 40-59% | 80 |
| 20-39% | 60 |
| 5-19% | 30 |
| <5% | 0 |

### 13.4 Site Gap — 15%

Site Gap consumes valid P2/P3/P5 evidence after root-cause deduplication.

Severity mapping:

| Evidence | Severity units |
| --- | ---: |
| HIGH | 100 |
| MEDIUM | 60 |
| LOW | 30 |
| INFO | 10 |
| PASS | 0 |
| UNKNOWN | excluded from denominator |

V1 Site Gap is the arithmetic mean of unique valid root-cause severity units for the page.

If no eligible Site Gap evidence exists because the upstream state is genuinely not applicable, the dimension is `NOT_APPLICABLE`. If evidence should exist but is unavailable/unknown, the dimension is `UNKNOWN`.

### 13.5 Trend / Visibility Gap — 10%

Internal split:

```text
GSC trend signal:       60%
P6 visibility signal:  40%
```

GSC compares current vs previous 28-day windows for:

- impressions;
- clicks;
- CTR;
- average position, where a higher numeric position is worse.

Each comparable metric produces a deterministic degradation signal. Missing metrics are excluded rather than treated as zero. The component is `UNKNOWN` when no GSC trend metric is comparable.

The P6 component consumes only persisted compatible P6 metric/comparison/alert facts. Missing P6 evidence is `UNKNOWN` and does not create an artificial visibility penalty.

## 14. Missing-weight and evidence-quality contract

For each available dimension:

```text
weightedContribution = dimensionScore * dimensionWeight
availableWeight = sum(weights whose state is KNOWN)
normalizedScore = round(sum(weightedContribution) / availableWeight)
evidenceCoverage = availableWeight / 100
```

The normalization keeps the score on a 0-100 scale without treating missing dimensions as zero.

V1 states:

- `availableWeight = 100` -> score is calculated, `evidenceQuality=COMPLETE`, `rankingEligible=true`;
- `70 <= availableWeight < 100` -> score is calculated, `evidenceQuality=PARTIAL`, `rankingEligible=true`;
- `50 <= availableWeight < 70` -> a diagnostic normalized score and priority may be displayed with `evidenceQuality=PARTIAL`, but `rankingEligible=false`; it is excluded from the default Top Opportunities ranking;
- `availableWeight < 50` -> authoritative score/priority are `UNKNOWN`, `rankingEligible=false`.

This resolves the distinction between a useful partial diagnostic and a score reliable enough to drive project-wide ordering.

Priority mapping for a calculated score:

| Score | Priority |
| --- | --- |
| 85-100 | CRITICAL |
| 70-84 | HIGH |
| 50-69 | MEDIUM |
| 25-49 | LOW |
| 0-24 | MONITOR |
| Score unknown | UNKNOWN |

Evidence quality is displayed separately from priority, so `HIGH / PARTIAL` is valid.

## 15. Keyword Cannibalization Detector V1

The V1 detector is intentionally balanced rather than hypersensitive.

### 15.1 Candidate requirements

For one normalized Query in one current stable window:

- at least two distinct canonical pages have valid impressions;
- canonical-equivalent URLs are collapsed before evaluation;
- the Query passes the same project demand floor used to suppress low-volume noise;
- each candidate page retains impressions, clicks, CTR, and average position provenance.

### 15.2 Competitive share

For each page:

```text
pageShare = pageImpressions / totalQueryImpressions
```

At least two pages must have `pageShare >= 20%`, and no dominant page may have `pageShare >= 80%`.

### 15.3 Ranking competition

At least one of these must hold:

- two material pages both have average position <=30; or
- their average-position difference is <=10.

### 15.4 Primary-page candidate

P7-A may recommend a deterministic primary-page candidate for investigation, but it may not execute a redirect/canonical/content merge.

Tie-break order:

1. higher impressions share;
2. better average position;
3. higher CTR;
4. stronger deduplicated P3/P5 content/entity evidence.

If the evidence does not establish a meaningful winner, the candidate is `UNKNOWN`.

### 15.5 Persisted evidence

A cannibalization snapshot records the sorted competing canonical pages and each page’s impressions, share, clicks, CTR, position, supporting content/entity evidence, reason codes, and primary-page candidate state.

The V1 detector must cap competing pages at 20 per Query.

## 16. New Content Detector V1

`NEW_CONTENT_OPPORTUNITY` is conservative and evaluated only after cannibalization handling.

All required conditions:

- Demand Score >=65;
- Query impressions are at or above the project’s current-window P50 demand threshold;
- the best existing page has average position >20;
- no page owns >=70% of Query impressions;
- at least one valid P3/P5 content, entity, or citability coverage gap exists;
- deterministic canonical/topic checks do not identify an already strong duplicate landing page;
- evidence coverage satisfies the detector’s minimum authoritative requirements;
- no active `KEYWORD_CANNIBALIZATION` identity for the same normalized Query is selected as the primary issue for the window.

If a required input is unknown, the detector returns an explicit unknown/ineligible reason instead of inferring that new content is needed.

The UI wording is advisory: **“建议评估新建专门内容页 / Evaluate a dedicated content page.”**

## 17. Topic Cluster V1

Topic clustering is deterministic.

Primary authority:

1. existing P3 Entity / Topic relationships;
2. explicit project alias/normalization maps;
3. deterministic normalized primary Query fallback.

DeepSeek and embeddings do not establish authoritative membership in V1.

Unresolved Queries remain `UNCLUSTERED` rather than being forced into a topic.

### 17.1 GrowthTopicCluster

Suggested fields:

- `id`
- `projectId`
- `topicKey`
- `topicIdentityVersion`
- `primaryEntityId`
- `primaryQuery`
- `createdAt`

Stable identity is based on `projectId + normalizedPrimaryEntityOrTopicKey`.

### 17.2 GrowthTopicClusterSnapshot

Each stable window creates an immutable topic snapshot with:

- member Query identities;
- member page identities;
- total impressions;
- total clicks;
- CTR;
- demand-weighted position;
- top Opportunity Score;
- aggregated Topic Score;
- evidence coverage;
- trend/visibility state;
- current/previous window provenance.

V1 Topic Score:

```text
Top Opportunity signal         50%
Demand-weighted opportunities  30%
Trend / AI Visibility signal   20%
```

Unknown sub-signals follow the same non-zero-coercion principle and record coverage.

Priority uses the same CRITICAL/HIGH/MEDIUM/LOW/MONITOR thresholds.

## 18. Materialization pipeline

Authoritative P7-A materialization is database-driven after GSC facts are persisted.

```text
GSC Daily Sync
  -> immutable Daily Snapshots / QueryPage Facts
  -> Stable Window Resolver
  -> Current 28d aggregate
  -> Previous 28d aggregate
  -> PROJECT_CTR_CURVE_V1
  -> P2/P3/P5/P6 persisted fact join
  -> Evidence normalization + root-cause dedupe
  -> Opportunity type detection
  -> Cannibalization detector
  -> New Content detector
  -> GROWTH_SCORE_V1
  -> stable Opportunity identity resolution
  -> immutable Opportunity snapshots
  -> Topic Cluster snapshots
  -> Lifecycle reconciliation
  -> safe observability
```

Normal materialization makes **zero Google API calls, zero P6 provider calls, and zero DeepSeek calls**.

A Growth Center GET request also makes zero external calls and performs no authoritative recomputation.

## 19. Queue and worker design

### 19.1 `search-console-sync`

Responsibilities:

- validate active connection/property;
- refresh OAuth credentials through the secret mechanism when needed;
- fetch one bounded source day at a time;
- normalize and persist Query + Page facts;
- finalize immutable daily snapshot/version;
- emit safe lifecycle observability.

Failure classes include:

- `TOKEN_REVOKED`
- `PERMISSION_DENIED`
- `PROPERTY_UNAVAILABLE`
- `RATE_LIMITED`
- `TRANSIENT_PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `PERSISTENCE_FAILED`

Retries must be bounded and must not create duplicate completed daily facts.

### 19.2 `growth-materialization`

Responsibilities:

- resolve stable windows;
- aggregate persisted GSC facts;
- calculate CTR curve;
- join persisted P2/P3/P5/P6 evidence;
- detect/dedupe opportunities;
- calculate deterministic scores;
- persist immutable snapshots and topic rollups;
- reconcile lifecycle.

The queue uses deterministic idempotency keys based on project, formula/materialization version, current/previous windows, data cutoff, and selected source-version identity.

## 20. REST API

### 20.1 Search Console API

Prefix:

```text
/api/projects/:projectId/search-console
```

V1 routes should cover:

- connection status;
- begin OAuth connection;
- OAuth callback handling;
- list authorized properties;
- bind/unbind active property;
- sync status and source freshness;
- bounded manual sync request;
- daily snapshot/history metadata.

OAuth callback routes may require a non-project-prefixed callback endpoint internally, but project association must be recovered through signed/validated state rather than user-controlled callback parameters.

### 20.2 Growth API

Prefix:

```text
/api/projects/:projectId/growth
```

V1 routes should cover:

- Opportunity list/filter/sort;
- Opportunity detail;
- score breakdown;
- evidence/provenance;
- snapshot history;
- lifecycle mutation under the allowed state machine;
- Topic Cluster list/detail;
- Cannibalization filtered view;
- New Content filtered view;
- explicit user-triggered DeepSeek explanation;
- project Growth summary for dashboard integration.

All list routes are bounded and paginated.

## 21. Web UI

### 21.1 Google Search Console settings

Project settings add a `Google Search Console` surface with states:

```text
NOT_CONNECTED
CONNECTED
PROPERTY_SELECTED
SYNCING
READY
TOKEN_REVOKED
PERMISSION_DENIED
PROPERTY_UNAVAILABLE
SYNC_FAILED
```

The screen clearly labels the integration **read-only** and displays:

- active property;
- last successful sync;
- latest complete source date;
- available date coverage;
- current connection/sync health.

### 21.2 Growth Opportunities Center

Primary product question:

> 现在最值得做什么？ / What should we optimize next?

Top summary:

- Top Opportunities;
- CRITICAL/HIGH counts;
- NEW / IN_PROGRESS / RESOLVED counts;
- GSC data freshness.

Default table fields:

- Priority;
- Score and Evidence Quality;
- Query;
- canonical Page;
- Primary Type;
- Demand;
- Position;
- CTR Gap;
- Evidence source badges;
- Trend;
- Lifecycle.

Default ordering uses `rankingEligible=true` and Opportunity Score descending. Low-evidence diagnostic scores do not outrank authoritative opportunities.

### 21.3 Opportunity detail

Sections:

1. deterministic “Why this opportunity” reason codes/summaries;
2. Score Breakdown;
3. current vs previous 28-day Search Performance;
4. Evidence grouped by GSC / SEO / GEO / Content / Competitor / AI Visibility;
5. Lifecycle actions;
6. separate optional `DeepSeek 分析这个机会` action/result.

AI output is visually separated from authoritative score/evidence.

### 21.4 Cannibalization view

Shows one Query with bounded competing page rows:

- impressions share;
- clicks;
- CTR;
- position;
- P3/P5 content/entity strength summary;
- deterministic reason codes;
- primary-page candidate when known.

P7-A provides no automatic redirect/canonical execution button.

### 21.5 New Content view

Shows:

- Query / Topic;
- Demand;
- current best page;
- current position;
- page ownership/share;
- supporting content/entity/citability gap;
- Topic Cluster;
- Opportunity Score;
- advisory “evaluate a dedicated content page” wording.

### 21.6 Growth Topics view

Shows Topic Score, member Query count, member pages, impressions, clicks, demand-weighted position, top opportunity, trend/visibility state, and drill-down to member opportunities.

## 22. Dashboard integration

P7-A extends the existing project dashboard rather than creating a second dashboard shell.

Project dashboard Growth Intelligence section may show:

- Top Opportunity Score;
- CRITICAL/HIGH opportunity count;
- Search impressions/click trend;
- top declining topic;
- top ranking upside;
- top cannibalization risk;
- GSC data freshness;
- link to the full Growth Opportunities Center.

Enterprise portfolio dashboard may show:

- project top opportunity;
- critical count;
- GSC connection/freshness health;
- opportunity trend;
- resolved opportunity count;
- cross-project priority ordering.

Dashboard rendering reads persisted P7-A summary facts only and does not call Google or DeepSeek.

## 23. Optional DeepSeek explanation

Add a new P4 advisory AI task, tentatively:

```text
GROWTH_OPPORTUNITY_EXPLANATION
```

It is explicitly user-triggered.

Allowed bounded inputs:

- Opportunity identity/type;
- deterministic score + breakdown;
- current/previous aggregate GSC metrics;
- selected deduplicated P2/P3/P5/P6 evidence summaries;
- evidence quality/unknown caveats;
- Topic context when applicable.

Expected output may include:

- why the opportunity matters now;
- recommended investigation/optimization direction;
- risks/caveats;
- suggested human next steps.

It may not mutate Opportunity Score, Priority, trigger state, Topic identity, lifecycle state, or upstream facts.

Raw OAuth credentials, raw provider reasoning, large private Query corpora, and unbounded evidence payloads are prohibited AI inputs.

## 24. Feature gates and plans

P7-A introduces explicit feature semantics rather than overloading P6/Reporting gates:

- `SEARCH_CONSOLE`
- `GROWTH_OPPORTUNITIES`
- `GROWTH_TOPIC_CLUSTERS`
- `GROWTH_CANNIBALIZATION`
- `GROWTH_NEW_CONTENT`
- `GROWTH_AI_EXPLANATION`
- `PORTFOLIO_GROWTH`

Recommended plan boundary:

### Standard

- connect one read-only Search Console property;
- basic GSC facts/health;
- basic Ranking/CTR opportunities;
- bounded Top Opportunities;
- basic deterministic Opportunity Score.

### Advanced

- full Opportunity Center;
- P2/P3/P5/P6 combined evidence;
- Topic Clusters;
- Cannibalization;
- New Content Opportunities;
- Opportunity history and lifecycle;
- AI Visibility contribution;
- explicit DeepSeek Opportunity Explanation.

### Enterprise

- Portfolio Growth Intelligence;
- cross-project prioritization;
- higher retention/capacity bounds defined by plan policy;
- future P8/P9 enterprise automation entry points.

Restricted features fail before restricted data reads or side effects.

## 25. Hard bounds

Initial V1 safety bounds:

- GSC Query + Page rows per project per source day: **25,000**;
- Growth candidates per materialization: **50,000**;
- persisted Opportunity snapshots per project/window: **10,000**;
- Opportunity API page size: **100**;
- Topic Clusters per project: **2,000**;
- member Queries per Topic Cluster snapshot: **500**;
- competing canonical pages per Cannibalization identity: **20**.

An implementation may use lower plan-specific bounds. It may not silently run unbounded work.

When Google returns only a bounded/top-row Search Analytics result set, P7-A records that source limitation and never labels the materialization as a complete universe of all searches.

## 26. Safe observability

Allowlisted lifecycle events include:

```text
gsc.connection.connected
gsc.connection.revoked
gsc.property.bound
gsc.sync.started
gsc.sync.completed
gsc.sync.failed
growth.materialization.started
growth.materialization.completed
growth.materialization.failed
growth.lifecycle.changed
growth.ai_explanation.completed
growth.ai_explanation.failed
```

Safe metadata may include:

- projectId;
- property ID/hash or safe internal ID;
- source date/window bounds;
- counts;
- duration;
- state;
- reason code;
- formula/materialization version.

Logs must not contain:

- OAuth access/refresh tokens;
- client secrets;
- full Google account credentials;
- unbounded Query lists;
- full Opportunity evidence payloads;
- raw AI prompt/response bodies;
- P6 provider raw bodies or reasoning.

## 27. Error and UNKNOWN semantics

P7-A must distinguish:

- zero — valid measured absence or zero value;
- `UNKNOWN` — evidence expected but unavailable/unreliable;
- `NOT_APPLICABLE` — dimension does not apply;
- `PARTIAL` — enough evidence exists for a bounded diagnostic/calculated result but the evidence set is incomplete;
- source failure — synchronization/materialization failed before authoritative output.

No error path writes a fabricated successful Opportunity snapshot.

A failed GSC source day must not be treated as a zero-impression day.

A missing P6 visibility fact must not penalize a project as if its Mention/Citation/SOV were zero.

## 28. Security and privacy

Required controls:

- read-only Google Search Console scope;
- OAuth state validation;
- encrypted/secret-managed credential storage through opaque `credentialRef`;
- no OAuth tokens in business snapshot tables;
- no secrets in logs, HTML, reports, or AI requests;
- project scoping on every connection/property/fact/opportunity route;
- plan gates before restricted reads or writes;
- bounded source and materialization workloads;
- idempotent daily synchronization and materialization;
- immutable historical facts;
- safe structured observability only.

## 29. Release gate

P7-A is release-ready only when fresh exact-head verification proves all of the following.

### 29.1 Search Console / OAuth

- only the intended read-only Search Console scope is requested;
- OAuth state validation rejects tampering/replay as designed;
- revoked/invalid credentials fail closed;
- unauthorized/unavailable properties cannot be bound or imported;
- CI/test runs use fixtures/mocks and do not call live Google APIs;
- duplicate synchronization cannot create duplicate completed daily facts;
- completed daily snapshot versions are immutable;
- source freshness and failed days are explicit.

### 29.2 Deterministic scoring

- identical persisted inputs + formula version produce identical score/breakdown;
- all five weight components and normalized-score math match `GROWTH_SCORE_V1`;
- `UNKNOWN` is never coerced to zero;
- evidence coverage and ranking eligibility follow section 14;
- Demand percentile bands are frozen per materialization;
- CTR curve minimum-sample rules are deterministic;
- root-cause evidence dedupe prevents double scoring;
- DeepSeek output cannot mutate or replace deterministic score/priority.

### 29.3 Detectors

- balanced Cannibalization rules pass positive/negative boundary tests;
- canonical-equivalent pages do not create false cannibalization;
- low-demand noise does not create a high-priority cannibalization opportunity;
- primary-page candidate tie-breaks are deterministic and may return UNKNOWN;
- conservative New Content rules pass positive/negative tests;
- active cannibalization prevents conflicting New Content recommendation for the same Query/window.

### 29.4 History and lifecycle

- stable opportunity identity remains stable across windows;
- old Opportunity and Topic snapshots remain immutable;
- two-window resolution rule is enforced;
- DONE/RESOLVED opportunity recurrence creates REOPENED without deleting prior events;
- DISMISSED does not auto-reopen in V1;
- system cannot auto-mark PLANNED/IN_PROGRESS as DONE.

### 29.5 Security / gates / observability

- Standard/Advanced/Enterprise feature gates match policy;
- restricted reads fail before restricted database reads or queue side effects;
- OAuth secrets never appear in logs, snapshots, rendered HTML, reports, or AI input fixtures;
- Growth Center/dashboard reads perform zero Google/P6-provider/DeepSeek calls;
- lifecycle observability is allowlisted and bounded.

### 29.6 Full project gate

The final exact head must pass the repository’s full verification path, including:

```text
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Production dependency audit and Chromium/browser smoke remain required CI jobs in the same spirit as P6.

## 30. Suggested implementation decomposition

The implementation plan should preserve the following dependency order, but exact Task numbering is deferred until the written spec is approved:

1. Search Console persistence + credential-reference boundary;
2. OAuth/property binding flow;
3. fixture-safe Search Console client + daily immutable synchronization;
4. GSC aggregation/window/CTR-curve primitives;
5. Growth persistence foundation: identity/snapshot/evidence/lifecycle/topic models;
6. evidence adapters/deduplication for P2/P3/P5/P6;
7. deterministic Opportunity Score V1;
8. Opportunity Catalog detection;
9. Cannibalization + New Content detectors;
10. materialization queue/worker + lifecycle reconciliation;
11. Growth REST API;
12. Search Console settings + Growth Opportunity Center + topic/special views;
13. project/portfolio dashboard integration;
14. optional P4 DeepSeek `GROWTH_OPPORTUNITY_EXPLANATION`;
15. safe observability/operator guide/final release gate.

The final implementation plan must break these into independently testable tasks and must use TDD for behavior changes.

## 31. Acceptance summary

P7-A succeeds when the system can take persisted real search demand/performance and existing deterministic SEO/GEO/Content/AI-Visibility evidence and produce a stable, auditable priority list where every authoritative opportunity can answer:

1. Why did this opportunity appear?
2. Why does it have this score and priority?
3. Which persisted facts were used?
4. Which evidence is missing or partial?
5. Why is it ranked above or below other opportunities?
6. How has the same logical opportunity changed across stable windows?

The defining boundary is:

> **P7-A identifies and prioritizes growth work. It does not execute site changes.**
