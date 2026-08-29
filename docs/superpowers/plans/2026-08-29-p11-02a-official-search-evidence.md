# P11-02A Official Search Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect authoritative P11 keywords to persisted official Google Search Console and Bing Webmaster query evidence, preserving incomplete-data semantics and displaying truthful search evidence without claiming live SERP rank.

**Architecture:** Add a pure keyword/search-query matching and aggregation domain under `src/modules/keywords`, extend the existing `SearchFactRepository` with read-only completed-snapshot metadata needed to distinguish incomplete absence from complete absence, then add a project-scoped orchestration service, secured JSON API, and Keyword Center projection. All reads are side-effect free and operate only on already persisted `SearchFact` data plus static provider manifests; no provider transport, queue, crawl, AI, publication, or new persistence is introduced.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL, Vitest 3, Supertest 7, Playwright 1.62, existing `SearchFactRepository`, existing search-provider registry, existing P11 Keyword Center/EJS shell.

**Spec:** `docs/superpowers/specs/2026-08-29-p11-02a-official-search-evidence-design.md`

## Global Constraints

- Stacked implementation base is the approved P11-01 closure head plus this approved spec/plan; do not write directly to `main`.
- P11-01 `Keyword.normalizedText` identity semantics are frozen and must not change.
- Keyword-to-provider matching is exact after a separate search-evidence normalizer: NFKC, curly-quote normalization, dash normalization, trim, whitespace collapse, locale-independent lowercase.
- Do not auto-convert Traditional/Simplified Chinese; `符紙` and `符纸` remain distinct.
- Read only persisted `SearchFact` / `SearchFactSnapshot` evidence; keyword evidence reads must not call provider transports or enqueue sync/crawl/AI/content/publication/distribution work.
- Google Search Console current completeness is `TOP_ROWS_ONLY`; absent keyword rows are `UNKNOWN`, not zero and not `NOT_OBSERVED`.
- Bing current completeness is `PROVIDER_UNSPECIFIED`; absent keyword rows are `UNKNOWN`, not zero and not `NOT_OBSERVED`.
- `NOT_OBSERVED` is allowed only when the relevant query evidence is `COMPLETE` for the evaluated lane/window.
- A matched Bing query remains `OBSERVED` even if one provider-specific position metric is `UNKNOWN`; that metric remains `null`.
- Google metrics are derived only from persisted Query+Page facts in the selected lane/window and must not be described as property-level query-only totals.
- Google position label is `Search Console 平均位置` / `Search Console average position`; never `Google 当前排名`, `Google rank`, or deterministic live SERP rank.
- Bing positions are provider-reported averages, not a guaranteed current rank.
- Real evidence lanes always preserve `(provider, marketCode, locale, propertyRef)` and are never merged across markets/properties.
- Provider-level placeholders may have null lane identity only for `UNKNOWN` supported-with-no-persisted-lane or `UNAVAILABLE` capability projection.
- Baidu/360/Sogou/Shenma use registry capability truth only in P11-02A; do not fabricate provider health, connection state, search volume, or rank.
- No new Prisma model/table/migration is expected or permitted without a new design change.
- Read authorization is existing `PROJECT_READ`; no new role/capability and no CSRF on GET.
- Foreign keyword IDs fail closed as `KEYWORD_NOT_FOUND`.
- Default range is trailing 28 UTC calendar days ending yesterday; explicit range maximum is 93 calendar days.
- Every implementation task follows RED -> exact failing evidence -> minimal GREEN -> focused tests -> exact-head full CI before a phase freeze.
- Required exact-head CI gates at each freeze: `verify`, `production-audit`, `deployment-artifact`, `e2e`.
- No merge or deployment without separate explicit authorization.

---

## File Structure

### New production files

- `src/modules/keywords/keyword-search-evidence-normalize.ts` — pure exact-match normalization owned by P11-02A.
- `src/modules/keywords/keyword-search-evidence.ts` — evidence types, real-lane/provider-projection discriminated union, pure Google/Bing aggregation, provider capability projection.
- `src/modules/keywords/keyword-search-evidence.repository.ts` — read-only adapter combining `SearchFactRepository` completed facts/snapshots with provider manifests.
- `src/modules/keywords/keyword-search-evidence.service.ts` — project/keyword lookup, UTC range parsing, filtering, deterministic lane projection, project bulk evaluation for Keyword Center.

### Existing production files to modify

- `src/modules/search-facts/search-fact.types.ts` — add completed-snapshot read filter/view types.
- `src/modules/search-facts/search-fact.repository.ts` — add read-only `listCompletedSnapshots()`; no write-path changes.
- `src/modules/keywords/keyword.routes.ts` — add secured read-only JSON endpoint.
- `src/modules/keywords/keyword.web.repository.ts` — attach search-evidence summaries to keyword rows via one project bulk evaluation.
- `src/modules/keywords/keyword.web.routes.ts` — inject search-evidence service into the web repository path.
- `src/views/keywords/index.ejs` — render truthful provider evidence / unavailable copy.
- `src/public/css/p11-keywords.css` — responsive search-evidence badges/cards only.
- `src/app.ts` — dependency injection for API/web search-evidence service.

### Tests

- `tests/unit/keyword-search-evidence-normalize.test.ts`
- `tests/unit/keyword-search-evidence.test.ts`
- `tests/integration/search-fact.snapshot-read.test.ts`
- `tests/integration/keywords.search-evidence.service.test.ts`
- `tests/integration/keywords.search-evidence.api.test.ts`
- `tests/integration/keywords.web.test.ts` — extend existing Keyword Center contract.
- `tests/e2e/keywords.spec.ts` — extend existing browser contract.

### Final evidence

- `docs/development/p11-02a-official-search-evidence-verification.md`

---

### Task 1: Exact Search-Evidence Query Normalization

