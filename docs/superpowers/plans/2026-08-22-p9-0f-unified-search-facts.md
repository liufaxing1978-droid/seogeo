# P9-0F Unified Search Facts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an additive provider-aware normalized search-fact layer for Google Search Console and Bing Webmaster that preserves market, locale, property identity, exact source provenance, metric semantics, evidence state, completeness, and immutable normalization versions without changing P7 Growth scoring.

**Architecture:** Keep existing GSC tables authoritative, add a durable allowlisted provider-source batch/observation boundary for Bing, and materialize both sources into immutable `SearchFactSnapshot -> SearchFact -> SearchFactMetric` records. Pure provider normalizers produce deterministic drafts; a materializer validates source identity and persists idempotently; a read repository exposes provider-aware facts for P9-0G without doing cross-provider scoring or deduplication.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Prisma 6.14, PostgreSQL, Vitest 3.2, existing repository/CI conventions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0f-unified-search-facts-design.md`

## Global Constraints

- Base implementation branch: `feat/p9-0f-unified-search-facts`, forked from `main@a6d1fd648b0d836ef590d33492bdc44df18a190f`.
- P9-0F covers search-engine performance evidence only; P9-0E `PlatformObservation` remains separate.
- Do not modify P7 Growth scoring, opportunity formulas, lifecycle, evidence quality rules, or explanation semantics.
- Do not delete or rewrite `GscDailySnapshot` or `GscQueryPageFact`.
- Preserve Google position, Bing average-click-position, and Bing average-impression-position as different metric semantics.
- `UNKNOWN`, `KNOWN_EMPTY`, and `NOT_SUPPORTED` are not zero and must never be persisted as zero substitutes.
- Completed normalized snapshots are immutable; a normalization rule change creates a new normalization version.
- Provider-source persistence must be allowlisted from typed adapter observations and must never persist credentials, authorization headers, arbitrary upstream response bodies, or secret-bearing error bodies.
- P9-0F does not perform cross-provider deduplication or scoring; P9-0G owns those decisions.
- Use RED -> GREEN TDD for every major contract and observe the RED in actual PR CI before production implementation.
- Final readiness requires exact-head `verify`, `production-audit`, and `e2e` success. Do not auto-merge.

---

## File Structure

### New persistence/schema files

- `prisma/models/search-facts.prisma` — enums and models for Bing source batches/rows plus normalized snapshots/facts/metrics.
- `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql` — additive SQL only.
- `prisma/schema.prisma` — mirror the same schema declarations if the repository's current Prisma validation path still consumes the assembled root schema.

### New search-fact module

- `src/modules/search-facts/search-fact.types.ts` — contracts, draft types, normalization version, semantic helpers.
- `src/modules/search-facts/search-provider-source.repository.ts` — append-only allowlisted Bing source batch/observation persistence and reads.
- `src/modules/search-facts/search-fact.repository.ts` — normalized snapshot/fact/metric persistence and provider-aware read contract.
- `src/modules/search-facts/search-fact.materializer.ts` — deterministic source validation, idempotency, immutable snapshot orchestration.
- `src/modules/search-facts/normalizers/google-search-fact.normalizer.ts` — pure GSC fact mapping.
- `src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts` — pure Bing QUERY/PAGE/SITE mapping.

### Tests

- `tests/unit/search-fact.contract.test.ts`
- `tests/unit/search-fact.google-normalizer.test.ts`
- `tests/unit/search-fact.bing-normalizer.test.ts`
- `tests/integration/search-provider-source.repository.test.ts`
- `tests/integration/search-fact.materializer.test.ts`
- `tests/integration/search-fact.repository.test.ts`

### Documentation

- `docs/development/p9-0f-unified-search-facts.md`

---

### Task 1: Lock the persistence and semantic contract

**Files:**
- Create: `tests/unit/search-fact.contract.test.ts`
- Create: `prisma/models/search-facts.prisma`
- Create: `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql`
- Modify: `prisma/schema.prisma`
- Create: `src/modules/search-facts/search-fact.types.ts`

**Interfaces:**
- Consumes: existing Prisma `MarketCode`; existing provider codes from `src/modules/search-providers/search-provider.types.ts`.
- Produces:
  - `SEARCH_FACT_NORMALIZATION_VERSION = 'SEARCH_FACT_NORMALIZATION_V1'`
  - `SearchFactProviderCode`
  - `SearchFactKind`
  - `SearchFactMetricSemantic`
  - `SearchFactEvidenceState`
  - `SearchFactCompleteness`
  - `SearchFactSourceKind`
  - `NormalizedSearchFactDraft`
  - `NormalizedSearchMetricDraft`

- [ ] **Step 1: Write the failing semantic-contract test**

Create `tests/unit/search-fact.contract.test.ts` with assertions that import the new module and require the exact semantics:

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
  it('keeps provider-specific position semantics distinct', () => {
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

- [ ] **Step 2: Commit the test-only RED and open a Draft PR**

Commit only the test file first:

```bash
git add tests/unit/search-fact.contract.test.ts
git commit -m "test: lock unified search fact contract"
git push -u origin feat/p9-0f-unified-search-facts
```

Open a Draft PR titled `P9-0F: add unified search facts` against `main`. Record the exact head SHA in the PR body.

- [ ] **Step 3: Observe actual CI RED**

Expected exact-head `verify` Typecheck failure:

```text
Cannot find module '../../src/modules/search-facts/search-fact.types.js'
```

Do not add production code before this failure is observed in the PR workflow.

- [ ] **Step 4: Add the TypeScript contract**

Create `src/modules/search-facts/search-fact.types.ts`:

```ts
import type { MarketCode } from '@prisma/client';
import type { SearchProviderCode } from '../search-providers/search-provider.types.js';

