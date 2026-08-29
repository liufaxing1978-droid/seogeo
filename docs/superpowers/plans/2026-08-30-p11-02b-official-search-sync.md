# P11-02B Official Search Sync & Query Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize bounded official Google Search Console and Bing Webmaster query evidence into the existing `SearchFact` truth layer, surface real untracked search queries for human review, and create authoritative keywords only after an explicit authorized acceptance.

**Architecture:** Reuse the existing Google daily-sync worker, Bing adapter/source-batch repository, and `SearchFactMaterializer`. Add one non-secret provider-lane binding model, one review-state model for discovered queries, a focused `search-sync` orchestration module, and a focused keyword-discovery projection/review module. Provider metrics stay only in `SearchFact`; discovery rows persist review state only.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL 17, BullMQ where already used by Google sync, Vitest 3, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30-p11-02b-official-search-sync-design.md`

## Global Constraints

- Stacked base is `8d8e59a19ed40ffc99a320fc2bfcdddfd806447d`; implementation branch is `feat/p11-02b-official-search-sync`; PR #187 remains Draft/open and unmerged.
- `SearchFact` is the only normalized provider-metric truth. Do not duplicate clicks, impressions, CTR, or position into discovery persistence.
- `Keyword` remains operator-authoritative. Provider-discovered queries never become keywords without explicit authorized acceptance.
- Provider impressions are site-observed evidence, never global search volume.
- Google Search Console average position and Bing average positions are provider-reported averages, never live/current rank.
- Preserve Google `TOP_ROWS_ONLY` and Bing `PROVIDER_UNSPECIFIED`; incomplete absence is never zero demand/no ranking.
- Read routes must never call provider network transports or mutate bindings/candidates.
- Sync/binding mutations require authentication, active project membership, `PROJECT_SETTINGS_WRITE`, and CSRF for web-originating writes.
- Discovery accept/reject require authentication, active membership, `CONTENT_WRITE`, and CSRF.
- No sync/discovery path may invoke crawler, AI, content generation, publication, distribution, or URL submission.
- Sync command dates are strict UTC `YYYY-MM-DD`, inclusive, no future dates, maximum span 31 days; UI default is trailing 7 completed UTC days ending yesterday.
- Discovery default window is trailing 28 completed UTC days ending yesterday; maximum span is 93 days.
- Google daily row bound stays 25,000. Bing discovery sync persists only query observations inside the requested bounded window.
- Observability must not log access tokens, refresh tokens, Bing auth keys, Authorization headers, credential-vault payloads, raw provider error bodies, or bulk raw-query collections.
- P11-02C SERP/live-rank/history work is excluded.
- Every task follows RED -> exact failing evidence -> minimal GREEN -> focused tests -> exact-head full CI before freeze.

---

## File Structure

### Persistence
- Modify: `prisma/models/search-facts.prisma` — add `SearchProviderLaneBinding` and project-safe indexes/relations.
- Modify: `prisma/models/keyword-demand.prisma` — add `KeywordDiscoveryStatus`, `KeywordDiscoveryCandidate`, and `KeywordSource.SEARCH_DISCOVERY_ACCEPTED`.
- Create: `prisma/migrations/20260830010000_add_p11_02b_official_search_sync/migration.sql` — one focused forward migration.

### Official search sync
- Create: `src/modules/search-sync/official-search-sync.types.ts` — commands/results/error codes/date parsers.
- Create: `src/modules/search-sync/official-search-sync.repository.ts` — project-scoped non-secret lane binding persistence only.
- Create: `src/modules/search-sync/official-search-sync.observability.ts` — safe sync events.
- Create: `src/modules/search-sync/official-search-sync.service.ts` — Google/Bing dispatch and SearchFact materialization.
- Create: `src/modules/search-sync/official-search-sync.routes.ts` — authenticated/authorized JSON routes.

### Keyword discovery
- Create: `src/modules/keywords/keyword-discovery.types.ts` — projection/read/review types.
- Create: `src/modules/keywords/keyword-discovery.repository.ts` — bounded SearchFact query reads + candidate persistence.
- Create: `src/modules/keywords/keyword-discovery.ts` — pure grouping, representative-text selection, provider-qualified aggregation, deterministic ordering.
- Create: `src/modules/keywords/keyword-discovery.service.ts` — refresh/list/accept/reject orchestration and serializable transactional review.
- Create: `src/modules/keywords/keyword-discovery.routes.ts` — read/refresh/accept/reject JSON routes.

### Composition/UI
- Modify: `src/app.ts` — DI and route registration.
- Modify: `src/modules/keywords/keyword.web.routes.ts` — read persisted discoveries only; no network.
- Modify: `src/views/keywords/index.ejs` — truthful discovery table/actions.
- Modify: `src/public/styles.css` — bounded responsive layout only if required by RED browser test.

### Tests
- Create: `tests/integration/p11-02b.persistence.test.ts`
- Create: `tests/unit/official-search-sync.service.test.ts`
- Create: `tests/integration/official-search-sync.repository.test.ts`
- Create: `tests/integration/official-search-sync.api.test.ts`
- Create: `tests/unit/keyword-discovery.test.ts`
- Create: `tests/integration/keyword-discovery.service.test.ts`
- Create: `tests/integration/keyword-discovery.api.test.ts`
- Modify: `tests/integration/keywords.web.test.ts`
- Modify: `tests/e2e/keywords.spec.ts`
- Create at closure: `docs/development/p11-02b-official-search-sync-verification.md`

---

### Task 1: Persistence and Authority Foundation

**Files:**
- Modify: `prisma/models/search-facts.prisma`
- Modify: `prisma/models/keyword-demand.prisma`
- Create: `prisma/migrations/20260830010000_add_p11_02b_official_search_sync/migration.sql`
- Test: `tests/integration/p11-02b.persistence.test.ts`

**Interfaces:**
- Produces Prisma types `SearchProviderLaneBinding`, `KeywordDiscoveryCandidate`, `KeywordDiscoveryStatus`, and `KeywordSource.SEARCH_DISCOVERY_ACCEPTED` used by all later tasks.
- `SearchProviderLaneBinding` contains only `projectId`, `provider`, `propertyRef`, `marketCode`, `locale`, `isActive`, timestamps. No credential field is permitted.
- `KeywordDiscoveryCandidate` stores only identity/review metadata; no provider metrics.

- [ ] **Step 1: Write the RED migration/schema tests**

Create tests that compile against and inspect the required Prisma contracts:

```ts
it('persists a non-secret unique provider lane binding', async () => {
  const created = await prisma.searchProviderLaneBinding.create({
    data: {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      propertyRef: 'sc-domain:xingshantang.org',
      marketCode: 'HK',
      locale: 'zh-Hant',
    },
  });
  expect(created.isActive).toBe(true);
  await expect(prisma.searchProviderLaneBinding.create({ data: {
    projectId,
    provider: 'GOOGLE_SEARCH_CONSOLE',
    propertyRef: 'sc-domain:xingshantang.org',
    marketCode: 'HK',
    locale: 'zh-Hant',
  }})).rejects.toMatchObject({ code: 'P2002' });
});