**Phase:** P11-02A-A

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence-normalize.ts`
- Create: `tests/unit/keyword-search-evidence-normalize.test.ts`

**Interfaces:**
- Consumes: raw authoritative keyword/provider query text.
- Produces:

```ts
export function normalizeSearchEvidenceQuery(text: string): string;
```

- This function is matching-only. It must not replace `normalizeKeywordText()` and must never be used as the `Keyword` uniqueness key.

- [ ] **Step 1: Write normalization RED**

Create `tests/unit/keyword-search-evidence-normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import * as moduleUnderTest from '../../src/modules/keywords/keyword-search-evidence-normalize.js';

const subject = moduleUnderTest as unknown as {
  normalizeSearchEvidenceQuery(text: string): string;
};

describe('P11-02A search evidence query normalization', () => {
  it('normalizes provider punctuation and width without collapsing Chinese variants', () => {
    expect(subject.normalizeSearchEvidenceQuery('  ＦＯＯ　“符紙” — bar  '))
      .toBe('foo "符紙" - bar');
    expect(subject.normalizeSearchEvidenceQuery('符紙')).not.toBe(
      subject.normalizeSearchEvidenceQuery('符纸'),
    );
  });

  it('normalizes curly apostrophes and whitespace deterministically', () => {
    expect(subject.normalizeSearchEvidenceQuery('  user’s   guide ')).toBe("user's guide");
  });
});
```

- [ ] **Step 2: Run focused RED**

Run:

```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts
```

Expected: FAIL because `keyword-search-evidence-normalize.ts` / `normalizeSearchEvidenceQuery` does not exist.

- [ ] **Step 3: Implement minimal normalizer**

Create `src/modules/keywords/keyword-search-evidence-normalize.ts`:

```ts
export function normalizeSearchEvidenceQuery(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('und');
}
```

- [ ] **Step 4: Run focused GREEN**

Run:

```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/keywords/keyword-search-evidence-normalize.ts tests/unit/keyword-search-evidence-normalize.test.ts
git commit -m "feat(keywords): normalize official search evidence queries"
```

---

### Task 2: Pure Evidence Types, Google/Bing Aggregation, and Capability Projection

**Phase:** P11-02A-A

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence.ts`
- Create: `tests/unit/keyword-search-evidence.test.ts`

**Interfaces:**
- Consumes: `SearchFactView[]`, completed snapshot lane metadata, provider manifests, normalized keyword match text, effective UTC range.
- Produces:

```ts
export type KeywordSearchEvidenceState =
  | 'OBSERVED'
  | 'NOT_OBSERVED'
  | 'UNKNOWN'
  | 'UNAVAILABLE';

export type KeywordSearchEvidenceMetrics = {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  searchConsoleAveragePosition: number | null;
  bingAverageClickPosition: number | null;
  bingAverageImpressionPosition: number | null;
};

export type KeywordSearchEvidenceRealLane = {
  kind: 'LANE';
  provider: SearchProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  state: Exclude<KeywordSearchEvidenceState, 'UNAVAILABLE'>;
  capabilityState: 'SUPPORTED';
  sourceCompleteness: SearchFactCompleteness[];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: string | null;
  latestAvailableSourceDate: string | null;
  snapshotIds: string[];
  metrics: KeywordSearchEvidenceMetrics;
  matchedPages: Array<{
    canonicalPage: string;
    clicks: number;
    impressions: number;
    averagePosition: number | null;
  }>;
  reason: string;
};

export type KeywordSearchEvidenceProviderProjection = {
  kind: 'PROVIDER';
  provider: SearchProviderCode;
  marketCode: null;
  locale: null;
  propertyRef: null;
  propertyType: null;
  state: 'UNKNOWN' | 'UNAVAILABLE';
  capabilityState: CapabilityState;
  accessMode: SearchProviderAccessMode;
  sourceCompleteness: [];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: null;
  latestAvailableSourceDate: null;
  snapshotIds: [];
  metrics: KeywordSearchEvidenceMetrics;
  matchedPages: [];
  reason: string;
};

export type KeywordSearchEvidenceItem =
  | KeywordSearchEvidenceRealLane
  | KeywordSearchEvidenceProviderProjection;

export function aggregateKeywordSearchEvidenceLane(input: {
  normalizedKeyword: string;
  lane: KeywordSearchEvidenceLaneSource;
  facts: SearchFactView[];
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceRealLane;

export function projectUnavailableProviders(input: {
  providersWithRealLanes: ReadonlySet<SearchProviderCode>;
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceProviderProjection[];
```

Define `KeywordSearchEvidenceLaneSource` in the same module with exact real-lane identity and completed-snapshot metadata required by aggregation.

- [ ] **Step 1: Write Google aggregation RED**

In `tests/unit/keyword-search-evidence.test.ts`, construct one Google lane with `TOP_ROWS_ONLY` snapshots and three Query+Page facts for exact query `符纸`:

```ts
const result = aggregateKeywordSearchEvidenceLane({
  normalizedKeyword: '符纸',
  lane: googleLane,
  facts: [
    googleFact({ page: 'https://example.com/a', clicks: 4, impressions: 100, position: 8 }),
    googleFact({ page: 'https://example.com/b', clicks: 2, impressions: 50, position: 4 }),
    googleFact({ query: '其它词', page: 'https://example.com/c', clicks: 50, impressions: 500, position: 1 }),
  ],
  dateFrom: '2026-08-01',
  dateTo: '2026-08-28',
});

expect(result.state).toBe('OBSERVED');
expect(result.metrics.clicks).toBe(6);
expect(result.metrics.impressions).toBe(150);
expect(result.metrics.ctr).toBeCloseTo(0.04);
expect(result.metrics.searchConsoleAveragePosition).toBeCloseTo((8 * 100 + 4 * 50) / 150);
expect(result.matchedPages.map((item) => item.canonicalPage)).toEqual([
  'https://example.com/a',
  'https://example.com/b',
]);
```

Also assert that a missing exact query under `TOP_ROWS_ONLY` returns `UNKNOWN`, with all metrics `null`, not zeros.

- [ ] **Step 2: Write Bing aggregation RED**