export const SEARCH_FACT_NORMALIZATION_VERSION = 'SEARCH_FACT_NORMALIZATION_V1' as const;

export const SEARCH_FACT_KINDS = Object.freeze(['QUERY_PAGE', 'QUERY', 'PAGE', 'SITE'] as const);
export type SearchFactKind = (typeof SEARCH_FACT_KINDS)[number];

export const SEARCH_FACT_SOURCE_KINDS = Object.freeze([
  'GSC_DAILY_SNAPSHOT',
  'PROVIDER_OBSERVATION_BATCH'
] as const);
export type SearchFactSourceKind = (typeof SEARCH_FACT_SOURCE_KINDS)[number];

export const SEARCH_FACT_METRIC_SEMANTICS = Object.freeze([
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION',
  'BING_AVG_CLICK_POSITION',
  'BING_AVG_IMPRESSION_POSITION'
] as const);
export type SearchFactMetricSemantic = (typeof SEARCH_FACT_METRIC_SEMANTICS)[number];

export const SEARCH_FACT_EVIDENCE_STATES = Object.freeze([
  'KNOWN_PRESENT',
  'KNOWN_EMPTY',
  'UNKNOWN',
  'NOT_SUPPORTED'
] as const);
export type SearchFactEvidenceState = (typeof SEARCH_FACT_EVIDENCE_STATES)[number];

export const SEARCH_FACT_COMPLETENESS = Object.freeze([
  'COMPLETE',
  'TOP_ROWS_ONLY',
  'PROVIDER_UNSPECIFIED',
  'UNKNOWN'
] as const);
export type SearchFactCompleteness = (typeof SEARCH_FACT_COMPLETENESS)[number];

export type SearchFactProviderCode = SearchProviderCode;

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

- [ ] **Step 5: Add the additive Prisma models**

Define these Prisma enums in `prisma/models/search-facts.prisma` and the active root schema:

```prisma
enum SearchFactProvider {
  GOOGLE_SEARCH_CONSOLE
  BING_WEBMASTER
  BAIDU_SEARCH_RESOURCE
  QIHOO_360_WEBMASTER
  SOGOU_WEBMASTER
  SHENMA_WEBMASTER
}

enum SearchFactSnapshotStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
}

enum SearchFactKind {
  QUERY_PAGE
  QUERY
  PAGE
  SITE
}

enum SearchFactMetricSemantic {
  CLICKS
  IMPRESSIONS
  CTR
  GOOGLE_SEARCH_CONSOLE_POSITION
  BING_AVG_CLICK_POSITION
  BING_AVG_IMPRESSION_POSITION
}

enum SearchFactEvidenceState {
  KNOWN_PRESENT
  KNOWN_EMPTY
  UNKNOWN
  NOT_SUPPORTED
}

enum SearchFactCompleteness {
  COMPLETE
  TOP_ROWS_ONLY
  PROVIDER_UNSPECIFIED
  UNKNOWN
}

enum SearchFactSourceKind {
  GSC_DAILY_SNAPSHOT
  PROVIDER_OBSERVATION_BATCH
}
```

Add the source persistence models:

```prisma
model SearchProviderObservationBatch {
  id               String                 @id @default(uuid()) @db.Uuid
  projectId        String                 @db.Uuid
  provider         SearchFactProvider
  marketCode       MarketCode
  locale           String
  propertyRef      String
  propertyType     String
  sourceCutoffAt   DateTime
  sourceCompleteness SearchFactCompleteness
  schemaVersion    String
  inputHash        String
  observationCount Int
  createdAt        DateTime               @default(now())

  observations SearchProviderObservationRecord[]

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

  batch SearchProviderObservationBatch @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([batchId, observationKey], map: "SearchProviderObservationRecord_batch_key")
  @@index([projectId, sourceDate, observationKind], map: "SearchProviderObservationRecord_project_date_kind_idx")
}
```

Add the normalized models:

```prisma
model SearchFactSnapshot {
  id                  String                   @id @default(uuid()) @db.Uuid
  projectId           String                   @db.Uuid
  provider            SearchFactProvider
  marketCode          MarketCode
  locale              String
  propertyRef         String
  propertyType        String
  sourceKind          SearchFactSourceKind
  sourceRef           String
  sourceCutoffAt      DateTime
  sourceCompleteness  SearchFactCompleteness
  normalizationVersion String
  inputHash           String
  status              SearchFactSnapshotStatus @default(PENDING)
  factCount           Int                      @default(0)
  startedAt           DateTime?
  completedAt         DateTime?
  errorCode           String?
  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt

  facts SearchFact[]

  @@unique([projectId, provider, marketCode, locale, propertyRef, sourceKind, sourceRef, normalizationVersion], map: "SearchFactSnapshot_identity_key")
  @@index([projectId, provider, marketCode, locale, sourceCutoffAt, status], map: "SearchFactSnapshot_lookup_idx")
}

model SearchFact {
  id                       String         @id @default(uuid()) @db.Uuid
  snapshotId               String         @db.Uuid
  projectId                String         @db.Uuid
  factKey                  String
  factKind                 SearchFactKind
  sourceObservationRef     String
  sourceDate               DateTime       @db.Date
  query                    String?
  normalizedQuery          String?
  queryNormalizationVersion String?
  page                     String?
  canonicalPage            String?
  canonicalizationVersion  String?
  createdAt                DateTime       @default(now())

  snapshot SearchFactSnapshot @relation(fields: [snapshotId], references: [id], onDelete: Cascade)
  metrics  SearchFactMetric[]

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

  fact SearchFact @relation(fields: [factId], references: [id], onDelete: Cascade)

  @@unique([factId, metricSemantic], map: "SearchFactMetric_fact_semantic_key")
  @@index([metricSemantic, evidenceState], map: "SearchFactMetric_semantic_evidence_idx")
}
```

- [ ] **Step 6: Create the SQL migration**