it('persists discovery review state without copied search metrics', async () => {
  const candidate = await prisma.keywordDiscoveryCandidate.create({ data: {
    projectId,
    normalizedQuery: '六壬符纸怎么用',
    representativeText: '六壬符纸怎么用',
    firstObservedAt: new Date('2026-08-01T00:00:00Z'),
    lastObservedAt: new Date('2026-08-29T00:00:00Z'),
  }});
  expect(candidate.status).toBe('PENDING');
  expect(Object.keys(candidate)).not.toEqual(expect.arrayContaining([
    'clicks', 'impressions', 'ctr', 'position', 'averagePosition',
  ]));
});
```

Also assert a `Keyword` can be created with `source: 'SEARCH_DISCOVERY_ACCEPTED'` after migration.

- [ ] **Step 2: Run RED**

Run:

```bash
npx prisma generate
npm test -- tests/integration/p11-02b.persistence.test.ts
```

Expected: FAIL because the models/enums do not yet exist.

- [ ] **Step 3: Implement the minimal Prisma schema**

Use these frozen semantics:

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

  @@unique([projectId, provider, propertyRef, marketCode, locale], map: "SearchProviderLaneBinding_identity_key")
  @@index([projectId, provider, isActive], map: "SearchProviderLaneBinding_lookup_idx")
}

enum KeywordDiscoveryStatus {
  PENDING
  ACCEPTED
  REJECTED
}
```

