# P11-02B Official Search Sync & Query Discovery Design

Status: **APPROVED DESIGN**  
Date: **2026-08-30**  
Stacked base: `8d8e59a19ed40ffc99a320fc2bfcdddfd806447d` (`feat/p11-02a-official-search-evidence` closure head)  
Branch: `feat/p11-02b-official-search-sync`

## 1. Purpose

P11-02B turns the read-only search-evidence layer from P11-02A into an official-provider ingestion and query-discovery workflow.

The user outcome is:

> The platform can synchronize official Google Search Console and Bing Webmaster query evidence into the existing normalized `SearchFact` layer, discover real search queries that users used to reach or expose the site, compare those queries against the operator-controlled keyword library, and present untracked queries for human review without silently turning provider observations into strategic keywords.

Example:

- Google Search Console observes `六壬符纸怎么用`;
- the query has persisted impressions/clicks and Search Console average-position evidence;
- the exact normalized query is not yet an authoritative `Keyword`;
- P11-02B surfaces a pending discovery candidate with source/provenance;
- an authorized operator may explicitly accept it;
- only acceptance creates an authoritative keyword.

P11-02B is an **official provider synchronization and human-reviewed query-discovery layer**.

It is not a live SERP rank tracker, search-volume product, autonomous keyword strategy engine, or content generator.

## 2. Scope

P11-02B includes:

1. a project-scoped, non-secret provider-lane binding for provider/property/market/locale identity;
2. orchestration over the existing Google Search Console daily-sync path;
3. orchestration over the existing Bing Webmaster adapter/source-batch path;
4. deterministic materialization into the existing `SearchFact` layer;
5. idempotent sync commands with explicit provider/result states;
6. a deterministic query-discovery projection over completed `SearchFact` snapshots;
7. persisted human-review state for discovered queries;
8. explicit accept/reject workflow;
9. accepted discovery creating an authoritative `Keyword` using existing keyword identity rules;
10. project-scoped JSON APIs and Keyword Center UI integration;
11. observability for sync and discovery commands without credential leakage;
12. RED -> minimal GREEN -> exact-head CI execution.

## 3. Explicit Non-Goals

P11-02B does **not** include:

- scraping Google, Bing, Baidu, 360, Sogou, or Shenma SERPs;
- third-party rank-tracking APIs;
- deterministic/current SERP rank claims;
- Google Ads Keyword Planner or other search-volume APIs;
- AI-generated keyword acceptance;
- AI classification being authoritative;
- autonomous keyword creation;
- automatic content generation, publication, distribution, or URL submission;
- crawler execution as a side effect of provider sync or query discovery;
- P11-02C live SERP/history functionality;
- production deployment or merge authority changes.

Baidu, 360, Sogou, and Shenma remain represented by the existing provider registry. P11-02B must not fabricate query data for providers whose official query-level ingestion is not implemented.

## 4. Existing Repository Assets to Reuse

### 4.1 Google Search Console

The repository already has:

- OAuth credential vault and access-token flow;
- Search Console transport client;
- project/property persistence;
- daily sync worker;
- Query+Page normalization;
- idempotent authoritative daily snapshot behavior;
- `TOP_ROWS_ONLY` completeness semantics;
- Search Console observability.

P11-02B must orchestrate this existing path instead of implementing a second Google client or storing raw tokens in new tables.

### 4.2 Bing Webmaster

The repository already has:

- Bing Webmaster transport client;
- `BingSearchProviderAdapter`;
- `fetchQueryStats` / page/site methods;
- `SearchProviderSourceRepository.persistBingBatch`;
- deterministic source-batch hashing and duplicate rejection;
- `PROVIDER_UNSPECIFIED` completeness semantics.

P11-02B must compose these assets instead of introducing a parallel Bing evidence store.

### 4.3 Unified SearchFact layer

The repository already has:

- `SearchFactSnapshot`;
- `SearchFact`;
- `SearchFactMetric`;
- Google and Bing normalizers;
- `SearchFactMaterializer.materializeGoogleSnapshot`;
- `SearchFactMaterializer.materializeBingBatch`.

`SearchFact` remains the authoritative normalized evidence layer.

P11-02B must not create another table containing duplicate clicks, impressions, CTR, or position truth.

### 4.4 Authoritative Keyword library

P11-01 established:

- operator-owned `Keyword` identity;
- `KeywordType`, `KeywordIntent`, priority, status, lock semantics;
- exact project-scoped uniqueness via `normalizedText`;
- AI `KeywordSuggestion` as a separate advisory workflow.

`KeywordSuggestion` is **not** reused for official provider query discovery because it requires AI-specific provenance (`provider`, `model`, `aiTaskId`) and would incorrectly describe official search observations as AI suggestions.

## 5. Architecture Decision

Three approaches were considered.

### A. Compose existing provider paths behind a focused orchestration layer — selected

Pros:

- reuses tested Google/Bing transports and persistence;
- preserves one normalized evidence truth (`SearchFact`);
- minimizes credential/security changes;
- keeps provider-specific semantics explicit;
- scales to future official providers through adapters.

### B. Build a new universal provider-sync framework

Rejected for P11-02B because it would refactor already-working Google/Bing code before a concrete requirement justifies the cost.

### C. Build separate Google and Bing query-discovery products

Rejected because it would duplicate workflow/UI/domain logic and make future provider additions harder.

## 6. Authority and Truth Boundaries

The following boundaries are frozen:

- Provider APIs are authoritative only for the observations they actually return.
- Provider credentials authorize transport access; credential presence is not provider health.
- `SearchFact` is authoritative normalized provider evidence.
- `Keyword` is authoritative strategic demand controlled by the operator.
- A discovered provider query is not a keyword until explicitly accepted.
- Rejecting a discovered query does not delete or suppress underlying `SearchFact` evidence.
- Accepting a discovery does not mutate historical provider evidence.
- Google Search Console average position is not live/current Google rank.
- Bing average click/impression position is not deterministic current Bing rank.
- `TOP_ROWS_ONLY` or `PROVIDER_UNSPECIFIED` absence does not imply zero demand.
- Provider impressions are site-observed impressions, not global keyword search volume.
- Read routes never trigger provider synchronization.
- Sync routes never trigger crawl, AI, content generation, publication, distribution, or URL submission.

## 7. Provider Lane Binding

P11-02B adds a persisted, project-scoped **non-secret lane binding** so materialization does not infer market/locale from free-form keyword fields.

Suggested model:

```prisma
model SearchProviderLaneBinding {
  id          String             @id @default(uuid()) @db.Uuid
  projectId   String             @db.Uuid
  provider    SearchFactProvider
  propertyRef String
  marketCode  MarketCode
  locale      String
  isActive    Boolean            @default(true)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  @@unique([projectId, provider, propertyRef, marketCode, locale])
  @@index([projectId, provider, isActive])
}
```

### 7.1 Binding invariants

- no OAuth token, refresh token, Bing API key, or credential reference is stored here;
- `projectId` is mandatory and immutable after creation;
- provider/property identity must match an accessible configured provider property before a sync command may execute;
- `locale` must be nonblank and bounded;
- market must use the existing `MarketCode` enum;
- duplicate active identities are idempotent, not silently duplicated;
- inactive bindings cannot be synchronized;
- a read of the Keyword Center never creates or edits bindings.

### 7.2 Google property identity

Google bindings use the existing Search Console property URI (`sc-domain:...` or URL-prefix property URI) as `propertyRef`.

### 7.3 Bing property identity

Bing bindings use the verified site URL returned by Bing Webmaster as `propertyRef`.

## 8. Sync Command Model

P11-02B exposes explicit write commands. Provider synchronization never occurs as an incidental page read.

Suggested command boundary:

```ts
type OfficialSearchSyncCommand = {
  projectId: string;
  bindingId: string;
  dateFrom: string;
  dateTo: string;
};
```