Add a Bing lane case:

```ts
expect(result.state).toBe('OBSERVED');
expect(result.metrics.clicks).toBe(10);
expect(result.metrics.impressions).toBe(200);
expect(result.metrics.bingAverageClickPosition).toBeCloseTo(weightedClickPosition);
expect(result.metrics.bingAverageImpressionPosition).toBeNull();
```

The fixture must include a matching query whose `BING_AVG_IMPRESSION_POSITION` metric has `evidenceState: 'UNKNOWN'`. The lane must remain `OBSERVED` while that metric stays null.

- [ ] **Step 3: Write generic state/provider projection RED**

Add cases:

```ts
expect(completeLaneWithoutMatch.state).toBe('NOT_OBSERVED');
expect(incompleteLaneWithoutMatch.state).toBe('UNKNOWN');
expect(baiduProjection).toMatchObject({
  kind: 'PROVIDER',
  provider: 'BAIDU_SEARCH_RESOURCE',
  state: 'UNAVAILABLE',
  capabilityState: 'NOT_IMPLEMENTED',
  marketCode: null,
  propertyRef: null,
});
```

Add deterministic ordering assertions for snapshot IDs and Google matched pages.

- [ ] **Step 4: Run pure RED**

Run:

```bash
npm test -- tests/unit/keyword-search-evidence.test.ts
```

Expected: FAIL because aggregation module/types are absent.

- [ ] **Step 5: Implement pure aggregation helpers**

Implement `src/modules/keywords/keyword-search-evidence.ts` with these rules:

```ts
const metric = (
  fact: SearchFactView,
  semantic: SearchFactMetricSemantic,
): SearchFactMetricView | undefined =>
  fact.metrics.find((item) => item.metricSemantic === semantic);

const knownNumber = (
  fact: SearchFactView,
  semantic: SearchFactMetricSemantic,
): number | null => {
  const value = metric(fact, semantic);
  return value?.evidenceState === 'KNOWN_PRESENT' && value.numericValue !== null
    ? value.numericValue
    : null;
};
```

Use `normalizeSearchEvidenceQuery(fact.query)` for matching; do not trust provider `normalizedQuery` as the permanent cross-version join key.

Google aggregation:

```ts
clicks = sum known CLICKS;
impressions = sum known IMPRESSIONS;
ctr = impressions > 0 ? clicks / impressions : null;
position = sum(position * impressions) / sum(impressions) over rows where both are known and impressions > 0;
```

Google per-page aggregation groups by `canonicalPage`, sums clicks/impressions, and computes page impression-weighted position. Sort pages by impressions desc, clicks desc, canonical URL asc.

Bing aggregation uses matching `QUERY` facts only. Compute weighted averages only from rows with a known provider position and positive corresponding weight. If no weighted observations exist, the position metric is null.

State resolution:

```ts
if (matchingFacts.length > 0) return 'OBSERVED';
if (lane.sourceCompleteness.length > 0 && lane.sourceCompleteness.every((value) => value === 'COMPLETE')) {
  return 'NOT_OBSERVED';
}
return 'UNKNOWN';
```

Provider query capability selection:

```ts
const queryCapability = provider === 'GOOGLE_SEARCH_CONSOLE'
  ? manifest.capabilities.QUERY_PAGE_DAILY
  : manifest.capabilities.QUERY_STATS;
```

Google/Bing with supported capability but no real lane receive a provider-level `UNKNOWN` projection. Unsupported/not-implemented providers receive `UNAVAILABLE` with manifest `capabilityState` and `accessMode`.

- [ ] **Step 6: Run pure GREEN**

Run:

```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts tests/unit/keyword-search-evidence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/modules/keywords/keyword-search-evidence.ts tests/unit/keyword-search-evidence.test.ts
git commit -m "feat(keywords): aggregate official search evidence"
```

- [ ] **Step 8: Freeze P11-02A-A with exact-head full CI**

Push the exact Task 2 head and require GitHub Actions:

```text
verify = SUCCESS
production-audit = SUCCESS
deployment-artifact = SUCCESS
e2e = SUCCESS
```

Do not start Task 3 until all four jobs are green at the exact same head.

---

### Task 3: Completed SearchFact Snapshot Metadata Read

**Phase:** P11-02A-B

**Files:**
- Modify: `src/modules/search-facts/search-fact.types.ts`
- Modify: `src/modules/search-facts/search-fact.repository.ts`
- Create: `tests/integration/search-fact.snapshot-read.test.ts`

**Interfaces:**
- Consumes: persisted `SearchFactSnapshot` records only.
- Produces:

```ts
export type SearchFactSnapshotReadFilter = {
  projectId: string;
  provider?: SearchFactProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
  sourceCutoffFrom?: Date;
  sourceCutoffTo?: Date;
};

export type SearchFactSnapshotView = {
  snapshotId: string;
  projectId: string;
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceKind: SearchFactSourceKind;
  sourceRef: string;
  sourceCutoffAt: Date;
  sourceCompleteness: SearchFactCompleteness;
  normalizationVersion: string;
  factCount: number;
  completedAt: Date;
};

SearchFactRepository.listCompletedSnapshots(
  filter: SearchFactSnapshotReadFilter,
): Promise<SearchFactSnapshotView[]>;
```

- [ ] **Step 1: Write snapshot-read RED**

Create `tests/integration/search-fact.snapshot-read.test.ts` that persists:

1. a completed Google snapshot with zero facts and `TOP_ROWS_ONLY`;
2. a completed Bing snapshot with one unrelated query and `PROVIDER_UNSPECIFIED`;
3. a foreign-project snapshot.

Then assert:

```ts
const rows = await repository.listCompletedSnapshots({
  projectId,
  sourceCutoffFrom: new Date('2026-08-01T00:00:00.000Z'),
  sourceCutoffTo: new Date('2026-08-28T23:59:59.999Z'),
});

expect(rows.map((row) => row.provider)).toEqual([
  'BING_WEBMASTER',
  'GOOGLE_SEARCH_CONSOLE',
]);
expect(rows.every((row) => row.projectId === projectId)).toBe(true);
expect(rows.find((row) => row.provider === 'GOOGLE_SEARCH_CONSOLE')).toMatchObject({
  factCount: 0,
  sourceCompleteness: 'TOP_ROWS_ONLY',
});
```