Add `SEARCH_DISCOVERY_ACCEPTED` to `KeywordSource`, and add candidate relations to `Project`/`Keyword` following existing generated-schema conventions. Keep `acceptedKeywordId` nullable with `onDelete: SetNull`.

- [ ] **Step 4: Write the focused migration**

Migration must create exactly the two tables/status enum/source enum value plus indexes/FKs; it must not create search-metric columns. Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- tests/integration/p11-02b.persistence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and run exact-head CI freeze A**

Commit message:

```text
feat: add P11-02B persistence foundation
```

Record exact RED commit/run and GREEN commit/run in the final verification document. Do not proceed if Typecheck, Full Vitest, Build, production-audit, deployment-artifact, or e2e is red on the exact head.

---

### Task 2: Provider Lane Binding Repository and API

**Files:**
- Create: `src/modules/search-sync/official-search-sync.types.ts`
- Create: `src/modules/search-sync/official-search-sync.repository.ts`
- Create: `src/modules/search-sync/official-search-sync.routes.ts` (binding routes only in this task)
- Modify: `src/app.ts`
- Test: `tests/integration/official-search-sync.repository.test.ts`
- Test: `tests/integration/official-search-sync.api.test.ts`

**Interfaces:**

```ts
export type CreateSearchProviderLaneBindingInput = {
  projectId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  propertyRef: string;
  marketCode: MarketCode;
  locale: string;
};

export class OfficialSearchSyncRepository {
  listBindings(projectId: string): Promise<SearchProviderLaneBinding[]>;
  findBinding(projectId: string, bindingId: string): Promise<SearchProviderLaneBinding | null>;
  createBinding(input: CreateSearchProviderLaneBindingInput): Promise<SearchProviderLaneBinding>;
  setBindingActive(projectId: string, bindingId: string, isActive: boolean): Promise<SearchProviderLaneBinding | null>;
}
```

- [ ] **Step 1: Write RED repository tests**

Prove: project-scoped lookup, duplicate identity converges to the existing row, blank/oversized locale rejected before Prisma, unsupported P11-02B provider rejected, cross-project binding id returns null.

- [ ] **Step 2: Write RED API tests**

Routes:

```text
GET   /api/v1/projects/:projectId/search-provider-bindings
POST  /api/v1/projects/:projectId/search-provider-bindings
PATCH /api/v1/projects/:projectId/search-provider-bindings/:bindingId
```

Assert:
- GET = auth + membership + `PROJECT_READ`, no CSRF, no writes;
- POST/PATCH = auth + membership + `PROJECT_SETTINGS_WRITE` + CSRF;
- OPERATOR cannot create/update binding; ADMIN/OWNER can;
- cross-project binding id fails closed with standard not-found behavior;
- response contains no `credentialRef`, token, key, auth header, vault payload.

- [ ] **Step 3: Run RED**

```bash
npm test -- tests/integration/official-search-sync.repository.test.ts tests/integration/official-search-sync.api.test.ts
```

Expected: FAIL with missing module/routes.

- [ ] **Step 4: Implement minimal repository/types/routes**

Use `zod` request parsing consistent with existing APIs. Normalize locale with `trim()` and enforce max 64 chars. `propertyRef` max 2048 chars. Provider allowlist in P11-02B is exactly Google/Bing.

