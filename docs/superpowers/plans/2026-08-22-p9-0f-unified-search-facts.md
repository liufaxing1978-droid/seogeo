# P9-0F Unified Search Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an additive provider-aware normalized search-fact layer for Google Search Console and Bing Webmaster while preserving exact source provenance, market/locale/property identity, metric semantics, evidence state, completeness, and immutable normalization versions without changing P7 Growth scoring.

**Architecture:** Existing GSC tables stay authoritative. Bing gets an append-only, allowlisted source batch/row boundary before normalization. Pure Google/Bing normalizers produce deterministic drafts that a materializer persists into immutable `SearchFactSnapshot -> SearchFact -> SearchFactMetric` records; a provider-aware read repository is the only P9-0G handoff.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Prisma 6.14, PostgreSQL 17 in CI, Vitest 3.2.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0f-unified-search-facts-design.md`

## Global Constraints

- Branch: `feat/p9-0f-unified-search-facts`, forked from `main@a6d1fd648b0d836ef590d33492bdc44df18a190f`.
- P9-0F is search-engine performance evidence only; P9-0E `PlatformObservation` remains separate.
- Do not modify P7 scoring, opportunity formulas, lifecycle, evidence quality, or explanation semantics.
- Do not delete/rewrite `GscDailySnapshot` or `GscQueryPageFact`.
- Never collapse Google position, Bing average click position, and Bing average impression position into one semantic.
- `UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` are not zero.
- Completed normalized snapshots are immutable; normalization changes create a new version.
- Bing source persistence must be built from typed allowlisted observation fields only; no credentials, auth headers, arbitrary upstream bodies, or secret-bearing error bodies.
- P9-0F performs no cross-provider deduplication/scoring; P9-0G owns that logic.
- Every major contract uses RED -> GREEN TDD and the RED must be observed in the Draft PR CI before production code is added.
- Final readiness requires exact-head `verify`, `production-audit`, and `e2e` success. Do not merge automatically.

---

## File Map

**Create**
- `prisma/models/search-facts.prisma`
- `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql`
- `src/modules/search-facts/search-fact.types.ts`
- `src/modules/search-facts/search-provider-source.repository.ts`
- `src/modules/search-facts/search-fact.repository.ts`
- `src/modules/search-facts/search-fact.materializer.ts`
- `src/modules/search-facts/normalizers/google-search-fact.normalizer.ts`
- `src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts`
- `tests/unit/search-fact.contract.test.ts`
- `tests/unit/search-fact.google-normalizer.test.ts`
- `tests/unit/search-fact.bing-normalizer.test.ts`
- `tests/integration/search-provider-source.repository.test.ts`
- `tests/integration/search-fact.materializer.test.ts`
- `tests/integration/search-fact.repository.test.ts`
- `docs/development/p9-0f-unified-search-facts.md`

**Modify**
- `prisma/schema.prisma` — CI runs `npx prisma validate/generate` against this root schema, so the new declarations must exist here as well as in `prisma/models/search-facts.prisma`.

---

### Task 1: Persistence and semantic contract

**Files:**
- Create: `tests/unit/search-fact.contract.test.ts`
- Create: `src/modules/search-facts/search-fact.types.ts`
- Create: `prisma/models/search-facts.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql`

**Interfaces produced:**

```ts
export const SEARCH_FACT_NORMALIZATION_VERSION = 'SEARCH_FACT_NORMALIZATION_V1' as const;
export const SEARCH_FACT_KINDS = ['QUERY_PAGE', 'QUERY', 'PAGE', 'SITE'] as const;
export const SEARCH_FACT_SOURCE_KINDS = ['GSC_DAILY_SNAPSHOT', 'PROVIDER_OBSERVATION_BATCH'] as const;
export const SEARCH_FACT_METRIC_SEMANTICS = [
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION',
  'BING_AVG_CLICK_POSITION',
  'BING_AVG_IMPRESSION_POSITION'
] as const;
export const SEARCH_FACT_EVIDENCE_STATES = [
  'KNOWN_PRESENT',
  'KNOWN_EMPTY',
  'UNKNOWN',
  'NOT_SUPPORTED'
] as const;
export const SEARCH_FACT_COMPLETENESS = [
  'COMPLETE',
  'TOP_ROWS_ONLY',
  'PROVIDER_UNSPECIFIED',
  'UNKNOWN'
] as const;
```

- [ ] **Step 1: Add test-only RED**

Create `tests/unit/search-fact.contract.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  SEARCH_FACT_EVIDENCE_STATES,
  SEARCH_FACT_KINDS,
  SEARCH_FACT_METRIC_SEMANTICS,
  SEARCH_FACT_NORMALIZATION_VERSION,
  SEARCH_FACT_SOURCE_KINDS
} from '../../src/modules/search-facts/search-fact.types.js';