The test must prove a completed zero-fact snapshot is still observable.

- [ ] **Step 2: Run snapshot RED**

Run:

```bash
npm test -- tests/integration/search-fact.snapshot-read.test.ts
```

Expected: FAIL because snapshot read types/method do not exist.

- [ ] **Step 3: Add read filter/view types**

In `search-fact.types.ts`, add the exact types above. Do not alter existing materialization/write types.

- [ ] **Step 4: Implement `listCompletedSnapshots()`**

In `SearchFactRepository`, reuse validation style from `listCompletedFacts()` and query:

```ts
const rows = await this.db.searchFactSnapshot.findMany({
  where: {
    projectId: filter.projectId,
    status: 'COMPLETED',
    completedAt: { not: null },
    ...(filter.provider ? { provider: filter.provider } : {}),
    ...(filter.marketCode ? { marketCode: filter.marketCode } : {}),
    ...(filter.locale !== undefined ? { locale: filter.locale } : {}),
    ...(filter.propertyRef !== undefined ? { propertyRef: filter.propertyRef } : {}),
    ...(cutoff ? { sourceCutoffAt: cutoff } : {}),
  },
  orderBy: [
    { provider: 'asc' },
    { marketCode: 'asc' },
    { locale: 'asc' },
    { propertyRef: 'asc' },
    { sourceCutoffAt: 'asc' },
    { id: 'asc' },
  ],
});
```

Map only safe metadata; never expose credentials.

- [ ] **Step 5: Run snapshot GREEN**

```bash
npm test -- tests/integration/search-fact.snapshot-read.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/modules/search-facts/search-fact.types.ts src/modules/search-facts/search-fact.repository.ts tests/integration/search-fact.snapshot-read.test.ts
git commit -m "feat(search-facts): expose completed snapshot evidence"
```

---

### Task 4: Persisted Keyword Search-Evidence Repository and Service

**Phase:** P11-02A-B

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence.repository.ts`
- Create: `src/modules/keywords/keyword-search-evidence.service.ts`
- Create: `tests/integration/keywords.search-evidence.service.test.ts`

**Interfaces:**
- Consumes: `KeywordRepository`, `SearchFactRepository.listCompletedFacts()`, `SearchFactRepository.listCompletedSnapshots()`, `listSearchProviderManifests()`.
- Produces:

```ts
export type KeywordSearchEvidenceFilters = {
  from?: string;
  to?: string;
  provider?: SearchProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
};

export type KeywordSearchEvidenceResult = {
  keyword: {
    id: string;
    text: string;
    normalizedMatchText: string;
  };
  dateFrom: string;
  dateTo: string;
  evidence: KeywordSearchEvidenceItem[];
};

export class KeywordSearchEvidenceRepository {
  loadProjectWindow(input: {
    projectId: string;
    dateFrom: Date;
    dateTo: Date;
    provider?: SearchProviderCode;
    marketCode?: MarketCode;
    locale?: string;
    propertyRef?: string;
  }): Promise<{
    snapshots: SearchFactSnapshotView[];
    facts: SearchFactView[];
  }>;
}

export class KeywordSearchEvidenceService {
  constructor(
    repository?: KeywordSearchEvidenceRepository,
    keywordRepository?: KeywordRepository,
    now?: () => Date,
  );

  evaluateKeyword(
    projectId: string,
    keywordId: string,
    filters?: KeywordSearchEvidenceFilters,
  ): Promise<KeywordSearchEvidenceResult>;

  evaluateProject(
    projectId: string,
    keywords: KeywordListRecord[],
    filters?: KeywordSearchEvidenceFilters,
  ): Promise<Map<string, KeywordSearchEvidenceResult>>;
}

export const keywordSearchEvidenceService: KeywordSearchEvidenceService;
```

- [ ] **Step 1: Write service RED for real observed evidence**

Seed one project, one authoritative keyword `符纸`, completed Google/Bing snapshots/facts, and a foreign project. Use `SearchFactRepository.persistCompletedSnapshot()` for normal fact persistence.

Assert:

```ts
const result = await service.evaluateKeyword(project.id, keyword.id, {
  from: '2026-08-01',
  to: '2026-08-28',
});

expect(result.keyword).toMatchObject({
  id: keyword.id,
  text: '符纸',
  normalizedMatchText: '符纸',
});
expect(result.evidence.find((item) => item.provider === 'GOOGLE_SEARCH_CONSOLE'))
  .toMatchObject({ kind: 'LANE', state: 'OBSERVED' });
expect(result.evidence.find((item) => item.provider === 'BING_WEBMASTER'))
  .toMatchObject({ kind: 'LANE', state: 'OBSERVED' });
```

- [ ] **Step 2: Write service RED for incomplete absence and provider availability**

Seed a Google `TOP_ROWS_ONLY` snapshot with no matching query and a Bing `PROVIDER_UNSPECIFIED` snapshot with unrelated queries.

Assert both real lanes return `UNKNOWN`; assert Baidu/360/Sogou/Shenma appear as truthful `UNAVAILABLE` provider projections according to manifest capability state.

- [ ] **Step 3: Write range/filter/fail-closed RED**

Add assertions:

```ts
await expect(service.evaluateKeyword(project.id, foreignKeyword.id))
  .rejects.toMatchObject({ code: 'KEYWORD_NOT_FOUND' });

await expect(service.evaluateKeyword(project.id, keyword.id, {
  from: '2026-08-30',
  to: '2026-08-01',
})).rejects.toMatchObject({ code: 'KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID' });