Use idempotent duplicate handling: on Prisma `P2002`, reread same project/provider/property/market/locale and return the existing row; never return another project's row.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm run typecheck
npm test -- tests/integration/official-search-sync.repository.test.ts tests/integration/official-search-sync.api.test.ts
```

Commit:

```text
feat: add official search provider lane bindings
```

---

### Task 3: Google Official Sync Orchestration

**Files:**
- Create: `src/modules/search-sync/official-search-sync.observability.ts`
- Create: `src/modules/search-sync/official-search-sync.service.ts`
- Modify: `src/modules/search-sync/official-search-sync.types.ts`
- Modify: `src/modules/search-sync/official-search-sync.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/official-search-sync.service.test.ts`
- Test: `tests/integration/official-search-sync.api.test.ts`

**Interfaces:**

```ts
export type OfficialSearchSyncCommand = {
  projectId: string;
  bindingId: string;
  dateFrom: string;
  dateTo: string;
};

export type OfficialSearchSyncOutcome = {
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  state: 'COMPLETED' | 'ALREADY_COMPLETED' | 'UNAVAILABLE' | 'FAILED';
  dateFrom: string;
  dateTo: string;
  sourceRefs: string[];
  searchFactSnapshotIds: string[];
  discoveryState: 'REFRESHED' | 'DISCOVERY_REFRESH_FAILED' | 'NOT_RUN';
  reason: OfficialSearchSyncFailureReason | null;
};
```

Inject ports rather than instantiating transport in tests:

```ts
export type GoogleDailySyncPort = typeof syncSearchConsoleDay;
export interface SearchFactMaterializePort {
  materializeGoogleSnapshot(input: MaterializeGoogleSearchSnapshotInput): Promise<SearchFactSnapshot>;
  materializeBingBatch(input: MaterializeBingSearchBatchInput): Promise<SearchFactSnapshot>;
}
```

- [ ] **Step 1: Write Google RED tests**

Cover:
- strict UTC date parsing, from<=to, <=31 days, no future dates;
- inactive/cross-project binding -> fail closed;
- binding must be `GOOGLE_SEARCH_CONSOLE`;
- binding propertyRef must resolve to an active project-owned `SearchConsoleProperty`;
- for each date call existing `syncSearchConsoleDay({ projectId, propertyId, date })`;
- materialize the returned/reused GSC snapshot with binding marketCode/locale;
- repeated command reuses authoritative daily source and existing SearchFact snapshot;
- Google source completeness stays `TOP_ROWS_ONLY`;
- normalize `TOKEN_REVOKED`, `PERMISSION_DENIED`, `PROPERTY_UNAVAILABLE`, `RATE_LIMITED`, `TRANSIENT_PROVIDER_ERROR`, `INVALID_RESPONSE`, `PERSISTENCE_FAILED`, `MATERIALIZATION_FAILED`;
- injected crawl/AI/publication/distribution spies remain untouched.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/official-search-sync.service.test.ts
```

Expected: FAIL because orchestrator is absent.

- [ ] **Step 3: Implement minimal Google service path**

Use existing Search Console repository methods to resolve property identity. Do not add a new OAuth/token store. For every source date:

```ts
const source = await googleDailySync({ projectId, propertyId, date }, googleDependencies);
const searchFact = await materializer.materializeGoogleSnapshot({
  snapshotId: source.snapshotId,
  marketCode: binding.marketCode,
  locale: binding.locale,
  normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
});
```

Use the repository's actual normalization version constant already used by SearchFact tests; do not invent a semantic version during GREEN if a constant exists.

- [ ] **Step 4: Add sync route RED/GREEN**

Route:

```text
POST /api/v1/projects/:projectId/search-sync
```

Guard order: authentication -> CSRF -> membership -> `PROJECT_SETTINGS_WRITE`. Body is `{ bindingId, dateFrom, dateTo }`.

- [ ] **Step 5: Verify and freeze Google head**

```bash
npm run typecheck
npm test -- tests/unit/official-search-sync.service.test.ts tests/integration/official-search-sync.api.test.ts
npm run build
```

Commit:

```text
feat: orchestrate Google official search sync
```

Run exact-head full CI before moving to Bing.

---

### Task 4: Bing Official Query Sync Orchestration

