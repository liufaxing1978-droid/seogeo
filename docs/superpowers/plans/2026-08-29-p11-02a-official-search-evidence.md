# P11-02A Official Search Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect authoritative P11 keywords to already persisted Google Search Console and Bing Webmaster query evidence without fabricating live SERP rank, search volume, provider health, or zero-demand conclusions.

**Architecture:** Build a pure matching/aggregation layer under `src/modules/keywords`, extend `SearchFactRepository` with completed-snapshot metadata reads so absence can be interpreted safely, then add a read-only service, secured JSON endpoint, and Keyword Center projection. Reads consume only persisted `SearchFact`/`SearchFactSnapshot` rows plus static provider manifests and never invoke provider transports, queues, crawl, AI, publication, or distribution.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL, Vitest 3, Supertest 7, Playwright 1.62, existing SearchFact/provider registry, existing P11 Keyword Center.

**Spec:** `docs/superpowers/specs/2026-08-29-p11-02a-official-search-evidence-design.md`

## Global Constraints

- Stacked base is P11-01 closure head `e1786e7019c6eeaacf5e1c4a7d0993c504763ae8` plus approved P11-02A spec/plan; never write directly to `main`.
- Do not change P11-01 `Keyword.normalizedText` identity or uniqueness semantics.
- Search-evidence matching uses a separate exact matcher: NFKC, curly quote normalization, Unicode dash normalization, trim, whitespace collapse, locale-independent lowercase.
- Do not auto-convert Traditional/Simplified Chinese; `符紙` and `符纸` stay distinct.
- Google current completeness is `TOP_ROWS_ONLY`; missing query rows => `UNKNOWN`, never zero or `NOT_OBSERVED`.
- Bing current completeness is `PROVIDER_UNSPECIFIED`; missing query rows => `UNKNOWN`, never zero or `NOT_OBSERVED`.
- `NOT_OBSERVED` requires `COMPLETE` query evidence for that real lane/window.
- A matched Bing query remains `OBSERVED` even when one position metric is provider `UNKNOWN`; that metric stays `null`.
- Google output is a derived aggregation of persisted Query+Page facts for the selected lane/window, not property-level query-only totals.
- Label Google position only as `Search Console 平均位置` / `Search Console average position`; never live/deterministic Google rank.
- Real lanes preserve exact `(provider, marketCode, locale, propertyRef)` and are never silently merged.
- Provider placeholders may use null lane identity only for supported-with-no-lane `UNKNOWN` or capability `UNAVAILABLE` projections.
- Baidu/360/Sogou/Shenma use provider-manifest capability truth only; no fabricated health/connection/rank/search-volume claims.
- No new Prisma model/table/migration in P11-02A.
- Reads require existing `PROJECT_READ`; no new role/capability and no CSRF on GET.
- Foreign keyword IDs fail closed as `KEYWORD_NOT_FOUND`.
- Default date range is 28 UTC calendar days ending yesterday; explicit range maximum is 93 calendar days.
- Every task is RED -> exact failure -> minimal GREEN. Phase freezes require exact-head `verify`, `production-audit`, `deployment-artifact`, `e2e` all green.
- No merge/deploy without separate explicit authorization.

---

## File Map

**Create**
- `src/modules/keywords/keyword-search-evidence-normalize.ts` — pure matching normalizer.
- `src/modules/keywords/keyword-search-evidence.ts` — types, lane aggregation, provider projection.
- `src/modules/keywords/keyword-search-evidence.repository.ts` — read-only adapter over SearchFact reads/provider manifests.
- `src/modules/keywords/keyword-search-evidence.service.ts` — keyword lookup, range/filter validation, lane orchestration, project bulk evaluation.
- `tests/unit/keyword-search-evidence-normalize.test.ts`
- `tests/unit/keyword-search-evidence.test.ts`
- `tests/integration/search-fact.snapshot-read.test.ts`
- `tests/integration/keywords.search-evidence.service.test.ts`
- `tests/integration/keywords.search-evidence.api.test.ts`
- `tests/integration/keywords.search-evidence.web-repository.test.ts`
- `docs/development/p11-02a-official-search-evidence-verification.md`