await expect(service.evaluateKeyword(project.id, keyword.id, {
  from: '2026-01-01',
  to: '2026-08-28',
})).rejects.toMatchObject({ code: 'KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID' });
```

Inject `now = () => new Date('2026-08-29T12:00:00.000Z')` and verify default range is exactly `2026-08-01` through `2026-08-28`.

Filter tests must prove provider/market/locale/propertyRef narrow lanes without merging them.

- [ ] **Step 4: Write no-execution RED**

The repository/service constructor exposes only read repositories and `now`; it must not accept provider transports or queues. Add spies/fakes around the read repository and assert only `loadProjectWindow()` is called. In an integration test, do not configure Search Console/Bing transports, Redis, crawler, or AI; the service must still resolve seeded persisted evidence successfully.

- [ ] **Step 5: Run service RED**

```bash
npm test -- tests/integration/keywords.search-evidence.service.test.ts
```

Expected: FAIL because repository/service do not exist.

- [ ] **Step 6: Implement UTC range parser**

In `keyword-search-evidence.service.ts` use strict calendar parsing:

```ts
const DAY_MS = 86_400_000;
const MAX_DAYS = 93;

function parseUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw rangeError();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw rangeError();
  }
  return date;
}
```

For default window:

```ts
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const dateTo = new Date(today.getTime() - DAY_MS);
const dateFrom = new Date(dateTo.getTime() - 27 * DAY_MS);
```

Reject spans where `Math.floor((to - from) / DAY_MS) + 1 > 93`.

Stable errors:

```ts
new AppError('Keyword search evidence range is invalid', 400, 'KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID');
new AppError('Keyword search evidence filter is invalid', 400, 'KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID');
```

Validate provider against `SEARCH_PROVIDER_CODES`; validate market against Prisma `MarketCode` values already used by the codebase; reject blank locale/propertyRef.

- [ ] **Step 7: Implement repository load**

`KeywordSearchEvidenceRepository.loadProjectWindow()` must call both:

```ts
searchFactRepository.listCompletedSnapshots(snapshotFilter)
searchFactRepository.listCompletedFacts(factFilter)
```

Do not pass `normalizedQuery`, because P11-02A must normalize each raw `fact.query` with its own matcher.

Load query-capable facts only:

- Google: `QUERY_PAGE`
- Bing: `QUERY`

If a single `factKind` filter cannot express both in one call, use two read calls and concatenate deterministically. Do not load `PAGE`/`SITE` into keyword query aggregation.

- [ ] **Step 8: Implement lane materialization**

Group snapshots by exact real lane key:

```ts
`${provider}\u0000${marketCode}\u0000${locale}\u0000${propertyRef}`
```

For each real lane, pass its snapshots and same-lane facts into `aggregateKeywordSearchEvidenceLane()`.

After real lanes are built, append provider projections from `projectUnavailableProviders()`. Sort final items by provider, then real lane market/locale/propertyRef, with provider placeholder after real lanes for the same provider if such a case ever occurs.

- [ ] **Step 9: Implement project bulk evaluation**

`evaluateProject()` must load the project window once and aggregate the same persisted window for all supplied authoritative keywords. It must not call `evaluateKeyword()` in a loop if that causes repeated database reads.

- [ ] **Step 10: Run service GREEN**

```bash
npm test -- \
  tests/unit/keyword-search-evidence-normalize.test.ts \
  tests/unit/keyword-search-evidence.test.ts \
  tests/integration/search-fact.snapshot-read.test.ts \
  tests/integration/keywords.search-evidence.service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit Task 4**

```bash
git add \
  src/modules/keywords/keyword-search-evidence.repository.ts \
  src/modules/keywords/keyword-search-evidence.service.ts \
  tests/integration/keywords.search-evidence.service.test.ts
git commit -m "feat(keywords): read persisted official search evidence"
```

- [ ] **Step 12: Freeze P11-02A-B with exact-head full CI**

Require all four current jobs green at the exact Task 4 head before API work.

---

### Task 5: Secured Read-Only JSON API

**Phase:** P11-02A-C

**Files:**
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.search-evidence.api.test.ts`

**Interfaces:**
- Consumes: `KeywordSearchEvidenceService.evaluateKeyword()`.
- Produces:

```text
GET /api/v1/projects/:projectId/keywords/:keywordId/search-evidence
```

Query params: `from`, `to`, `provider`, `marketCode`, `locale`, `propertyRef`.

Guards:

```ts
requireAuthentication(),
requireProjectMembership(),
requireProjectCapability('PROJECT_READ')
```

No CSRF on this GET.

- [ ] **Step 1: Write API RED**

Create API tests with seeded persisted facts:

```ts
it('lets a VIEWER read truthful Google/Bing evidence', ... expect(200));
it('requires authentication', ... expect(401));
it('hides a foreign project from a non-member', ... expect(404));
it('fails closed for a foreign keyword id', ... expect(404) and KEYWORD_NOT_FOUND);
it('accepts a GET without CSRF', ... expect(200));
it('returns stable range error', ... expect(400) and KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID);
it('returns stable filter error', ... expect(400) and KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID);
```

For the successful response assert the exact label field semantics/data, not UI copy:

```ts
expect(response.body.data.evidence).toEqual(expect.arrayContaining([
  expect.objectContaining({
    provider: 'GOOGLE_SEARCH_CONSOLE',
    state: 'OBSERVED',
    metrics: expect.objectContaining({
      searchConsoleAveragePosition: expect.any(Number),
    }),
  }),
]));
```

- [ ] **Step 2: Run API RED**

```bash
npm test -- tests/integration/keywords.search-evidence.api.test.ts
```

Expected: route 404 before implementation; non-member generic 404 may already satisfy its hide-existence case.

- [ ] **Step 3: Add dependency injection**

In `src/app.ts`:

```ts
import type { KeywordSearchEvidenceService } from './modules/keywords/keyword-search-evidence.service.js';