**Files:**
- Modify: `src/modules/search-sync/official-search-sync.service.ts`
- Modify: `src/modules/search-sync/official-search-sync.types.ts`
- Test: `tests/unit/official-search-sync.service.test.ts`
- Test: `tests/integration/official-search-sync.api.test.ts`

**Interfaces:**

```ts
export interface BingSearchProviderPort {
  listProperties(): Promise<SearchProviderProperty[]>;
  fetchQueryStats(siteUrl: string): Promise<BingQueryObservation[]>;
}

export interface BingSourcePersistencePort {
  persistBingBatch(input: PersistBingObservationBatchInput): Promise<SearchProviderObservationBatch>;
}
```

- [ ] **Step 1: Write Bing RED tests**

Cover:
- active binding provider must be `BING_WEBMASTER`;
- `listProperties()` must contain the exact verified `propertyRef` before fetch;
- `fetchQueryStats(propertyRef)` is called once per bounded command, not once per day;
- filter inclusive source dates to command window;
- no future/out-of-window rows persisted;
- stable sort by sourceDate then query before persistence;
- empty in-window observation set maps to `INVALID_RESPONSE`/safe failure consistent with existing `persistBingBatch` empty-batch contract;
- persist with binding marketCode/locale/propertyRef and sourceCutoffAt = command `dateTo` UTC day;
- materialize using `materializeBingBatch`;
- repeated identical command converges to same deterministic source batch/SearchFact snapshot;
- source completeness stays `PROVIDER_UNSPECIFIED`.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/official-search-sync.service.test.ts -t Bing
```

Expected: FAIL because Bing dispatch is absent.

- [ ] **Step 3: Implement minimal Bing dispatch**

Compose existing `BingSearchProviderAdapter`, `SearchProviderSourceRepository`, and `SearchFactMaterializer`; do not add another Bing transport or raw table.

- [ ] **Step 4: Run GREEN and freeze Bing head**

```bash
npm run typecheck
npm test -- tests/unit/official-search-sync.service.test.ts tests/integration/official-search-sync.api.test.ts
npm run build
```

Commit:

```text
feat: orchestrate Bing official query sync
```

Run exact-head full CI.

---

### Task 5: Deterministic Query Discovery Projection and Refresh

**Files:**
- Create: `src/modules/keywords/keyword-discovery.types.ts`
- Create: `src/modules/keywords/keyword-discovery.ts`
- Create: `src/modules/keywords/keyword-discovery.repository.ts`
- Create: `src/modules/keywords/keyword-discovery.service.ts`
- Test: `tests/unit/keyword-discovery.test.ts`
- Test: `tests/integration/keyword-discovery.service.test.ts`

**Interfaces:**

```ts
export type KeywordDiscoveryWindow = { dateFrom: string; dateTo: string };

export type KeywordDiscoveryProviderEvidence = {
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  impressions: number | null;
  clicks: number | null;
  searchConsoleAveragePosition: number | null;
  bingAverageClickPosition: number | null;
  bingAverageImpressionPosition: number | null;
  latestSourceDate: string;
};

export type KeywordDiscoveryReadModel = {
  candidateId: string | null;
  normalizedQuery: string;
  representativeText: string;
  trackedKeywordId: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'TRACKED';
  firstObservedAt: string;
  lastObservedAt: string;
  providers: KeywordDiscoveryProviderEvidence[];
};