**Modify**
- `src/modules/search-facts/search-fact.types.ts`
- `src/modules/search-facts/search-fact.repository.ts`
- `src/modules/keywords/keyword.routes.ts`
- `src/modules/keywords/keyword.web.repository.ts`
- `src/modules/keywords/keyword.web.routes.ts`
- `src/views/keywords/index.ejs`
- `src/public/css/p11-keywords.css`
- `src/app.ts`
- `tests/integration/keywords.web.test.ts`
- `tests/e2e/keywords.spec.ts`

---

### Task 1: Search-Evidence Query Matcher

**Phase:** A

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence-normalize.ts`
- Create: `tests/unit/keyword-search-evidence-normalize.test.ts`

**Produces:**
```ts
export function normalizeSearchEvidenceQuery(text: string): string;
```

- [ ] **Step 1: Write RED**

```ts
import { describe, expect, it } from 'vitest';
import * as moduleUnderTest from '../../src/modules/keywords/keyword-search-evidence-normalize.js';

const subject = moduleUnderTest as unknown as {
  normalizeSearchEvidenceQuery(text: string): string;
};

describe('P11-02A search evidence normalization', () => {
  it('normalizes width, punctuation and whitespace', () => {
    expect(subject.normalizeSearchEvidenceQuery('  ＦＯＯ　“符紙” — bar  '))
      .toBe('foo "符紙" - bar');
    expect(subject.normalizeSearchEvidenceQuery(' user’s   guide '))
      .toBe("user's guide");
  });

  it('does not collapse Traditional/Simplified Chinese', () => {
    expect(subject.normalizeSearchEvidenceQuery('符紙'))
      .not.toBe(subject.normalizeSearchEvidenceQuery('符纸'));
  });
});
```

- [ ] **Step 2: Prove RED**

Run:
```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts
```
Expected: FAIL because module/function does not exist.

- [ ] **Step 3: Minimal GREEN**

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

- [ ] **Step 4: Verify/commit**

```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts
npm run typecheck
git add src/modules/keywords/keyword-search-evidence-normalize.ts tests/unit/keyword-search-evidence-normalize.test.ts
git commit -m "feat(keywords): normalize official search evidence queries"
```

---

### Task 2: Pure Google/Bing Evidence Aggregation

**Phase:** A

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence.ts`
- Create: `tests/unit/keyword-search-evidence.test.ts`

**Produces:**
```ts
export type KeywordSearchEvidenceState = 'OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN' | 'UNAVAILABLE';

export type KeywordSearchEvidenceMetrics = {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  searchConsoleAveragePosition: number | null;
  bingAverageClickPosition: number | null;
  bingAverageImpressionPosition: number | null;
};

export type KeywordSearchEvidenceLaneSource = {
  provider: SearchProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceCompleteness: SearchFactCompleteness[];
  snapshotIds: string[];
  latestAvailableSourceDate: string | null;
};

export type KeywordSearchEvidenceRealLane = {
  kind: 'LANE';
  provider: SearchProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  state: 'OBSERVED' | 'NOT_OBSERVED' | 'UNKNOWN';
  capabilityState: 'SUPPORTED';
  sourceCompleteness: SearchFactCompleteness[];
  dateFrom: string;
  dateTo: string;
  latestSourceDate: string | null;
  latestAvailableSourceDate: string | null;
  snapshotIds: string[];
  metrics: KeywordSearchEvidenceMetrics;
  matchedPages: Array<{ canonicalPage: string; clicks: number; impressions: number; averagePosition: number | null }>;
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

export type KeywordSearchEvidenceItem = KeywordSearchEvidenceRealLane | KeywordSearchEvidenceProviderProjection;

export function aggregateKeywordSearchEvidenceLane(input: {
  normalizedKeyword: string;
  lane: KeywordSearchEvidenceLaneSource;
  facts: SearchFactView[];
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceRealLane;

export function projectProviderPlaceholders(input: {
  providersWithRealLanes: ReadonlySet<SearchProviderCode>;
  dateFrom: string;
  dateTo: string;
}): KeywordSearchEvidenceProviderProjection[];
```