### 8.1 Date bounds

- UTC `YYYY-MM-DD` only;
- `dateFrom <= dateTo`;
- no future dates;
- maximum command span: 31 UTC calendar days;
- UI default: trailing 7 completed UTC days ending yesterday;
- larger backfills must be submitted as multiple bounded commands.

The 31-day bound prevents one request from becoming an unbounded provider/API operation.

### 8.2 Authorization

Sync command requires:

- authenticated user;
- project membership;
- existing project write/admin permission used for provider operations;
- CSRF protection for web command routes.

Exact permission constant must reuse the repository's existing authority model; P11-02B must not invent a parallel role system.

Read-only discovery/evidence routes remain `PROJECT_READ`.

### 8.3 Idempotency

A repeated sync request for the same provider/property/lane/source date must converge on existing authoritative source/snapshot materialization where input identity is unchanged.

It must not create duplicate SearchFacts or count the same provider observation twice.

## 9. Google Synchronization Flow

For each requested UTC source date:

1. resolve active lane binding;
2. resolve the existing project-owned Search Console property;
3. invoke the existing Search Console daily sync command/worker path;
4. if the authoritative daily snapshot is already completed, reuse it;
5. otherwise fetch official Query+Page data using existing OAuth transport;
6. persist/complete the existing GSC daily snapshot;
7. call `SearchFactMaterializer.materializeGoogleSnapshot` with binding `marketCode` and `locale`;
8. return source snapshot and SearchFact snapshot identity.

### 9.1 Google completeness

Existing Google Query+Page ingestion is capped and marked `TOP_ROWS_ONLY`.

P11-02B must preserve this exact completeness state.

No API/UI copy may describe an absent Google query as zero searches or no ranking.

### 9.2 Google empty response

An official request returning zero Query+Page rows may still produce a completed source snapshot according to existing worker semantics, but downstream absence truth remains governed by completeness. `TOP_ROWS_ONLY` does not become `COMPLETE` merely because the response is empty.

## 10. Bing Synchronization Flow

For each bounded sync command:

1. resolve active Bing lane binding;
2. verify `propertyRef` is present in the adapter's verified properties;
3. call existing `BingSearchProviderAdapter.fetchQueryStats(propertyRef)`;
4. filter returned observations to the requested inclusive UTC date window;
5. sort deterministically;
6. reject invalid/empty transport content according to existing adapter/source repository rules;
7. persist one deterministic `SearchProviderObservationBatch` for the lane and command cutoff;
8. call `SearchFactMaterializer.materializeBingBatch`;
9. return source batch and SearchFact snapshot identity.

P11-02B query discovery uses Bing `QUERY_STATS`; page/site stats are not required for discovery.

### 10.1 Bing completeness

Existing Bing query observations are `PROVIDER_UNSPECIFIED`.

P11-02B preserves that state and does not upgrade it to `COMPLETE`.

### 10.2 Bing provider response window

If Bing's official endpoint returns a provider-defined historical range rather than a request-scoped day, the system persists only observations inside the explicit P11-02B command window for the discovery batch. The underlying transport contract is not misrepresented as a daily endpoint.

## 11. Sync Orchestrator

Add a focused orchestration module rather than merging provider-specific transport code.

Suggested files:

```text
src/modules/search-sync/official-search-sync.types.ts
src/modules/search-sync/official-search-sync.repository.ts
src/modules/search-sync/official-search-sync.service.ts
src/modules/search-sync/official-search-sync.routes.ts
src/modules/search-sync/official-search-sync.observability.ts
```

Responsibilities:

### types

- command/result types;
- provider-specific outcome states;
- public error codes.

### repository

- lane binding CRUD/read operations;
- project-scoped binding lookup;
- no credential decryption.

### service

- authorization-independent domain orchestration;
- date validation;
- property verification;
- provider dispatch;
- source persistence;
- SearchFact materialization;
- fail-closed error mapping.

### routes