describe('P9-0F search fact contract', () => {
  it('keeps source and metric semantics explicit', () => {
    expect(SEARCH_FACT_NORMALIZATION_VERSION).toBe('SEARCH_FACT_NORMALIZATION_V1');
    expect(SEARCH_FACT_KINDS).toEqual(['QUERY_PAGE', 'QUERY', 'PAGE', 'SITE']);
    expect(SEARCH_FACT_SOURCE_KINDS).toEqual(['GSC_DAILY_SNAPSHOT', 'PROVIDER_OBSERVATION_BATCH']);
    expect(SEARCH_FACT_METRIC_SEMANTICS).toEqual([
      'CLICKS',
      'IMPRESSIONS',
      'CTR',
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'BING_AVG_CLICK_POSITION',
      'BING_AVG_IMPRESSION_POSITION'
    ]);
    expect(SEARCH_FACT_EVIDENCE_STATES).toEqual([
      'KNOWN_PRESENT',
      'KNOWN_EMPTY',
      'UNKNOWN',
      'NOT_SUPPORTED'
    ]);
    expect(SEARCH_FACT_METRIC_SEMANTICS).not.toContain('POSITION');
  });
});
```

Commit only this test, open Draft PR `P9-0F: add unified search facts`, and observe exact-head CI RED with module-not-found for `search-fact.types.js`.

- [ ] **Step 2: Add TypeScript contracts**

Create `src/modules/search-facts/search-fact.types.ts`:

```ts
import type { MarketCode } from '@prisma/client';
import type { SearchProviderCode } from '../search-providers/search-provider.types.js';

export const SEARCH_FACT_NORMALIZATION_VERSION = 'SEARCH_FACT_NORMALIZATION_V1' as const;
export const SEARCH_FACT_KINDS = Object.freeze(['QUERY_PAGE', 'QUERY', 'PAGE', 'SITE'] as const);
export const SEARCH_FACT_SOURCE_KINDS = Object.freeze(['GSC_DAILY_SNAPSHOT', 'PROVIDER_OBSERVATION_BATCH'] as const);
export const SEARCH_FACT_METRIC_SEMANTICS = Object.freeze([
  'CLICKS', 'IMPRESSIONS', 'CTR', 'GOOGLE_SEARCH_CONSOLE_POSITION',
  'BING_AVG_CLICK_POSITION', 'BING_AVG_IMPRESSION_POSITION'
] as const);
export const SEARCH_FACT_EVIDENCE_STATES = Object.freeze([
  'KNOWN_PRESENT', 'KNOWN_EMPTY', 'UNKNOWN', 'NOT_SUPPORTED'
] as const);
export const SEARCH_FACT_COMPLETENESS = Object.freeze([
  'COMPLETE', 'TOP_ROWS_ONLY', 'PROVIDER_UNSPECIFIED', 'UNKNOWN'
] as const);

export type SearchFactProviderCode = SearchProviderCode;
export type SearchFactKind = (typeof SEARCH_FACT_KINDS)[number];
export type SearchFactSourceKind = (typeof SEARCH_FACT_SOURCE_KINDS)[number];
export type SearchFactMetricSemantic = (typeof SEARCH_FACT_METRIC_SEMANTICS)[number];
export type SearchFactEvidenceState = (typeof SEARCH_FACT_EVIDENCE_STATES)[number];
export type SearchFactCompleteness = (typeof SEARCH_FACT_COMPLETENESS)[number];