export interface AppOptions {
  // existing options...
  keywordSearchEvidenceService?: KeywordSearchEvidenceService;
}
```

Pass the optional service to `createKeywordRoutes()` and later `createKeywordWebRoutes()`.

- [ ] **Step 4: Add API route**

Extend `createKeywordRoutes()` signature:

```ts
export function createKeywordRoutes(
  service = keywordService,
  coverageService = keywordCoverageService,
  aiService = aiTaskService,
  searchEvidenceService = keywordSearchEvidenceService,
) { ... }
```

Add GET before mutation routes:

```ts
router.get(
  '/projects/:projectId/keywords/:keywordId/search-evidence',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  async (req, res, next) => {
    try {
      const data = await searchEvidenceService.evaluateKeyword(
        routeParam(req.params.projectId),
        routeParam(req.params.keywordId),
        {
          from: typeof req.query.from === 'string' ? req.query.from : undefined,
          to: typeof req.query.to === 'string' ? req.query.to : undefined,
          provider: typeof req.query.provider === 'string' ? req.query.provider as never : undefined,
          marketCode: typeof req.query.marketCode === 'string' ? req.query.marketCode as never : undefined,
          locale: typeof req.query.locale === 'string' ? req.query.locale : undefined,
          propertyRef: typeof req.query.propertyRef === 'string' ? req.query.propertyRef : undefined,
        },
      );
      res.json({ data });
    } catch (error) {
      next(error);
    }
  },
);
```

Do **not** retain `as never` in final implementation. Add/export typed query parsing helpers in the service or route so invalid enum strings are validated and mapped to `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID` before calling the service. The final route must be type-safe.

- [ ] **Step 5: Run API GREEN**

```bash
npm test -- tests/integration/keywords.search-evidence.api.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.search-evidence.api.test.ts
git commit -m "feat(keywords): expose official search evidence API"
```

- [ ] **Step 7: Freeze P11-02A-C with exact-head full CI**

Require `verify`, `production-audit`, `deployment-artifact`, `e2e` all green on the same head.

---

### Task 6: Keyword Center Search-Evidence Read Model

**Phase:** P11-02A-D

**Files:**
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/app.ts`
- Modify: `tests/integration/keywords.web.test.ts`

**Interfaces:**
- Consumes: `KeywordSearchEvidenceService.evaluateProject()`.
- Produces `searchEvidence` attached to each `KeywordCenterKeywordRecord`.

Add:

```ts
export interface KeywordCenterKeywordRecord extends KeywordListRecord {
  parentKeywordId: string | null;
  groupIds: string[];
  coverage: KeywordCoverageResult;
  searchEvidence: KeywordSearchEvidenceResult;
}
```

- [ ] **Step 1: Write web read-model RED**

Extend `tests/integration/keywords.web.test.ts` with seeded SearchFact evidence and assertions:

```ts
expect(response.text).toContain('搜索证据');
expect(response.text).toContain('Google Search Console');
expect(response.text).toContain('Search Console 平均位置');
expect(response.text).not.toContain('Google 当前排名');
expect(response.text).not.toContain('Google 排名：1');
expect(response.text).toContain('当前持久化数据不完整');
expect(response.text).toContain('官方平台能力尚未接入');
```

Add VIEWER read assertion and keep mutation controls hidden as in P11-01.

- [ ] **Step 2: Write one-load/no-side-effect RED**

Inject a fake `KeywordSearchEvidenceService` whose `evaluateProject()` is a Vitest spy. Render a project with multiple keywords and assert:

```ts
expect(evaluateProject).toHaveBeenCalledTimes(1);
expect(evaluateProject).toHaveBeenCalledWith(projectId, expect.any(Array), undefined);
```

Do not inject or invoke Search Console sync, Bing collection, crawler, AI, publication, or distribution dependencies anywhere in this web path.

- [ ] **Step 3: Run web RED**

```bash
npm test -- tests/integration/keywords.web.test.ts
```

Expected: FAIL because the view model/page has no `searchEvidence` projection/copy.

- [ ] **Step 4: Extend KeywordWebRepository**

Constructor:

```ts
constructor(
  private readonly coverageService = keywordCoverageService,
  private readonly keywordRepository = new KeywordRepository(),
  private readonly searchEvidenceService = keywordSearchEvidenceService,
) {}
```

After keywords are loaded:

```ts
const [coverageByKeyword, searchEvidenceByKeyword] = await Promise.all([
  this.coverageService.evaluateProject(projectId, keywords),
  this.searchEvidenceService.evaluateProject(projectId, keywords),
]);
```

Each row receives:

```ts
searchEvidence: searchEvidenceByKeyword.get(keyword.id) ?? failClosedUnknownResult(keyword)
```

Prefer making `evaluateProject()` return every supplied keyword deterministically so a fallback is not normally needed. If a fallback helper is retained, it must return `UNKNOWN`/provider `UNAVAILABLE` semantics only and never fabricate zero metrics.

- [ ] **Step 5: Inject service through web routes/App**

Extend `createKeywordWebRoutes()` with the optional search-evidence service and construct:

```ts
const webRepository = new KeywordWebRepository(
  coverageService,
  new KeywordRepository(),
  searchEvidenceService,
);
```

Update the existing `createApp()` call accordingly.

- [ ] **Step 6: Run read-model GREEN**

```bash
npm test -- tests/integration/keywords.web.test.ts
npm run typecheck
```