- [ ] **Step 1: Google RED**

Seed matching Query+Page facts and assert:
```ts
expect(result.state).toBe('OBSERVED');
expect(result.metrics.clicks).toBe(6);
expect(result.metrics.impressions).toBe(150);
expect(result.metrics.ctr).toBeCloseTo(0.04);
expect(result.metrics.searchConsoleAveragePosition)
  .toBeCloseTo((8 * 100 + 4 * 50) / 150);
expect(result.matchedPages.map((item) => item.canonicalPage)).toEqual([
  'https://example.com/a',
  'https://example.com/b',
]);
```
Also assert absent exact query under `TOP_ROWS_ONLY` => `UNKNOWN` and all metrics `null`.

- [ ] **Step 2: Bing RED**

Seed matching `QUERY` facts. One `BING_AVG_IMPRESSION_POSITION` metric must be `UNKNOWN`.
```ts
expect(result.state).toBe('OBSERVED');
expect(result.metrics.clicks).toBe(10);
expect(result.metrics.impressions).toBe(200);
expect(result.metrics.bingAverageClickPosition).toBeCloseTo(expectedWeightedClickPosition);
expect(result.metrics.bingAverageImpressionPosition).toBeNull();
```

- [ ] **Step 3: State/provider RED**

```ts
expect(completeLaneWithoutMatch.state).toBe('NOT_OBSERVED');
expect(incompleteLaneWithoutMatch.state).toBe('UNKNOWN');
expect(baiduProjection).toMatchObject({
  kind: 'PROVIDER',
  provider: 'BAIDU_SEARCH_RESOURCE',
  state: 'UNAVAILABLE',
  capabilityState: 'NOT_IMPLEMENTED',
  marketCode: null,
});
```
Assert deterministic snapshot-ID and Google matched-page ordering.

- [ ] **Step 4: Prove RED**
```bash
npm test -- tests/unit/keyword-search-evidence.test.ts
```
Expected: missing aggregation module.

- [ ] **Step 5: Minimal aggregation GREEN**

Use `normalizeSearchEvidenceQuery(fact.query)`; never rely permanently on provider `normalizedQuery` version equality.

Google:
```text
clicks = sum known CLICKS
impressions = sum known IMPRESSIONS
ctr = clicks / impressions only when impressions > 0
position = impression-weighted mean over rows with known position and positive impressions
```
Group Google pages by `canonicalPage`; sum clicks/impressions; page position is impression-weighted; sort pages impressions desc, clicks desc, URL asc.

Bing:
```text
clicks = sum known CLICKS
impressions = sum known IMPRESSIONS
avgClickPosition = click-weighted mean only over known position + positive clicks
avgImpressionPosition = impression-weighted mean only over known position + positive impressions
```
Unknown metric evidence remains null.

State:
```ts
if (matchingFacts.length > 0) return 'OBSERVED';
if (lane.sourceCompleteness.length > 0 && lane.sourceCompleteness.every((v) => v === 'COMPLETE')) {
  return 'NOT_OBSERVED';
}
return 'UNKNOWN';
```

Provider query capability:
```ts
const descriptor = provider === 'GOOGLE_SEARCH_CONSOLE'
  ? manifest.capabilities.QUERY_PAGE_DAILY
  : manifest.capabilities.QUERY_STATS;
```
Supported provider with no real lane => provider-level `UNKNOWN`; `NOT_SUPPORTED`/`NOT_IMPLEMENTED` => `UNAVAILABLE`.