export type NormalizedSearchMetricDraft = {
  metricSemantic: SearchFactMetricSemantic;
  numericValue: number | null;
  evidenceState: SearchFactEvidenceState;
  sourceField: string;
};

export type NormalizedSearchFactDraft = {
  factKey: string;
  factKind: SearchFactKind;
  sourceObservationRef: string;
  sourceDate: Date;
  query: string | null;
  normalizedQuery: string | null;
  queryNormalizationVersion: string | null;
  page: string | null;
  canonicalPage: string | null;
  canonicalizationVersion: string | null;
  metrics: readonly NormalizedSearchMetricDraft[];
};

export type SearchFactMaterializeIdentity = {
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
};
```

- [ ] **Step 3: Add Prisma schema**

Add these enums to both `prisma/models/search-facts.prisma` and `prisma/schema.prisma`:

```prisma
enum SearchFactProvider {
  GOOGLE_SEARCH_CONSOLE
  BING_WEBMASTER
  BAIDU_SEARCH_RESOURCE
  QIHOO_360_WEBMASTER
  SOGOU_WEBMASTER
  SHENMA_WEBMASTER
}

enum SearchFactSnapshotStatus { PENDING RUNNING COMPLETED FAILED }
enum SearchFactKind { QUERY_PAGE QUERY PAGE SITE }
enum SearchFactMetricSemantic {
  CLICKS
  IMPRESSIONS
  CTR
  GOOGLE_SEARCH_CONSOLE_POSITION
  BING_AVG_CLICK_POSITION
  BING_AVG_IMPRESSION_POSITION
}
enum SearchFactEvidenceState { KNOWN_PRESENT KNOWN_EMPTY UNKNOWN NOT_SUPPORTED }
enum SearchFactCompleteness { COMPLETE TOP_ROWS_ONLY PROVIDER_UNSPECIFIED UNKNOWN }
enum SearchFactSourceKind { GSC_DAILY_SNAPSHOT PROVIDER_OBSERVATION_BATCH }
```

Add these four models to both schema locations:

```prisma
model SearchProviderObservationBatch {
  id                 String                 @id @default(uuid()) @db.Uuid
  projectId          String                 @db.Uuid
  provider           SearchFactProvider
  marketCode         MarketCode
  locale             String
  propertyRef        String
  propertyType       String
  sourceCutoffAt     DateTime
  sourceCompleteness SearchFactCompleteness
  schemaVersion      String
  inputHash          String
  observationCount   Int
  createdAt          DateTime               @default(now())
  observations       SearchProviderObservationRecord[]

  @@unique([projectId, provider, marketCode, locale, propertyRef, sourceCutoffAt, schemaVersion, inputHash], map: "SearchProviderObservationBatch_identity_key")
  @@index([projectId, provider, marketCode, locale, sourceCutoffAt], map: "SearchProviderObservationBatch_lookup_idx")
}

model SearchProviderObservationRecord {
  id              String                 @id @default(uuid()) @db.Uuid
  batchId         String                 @db.Uuid
  projectId       String                 @db.Uuid
  sourceDate      DateTime               @db.Date
  observationKind String
  observationKey  String
  completeness    SearchFactCompleteness
  inputHash       String
  payloadJson     Json
  createdAt       DateTime               @default(now())
  batch           SearchProviderObservationBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([batchId, observationKey], map: "SearchProviderObservationRecord_batch_key")
  @@index([projectId, sourceDate, observationKind], map: "SearchProviderObservationRecord_project_date_kind_idx")
}