- authentication/project authorization;
- CSRF on mutations;
- request parsing;
- no transport internals.

### observability

Safe fields only:

- event name;
- projectId;
- bindingId;
- provider;
- date range;
- state;
- normalized reason code;
- counts/duration where safe.

Never log access tokens, refresh tokens, Bing auth keys, Authorization headers, raw provider error bodies, or credential vault payloads.

## 12. Sync Result States

Per provider/date or bounded provider command, results use explicit states such as:

- `COMPLETED`
- `ALREADY_COMPLETED`
- `UNAVAILABLE`
- `FAILED`

`UNAVAILABLE` means the configured provider capability/path cannot execute; it never means the site has no search visibility.

Normalized failure reasons include, where applicable:

- `SYNC_NOT_CONFIGURED`
- `BINDING_NOT_FOUND`
- `BINDING_INACTIVE`
- `PROPERTY_UNAVAILABLE`
- `TOKEN_REVOKED`
- `PERMISSION_DENIED`
- `RATE_LIMITED`
- `TRANSIENT_PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `PERSISTENCE_FAILED`
- `MATERIALIZATION_FAILED`

Public responses must not expose provider secrets or raw stack traces.

## 13. Query Discovery Projection

After completed SearchFact materialization, P11-02B can project query candidates from persisted evidence.

The projection is deterministic and provider-independent over query-capable facts:

- Google: `QUERY_PAGE` facts;
- Bing: `QUERY` facts.

### 13.1 Candidate identity

Candidate matching uses the P11-02A bridge normalization:

```ts
normalizeSearchEvidenceQuery(query)
```

Candidate identity is project-scoped normalized query text, not provider-specific raw casing/spacing.

Traditional/Simplified forms remain distinct unless the operator later chooses to merge strategy manually.

### 13.2 Existing keyword check

A candidate is considered already tracked only when it matches the existing authoritative keyword identity under existing `Keyword.normalizedText` semantics.

The discovery module must not change `Keyword.normalizedText` rules merely to make SearchFact matching convenient.

If P11-02A bridge normalization and keyword identity produce different equivalence classes, the UI may show an evidence-match hint, but keyword creation must still obey the existing authoritative uniqueness contract.

### 13.3 Discovery aggregate

The list may display a bounded evidence summary derived from SearchFact, for example:

- providers observed;
- latest observed source date;
- observed impressions;
- observed clicks;
- provider-qualified average-position fields;
- observed pages for Google where available.

These metrics are read dynamically from SearchFact and are **not duplicated into the candidate persistence record**.

### 13.4 Default discovery window

Default: trailing 28 completed UTC days ending yesterday.

Maximum read window: 93 days, matching P11-02A evidence bounds.

## 14. Persisted Discovery Review State

P11-02B adds a dedicated persistence model because existing `KeywordSuggestion` is AI-specific and cannot truthfully represent provider-discovered search demand.

Suggested model:

```prisma
enum KeywordDiscoveryStatus {
  PENDING
  ACCEPTED
  REJECTED
}