- [ ] **Step 6: Verify/commit/freeze A**
```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts tests/unit/keyword-search-evidence.test.ts
npm run typecheck
git add src/modules/keywords/keyword-search-evidence.ts tests/unit/keyword-search-evidence.test.ts
git commit -m "feat(keywords): aggregate official search evidence"
```
Push exact head. Require `verify`, `production-audit`, `deployment-artifact`, `e2e` all SUCCESS before Task 3.

---

### Task 3: Completed SearchFact Snapshot Metadata Read

**Phase:** B

**Files:**
- Modify: `src/modules/search-facts/search-fact.types.ts`
- Modify: `src/modules/search-facts/search-fact.repository.ts`
- Create: `tests/integration/search-fact.snapshot-read.test.ts`

**Produces:**
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

SearchFactRepository.listCompletedSnapshots(filter: SearchFactSnapshotReadFilter): Promise<SearchFactSnapshotView[]>;
```

- [ ] **Step 1: RED**
Persist a completed zero-fact Google `TOP_ROWS_ONLY` snapshot, a Bing snapshot, and a foreign-project snapshot. Assert project scoping and that the zero-fact completed Google snapshot is returned with completeness/factCount.

- [ ] **Step 2: Prove RED**
```bash
npm test -- tests/integration/search-fact.snapshot-read.test.ts
```
Expected: method/types absent.

- [ ] **Step 3: GREEN**
Add filter validation matching existing `listCompletedFacts()` conventions. Query only:
```ts
where: {
  projectId: filter.projectId,
  status: 'COMPLETED',
  completedAt: { not: null },
  ...(filter.provider ? { provider: filter.provider } : {}),
  ...(filter.marketCode ? { marketCode: filter.marketCode } : {}),
  ...(filter.locale !== undefined ? { locale: filter.locale } : {}),
  ...(filter.propertyRef !== undefined ? { propertyRef: filter.propertyRef } : {}),
  ...(cutoff ? { sourceCutoffAt: cutoff } : {}),
}
```
Order provider, market, locale, propertyRef, sourceCutoffAt, id. Return safe metadata only.

- [ ] **Step 4: Verify/commit**
```bash
npm test -- tests/integration/search-fact.snapshot-read.test.ts
npm run typecheck
git add src/modules/search-facts/search-fact.types.ts src/modules/search-facts/search-fact.repository.ts tests/integration/search-fact.snapshot-read.test.ts
git commit -m "feat(search-facts): expose completed snapshot evidence"
```

---

### Task 4: Persisted Search-Evidence Repository + Service

**Phase:** B

**Files:**
- Create: `src/modules/keywords/keyword-search-evidence.repository.ts`
- Create: `src/modules/keywords/keyword-search-evidence.service.ts`
- Create: `tests/integration/keywords.search-evidence.service.test.ts`

**Produces:**
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
  keyword: { id: string; text: string; normalizedMatchText: string };
  dateFrom: string;
  dateTo: string;
  evidence: KeywordSearchEvidenceItem[];
};

export class KeywordSearchEvidenceRepository {
  constructor(searchFactRepository?: SearchFactRepository);
  loadProjectWindow(input: {
    projectId: string;
    dateFrom: Date;
    dateTo: Date;
    provider?: SearchProviderCode;
    marketCode?: MarketCode;
    locale?: string;
    propertyRef?: string;
  }): Promise<{ snapshots: SearchFactSnapshotView[]; facts: SearchFactView[] }>;
}

export class KeywordSearchEvidenceService {
  constructor(
    repository?: KeywordSearchEvidenceRepository,
    keywordRepository?: KeywordRepository,
    now?: () => Date,
  );
  evaluateKeyword(projectId: string, keywordId: string, filters?: KeywordSearchEvidenceFilters): Promise<KeywordSearchEvidenceResult>;
  evaluateProject(projectId: string, keywords: KeywordListRecord[], filters?: KeywordSearchEvidenceFilters): Promise<Map<string, KeywordSearchEvidenceResult>>;
}

export const keywordSearchEvidenceService: KeywordSearchEvidenceService;
```