export class KeywordDiscoveryService {
  refresh(input: { projectId: string; dateFrom?: string; dateTo?: string }): Promise<{ created: number; updated: number; preserved: number }>;
  list(input: { projectId: string; dateFrom?: string; dateTo?: string }): Promise<KeywordDiscoveryReadModel[]>;
}
```

- [ ] **Step 1: Write pure RED tests**

Seed pure fact DTOs and prove:
- Google `QUERY_PAGE` rows group by `normalizeSearchEvidenceQuery(query)`;
- Bing `QUERY` rows group by same bridge normalizer;
- Traditional/Simplified remain distinct;
- representative text = raw query from latest source date, tie broken lexicographically;
- provider metrics stay provider-qualified; never sum Google+Bing into fake cross-provider total;
- Google average position is impression-weighted only over known positive-impression observations;
- Bing click/impression positions use their own weights and unknown metrics remain null;
- ordering = untracked first, then deterministic provider precedence (`GOOGLE_SEARCH_CONSOLE` before `BING_WEBMASTER`) using provider observed impressions desc, clicks desc, latest date desc, normalized query asc;
- no copy labels/fields named `searchVolume`, `currentRank`, or generic `rank`.

- [ ] **Step 2: Write repository/service RED tests**

Seed completed SearchFact snapshots and authoritative Keywords. Prove:
- bounded completed query-capable facts only;
- tracked authoritative keyword is marked `TRACKED` and not inserted as a new candidate;
- newly observed untracked query creates one `PENDING` candidate;
- repeated refresh advances first/last observed deterministically without duplicating candidate;
- `REJECTED` stays rejected;
- `ACCEPTED` stays accepted/linked;
- candidate DB row has no metrics;
- list is read-only and does not call provider transports.

- [ ] **Step 3: Run RED**

```bash
npm test -- tests/unit/keyword-discovery.test.ts tests/integration/keyword-discovery.service.test.ts
```

- [ ] **Step 4: Implement minimal pure projection/repository/service**

Repository read must filter:

```ts
snapshot: { status: 'COMPLETED' },
sourceDate: { gte: fromDate, lte: toDate },
factKind: { in: ['QUERY_PAGE', 'QUERY'] },
query: { not: null },
```

Load metrics in one bounded read; avoid N+1 per candidate. Load project keywords in one query and candidate review rows in one query.

Refresh writes only candidate identity/review metadata and never resets accepted/rejected status.

- [ ] **Step 5: Verify and commit**

```bash
npm run typecheck
npm test -- tests/unit/keyword-discovery.test.ts tests/integration/keyword-discovery.service.test.ts
```

Commit:

```text
feat: discover real search queries from SearchFact
```

Run exact-head full CI.

---

### Task 6: Atomic Human Accept/Reject Workflow

**Files:**
- Modify: `src/modules/keywords/keyword-discovery.types.ts`
- Modify: `src/modules/keywords/keyword-discovery.repository.ts`
- Modify: `src/modules/keywords/keyword-discovery.service.ts`
- Use: `src/modules/keywords/keyword-normalize.ts`
- Use: `src/modules/keywords/keyword.repository.ts`
- Test: `tests/integration/keyword-discovery.service.test.ts`

**Interfaces:**

```ts
export type AcceptKeywordDiscoveryInput = {
  actorUserId: string;
  projectId: string;
  candidateId: string;
  type: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  language?: string | null;
  targetCountry?: string | null;
};

accept(input: AcceptKeywordDiscoveryInput): Promise<Keyword>;
reject(input: { actorUserId: string; projectId: string; candidateId: string }): Promise<KeywordDiscoveryCandidate>;
```

`type` is explicitly operator-selected. No AI classifier is called. Default `intent='UNKNOWN'`, `priority='MEDIUM'`, `status='ACTIVE'`, `source='SEARCH_DISCOVERY_ACCEPTED'`.

- [ ] **Step 1: Write accept/reject RED tests**

Prove:
- cross-project candidate -> standard discovery not-found, no existence leak;
- pending accept creates exactly one Keyword under existing `normalizeKeywordText` uniqueness;
- source is `SEARCH_DISCOVERY_ACCEPTED`;
- candidate links acceptedKeywordId + actor/time atomically;
- existing same-project keyword identity is reused and candidate links to it;
- archived duplicate obeys existing archived restore contract rather than silently creating;
- repeated accept of already accepted candidate returns linked keyword idempotently;
- concurrent duplicate race resolves to one authoritative keyword;
- reject changes only candidate status/actor/time; SearchFact count/content unchanged;
- repeated reject is idempotent;
- accepted candidate cannot be rejected and rejected candidate cannot be accepted without an explicit future design change;
- AI task/service spies remain zero calls.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/keyword-discovery.service.test.ts -t 'accept|reject'
```

- [ ] **Step 3: Implement serializable transactional review**