model KeywordDiscoveryCandidate {
  id                String                 @id @default(uuid()) @db.Uuid
  projectId         String                 @db.Uuid
  normalizedQuery   String
  representativeText String
  status            KeywordDiscoveryStatus @default(PENDING)
  acceptedKeywordId String?                @db.Uuid
  firstObservedAt   DateTime
  lastObservedAt    DateTime
  decidedAt         DateTime?
  decidedByUserId   String?                @db.Uuid
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @updatedAt

  @@unique([projectId, normalizedQuery])
  @@index([projectId, status, lastObservedAt])
}
```

Final Prisma relations/naming should follow repository conventions, but semantics are frozen.

### 14.1 What is intentionally not stored

Do not store duplicated:

- clicks;
- impressions;
- CTR;
- average position;
- provider health;
- raw provider credentials.

Those are read from SearchFact/provider state at request time.

### 14.2 Representative text

`representativeText` is deterministic display text chosen from observed raw queries. A stable rule must be used, e.g. most recent observed raw form, tie-broken lexicographically.

It is not an operator-controlled keyword until acceptance.

### 14.3 Candidate upsert behavior

Projection refresh may:

- create a new `PENDING` candidate for a newly observed untracked normalized query;
- advance `lastObservedAt` for an existing candidate;
- preserve `REJECTED` state across repeated observation;
- preserve `ACCEPTED` state and accepted keyword link;
- never reset a human decision because the provider observed the query again.

## 15. Human Review Workflow

### 15.1 Accept

Acceptance requires project keyword-write authority and CSRF for web mutation.

In one transaction:

1. lock/read the project-scoped candidate;
2. require state `PENDING` or idempotently return existing accepted result;
3. create or resolve the authoritative `Keyword` using existing keyword service/identity rules;
4. set `acceptedKeywordId`;
5. set status `ACCEPTED`;
6. write the existing keyword audit trail with discovery provenance;
7. commit atomically.

Default keyword fields on acceptance:

- text: candidate representative text;
- source: **requires a new truthful source value such as `SEARCH_DISCOVERY_ACCEPTED`**, rather than pretending it was `MANUAL` or `AI_ACCEPTED`;
- type: conservative default determined by explicit non-AI deterministic rule or operator choice;
- intent: `UNKNOWN` unless the operator chooses it;
- priority: existing default `MEDIUM` unless operator chooses otherwise;
- status: `ACTIVE`.

Because `KeywordSource` currently has only `MANUAL` and `AI_ACCEPTED`, P11-02B requires a small Prisma enum migration for truthful provenance.

No AI call is required to accept a discovery.

### 15.2 Reject

Reject:

- marks only the candidate `REJECTED`;
- records actor/time;
- does not mutate SearchFact;
- does not delete the query from future evidence;
- remains idempotent.

### 15.3 Duplicate keyword race

If another actor creates the same authoritative keyword between candidate display and acceptance, acceptance resolves to that existing same-project keyword when identity matches and records the candidate as accepted to it; it must not create a duplicate or fail open across projects.

## 16. Discovery Refresh Command

Discovery persistence should be refreshed by an explicit deterministic command after sync/materialization, not by mutating state during a GET.

Suggested service:

```ts
refreshKeywordDiscoveries({
  projectId,
  dateFrom,
  dateTo
})
```

The sync orchestrator may invoke this command **after** SearchFact materialization as a same-workflow follow-up because discovery candidate refresh is an intended P11-02B write effect.

Important boundary:

- sync command may update discovery review metadata;
- read routes may not.

If discovery refresh fails after SearchFact materialization, provider evidence remains valid and committed. The command result reports `DISCOVERY_REFRESH_FAILED`; it must not roll back or delete valid provider evidence merely because the review projection failed.

## 17. Opportunity Ordering

P11-02B may provide a deterministic **discovery priority** for sorting, but it must not label it global search volume or guaranteed SEO opportunity.

Recommended first version: stable lexicographic sort tuple, not an opaque AI score:

1. tracked state (`untracked` first);
2. observed impressions descending where known;
3. observed clicks descending where known;
4. latest observed date descending;
5. normalized query ascending.

If evidence across providers cannot be safely summed because semantics differ, keep provider-specific metrics separate and use a documented deterministic precedence rather than manufacturing a cross-provider total.

The UI copy must state:

> Priority is based on official search-platform evidence observed for this site; it is not global keyword search volume.

## 18. API Surface

Suggested routes, using repository conventions:

```text
GET  /api/v1/projects/:projectId/search-provider-bindings
POST /api/v1/projects/:projectId/search-provider-bindings
PATCH /api/v1/projects/:projectId/search-provider-bindings/:bindingId

POST /api/v1/projects/:projectId/search-sync