- [ ] **Step 1: Service RED**
Seed same-project keyword plus Google/Bing persisted facts and foreign keyword. Assert Google/Bing `OBSERVED`, foreign keyword `KEYWORD_NOT_FOUND`, default clock `2026-08-29T12:00:00Z` => range `2026-08-01..2026-08-28`, and explicit filters keep lanes separate.

- [ ] **Step 2: Incomplete/provider RED**
Google no-match `TOP_ROWS_ONLY` => real-lane `UNKNOWN`; Bing no-match `PROVIDER_UNSPECIFIED` => `UNKNOWN`; China manifests => truthful `UNAVAILABLE` projections.

- [ ] **Step 3: Range/filter RED**
Assert invalid/reversed/>93-day ranges => `KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID`; invalid provider/market/blank locale/property => `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID`.

- [ ] **Step 4: No-execution RED**
Service/repository dependencies expose only read repositories and clock. Seed persisted data without Redis/provider transports/crawler/AI and prove evaluation succeeds. A fake repository spy must show one `loadProjectWindow()` for `evaluateProject()`, not one per keyword.

- [ ] **Step 5: Prove RED**
```bash
npm test -- tests/integration/keywords.search-evidence.service.test.ts
```

- [ ] **Step 6: Implement strict UTC range/filter parsing**
```ts
const DAY_MS = 86_400_000;
const MAX_DAYS = 93;

function parseUtcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw rangeError();
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw rangeError();
  return date;
}
```
Default: yesterday UTC through 27 days before. Reject inclusive span >93.

Use runtime enum checks:
```ts
import { MarketCode } from '@prisma/client';
import { SEARCH_PROVIDER_CODES, type SearchProviderCode } from '../search-providers/search-provider.types.js';

const providerSet = new Set<string>(SEARCH_PROVIDER_CODES);
const marketSet = new Set<string>(Object.values(MarketCode));
```
Do not accept unchecked casts from HTTP strings.

- [ ] **Step 7: Implement read repository**
Default constructor:
```ts
constructor(
  private readonly searchFacts = new SearchFactRepository(prisma),
) {}
```
Call `listCompletedSnapshots()` plus query-capable `listCompletedFacts()` calls. Do not filter by provider `normalizedQuery`; P11-02A matcher normalizes raw `fact.query` itself. Load Google `QUERY_PAGE` and Bing `QUERY` only.

- [ ] **Step 8: Implement real lanes/provider projections**
Group snapshots by exact lane key `provider\0market\0locale\0propertyRef`; pass same-lane facts into pure aggregation. Add provider placeholders after real lanes. Deterministically sort provider/market/locale/propertyRef and snapshot IDs.

- [ ] **Step 9: Implement bulk evaluation**
`evaluateProject()` loads one project window once, then aggregates that in-memory dataset for every supplied authoritative keyword. Do not call `evaluateKeyword()` in a database-reading loop.

- [ ] **Step 10: Verify/commit/freeze B**
```bash
npm test -- tests/unit/keyword-search-evidence-normalize.test.ts tests/unit/keyword-search-evidence.test.ts tests/integration/search-fact.snapshot-read.test.ts tests/integration/keywords.search-evidence.service.test.ts
npm run typecheck
git add src/modules/keywords/keyword-search-evidence.repository.ts src/modules/keywords/keyword-search-evidence.service.ts tests/integration/keywords.search-evidence.service.test.ts
git commit -m "feat(keywords): read persisted official search evidence"
```
Require exact-head four CI jobs SUCCESS before Task 5.

---

### Task 5: Secured Read-Only Search-Evidence API

**Phase:** C