model SearchFactSnapshot {
  id                   String                   @id @default(uuid()) @db.Uuid
  projectId            String                   @db.Uuid
  provider             SearchFactProvider
  marketCode           MarketCode
  locale               String
  propertyRef          String
  propertyType         String
  sourceKind           SearchFactSourceKind
  sourceRef            String
  sourceCutoffAt       DateTime
  sourceCompleteness   SearchFactCompleteness
  normalizationVersion String
  inputHash            String
  status               SearchFactSnapshotStatus @default(PENDING)
  factCount            Int                      @default(0)
  startedAt            DateTime?
  completedAt          DateTime?
  errorCode            String?
  createdAt            DateTime                 @default(now())
  updatedAt            DateTime                 @updatedAt
  facts                SearchFact[]

  @@unique([projectId, provider, marketCode, locale, propertyRef, sourceKind, sourceRef, normalizationVersion], map: "SearchFactSnapshot_identity_key")
  @@index([projectId, provider, marketCode, locale, sourceCutoffAt, status], map: "SearchFactSnapshot_lookup_idx")
}

model SearchFact {
  id                        String         @id @default(uuid()) @db.Uuid
  snapshotId                String         @db.Uuid
  projectId                 String         @db.Uuid
  factKey                   String
  factKind                  SearchFactKind
  sourceObservationRef      String
  sourceDate                DateTime       @db.Date
  query                     String?
  normalizedQuery           String?
  queryNormalizationVersion String?
  page                      String?
  canonicalPage             String?
  canonicalizationVersion   String?
  createdAt                 DateTime       @default(now())
  snapshot                  SearchFactSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  metrics                   SearchFactMetric[]

  @@unique([snapshotId, factKey], map: "SearchFact_snapshot_fact_key")
  @@index([projectId, factKind, sourceDate], map: "SearchFact_project_kind_date_idx")
  @@index([projectId, canonicalPage, sourceDate], map: "SearchFact_project_page_date_idx")
  @@index([projectId, normalizedQuery, sourceDate], map: "SearchFact_project_query_date_idx")
}

model SearchFactMetric {
  id             String                    @id @default(uuid()) @db.Uuid
  factId         String                    @db.Uuid
  metricSemantic SearchFactMetricSemantic
  numericValue   Float?
  evidenceState  SearchFactEvidenceState
  sourceField    String
  createdAt      DateTime                  @default(now())
  fact           SearchFact                @relation(fields: [factId], references: [id], onDelete: Cascade)

  @@unique([factId, metricSemantic], map: "SearchFactMetric_fact_semantic_key")
  @@index([metricSemantic, evidenceState], map: "SearchFactMetric_semantic_evidence_idx")
}
```

Create `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql` with additive `CREATE TYPE`, `CREATE TABLE`, foreign-key, unique-index, and lookup-index SQL equivalent to the schema above. The SQL must contain no `DROP`, `TRUNCATE`, `DELETE`, or update of existing GSC/Growth/visibility rows.

- [ ] **Step 4: Verify Task 1 GREEN**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- tests/unit/search-fact.contract.test.ts
```

Expected: all pass. Commit as `feat: add unified search fact contract`.

---

### Task 2: Durable allowlisted Bing source boundary

**Files:**
- Create: `tests/integration/search-provider-source.repository.test.ts`
- Create: `src/modules/search-facts/search-provider-source.repository.ts`

**Interfaces produced:**

```ts
export const BING_SOURCE_SCHEMA_VERSION = 'BING_SEARCH_SOURCE_V1' as const;

export type PersistBingObservationBatchInput = {
  projectId: string;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: 'SITE';
  sourceCutoffAt: Date;
  observations: readonly (
    BingQueryObservation | BingPageObservation | BingSiteTrafficObservation
  )[];
};

export class SearchProviderSourceRepository {
  persistBingBatch(input: PersistBingObservationBatchInput): Promise<SearchProviderObservationBatch>;
  getBatch(batchId: string): Promise<SearchProviderObservationBatch | null>;
  listBatchObservations(batchId: string): Promise<PersistedProviderObservation[]>;
}
```

- [ ] **Step 1: RED integration test**

Persist QUERY/PAGE/SITE Bing observations and assert provider, completeness, exact three kinds, deterministic ordering, and idempotency. Serialize returned rows and assert it does not contain `Authorization`, `apiKey`, `access_token`, or `refresh_token`. Commit test-only and observe module-not-found RED in PR CI.