Use Prisma serializable transaction with the same P2034 retry bound (`3`) as current keyword writes. Inside one transaction instantiate transaction-scoped repositories, lock/read the candidate project-safely, resolve/create keyword, append existing `KeywordAuditEvent`:

```ts
await keywordRepo.appendAudit(
  input.projectId,
  keyword.id,
  input.actorUserId,
  'KEYWORD_DISCOVERY_ACCEPTED',
  { candidateId: candidate.id, source: 'SEARCH_DISCOVERY_ACCEPTED' },
);
```

Do not put provider metric snapshots into audit metadata.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run typecheck
npm test -- tests/integration/keyword-discovery.service.test.ts
```

Commit:

```text
feat: add human-reviewed keyword discovery decisions
```

Run exact-head full CI.

---

### Task 7: Discovery API, Sync Follow-up Refresh, and Safe Observability

**Files:**
- Create: `src/modules/keywords/keyword-discovery.routes.ts`
- Modify: `src/modules/search-sync/official-search-sync.service.ts`
- Modify: `src/modules/search-sync/official-search-sync.observability.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/keyword-discovery.api.test.ts`
- Test: `tests/integration/official-search-sync.api.test.ts`

**Interfaces / Routes:**

```text
GET  /api/v1/projects/:projectId/keyword-discoveries
POST /api/v1/projects/:projectId/keyword-discoveries/refresh
POST /api/v1/projects/:projectId/keyword-discoveries/:candidateId/accept
POST /api/v1/projects/:projectId/keyword-discoveries/:candidateId/reject
```

- [ ] **Step 1: Write API RED tests**

Assert:
- GET: auth + membership + `PROJECT_READ`, no CSRF, no provider transport, no writes;
- refresh: auth + CSRF + membership + `CONTENT_WRITE` (it mutates keyword-review state, not provider settings);
- accept/reject: auth + CSRF + membership + `CONTENT_WRITE`;
- accept body requires operator-selected `type` and optionally accepts intent/priority/language/targetCountry;
- VIEWER can read but cannot mutate;
- foreign candidate/binding ids fail closed;
- responses serialize no credentials/raw provider errors.

- [ ] **Step 2: Write sync follow-up RED test**

After successful SearchFact materialization, orchestrator calls `discovery.refresh({ projectId, dateFrom, dateTo })` once. If refresh throws:
- SearchFact remains committed;
- command does not delete/rollback provider evidence;
- outcome has `discoveryState: 'DISCOVERY_REFRESH_FAILED'` and normalized reason;
- event `keyword_discovery.refresh.failed` emits safe metadata.

- [ ] **Step 3: Implement minimal routes and follow-up**

Event families exactly:

```text
official_search.sync.started
official_search.sync.completed
official_search.sync.failed
keyword_discovery.refresh.completed
keyword_discovery.refresh.failed
keyword_discovery.accepted
keyword_discovery.rejected
```

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run typecheck
npm test -- tests/integration/keyword-discovery.api.test.ts tests/integration/official-search-sync.api.test.ts tests/unit/official-search-sync.service.test.ts
```

Commit:

```text
feat: expose official search sync and discovery APIs
```

Run exact-head full CI.

---

### Task 8: Keyword Center UI — 真实搜索词

**Files:**
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/views/keywords/index.ejs`
- Modify only if RED requires: `src/public/styles.css`
- Modify: `src/app.ts` DI to pass a read-only `KeywordDiscoveryService` port to web routes.
- Test: `tests/integration/keywords.web.test.ts`

**Interfaces:**

Web GET may call only:

```ts
Pick<KeywordDiscoveryService, 'list'>
```

It must never receive or call sync/refresh/accept/reject methods during page render.

- [ ] **Step 1: Write UI RED tests**

Seed SearchFact + persisted candidate state and render Keyword Center. Assert exact stable hooks/copy:

```text
data-ui="keyword-discovery"
data-ui="keyword-discovery-row"
真实搜索词
本站官方搜索平台已观察
Priority is based on official search-platform evidence observed for this site; it is not global keyword search volume.
Search Console 平均位置
Bing 平均展示位置
加入关键词库
忽略
```

Forbidden text:

```text
Google 当前排名
Bing 当前排名
排名 0
全网搜索量
月搜索量
```

Unknown/incomplete metric cells render em dash, not zero.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/keywords.web.test.ts
```