**Files:**
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.search-evidence.api.test.ts`

**Route:**
```text
GET /api/v1/projects/:projectId/keywords/:keywordId/search-evidence
```
Guards: authentication + membership + `PROJECT_READ`; no CSRF.

- [ ] **Step 1: API RED**
Test: VIEWER 200, anonymous 401, non-member 404, foreign keyword `KEYWORD_NOT_FOUND`, GET without CSRF 200, invalid range/filter stable 400 errors.

- [ ] **Step 2: Prove RED**
```bash
npm test -- tests/integration/keywords.search-evidence.api.test.ts
```
Expected: endpoint 404 before implementation.

- [ ] **Step 3: Add typed query parsers**
Export from service:
```ts
export function parseSearchEvidenceProviderFilter(value: unknown): SearchProviderCode | undefined;
export function parseSearchEvidenceMarketFilter(value: unknown): MarketCode | undefined;
export function parseSearchEvidenceOptionalTextFilter(value: unknown): string | undefined;
```
Rules: undefined => undefined; non-string/blank/invalid enum => `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID`.

- [ ] **Step 4: Add DI and route**
Add `keywordSearchEvidenceService?: KeywordSearchEvidenceService` to `AppOptions` and extend `createKeywordRoutes(...)` with default singleton.

Route query object:
```ts
const filters: KeywordSearchEvidenceFilters = {
  from: parseSearchEvidenceOptionalTextFilter(req.query.from),
  to: parseSearchEvidenceOptionalTextFilter(req.query.to),
  provider: parseSearchEvidenceProviderFilter(req.query.provider),
  marketCode: parseSearchEvidenceMarketFilter(req.query.marketCode),
  locale: parseSearchEvidenceOptionalTextFilter(req.query.locale),
  propertyRef: parseSearchEvidenceOptionalTextFilter(req.query.propertyRef),
};
```
Then `evaluateKeyword(projectId, keywordId, filters)` and `res.json({ data })`.

- [ ] **Step 5: Verify/commit/freeze C**
```bash
npm test -- tests/integration/keywords.search-evidence.api.test.ts
npm run typecheck
git add src/modules/keywords/keyword.routes.ts src/modules/keywords/keyword-search-evidence.service.ts src/app.ts tests/integration/keywords.search-evidence.api.test.ts
git commit -m "feat(keywords): expose official search evidence API"
```
Require exact-head four CI jobs SUCCESS.

---

### Task 6: Keyword Center Search-Evidence Read Model

**Phase:** D

**Files:**
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.search-evidence.web-repository.test.ts`

**Produces:**
```ts
export interface KeywordCenterKeywordRecord extends KeywordListRecord {
  parentKeywordId: string | null;
  groupIds: string[];
  coverage: KeywordCoverageResult;
  searchEvidence: KeywordSearchEvidenceResult;
}
```

- [ ] **Step 1: Read-model RED**
Instantiate `KeywordWebRepository` with fake coverage service and fake search-evidence service. Seed multiple keywords. Assert `evaluateProject(projectId, keywords)` called exactly once and every returned keyword row receives the correct result keyed by keyword ID.

- [ ] **Step 2: Prove RED**
```bash
npm test -- tests/integration/keywords.search-evidence.web-repository.test.ts
```
Expected: constructor/interface lacks search-evidence service/result.

- [ ] **Step 3: Minimal GREEN**
Constructor:
```ts
constructor(
  private readonly coverageService = keywordCoverageService,
  private readonly keywordRepository = new KeywordRepository(),
  private readonly searchEvidenceService = keywordSearchEvidenceService,
) {}
```
Load once:
```ts
const [coverageByKeyword, searchEvidenceByKeyword] = await Promise.all([
  this.coverageService.evaluateProject(projectId, keywords),
  this.searchEvidenceService.evaluateProject(projectId, keywords),
]);
```
Require every supplied keyword to have a result; if absent, throw an internal consistency error rather than fabricating metrics.

Extend `createKeywordWebRoutes()` and `createApp()` DI only; no EJS changes in this task.