- [ ] **Step 2: Implement strict serialization**

`payloadJson` is built internally from typed fields only. The serializer may emit only:

```text
kind, provider, sourceDate, query/page, clicks, impressions,
avgClickPosition, avgImpressionPosition, completeness
```

It never accepts caller-supplied JSON. Compute observation keys and batch input hash with SHA-256 over stable sorted typed fields.

- [ ] **Step 3: Validate source identity**

Reject non-Bing observations, duplicate observation keys, mixed completeness, source dates later than cutoff, empty locale/property identity, and credential-bearing/non-HTTP(S) property URLs.

- [ ] **Step 4: GREEN verification**

```bash
npm run typecheck
npm test -- tests/integration/search-provider-source.repository.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

Expected: pass. Commit as `feat: persist Bing search source observations`.

---

### Task 3: Pure GSC and Bing normalizers

**Files:**
- Create: `tests/unit/search-fact.google-normalizer.test.ts`
- Create: `tests/unit/search-fact.bing-normalizer.test.ts`
- Create: `src/modules/search-facts/normalizers/google-search-fact.normalizer.ts`
- Create: `src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts`

**Interfaces produced:**

```ts
export const GSC_PERSISTED_CANONICALIZATION_VERSION = 'GSC_PERSISTED_CANONICAL_PAGE_V1';
export function normalizeGoogleSearchFact(source: GoogleSearchFactSource): NormalizedSearchFactDraft;