- [ ] **Step 3: Implement minimal UI**

Use provider badges and provider-separated metrics. For PENDING rows with write authority show accept/reject controls; for VIEWER show read-only state. Accept form includes explicit keyword type select; default selected option may be `LONG_TAIL`, but submission is still the human action.

Do not add a "sync on page load" action. A manual sync form/button may be shown only if it posts the explicit sync command and user has `PROJECT_SETTINGS_WRITE`; otherwise keep sync management in settings/admin UI to avoid mixing authority.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm run typecheck
npm test -- tests/integration/keywords.web.test.ts
npm run build
```

Commit:

```text
feat: show real search query discoveries in Keyword Center
```

---

### Task 9: Browser Contract, Scope Review, and Final Closure

**Files:**
- Modify: `tests/e2e/keywords.spec.ts`
- Create: `docs/development/p11-02b-official-search-sync-verification.md`

**Interfaces:** Final browser/closure evidence only; do not alter provider semantics merely to make browser tests pass.

- [ ] **Step 1: Add Playwright RED**

Add an e2e scenario that seeds persisted SearchFact/candidate state (no real network), opens Keyword Center as OPERATOR, verifies:
- discovered real query visible;
- provider-qualified Search Console/Bing labels;
- no current-rank/global-volume fabrication;
- accepting `六壬符纸怎么用` creates one keyword with `SEARCH_DISCOVERY_ACCEPTED`;
- rejecting another candidate leaves SearchFact intact;
- 820px `documentElement.scrollWidth - clientWidth <= 1` remains green.

- [ ] **Step 2: Run browser RED then minimal GREEN**

```bash
npm run test:e2e -- tests/e2e/keywords.spec.ts
```

If browser RED exposes layout or wiring defect, use `systematic-debugging` before any production change; do not guess CSS.

- [ ] **Step 3: Run Task 9 scope/security/truth review**

Review PR #187 full diff and prove:
- no SERP scraper/third-party rank API;
- no search-volume table/field;
- no provider metrics duplicated in candidate table;
- no credential field/log output;
- no crawl/AI/content/publication/distribution side effects;
- read routes have no network/write effects;
- mutation guards are exact (`PROJECT_SETTINGS_WRITE` for provider binding/sync, `CONTENT_WRITE` for discovery review, CSRF on mutations);
- project isolation is fail closed;
- Google/Bing completeness and position semantics remain qualified.

If a defect is found, add a focused RED before fixing it.

- [ ] **Step 4: Run implementation-head exact CI**

Require all exact-head gates:

```text
verify: Typecheck + Full Vitest + Build
production-audit
deployment-artifact / exact-SHA
e2e / full Playwright
```

Record run number, job IDs, exact commit SHA, full Vitest counts, Playwright counts, and any legitimate rerun/flaky evidence.

- [ ] **Step 5: Write final verification document**

`docs/development/p11-02b-official-search-sync-verification.md` must contain:
- stacked base and PR #187;
- each Task RED commit/run and expected failure reason;
- each GREEN freeze commit/run;
- migration identity and invariants;
- final implementation-head test counts;
- scope/security/truth review result;
- explicit `not merged / not deployed / P11-02C not started`.

Do not claim closure yet.

- [ ] **Step 6: Commit documentation and run documentation-head exact CI**

Commit:

```text
docs: verify P11-02B official search sync
```

Run the same exact-head four CI gates against the documentation head. Only after all are green may P11-02B be marked Frozen.

- [ ] **Step 7: Final closure check**

Re-read PR #187 and prove:
- state=open;
- draft=true;
- merged=false;
- head SHA equals documentation-head exact green SHA;
- base remains `feat/p11-02a-official-search-evidence` at the intended stacked dependency;
- no deployment occurred.