Create `prisma/migrations/20260822090000_add_unified_search_facts/migration.sql` with `CREATE TYPE`, `CREATE TABLE`, foreign keys, unique indexes, and lookup indexes matching the Prisma declarations. The migration is additive only: no `DROP`, no mutation of GSC/Growth/visibility rows.

- [ ] **Step 7: Run the focused contract and Prisma checks**

Run:

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test -- tests/unit/search-fact.contract.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit Task 1 GREEN**

```bash
git add prisma src/modules/search-facts/search-fact.types.ts tests/unit/search-fact.contract.test.ts
git commit -m "feat: add unified search fact contract"
```

---

### Task 2: Persist allowlisted Bing source observations

**Files:**
- Create: `tests/integration/search-provider-source.repository.test.ts`
- Create: `src/modules/search-facts/search-provider-source.repository.ts`

**Interfaces:**
- Consumes: `BingQueryObservation`, `BingPageObservation`, `BingSiteTrafficObservation` from `search-provider.types.ts`.
- Produces:
  - `BING_SOURCE_SCHEMA_VERSION = 'BING_SEARCH_SOURCE_V1'`
  - `PersistBingObservationBatchInput`
  - `PersistedProviderObservation`
  - `SearchProviderSourceRepository.persistBingBatch(input)`
  - `SearchProviderSourceRepository.getBatch(batchId)`
  - `SearchProviderSourceRepository.listBatchObservations(batchId)`

- [ ] **Step 1: Write the failing integration test**

Test a mixed Bing batch containing one QUERY, one PAGE, and one SITE observation. Assert:

```ts
expect(batch.provider).toBe('BING_WEBMASTER');
expect(batch.sourceCompleteness).toBe('PROVIDER_UNSPECIFIED');
expect(rows.map((row) => row.observationKind)).toEqual([
  'PAGE_STATS',
  'QUERY_STATS',
  'SITE_TRAFFIC_DAILY'
]);
expect(JSON.stringify(rows)).not.toContain('Authorization');
expect(JSON.stringify(rows)).not.toContain('apiKey');
expect(JSON.stringify(rows)).not.toContain('access_token');
```