GET  /api/v1/projects/:projectId/keyword-discoveries
POST /api/v1/projects/:projectId/keyword-discoveries/refresh
POST /api/v1/projects/:projectId/keyword-discoveries/:candidateId/accept
POST /api/v1/projects/:projectId/keyword-discoveries/:candidateId/reject
```

Exact route naming may adapt to established project conventions, but command/query separation and authority semantics are frozen.

### 18.1 Read routes

- auth + membership + `PROJECT_READ`;
- no CSRF requirement for GET;
- no network/provider call;
- no candidate mutation.

### 18.2 Write routes

- auth + membership + existing appropriate write permission;
- CSRF on web-originating state changes;
- project-scoped fail-closed resource lookup;
- no cross-project existence leak.

## 19. Keyword Center UI

Add a focused section/tab such as **真实搜索词 / Search Query Discoveries**.

Each row may show:

- query text;
- provider evidence badges;
- observed impressions/clicks where available;
- provider-qualified average position label;
- latest observation date;
- whether already tracked;
- review status;
- actions `加入关键词库` / `忽略` for authorized users.

Required truth copy includes:

- `Search Console 平均位置`, never `Google 当前排名`;
- `Bing 平均展示位置` or other provider-qualified wording, never `Bing 当前排名`;
- `本站官方搜索平台已观察`, never `全网搜索量`;
- incomplete data cannot be rendered as zero demand.

The 820px no-page-overflow regression from P11-02A remains protected.

## 20. Security

### 20.1 Credential isolation

- OAuth/Bing secrets stay in existing credential/auth infrastructure;
- lane bindings never carry secrets;
- API responses never serialize credential vault content;
- logs never contain Authorization headers or tokens.

### 20.2 SSRF/input safety

- property refs come from verified/listed provider properties or strict credential-free HTTP(S)/Search Console property forms;
- arbitrary user URL cannot be passed directly to provider transport without binding validation.

### 20.3 Project isolation

Every binding, command, discovery candidate, and accepted keyword transition is project scoped.

Cross-project IDs return the repository's standard not-found/fail-closed behavior rather than revealing resource existence.

### 20.4 Side-effect isolation

Official search sync has no authority to:

- crawl;
- run AI;
- create content;
- publish;
- distribute;
- submit URLs.

## 21. Observability

Required event families:

```text
official_search.sync.started
official_search.sync.completed
official_search.sync.failed
keyword_discovery.refresh.completed
keyword_discovery.refresh.failed
keyword_discovery.accepted
keyword_discovery.rejected
```

Safe metadata:

- projectId;
- provider;
- bindingId;
- bounded dates;
- source/snapshot ids;
- row/candidate counts;
- normalized reason;
- duration.

Never emit raw query collections as bulk log payloads. Individual accepted/rejected query text may remain in existing audit metadata only if that matches current keyword audit privacy conventions.

## 22. Failure and Atomicity Semantics

Provider synchronization is staged:

```text
provider source fetch/persist
        ↓
SearchFact materialization
        ↓