export const SEARCH_FACT_QUERY_NORMALIZATION_VERSION = 'SEARCH_FACT_QUERY_NORMALIZATION_V1';
export const SEARCH_FACT_PAGE_CANONICALIZATION_VERSION = 'SEARCH_FACT_PAGE_CANONICALIZATION_V1';
export function normalizeBingSearchObservation(source: PersistedProviderObservation): NormalizedSearchFactDraft;
```

- [ ] **Step 1: Google RED**

Fixture: clicks `7`, impressions `100`, CTR `0.07`, position `4.2`. Require `QUERY_PAGE`, exact persisted `normalizedQuery` and `canonicalPage`, source observation ref = original GSC fact id, and metrics:

```ts
[
  { metricSemantic: 'CLICKS', numericValue: 7, evidenceState: 'KNOWN_PRESENT', sourceField: 'clicks' },
  { metricSemantic: 'IMPRESSIONS', numericValue: 100, evidenceState: 'KNOWN_PRESENT', sourceField: 'impressions' },
  { metricSemantic: 'CTR', numericValue: 0.07, evidenceState: 'KNOWN_PRESENT', sourceField: 'ctr' },
  { metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION', numericValue: 4.2, evidenceState: 'KNOWN_PRESENT', sourceField: 'position' }
]
```

Commit test-only and observe PR CI RED.

- [ ] **Step 2: Google GREEN**

Map already persisted GSC normalization fields verbatim; do not normalize again. Validate finite non-negative metrics and CTR `[0,1]`.

Run:

```bash
npm run typecheck
npm test -- tests/unit/search-fact.google-normalizer.test.ts tests/unit/search-console.worker.test.ts
```

- [ ] **Step 3: Bing RED**

Require `QUERY_STATS -> QUERY`, `PAGE_STATS -> PAGE`, `SITE_TRAFFIC_DAILY -> SITE`; never fabricate missing query/page dimensions. Null Bing positions must emit provider-specific metrics with `numericValue: null` and `evidenceState: 'UNKNOWN'`. Assert no Bing result contains `GOOGLE_SEARCH_CONSOLE_POSITION`. Commit test-only and observe PR CI RED.

- [ ] **Step 4: Bing GREEN**

Query normalization: NFKC, smart quote/dash folding, trim, whitespace collapse, lowercase. Page canonicalization: credential-free HTTP(S), remove fragment, return `URL.toString()`.

Explicit clicks/impressions are `KNOWN_PRESENT`. Null positions stay `UNKNOWN`. Do not calculate CTR from clicks/impressions.

Run:

```bash
npm run typecheck
npm test -- tests/unit/search-fact.bing-normalizer.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

Commit Task 3 production files/tests as `feat: add search fact normalizers`.

---

### Task 4: Immutable, idempotent materialization

**Files:**
- Create: `tests/integration/search-fact.materializer.test.ts`
- Create: `src/modules/search-facts/search-fact.repository.ts`
- Create: `src/modules/search-facts/search-fact.materializer.ts`

**Interfaces produced:**

```ts
export type SearchFactMaterializeRequest = {
  projectId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE' | 'BING_WEBMASTER';
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: string;
  sourceKind: 'GSC_DAILY_SNAPSHOT' | 'PROVIDER_OBSERVATION_BATCH';
  sourceRef: string;
};

export type SearchFactMaterializeResult =
  | { state: 'COMPLETED'; snapshotId: string; factCount: number }
  | { state: 'ALREADY_COMPLETED'; snapshotId: string; factCount: number };
```

Repository write methods:

```ts
findCompletedSnapshot(identity): Promise<SearchFactSnapshot | null>;
createRunningSnapshot(identity & { inputHash: string; startedAt: Date }): Promise<SearchFactSnapshot>;
replaceSnapshotFacts(snapshotId: string, drafts: readonly NormalizedSearchFactDraft[]): Promise<void>;
completeSnapshot(snapshotId: string, factCount: number, completedAt: Date): Promise<SearchFactSnapshot>;
failSnapshot(snapshotId: string, errorCode: string): Promise<SearchFactSnapshot>;
```

- [ ] **Step 1: RED materializer tests**

GSC case: seed completed GSC snapshot + one fact; require `sourceKind=GSC_DAILY_SNAPSHOT`, `sourceRef=gscSnapshot.id`, `sourceObservationRef=gscFact.id`, provider `GOOGLE_SEARCH_CONSOLE`, completeness `TOP_ROWS_ONLY`.

Bing case: persist Task 2 batch, materialize twice, require second result `ALREADY_COMPLETED`, same snapshot id, unchanged fact/metric counts. Then use a dependency with normalization version `SEARCH_FACT_NORMALIZATION_V2` and require a new snapshot while V1 remains unchanged.

Commit test-only and observe PR CI RED.

- [ ] **Step 2: Source loading/validation**

GSC source must be `COMPLETED`, match project/property identity, and row count must equal actual fact count. Use source cutoff `completedAt ?? sourceFreshness ?? date`; map GSC completeness exactly.

Bing batch must match provider/project/market/locale/property identity and observation count. Use stored batch cutoff/completeness.

Reject unsupported provider/source-kind pairs.

- [ ] **Step 3: Deterministic hash**

SHA-256 input is exactly:

```text
normalizationVersion\0projectId\0provider\0marketCode\0locale\0propertyRef\0sourceKind\0sourceRef\0sourceCutoffAtISO\0stableOrderedDraftJson
```

No `now()` timestamp participates.

- [ ] **Step 4: Atomic persistence rules**

Lock mutable normalized snapshot rows with `FOR UPDATE`. `COMPLETED` and `FAILED` snapshots are immutable. For every metric:

```text
KNOWN_PRESENT => numericValue must be finite and >= 0
KNOWN_EMPTY / UNKNOWN / NOT_SUPPORTED => numericValue must be null
```

Create facts + metrics transactionally; complete only when persisted fact count equals requested fact count.

- [ ] **Step 5: GREEN verification**

```bash
npm run typecheck
npm test -- tests/integration/search-fact.materializer.test.ts tests/integration/search-provider-source.repository.test.ts
```

Expected: pass. Commit as `feat: materialize immutable unified search facts`.

---

### Task 5: Provider-aware read contract for P9-0G

**Files:**
- Create: `tests/integration/search-fact.repository.test.ts`
- Modify: `src/modules/search-facts/search-fact.types.ts`
- Modify: `src/modules/search-facts/search-fact.repository.ts`

**Interfaces produced:**

```ts
export type SearchFactQuery = {
  projectId: string;
  providers?: readonly SearchFactProviderCode[];
  marketCodes?: readonly MarketCode[];
  locales?: readonly string[];
  propertyRefs?: readonly string[];
  factKinds?: readonly SearchFactKind[];
  metricSemantics?: readonly SearchFactMetricSemantic[];
  canonicalPage?: string;
  normalizedQuery?: string;
  sourceDateFrom?: Date;
  sourceDateTo?: Date;
};

export type SearchFactView = {
  snapshotId: string;
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
  factId: string;
  factKey: string;
  factKind: SearchFactKind;
  sourceObservationRef: string;
  sourceDate: Date;
  query: string | null;
  normalizedQuery: string | null;
  page: string | null;
  canonicalPage: string | null;
  metrics: readonly NormalizedSearchMetricDraft[];
};

listCompletedFacts(query: SearchFactQuery): Promise<SearchFactView[]>;
```

- [ ] **Step 1: RED repository tests**

Seed completed GSC and Bing normalized snapshots on overlapping dates. Test filters independently for provider, market, locale, property, fact kind, metric semantic, canonical page, normalized query, and source date range. Every returned view must contain source snapshot/batch reference and source observation reference.

Commit test-only and observe PR CI RED.

- [ ] **Step 2: Implement persisted-read filtering**

Only read `SearchFactSnapshot.status = 'COMPLETED'`. Metric semantic filtering uses relation criteria to select facts, but each returned `SearchFactView` includes that fact's complete metric set.

Deterministic order:

```text
sourceDate asc, provider asc, marketCode asc, locale asc,
propertyRef asc, factKind asc, factKey asc
```

- [ ] **Step 3: Verify P7 regression stays untouched**

```bash
npm run typecheck
npm test -- \
  tests/integration/search-fact.repository.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
```

Expected: all pass without modifying either Growth test or any `src/modules/growth/*` scoring/evidence implementation.

Commit as `feat: expose unified search fact reads`.

---

### Task 6: Documentation, full verification, release review

**Files:**
- Create: `docs/development/p9-0f-unified-search-facts.md`
- Modify: Draft PR body after exact-head evidence exists.

- [ ] **Step 1: Write implementation documentation**

Document the GSC authority boundary, Bing allowlisted source boundary, fact-kind mapping, metric semantic table, evidence/completeness semantics, `numericValue=null` rule, market/locale/property/cutoff provenance, immutable version/idempotency behavior, separation from AI visibility, unchanged P7 boundary, additive migration/rollback guidance, and P9-0G `listCompletedFacts` handoff.

- [ ] **Step 2: Run focused final tests**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- \
  tests/unit/search-fact.contract.test.ts \
  tests/unit/search-fact.google-normalizer.test.ts \
  tests/unit/search-fact.bing-normalizer.test.ts \
  tests/integration/search-provider-source.repository.test.ts \
  tests/integration/search-fact.materializer.test.ts \
  tests/integration/search-fact.repository.test.ts \
  tests/unit/search-console.worker.test.ts \
  tests/unit/bing-search-provider.adapter.test.ts \
  tests/unit/growth.score.test.ts \
  tests/unit/growth.evidence.test.ts
npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit final documentation head**

Commit as `docs: document P9-0F unified search facts` and record the exact head SHA.

- [ ] **Step 4: Require exact-head GitHub Actions evidence**

One PR workflow attached to the exact final head must show:

```text
verify             success
production-audit   success
e2e                success
```

Inside `verify`, confirm Prisma validate, Prisma generate, migrations, Typecheck, full Vitest, and Build all succeeded.

- [ ] **Step 5: Release-review the diff against the spec**

The diff must satisfy all of these:

```text
no P7 scoring/formula changes
no AI visibility migration into search facts
no GSC raw table deletion/rewrite
no generic POSITION semantic
no null/unknown -> 0 conversion
no credentials/raw secret-bearing payload persistence
no cross-provider dedup/scoring
additive migration only
```

- [ ] **Step 6: Update PR body and mark Ready**

Write exact final head SHA and workflow run id into the PR body. Mark Draft -> Ready only after all three exact-head jobs are green. Do not merge; human merge approval remains required.