Also persist the same exact input twice and assert the same batch id is returned and row count does not increase.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/search-provider-source.repository.test.ts
```

Expected: fail because `search-provider-source.repository.js` does not exist.

Commit and observe this RED in exact-head PR CI before implementation.

- [ ] **Step 3: Implement strict allowlisted serialization**

The repository accepts only the typed Bing observation union. Construct `payloadJson` internally instead of accepting caller-supplied JSON:

```ts
function serializeBingObservation(observation: BingObservation): Prisma.InputJsonObject {
  switch (observation.kind) {
    case 'QUERY_STATS':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        query: observation.query,
        clicks: observation.clicks,
        impressions: observation.impressions,
        avgClickPosition: observation.avgClickPosition,
        avgImpressionPosition: observation.avgImpressionPosition,
        completeness: observation.completeness
      };
    case 'PAGE_STATS':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        page: observation.page,
        clicks: observation.clicks,
        impressions: observation.impressions,
        avgClickPosition: observation.avgClickPosition,
        avgImpressionPosition: observation.avgImpressionPosition,
        completeness: observation.completeness
      };
    case 'SITE_TRAFFIC_DAILY':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        clicks: observation.clicks,
        impressions: observation.impressions,
        completeness: observation.completeness
      };
  }
}
```

Create deterministic `observationKey` and `inputHash` using SHA-256 over stable typed fields. Sort observations before hashing/persistence so input ordering does not alter identity.

- [ ] **Step 4: Implement idempotent batch persistence**

Use a transaction that first resolves the deterministic batch identity. If the batch already exists, return it after verifying its stored `observationCount`; otherwise create the batch and rows atomically.

Reject:

- non-`BING_WEBMASTER` observations;
- mixed completeness states;
- observation source dates later than `sourceCutoffAt`;
- invalid property URLs containing credentials;
- duplicate deterministic observation keys inside one batch.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npm run typecheck
npm test -- tests/integration/search-provider-source.repository.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 2 GREEN**

```bash
git add src/modules/search-facts/search-provider-source.repository.ts tests/integration/search-provider-source.repository.test.ts
git commit -m "feat: persist Bing search source observations"
```

---

### Task 3: Add the pure Google Search Console normalizer

**Files:**
- Create: `tests/unit/search-fact.google-normalizer.test.ts`
- Create: `src/modules/search-facts/normalizers/google-search-fact.normalizer.ts`

**Interfaces:**
- Consumes one persisted GSC source fact with `id`, `date`, `factKey`, `query`, `normalizedQuery`, `normalizationVersion`, `page`, `canonicalPage`, `clicks`, `impressions`, `ctr`, `position`.
- Produces `normalizeGoogleSearchFact(source): NormalizedSearchFactDraft`.

- [ ] **Step 1: Write the failing normalizer test**

Use a source fixture with exact persisted normalized values and assert:

```ts
expect(result).toMatchObject({
  factKey: 'source-fact-key',
  factKind: 'QUERY_PAGE',
  sourceObservationRef: 'gsc-fact-id',
  query: '兴善堂',
  normalizedQuery: '兴善堂',
  queryNormalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
  page: 'https://xingshantang.org/page',
  canonicalPage: 'https://xingshantang.org/page',
  canonicalizationVersion: 'GSC_PERSISTED_CANONICAL_PAGE_V1'
});
expect(result.metrics).toEqual([
  { metricSemantic: 'CLICKS', numericValue: 7, evidenceState: 'KNOWN_PRESENT', sourceField: 'clicks' },
  { metricSemantic: 'IMPRESSIONS', numericValue: 100, evidenceState: 'KNOWN_PRESENT', sourceField: 'impressions' },
  { metricSemantic: 'CTR', numericValue: 0.07, evidenceState: 'KNOWN_PRESENT', sourceField: 'ctr' },
  { metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION', numericValue: 4.2, evidenceState: 'KNOWN_PRESENT', sourceField: 'position' }
]);
```

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- tests/unit/search-fact.google-normalizer.test.ts
```

Expected: module-not-found RED. Commit test-only and observe exact-head CI RED.

- [ ] **Step 3: Implement minimal pure mapping**

Do not recalculate GSC query normalization or page canonicalization. Reuse the already persisted authoritative fields verbatim and validate all numeric metrics are finite/non-negative, with CTR in `[0, 1]`.

Export:

```ts
export const GSC_PERSISTED_CANONICALIZATION_VERSION = 'GSC_PERSISTED_CANONICAL_PAGE_V1';
export function normalizeGoogleSearchFact(source: GoogleSearchFactSource): NormalizedSearchFactDraft;
```

- [ ] **Step 4: Run focused regression tests**

```bash
npm run typecheck
npm test -- tests/unit/search-fact.google-normalizer.test.ts tests/unit/search-console.worker.test.ts
```

Expected: pass and existing GSC behavior unchanged.

- [ ] **Step 5: Commit Task 3 GREEN**

```bash
git add src/modules/search-facts/normalizers/google-search-fact.normalizer.ts tests/unit/search-fact.google-normalizer.test.ts
git commit -m "feat: normalize Google search facts"
```

---

### Task 4: Add the pure Bing normalizer without fabricating joins or positions

**Files:**
- Create: `tests/unit/search-fact.bing-normalizer.test.ts`
- Create: `src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts`

**Interfaces:**
- Consumes `PersistedProviderObservation` from Task 2.
- Produces `normalizeBingSearchObservation(source): NormalizedSearchFactDraft`.

- [ ] **Step 1: Write RED tests for all three Bing kinds**

Required assertions:

```ts
expect(queryFact.factKind).toBe('QUERY');
expect(queryFact.page).toBeNull();
expect(pageFact.factKind).toBe('PAGE');
expect(pageFact.query).toBeNull();
expect(siteFact.factKind).toBe('SITE');
expect(siteFact.query).toBeNull();
expect(siteFact.page).toBeNull();
```

For `avgClickPosition: null` and `avgImpressionPosition: null`, require:

```ts
expect(positionMetrics).toEqual([
  {
    metricSemantic: 'BING_AVG_CLICK_POSITION',
    numericValue: null,
    evidenceState: 'UNKNOWN',
    sourceField: 'avgClickPosition'
  },
  {
    metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
    numericValue: null,
    evidenceState: 'UNKNOWN',
    sourceField: 'avgImpressionPosition'
  }
]);
```

Assert no metric semantic equals `GOOGLE_SEARCH_CONSOLE_POSITION`.

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- tests/unit/search-fact.bing-normalizer.test.ts
```

Commit test-only and observe exact-head CI RED before implementation.

- [ ] **Step 3: Implement deterministic query/page normalization helpers**

Use the same NFKC/lowercase query behavior currently used by GSC, but version it independently for Bing facts:

```ts
export const SEARCH_FACT_QUERY_NORMALIZATION_VERSION = 'SEARCH_FACT_QUERY_NORMALIZATION_V1';
export const SEARCH_FACT_PAGE_CANONICALIZATION_VERSION = 'SEARCH_FACT_PAGE_CANONICALIZATION_V1';
```

The query helper performs NFKC, smart-quote/dash folding, trim, whitespace collapse, and lowercase. The page helper accepts credential-free HTTP(S), removes fragments, and returns `URL.toString()`.

- [ ] **Step 4: Implement provider-kind mapping**

`QUERY_STATS` -> `QUERY`, `PAGE_STATS` -> `PAGE`, `SITE_TRAFFIC_DAILY` -> `SITE`.

All explicit numeric `clicks`/`impressions` become `KNOWN_PRESENT`. Nullable Bing position fields always emit their provider-specific metric record; null becomes `numericValue: null, evidenceState: 'UNKNOWN'`.

Never synthesize CTR from clicks/impressions in P9-0F.

- [ ] **Step 5: Run focused tests**

```bash
npm run typecheck
npm test -- tests/unit/search-fact.bing-normalizer.test.ts tests/unit/bing-search-provider.adapter.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit Task 4 GREEN**

```bash
git add src/modules/search-facts/normalizers/bing-search-fact.normalizer.ts tests/unit/search-fact.bing-normalizer.test.ts
git commit -m "feat: normalize Bing search facts"
```

---

### Task 5: Materialize immutable normalized snapshots with exact provenance and idempotency

**Files:**
- Create: `tests/integration/search-fact.materializer.test.ts`
- Create: `src/modules/search-facts/search-fact.repository.ts`
- Create: `src/modules/search-facts/search-fact.materializer.ts`

**Interfaces:**
- Consumes Task 2 source repository and Task 3/4 normalizers.
- Produces:

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

export async function materializeSearchFacts(
  request: SearchFactMaterializeRequest,
  dependencies: SearchFactMaterializerDependencies
): Promise<SearchFactMaterializeResult>;
```

- [ ] **Step 1: Write integration RED for GSC provenance**

Seed a completed `GscDailySnapshot` plus one `GscQueryPageFact`, materialize it, and assert:

```ts
expect(snapshot.sourceKind).toBe('GSC_DAILY_SNAPSHOT');
expect(snapshot.sourceRef).toBe(gscSnapshot.id);
expect(snapshot.provider).toBe('GOOGLE_SEARCH_CONSOLE');
expect(snapshot.sourceCompleteness).toBe('TOP_ROWS_ONLY');
expect(fact.sourceObservationRef).toBe(gscFact.id);
```

- [ ] **Step 2: Write integration RED for Bing provenance and idempotency**

Persist a Task 2 Bing batch, materialize it twice, and assert the second result is `ALREADY_COMPLETED`, the normalized snapshot id is unchanged, and fact/metric counts do not increase.

Also materialize the same source after changing the requested normalization version in a test dependency and assert a new snapshot is created while the first remains unchanged.

- [ ] **Step 3: Run and observe RED**

```bash
npm test -- tests/integration/search-fact.materializer.test.ts
```

Commit test-only and observe exact-head CI RED.

- [ ] **Step 4: Implement source loading and validation**

The materializer must reject:

- GSC source not `COMPLETED`;
- GSC `projectId` or property identity mismatch;
- Bing batch provider/project/market/locale/property mismatch;
- unsupported provider/sourceKind combinations;
- invalid/empty locale/property identity;
- source fact/observation counts that do not match their authoritative source metadata.

For GSC, read the existing snapshot with its property and ordered facts. Use `sourceCutoffAt = completedAt ?? sourceFreshness ?? date` and map current `TOP_ROWS_ONLY` exactly.

For Bing, load the persisted batch and ordered observations. Use the batch's stored cutoff and completeness.

- [ ] **Step 5: Implement deterministic snapshot `inputHash`**

Hash stable identity plus ordered normalized draft content:

```text
SEARCH_FACT_NORMALIZATION_V1\0projectId\0provider\0marketCode\0locale\0propertyRef\0sourceKind\0sourceRef\0sourceCutoffAt\0stable-normalized-drafts-json
```

No timestamps such as `now()` may enter the hash.

- [ ] **Step 6: Implement atomic persistence**

`SearchFactRepository` methods:

```ts
findCompletedSnapshot(identity): Promise<SearchFactSnapshot | null>
createRunningSnapshot(identity & { inputHash: string; startedAt: Date }): Promise<SearchFactSnapshot>
replaceSnapshotFacts(snapshotId: string, projectId: string, drafts: readonly NormalizedSearchFactDraft[]): Promise<void>
completeSnapshot(snapshotId: string, factCount: number, completedAt: Date): Promise<SearchFactSnapshot>
failSnapshot(snapshotId: string, errorCode: string): Promise<SearchFactSnapshot>
```

`replaceSnapshotFacts` runs in a transaction, locks the snapshot `FOR UPDATE`, refuses `COMPLETED`/`FAILED`, validates every draft has the same project through the snapshot, creates facts, then metrics. For any metric with `evidenceState !== 'KNOWN_PRESENT'`, reject non-null `numericValue`; for `KNOWN_PRESENT`, require finite non-negative numeric value.

- [ ] **Step 7: Run focused integration tests**

```bash
npm run typecheck
npm test -- tests/integration/search-fact.materializer.test.ts tests/integration/search-provider-source.repository.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit Task 5 GREEN**

```bash
git add src/modules/search-facts/search-fact.repository.ts src/modules/search-facts/search-fact.materializer.ts tests/integration/search-fact.materializer.test.ts
git commit -m "feat: materialize immutable unified search facts"
```

---

### Task 6: Expose the provider-aware read contract for P9-0G

**Files:**
- Create: `tests/integration/search-fact.repository.test.ts`
- Modify: `src/modules/search-facts/search-fact.types.ts`
- Modify: `src/modules/search-facts/search-fact.repository.ts`

**Interfaces:**
- Produces:

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
```

Repository method:

```ts
listCompletedFacts(query: SearchFactQuery): Promise<SearchFactView[]>;
```

- [ ] **Step 1: Write RED query tests**

Seed completed GSC and Bing normalized snapshots with overlapping dates. Assert filtering independently by:

- provider;
- market;
- locale;
- property;
- fact kind;
- metric semantic;
- canonical page;
- normalized query;
- source date range.

Assert every returned view includes provider, market, locale, property, `sourceKind/sourceRef`, `sourceObservationRef`, cutoff, completeness, and normalization version.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/search-fact.repository.test.ts
```

Commit test-only and observe exact-head CI RED.

- [ ] **Step 3: Implement persisted-read filtering**

Use only `SearchFactSnapshot.status = 'COMPLETED'`. Apply metric-semantic filtering through relation criteria but return the complete metric set for each matched fact so P9-0G does not lose companion metrics.

Order deterministically by:

```text
sourceDate asc
provider asc
marketCode asc
locale asc
propertyRef asc
factKind asc
factKey asc
```

- [ ] **Step 4: Verify no P7 behavior changed**

Run:

```bash
npm run typecheck
npm test -- tests/integration/search-fact.repository.test.ts tests/unit/growth-score.test.ts tests/unit/growth-evidence.test.ts
```

If the exact Growth test filenames differ, use the existing tests that directly cover `src/modules/growth/growth-score.ts` and `src/modules/growth/growth-evidence.ts`; do not modify their assertions for P9-0F.

Expected: search-fact repository tests pass and Growth regressions remain unchanged.

- [ ] **Step 5: Commit Task 6 GREEN**

```bash
git add src/modules/search-facts/search-fact.types.ts src/modules/search-facts/search-fact.repository.ts tests/integration/search-fact.repository.test.ts
git commit -m "feat: expose unified search fact reads"
```

---

### Task 7: Document P9-0F, run exact-head verification, and prepare the PR for review

**Files:**
- Create: `docs/development/p9-0f-unified-search-facts.md`
- Modify: PR body only after verification evidence exists.

**Interfaces:**
- Consumes all completed Task 1-6 contracts.
- Produces no new runtime behavior.

- [ ] **Step 1: Write implementation documentation**

Document:

- the three normalized layers and the separate Bing provider-source boundary;
- GSC raw authority preservation;
- exact GSC/Bing fact-kind mappings;
- metric semantic table;
- `KNOWN_PRESENT / KNOWN_EMPTY / UNKNOWN / NOT_SUPPORTED` behavior;
- completeness behavior;
- provider/market/locale/property/cutoff/source provenance;
- `numericValue = null` for non-present evidence states;
- immutable normalization version/idempotency behavior;
- explicit statement that AI visibility `PlatformObservation` is not stored here;
- explicit statement that P7 scoring is unchanged in P9-0F;
- migration and non-destructive rollback guidance;
- P9-0G handoff through `listCompletedFacts`.

- [ ] **Step 2: Run focused tests before the full gate**

```bash
npm run typecheck
npm test -- \
  tests/unit/search-fact.contract.test.ts \
  tests/unit/search-fact.google-normalizer.test.ts \
  tests/unit/search-fact.bing-normalizer.test.ts \
  tests/integration/search-provider-source.repository.test.ts \
  tests/integration/search-fact.materializer.test.ts \
  tests/integration/search-fact.repository.test.ts
npm run build
```

Expected: all pass.

- [ ] **Step 3: Commit documentation/final implementation head**

```bash
git add docs/development/p9-0f-unified-search-facts.md
git commit -m "docs: document P9-0F unified search facts"
git push
```

Record the exact final head SHA.

- [ ] **Step 4: Verify the exact final head in GitHub Actions**

Require one pull-request CI run attached to the exact final head with:

```text
verify             success
production-audit   success
e2e                success
```

Inside `verify`, confirm Prisma validate/generate/migrate, Typecheck, full Vitest, and Build all succeeded. Do not use an earlier green run as evidence for a newer head.

- [ ] **Step 5: Perform release review**

Review the PR diff against the spec and verify:

- no P7 formula/scoring changes;
- no AI visibility table migration into search facts;
- no GSC raw table deletion/rewrite;
- no generic `POSITION` semantic;
- no null/unknown metric converted to zero;
- no provider credentials or raw secret-bearing payload storage;
- no cross-provider dedup/scoring in P9-0F;
- migration is additive.

- [ ] **Step 6: Update PR body and mark Ready**

Write the exact final head SHA and CI workflow run id into the PR body. Mark Draft -> Ready only after the exact-head three-job gate is green.

Do not merge. Human approval is required for merge.