discovery refresh
```

Rules:

- a provider fetch failure creates no fabricated SearchFact;
- a source persistence failure does not report completion;
- materialization failure leaves source evidence intact for retry and reports failure;
- discovery refresh failure leaves normalized SearchFact intact for retry;
- acceptance is transactionally atomic between keyword identity and candidate decision;
- rejection never mutates provider evidence.

No compensating deletion of valid official evidence is used to hide downstream failures.

## 23. Performance and Bounds

- sync date span maximum 31 days;
- discovery evidence span maximum 93 days;
- Google row limit remains existing 25,000 per day;
- query discovery reads only completed query-capable SearchFact snapshots/facts in window;
- avoid N+1 evidence lookup per candidate;
- candidate upserts use batch/project-scoped operations where practical;
- Keyword Center performs bounded reads and never invokes provider network transport.

## 24. Migration Plan

P11-02B is expected to add one focused migration containing:

1. `SearchProviderLaneBinding`;
2. `KeywordDiscoveryCandidate` + status enum;
3. truthful `KeywordSource.SEARCH_DISCOVERY_ACCEPTED` enum value;
4. required indexes/constraints/relations.

No migration adds duplicate search metrics.

Migration tests must verify forward deploy on a clean database and schema invariants.

## 25. Testing Strategy

P11-02B follows RED -> minimal GREEN -> exact-head CI.

### A. Persistence and authority RED

Prove missing contracts for:

- provider lane binding uniqueness/project isolation;
- discovery candidate review persistence;
- truthful keyword source enum;
- migration constraints.

### B. Google orchestration RED

With fake transport/access dependencies:

- completed GSC daily source is materialized into SearchFact;
- duplicate command is idempotent;
- market/locale come from binding, not keyword/project guesswork;
- provider errors map fail closed;
- no crawl/AI/publication side effects.

### C. Bing orchestration RED

With fake Bing transport:

- verified property required;
- query stats persist to deterministic batch;
- bounded date filtering;
- materialize into SearchFact;
- duplicate command converges;
- completeness remains `PROVIDER_UNSPECIFIED`.

### D. Discovery projection RED

Seed completed Google/Bing SearchFact evidence and prove:

- new real query becomes `PENDING` discovery;
- existing authoritative keyword is not offered as a new untracked query;
- rejected query stays rejected when observed again;
- accepted query stays linked;
- provider metrics are not copied into candidate rows;
- deterministic ordering.

### E. Accept/reject RED

Prove:

- explicit human authority required;
- accept creates/resolves one authoritative keyword;
- source = `SEARCH_DISCOVERY_ACCEPTED`;
- no AI call;
- duplicate/race is idempotent;
- reject does not delete SearchFact;
- cross-project candidate id fails closed.

### F. API/UI RED

Prove:

- reads require `PROJECT_READ`;
- mutations require correct write permission + CSRF;
- GET never invokes provider transport;
- UI shows exact truthful labels;
- no `当前排名`, `排名 0`, or `全网搜索量` fabrication;
- 820px page overflow regression remains green.

### G. Exact-head verification

At every approved freeze:

- Typecheck;
- focused/full Vitest as plan requires;
- Build;
- production-audit;
- deployment-artifact/exact-SHA;
- Playwright browser suite.

No phase is declared complete from local or stale-head evidence.

## 26. Delivery / Git Boundary

- stacked base: P11-02A closure head `8d8e59a19ed40ffc99a320fc2bfcdddfd806447d`;
- implementation branch: `feat/p11-02b-official-search-sync`;
- use a separate Draft PR;
- do not modify or merge PR #186 as part of P11-02B;
- no merge to `main` without separate authorization;
- no deployment without separate authorization.

## 27. P11-02C Boundary

P11-02C remains the natural home for richer SERP/rank/history functionality, such as:

- third-party or controlled SERP observation;
- region/device-specific rank history;
- Top 3 / Top 10 / Top 20 historical movement;
- live/current-result qualification where a provider contract actually supports it;
- AI Overview / answer-engine citation observation where separately designed.

P11-02B must not blur official platform average-position evidence into these future rank semantics.

## 28. Acceptance Criteria

P11-02B is ready to close only when all are true:

1. Google official data can flow through the existing daily sync into SearchFact using explicit lane identity;
2. Bing official query stats can flow through adapter -> source batch -> SearchFact using explicit lane identity;
3. repeated sync commands are idempotent and bounded;
4. provider credentials remain isolated from bindings/logs/API output;
5. real observed queries can be deterministically discovered from SearchFact;
6. discovery review state persists without duplicating provider metrics;
7. no discovered query becomes an authoritative keyword without explicit authorized acceptance;
8. accepted keywords have truthful `SEARCH_DISCOVERY_ACCEPTED` provenance;
9. rejected discoveries remain rejected when re-observed;
10. read routes cause no provider/network/write side effects;
11. UI never fabricates global search volume or current rank;
12. project isolation and CSRF/write authority are enforced;
13. exact-head CI is green on the final documentation head;
14. PR remains Draft/open and unmerged unless separately authorized.