Expected: service spy contract passes, but final text assertions may remain RED until Task 7 view work; if so, split assertions so this task freezes only the read model and leave display assertions in Task 7. Do not weaken semantic assertions merely to make this task green.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/modules/keywords/keyword.web.repository.ts src/modules/keywords/keyword.web.routes.ts src/app.ts tests/integration/keywords.web.test.ts
git commit -m "feat(keywords): project search evidence into keyword center"
```

---

### Task 7: Truthful Keyword Center Search-Evidence UI

**Phase:** P11-02A-D

**Files:**
- Modify: `src/views/keywords/index.ejs`
- Modify: `src/public/css/p11-keywords.css`
- Modify: `tests/integration/keywords.web.test.ts`

**Interfaces:**
- Consumes: `KeywordCenterKeywordRecord.searchEvidence`.
- Produces server-rendered truthful search-evidence UI; no client-side provider fetching.

- [ ] **Step 1: Write/finalize UI RED**

Assert these stable hooks/copy in `keywords.web.test.ts`:

```html
<div data-ui="keyword-search-evidence">
<div data-provider="GOOGLE_SEARCH_CONSOLE">
<div data-provider="BING_WEBMASTER">
```

Required visible copy:

- `搜索证据`
- `Search Console 平均位置`
- `Search Console 平均位置是所选数据窗口的官方汇总指标，不代表某个用户此刻看到的实时 Google SERP 排名。`
- `当前持久化数据不完整，未观察到该关键词不能解释为 0 搜索量或无排名。`
- truthful unavailable wording for China provider projections.

Forbidden copy assertions:

```ts
expect(response.text).not.toContain('Google 当前排名');
expect(response.text).not.toContain('排名 0');
expect(response.text).not.toContain('无排名');
```

- [ ] **Step 2: Run UI RED**

```bash
npm test -- tests/integration/keywords.web.test.ts
```

Expected: RED on missing UI hooks/copy only.

- [ ] **Step 3: Render compact row evidence**

In `index.ejs`, inside each keyword row, render a search-evidence cell/stack. For each evidence item:

```ejs
<div class="keyword-search-evidence__provider"
     data-provider="<%= item.provider %>">
  <strong><%= providerDisplayName(item.provider) %></strong>
  <span><%= item.state %></span>
  <% if (item.kind === 'LANE' && item.provider === 'GOOGLE_SEARCH_CONSOLE' && item.state === 'OBSERVED') { %>
    <small><%= item.metrics.impressions %> impressions · <%= item.metrics.clicks %> clicks</small>
    <% if (item.metrics.searchConsoleAveragePosition !== null) { %>
      <small>Search Console 平均位置 <%= item.metrics.searchConsoleAveragePosition.toFixed(1) %></small>
    <% } %>
  <% } %>