- [ ] **Step 4: Verify/commit**
```bash
npm test -- tests/integration/keywords.search-evidence.web-repository.test.ts
npm run typecheck
git add src/modules/keywords/keyword.web.repository.ts src/modules/keywords/keyword.web.routes.ts src/app.ts tests/integration/keywords.search-evidence.web-repository.test.ts
git commit -m "feat(keywords): project search evidence into keyword center"
```
Task 6 is independently GREEN before UI text work begins.

---

### Task 7: Truthful Keyword Center UI + Web Contract

**Phase:** D

**Files:**
- Modify: `src/views/keywords/index.ejs`
- Modify: `src/public/css/p11-keywords.css`
- Modify: `tests/integration/keywords.web.test.ts`

- [ ] **Step 1: UI RED**
Seed persisted Google/Bing evidence and assert page contains:
```text
搜索证据
Google Search Console
Search Console 平均位置
当前持久化数据不完整，未观察到该关键词不能解释为 0 搜索量或无排名。
官方平台能力尚未接入 / 当前接口不支持查询级证据
```
Stable hook: `data-ui="keyword-search-evidence"` and provider `data-provider` attributes.

Forbidden assertions:
```ts
expect(response.text).not.toContain('Google 当前排名');
expect(response.text).not.toContain('排名 0');
```

- [ ] **Step 2: Prove RED**
```bash
npm test -- tests/integration/keywords.web.test.ts
```
Expected: existing page 200 but search-evidence hooks/copy absent.

- [ ] **Step 3: Render evidence**
Add local provider-display lookup at top of EJS; do not rely on undefined helper functions. For each keyword row render real lanes/provider placeholders with state, lane identity, completeness, safe metrics, and truth copy. Google position uses only `Search Console 平均位置`.

- [ ] **Step 4: Responsive CSS**
Add only namespaced classes, e.g.:
```css
.keyword-search-evidence{display:grid;gap:6px;min-width:180px}
.keyword-search-evidence__provider{display:grid;gap:3px;padding:8px 10px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface-subtle)}
.keyword-search-evidence__truth{font-size:10px;line-height:1.55;color:var(--ui-text-tertiary)}
@media(max-width:860px){.keyword-search-evidence{min-width:0}}
```

- [ ] **Step 5: Verify/commit**
```bash
npm test -- tests/integration/keywords.web.test.ts
npm run typecheck
git add src/views/keywords/index.ejs src/public/css/p11-keywords.css tests/integration/keywords.web.test.ts
git commit -m "feat(keywords): render official search evidence"
```

---

### Task 8: Playwright Contract + D Freeze

**Phase:** D

**Files:**
- Modify: `tests/e2e/keywords.spec.ts`

- [ ] **Step 1: Browser RED**
Seed one keyword and persisted Google SearchFact data before page load. Select the row by `data-keyword-id`, then assert its `[data-ui="keyword-search-evidence"]` contains `Google Search Console` and `Search Console 平均位置` and does not contain `Google 当前排名`.

- [ ] **Step 2: Extend 820px regression**
Seed evidence in the existing 820px flow and keep:
```ts
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
expect(overflow).toBeLessThanOrEqual(1);
```

- [ ] **Step 3: Prove RED/GREEN**
```bash
npx playwright test tests/e2e/keywords.spec.ts
```
RED must be only the new evidence contract before UI completion/hook correction. If multiple valid repeated elements exist, make the test selector precise rather than changing correct production behavior.

- [ ] **Step 4: Commit/freeze D**
```bash
git add tests/e2e/keywords.spec.ts
git commit -m "test(keywords): verify official search evidence browser flow"
```
Require exact-head `verify`, `production-audit`, `deployment-artifact`, `e2e` all SUCCESS and record actual Playwright pass count from logs.

---

### Task 9: Scope, Security and Truth Review

**Files:** no production changes unless a concrete defect is found.