</div>
```

Do not use an undefined EJS helper. Either define local lookup objects at the top of the template or prepare display names in the view model.

- [ ] **Step 4: Render truth notes and unavailable states**

For `UNKNOWN` incomplete real lanes show the required incomplete-data explanation. For `UNAVAILABLE` provider projections show manifest-derived wording such as `官方平台能力尚未接入` or `当前接口不支持查询级证据`.

Use `sourceCompleteness` visibly for real lanes where useful (`TOP_ROWS_ONLY`, `PROVIDER_UNSPECIFIED`, `COMPLETE`).

- [ ] **Step 5: Add responsive CSS**

Append focused classes under existing P11 CSS namespace:

```css
.keyword-search-evidence{display:grid;gap:6px;min-width:180px}
.keyword-search-evidence__provider{display:grid;gap:3px;padding:8px 10px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface-subtle)}
.keyword-search-evidence__truth{font-size:10px;line-height:1.55;color:var(--ui-text-tertiary)}
@media(max-width:860px){.keyword-search-evidence{min-width:0}}
```

Do not set fixed widths that cause the existing 820px shell overflow regression.

- [ ] **Step 6: Run UI GREEN**

```bash
npm test -- tests/integration/keywords.web.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add src/views/keywords/index.ejs src/public/css/p11-keywords.css tests/integration/keywords.web.test.ts
git commit -m "feat(keywords): render official search evidence"
```

---

### Task 8: Browser Contract and P11-02A-D Freeze

**Phase:** P11-02A-D

**Files:**
- Modify: `tests/e2e/keywords.spec.ts`

**Interfaces:**
- Consumes: seeded persisted SearchFact snapshots/facts and existing Keyword Center.
- Produces: real Chromium proof of truthful evidence rendering and responsive layout.

- [ ] **Step 1: Add Playwright RED**

Add a browser scenario that seeds a keyword plus persisted Google evidence before navigation. Do not click any sync/generation button.

```ts
test('operator sees persisted official search evidence without live-rank claims', async ({ page, context }) => {
  const auth = await authenticateE2e(context, { role: 'VIEWER', ... });
  try {
    // create keyword and persist completed GSC SearchFact snapshot/facts
    await page.goto(`/projects/${auth.project.id}/keywords`);
    const evidence = page.locator('[data-ui="keyword-search-evidence"]').filter({ hasText: '符纸' });
    await expect(evidence).toContainText('Google Search Console');
    await expect(evidence).toContainText('Search Console 平均位置');
    await expect(evidence).not.toContainText('Google 当前排名');
  } finally {
    await auth.cleanup();
  }
});
```

If row selection needs a stable keyword ID, use `[data-keyword-id="..."] [data-ui="keyword-search-evidence"]` rather than text filtering.

- [ ] **Step 2: Extend 820px regression**

On the existing 820px test, seed evidence and keep:

```ts
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
expect(overflow).toBeLessThanOrEqual(1);
```

Also assert Keyword Center sidebar remains usable.

- [ ] **Step 3: Run E2E RED**

```bash
npx playwright test tests/e2e/keywords.spec.ts
```

Expected before final UI completion: FAIL only on new search-evidence browser contract. Existing P11 browser scenarios remain green.

- [ ] **Step 4: Make only necessary stable-hook/accessibility corrections**

If RED exposes ambiguous locators, fix the production accessibility/stable hook when the UI itself is ambiguous; if the UI correctly contains multiple valid repeated provider cards, fix the test selector to target the intended row/card rather than changing valid production behavior.

- [ ] **Step 5: Run focused E2E GREEN**

```bash
npx playwright test tests/e2e/keywords.spec.ts
```

Expected: all keyword browser scenarios PASS.

- [ ] **Step 6: Commit E2E contract**

```bash
git add tests/e2e/keywords.spec.ts
git commit -m "test(keywords): verify official search evidence browser flow"
```

- [ ] **Step 7: Freeze P11-02A-D with exact-head full CI**

Require same-head green:

```text
verify = SUCCESS
production-audit = SUCCESS
deployment-artifact = SUCCESS
e2e = SUCCESS
```

Confirm full Playwright count from logs and do not infer it from job status alone.

---

### Task 9: Scope/Security/Truth Review

**Phase:** Final review before closure docs

**Files:**
- No production changes expected unless review finds a concrete defect.

**Interfaces:**
- Consumes all P11-02A changes.
- Produces review evidence that implementation matches approved spec.

- [ ] **Step 1: Compare implementation branch to stacked base**

Run/inspect:

```bash
git diff --stat <stacked-base>...HEAD
git diff <stacked-base>...HEAD -- src/modules/keywords src/modules/search-facts src/views/keywords src/public/css/p11-keywords.css src/app.ts tests
```

Expected scope only:

- matcher/aggregation/read service;
- SearchFact completed snapshot read extension;
- read-only API;
- Keyword Center projection/UI;
- tests/docs.

Explicitly fail review if diff contains:

- provider transport/sync writes;
- new Prisma migration/model;
- live SERP provider;
- crawler/AI/publication execution changes;
- rank/search-volume fabrication.

- [ ] **Step 2: Review authority/security**

Verify from code/tests:

```text
GET search-evidence requires auth + project membership + PROJECT_READ
no CSRF-exempt mutation was introduced
foreign keyword is KEYWORD_NOT_FOUND
no OAuth token/credentialRef rendered
no provider transport/queue dependency in evidence service
```

- [ ] **Step 3: Review truth semantics**

Verify:

```text
TOP_ROWS_ONLY absent => UNKNOWN
PROVIDER_UNSPECIFIED absent => UNKNOWN
COMPLETE absent => NOT_OBSERVED
matched Bing with unknown position remains OBSERVED + null metric
Google label is Search Console 平均位置
no deterministic live-rank copy
no zero metrics synthesized for UNKNOWN/UNAVAILABLE
```

- [ ] **Step 4: Review determinism/performance boundary**

Confirm:

- real lanes sorted provider/market/locale/propertyRef;
- matched pages deterministic;
- snapshot IDs sorted;
- project web load calls `evaluateProject()` once, not N evidence DB loads;
- no derived ranking table/cache silently added.

- [ ] **Step 5: Fix only evidence-backed defects**

If review finds a defect, add a RED regression test first, make the minimum fix, rerun focused tests and exact-head full CI before proceeding.

---

### Task 10: Final Verification Evidence and Closure Head

**Phase:** P11-02A final closure

**Files:**
- Create: `docs/development/p11-02a-official-search-evidence-verification.md`

**Interfaces:**
- Consumes exact RED/GREEN SHA and GitHub Actions evidence from phases A/B/C/D.
- Produces auditable closure evidence; no code behavior.

- [ ] **Step 1: Record phase evidence**

Document for A/B/C/D:

```text
RED commit SHA + failing CI run + exact expected failure
GREEN/freeze commit SHA + CI run
verify result
production-audit result
deployment-artifact result
e2e result
```

Never reconstruct missing run IDs from memory; query GitHub and write only observed evidence.

- [ ] **Step 2: Record final truth boundaries**

Include explicitly:

```text
Search evidence uses persisted official facts only.
UNKNOWN != zero and UNKNOWN != NOT_OBSERVED.
Search Console average position != deterministic live SERP rank.
Bing provider averages != guaranteed current rank.
No search volume is claimed.
No provider health is inferred from configuration/capability manifest.
No read triggers provider sync/crawl/AI/publication/distribution.
No new ranking persistence table/migration exists.
P11-02B/P11-02C remain excluded.
```

- [ ] **Step 3: Record final implementation-head full suite**

At the final production/test head before docs, capture exact logs showing:

```text
Prisma validate/generate/migrate deploy
Typecheck
Full Vitest file/test counts
Build
Playwright passed count
production-audit
runtime/deployment artifact audit
```

- [ ] **Step 4: Commit verification document**

```bash
git add docs/development/p11-02a-official-search-evidence-verification.md
git commit -m "docs: record P11-02A verification evidence"
```

- [ ] **Step 5: Run final documentation-head exact CI**

Because the verification commit changes HEAD, require a new final run at that exact documentation head:

```text
verify = SUCCESS
production-audit = SUCCESS
deployment-artifact = SUCCESS
e2e = SUCCESS
```

- [ ] **Step 6: Final closure check**

Confirm:

```text
implementation PR remains Draft/open unless separately authorized
merged = false
no deployment occurred
no P11-02B/P11-02C code was started
```

Only after Step 5 and Step 6 may P11-02A be declared closed.

---

## Plan Self-Review Checklist

### Spec coverage

- Exact-match normalizer: Task 1.
- Evidence states and Google/Bing aggregation: Task 2.
- Snapshot metadata required for absence semantics: Task 3.
- Persisted-only service, ranges, filters, lane separation, provider projections: Task 4.
- Secured read API: Task 5.
- Keyword Center bulk read model: Task 6.
- Truthful UI/copy: Task 7.
- Browser/responsive proof: Task 8.
- Scope/security/truth review: Task 9.
- Exact-head evidence/closure: Task 10.
- No migration/live SERP/China provider execution: enforced globally and reviewed in Tasks 9-10.

### Type consistency

The plan uses these stable interfaces end-to-end:

```text
normalizeSearchEvidenceQuery
aggregateKeywordSearchEvidenceLane
projectUnavailableProviders
SearchFactRepository.listCompletedSnapshots
KeywordSearchEvidenceRepository.loadProjectWindow
KeywordSearchEvidenceService.evaluateKeyword
evaluateProject
KeywordSearchEvidenceResult
KeywordCenterKeywordRecord.searchEvidence
```

### Placeholder scan

The implementation plan intentionally contains no `TBD`, `TODO`, `implement later`, or unspecified “add tests/error handling” steps. Any implementation discovery that changes a frozen semantic requires an explicit design update rather than an improvised GREEN expansion.