- [ ] **Step 1: Scope review**
Diff stacked base to HEAD. Allowed: matcher/aggregation, SearchFact snapshot read extension, persisted read service, read-only API, Keyword Center projection/UI, tests/docs. Reject any new migration, provider transport/sync write, live SERP provider, crawler/AI/publication execution change.

- [ ] **Step 2: Security review**
Verify GET requires auth + membership + `PROJECT_READ`; no mutation/CSRF exemption; foreign keyword => `KEYWORD_NOT_FOUND`; no OAuth token/credentialRef rendered or accessed.

- [ ] **Step 3: Truth review**
Verify:
```text
TOP_ROWS_ONLY absent => UNKNOWN
PROVIDER_UNSPECIFIED absent => UNKNOWN
COMPLETE absent => NOT_OBSERVED
matched Bing + unknown position => OBSERVED + null metric
Google copy => Search Console 平均位置
UNKNOWN/UNAVAILABLE never synthesize zero metrics
```

- [ ] **Step 4: Determinism/performance review**
Verify real lane order provider/market/locale/propertyRef; page/snapshot ordering deterministic; Keyword Center uses one bulk `evaluateProject()` read, not N database windows.

- [ ] **Step 5: Defect handling**
Any defect gets a RED regression test first, minimal fix second, focused tests third, exact-head full CI fourth.

---

### Task 10: Final Verification Document + Closure Head

**Files:**
- Create: `docs/development/p11-02a-official-search-evidence-verification.md`

- [ ] **Step 1: Record A/B/C/D RED/GREEN evidence**
For every phase write exact commit SHA, CI run, expected RED cause, GREEN/freeze four-job results. Query GitHub; never reconstruct run IDs from memory.

- [ ] **Step 2: Record final truth boundaries**
Document explicitly:
```text
persisted official facts only
UNKNOWN != zero and UNKNOWN != NOT_OBSERVED
Search Console average position != live deterministic SERP rank
Bing averages != guaranteed current rank
no search-volume claim
no provider-health inference
no read-side provider/crawl/AI/publication/distribution execution
no new ranking persistence/migration
P11-02B/P11-02C excluded
```

- [ ] **Step 3: Record implementation-head verification**
Capture exact logs for Prisma validate/generate/migrate deploy, Typecheck, full Vitest counts, Build, Playwright count, production-audit, deployment-artifact.

- [ ] **Step 4: Commit docs**
```bash
git add docs/development/p11-02a-official-search-evidence-verification.md
git commit -m "docs: record P11-02A verification evidence"
```

- [ ] **Step 5: Run documentation-head exact CI**
Because docs change HEAD, require a new same-head four-job green run.

- [ ] **Step 6: Closure check**
Confirm implementation PR remains Draft/open unless separately authorized, `merged=false`, no deploy, and no P11-02B/P11-02C implementation started. Only then declare P11-02A closed.

---

## Self-Review Result

**Spec coverage:** matcher Task 1; pure state/aggregation Task 2; absence-capable snapshot metadata Task 3; persisted read service/ranges/filters/no-execution Task 4; secured API Task 5; independent web read model Task 6; truthful UI Task 7; browser/responsive proof Task 8; scope/security/truth review Task 9; exact-head evidence Task 10.

**Type consistency:** final plan uses stable names end-to-end: `normalizeSearchEvidenceQuery`, `aggregateKeywordSearchEvidenceLane`, `projectProviderPlaceholders`, `SearchFactRepository.listCompletedSnapshots`, `KeywordSearchEvidenceRepository.loadProjectWindow`, `KeywordSearchEvidenceService.evaluateKeyword`, `KeywordSearchEvidenceService.evaluateProject`, `KeywordSearchEvidenceResult`, `KeywordCenterKeywordRecord.searchEvidence`.

**Placeholder review:** no implementation step depends on unspecified follow-up work. Semantic discoveries outside this contract require a design amendment rather than silent scope expansion.
