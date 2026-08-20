# P7-A Growth Opportunity Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Google Search Console ingestion and a deterministic Growth Opportunity layer that turns persisted GSC + P2/P3/P5/P6 facts into immutable, auditable, prioritized growth opportunities.

**Architecture:** Add `src/modules/search-console` for OAuth, encrypted credential references, property binding, immutable daily GSC facts and source health; add `src/modules/growth` for stable-window aggregation, evidence normalization, deterministic scoring/detection, immutable opportunity/topic snapshots and lifecycle reconciliation. Authoritative growth materialization is database-only after GSC facts are persisted; web/API GET paths never call Google, P6 providers or DeepSeek. Optional explanation reuses the existing P4 AI task pipeline.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest, Playwright/Chromium, Node `crypto`, native `fetch`, Google OAuth 2.0/Search Console REST API, existing P4 DeepSeek AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-20-p7a-growth-opportunity-intelligence-design.md`

## Global Constraints

- Google Search Console OAuth scope is exactly `https://www.googleapis.com/auth/webmasters.readonly`.
- OAuth callback `state` is random/high-entropy, hashed at rest, expiring and single-use.
- OAuth credential JSON is AES-256-GCM encrypted at rest; plaintext access/refresh tokens never enter business tables, logs, HTML, reports or AI inputs.
- Required env vars: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `OAUTH_CREDENTIAL_ENCRYPTION_KEY`, `OAUTH_CREDENTIAL_KEY_VERSION`.
- Default stable measurement contract is current 28 days + immediately previous 28 days, excluding the most recent 3 calendar days.
- A stable window is eligible only when all 56 expected source dates have a selected COMPLETED daily snapshot.
- `UNKNOWN` is never coerced to zero; a failed/missing GSC source day is not a zero-impression day.
- `GROWTH_SCORE_V1`: Demand 30%, Position Potential 25%, CTR Gap 20%, Site Gap 15%, Trend/Visibility 10%.
- `availableWeight >= 70` is ranking-eligible; 50–69 is diagnostic PARTIAL only; `<50` yields authoritative score/priority `UNKNOWN`.
- Normal stable identity is `projectId + QUERY_PAGE_GROWTH + normalizedQuery + canonicalPage`; dynamic `primaryType` is snapshot data, not identity.
- Cannibalization and New Content use separate stable identity types.
- COMPLETED GSC snapshots and all Growth snapshots/breakdowns/evidence/topic snapshots are immutable.
- Growth materialization makes zero Google API calls, zero P6 provider calls and zero DeepSeek calls.
- DeepSeek explanation is explicitly user-triggered and cannot mutate deterministic P7 facts or lifecycle state.
- Hard bounds: 25,000 GSC Query+Page rows/project/source-day; 50,000 growth candidates/materialization; 10,000 opportunity snapshots/project/window; API page size 100; 2,000 Topic Clusters/project; 500 member Queries/Topic snapshot; 20 competing pages/Cannibalization identity.
- No P8 site mutation and no P9 autonomous orchestration in this plan.
- Every behavior task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### New persistence

- `prisma/models/search-console.prisma`
- `prisma/migrations/20260820214000_add_search_console_foundation/migration.sql`
- `prisma/models/growth-intelligence.prisma`
- `prisma/migrations/20260820220000_add_growth_intelligence/migration.sql`
- `prisma/migrations/20260820230000_add_growth_opportunity_ai_task/migration.sql`

### New Search Console module

- `src/modules/search-console/search-console.types.ts`
- `src/modules/search-console/oauth-credential-vault.ts`
- `src/modules/search-console/search-console.repository.ts`
- `src/modules/search-console/google-search-console.client.ts`
- `src/modules/search-console/search-console.service.ts`
- `src/modules/search-console/search-console.routes.ts`
- `src/modules/search-console/search-console.web.routes.ts`
- `src/modules/search-console/search-console.worker.ts`
- `src/modules/search-console/search-console.observability.ts`

### New Growth module

- `src/modules/growth/growth.types.ts`
- `src/modules/growth/gsc-window.ts`
- `src/modules/growth/ctr-curve.ts`
- `src/modules/growth/growth-evidence.ts`
- `src/modules/growth/growth-score.ts`
- `src/modules/growth/growth-detectors.ts`
- `src/modules/growth/cannibalization.ts`
- `src/modules/growth/new-content.ts`
- `src/modules/growth/topic-cluster.ts`
- `src/modules/growth/growth.repository.ts`
- `src/modules/growth/growth.service.ts`
- `src/modules/growth/growth.worker.ts`
- `src/modules/growth/growth.routes.ts`
- `src/modules/growth/growth.web.repository.ts`
- `src/modules/growth/growth.web.routes.ts`
- `src/modules/growth/growth.observability.ts`

### Existing integration files

- `src/config/env.ts`
- `src/auth/feature-flags.ts`
- `src/auth/require-feature.ts`
- `src/queue/queues.ts`
- `src/queue/worker-bootstrap.ts`
- `src/app.ts`
- `src/web/dashboard.repository.ts`
- `src/web/routes.ts`
- `src/web/view-models.ts`
- `src/views/dashboard.ejs`
- `src/views/projects/show.ejs`
- `src/views/partials/sidebar.ejs`
- `src/modules/ai/ai.service.ts`
- `src/modules/ai/ai.worker.ts`
- `src/modules/ai/prompts/prompt-registry.ts`
- `prisma/models/ai-gateway.prisma`
- `.github/workflows/ci.yml`
- `README.md`

---

### Task 1: Search Console Persistence and Encrypted Credential Vault

**Files:**
- Create: `prisma/models/search-console.prisma`
- Create: `prisma/migrations/20260820214000_add_search_console_foundation/migration.sql`
- Create: `src/modules/search-console/search-console.types.ts`
- Create: `src/modules/search-console/oauth-credential-vault.ts`
- Create: `src/modules/search-console/search-console.repository.ts`
- Modify: `src/config/env.ts`
- Test: `tests/unit/search-console.credential-vault.test.ts`
- Test: `tests/integration/search-console.persistence.test.ts`

**Interfaces:**
- Produces `OAuthCredentialVault.put/get/replace/revoke`.
- Produces `SearchConsoleRepository` methods for OAuth nonce, connection/property, daily snapshot/fact and authoritative source-version selection.

- [ ] **Step 1: Write failing vault tests**

```ts
it('encrypts credential JSON and round-trips it', async () => {
  const vault = createOAuthCredentialVault({
    key: Buffer.alloc(32, 7),
    keyVersion: 'v1',
    repository
  });
  const ref = await vault.put('project-1', 'GOOGLE_SEARCH_CONSOLE', {
    access_token: 'access-secret',
    refresh_token: 'refresh-secret'
  });
  expect(JSON.stringify(await repository.rawCredentialRecord(ref))).not.toContain('access-secret');
  expect(await vault.get(ref)).toMatchObject({ access_token: 'access-secret', refresh_token: 'refresh-secret' });
});

it('rejects an invalid AES key instead of falling back to plaintext', () => {
  expect(() => parseOAuthCredentialKey('short')).toThrow(/32 bytes/i);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/search-console.credential-vault.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Add exact persistence models**

Create `OAuthStateNonce`, `OAuthCredentialRecord`, `SearchConsoleConnection`, `SearchConsoleProperty`, `GscDailySnapshot`, `GscQueryPageFact`. Use `(projectId, propertyId, date, syncVersion)` uniqueness for daily versions and repository APIs that expose no generic update method for COMPLETED daily snapshots/facts.

- [ ] **Step 4: Implement AES-256-GCM vault**

```ts
export interface OAuthCredentialVault {
  put(projectId: string, provider: 'GOOGLE_SEARCH_CONSOLE', payload: unknown): Promise<string>;
  get(credentialRef: string): Promise<unknown>;
  replace(credentialRef: string, payload: unknown): Promise<void>;
  revoke(credentialRef: string): Promise<void>;
}
```

Use a random 12-byte IV, 16-byte auth tag and stored `keyVersion`.

- [ ] **Step 5: Add persistence invariants**

Test highest COMPLETED `syncVersion` is authoritative for a source date, FAILED versions are never selected, and attempting to mutate a COMPLETED daily snapshot/fact through repository methods is impossible/rejected.

- [ ] **Step 6: Run GREEN**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/search-console.credential-vault.test.ts tests/integration/search-console.persistence.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/models/search-console.prisma prisma/migrations/20260820214000_add_search_console_foundation src/config/env.ts src/modules/search-console tests/unit/search-console.credential-vault.test.ts tests/integration/search-console.persistence.test.ts
git commit -m "feat: add Search Console persistence foundation"
```

---

### Task 2: Read-Only OAuth State Flow and Property Binding

**Files:**
- Create: `src/modules/search-console/google-search-console.client.ts`
- Create: `src/modules/search-console/search-console.service.ts`
- Create: `src/modules/search-console/search-console.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/search-console.oauth.test.ts`
- Test: `tests/integration/search-console.api.test.ts`

**Interfaces:**

```ts
export interface GoogleSearchConsoleTransport {
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokenPayload>;
  refreshToken(refreshToken: string): Promise<GoogleTokenPayload>;
  listSites(accessToken: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>>;
  querySearchAnalytics(accessToken: string, siteUrl: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse>;
}
```

Service produces `beginGoogleOAuth`, `completeGoogleOAuth`, `listReadableProperties`, `bindProperty`, `disconnect`.

- [ ] **Step 1: Write failing OAuth contract tests**

```ts
expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
expect(url.searchParams.get('access_type')).toBe('offline');
```

Also assert state nonce is hashed at rest, expires, is project+actor scoped, and a second callback with the same state is rejected before token exchange.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/search-console.oauth.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement native-fetch Google transport**

Inject `fetch` for tests. Token exchange and site-list responses are Zod-validated. No unit/integration test may access the network.

- [ ] **Step 4: Implement state consumption and property validation**

Callback atomically consumes state before storing credentials. Binding requires the authorized site list to contain the exact selected `propertyUri` with readable permission.

- [ ] **Step 5: Add API tests**

Cover status, begin OAuth, callback, property list, bind/unbind/disconnect; unauthorized project access must fail before credential-vault reads.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/search-console.oauth.test.ts tests/integration/search-console.api.test.ts`
Expected: PASS.

```bash
git add src/modules/search-console src/app.ts tests/unit/search-console.oauth.test.ts tests/integration/search-console.api.test.ts
git commit -m "feat: add read-only Search Console OAuth flow"
```

---

### Task 3: Immutable Daily Search Console Synchronization

**Files:**
- Create: `src/modules/search-console/search-console.worker.ts`
- Create: `src/modules/search-console/search-console.observability.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/search-console.worker.test.ts`
- Test: `tests/integration/search-console.sync.test.ts`

**Interfaces:**
- Queue name: `search-console-sync`.
- Job data: `{ projectId: string; propertyId: string; date: string }`.
- Worker function: `syncSearchConsoleDay(input, deps)`.

- [ ] **Step 1: Write failing idempotency/error tests**

```ts
await syncSearchConsoleDay(input, deps);
await syncSearchConsoleDay(input, deps);
expect(await repository.countSelectedCompletedDays(projectId, date)).toBe(1);
```

Cover `TOKEN_REVOKED`, `PERMISSION_DENIED`, `PROPERTY_UNAVAILABLE`, `RATE_LIMITED`, `TRANSIENT_PROVIDER_ERROR`, `INVALID_RESPONSE`, `PERSISTENCE_FAILED`.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement one-day Search Analytics fetch**

Request one day with dimensions `query,page`, `rowLimit=25000`, `startRow=0`. Reject/provider-bound responses above 25,000 rows. Store `sourceCompletenessState='TOP_ROWS_ONLY'` because Search Analytics is not a complete keyword universe.

- [ ] **Step 4: Normalize and persist atomically**

Persist raw Query text plus deterministic `normalizedQuery`, `normalizationVersion`, raw page URL plus deterministic `canonicalPage`, clicks, impressions, CTR and position. Finalize COMPLETED only after facts are durable.

- [ ] **Step 5: Add safe sync observability**

Events: `gsc.sync.started/completed/failed`; metadata limited to project/property internal IDs, source date, row count, duration, state/reason.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts`
Expected: PASS.

```bash
git add src/modules/search-console src/queue tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts
git commit -m "feat: add immutable daily Search Console sync"
```

---

### Task 4: Stable Windows, Aggregates and Project CTR Curve

**Files:**
- Create: `src/modules/growth/growth.types.ts`
- Create: `src/modules/growth/gsc-window.ts`
- Create: `src/modules/growth/ctr-curve.ts`
- Test: `tests/unit/growth.gsc-window.test.ts`
- Test: `tests/unit/growth.ctr-curve.test.ts`

**Interfaces:**
- `resolveStableWindows(asOfDate): StableGrowthWindows`
- `aggregateQueryPageFacts(facts): QueryPageAggregate[]`
- `buildProjectCtrCurve(samples): ProjectCtrCurveV1`

- [ ] **Step 1: Write failing date-window tests**

```ts
expect(resolveStableWindows(new Date('2026-08-20T12:00:00Z'))).toEqual({
  cutoffDate: '2026-08-17',
  current: { start: '2026-07-21', end: '2026-08-17' },
  previous: { start: '2026-06-23', end: '2026-07-20' }
});
```

Assert any missing/FAILED source date makes the 56-day input ineligible.

- [ ] **Step 2: Write failing aggregate/CTR tests**

Aggregate CTR as `sum(clicks)/sum(impressions)` and position as impression-weighted mean. `PROJECT_CTR_CURVE_V1` buckets are `1`, `2`, `3`, `4-5`, `6-10`, `11-20`, `21-30`, `31-50`, `>50`; an individual sample needs >=10 impressions and a bucket needs >=30 eligible samples.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement pure deterministic primitives**

```ts
export const GROWTH_WINDOW_V1 = { days: 28, excludeRecentDays: 3 } as const;
export const CTR_CURVE_MIN_ROW_IMPRESSIONS = 10;
export const CTR_CURVE_MIN_BUCKET_SAMPLES = 30;
```

A bucket with insufficient samples returns explicit `UNKNOWN`.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth.types.ts src/modules/growth/gsc-window.ts src/modules/growth/ctr-curve.ts tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts
git commit -m "feat: add deterministic GSC growth aggregates"
```

---

### Task 5: Immutable Growth Persistence and Stable Identity

**Files:**
- Create: `prisma/models/growth-intelligence.prisma`
- Create: `prisma/migrations/20260820220000_add_growth_intelligence/migration.sql`
- Create: `src/modules/growth/growth.repository.ts`
- Test: `tests/integration/growth.persistence.test.ts`

**Interfaces:**

```ts
export type GrowthIdentityType =
  | 'QUERY_PAGE_GROWTH'
  | 'KEYWORD_CANNIBALIZATION'
  | 'NEW_CONTENT_OPPORTUNITY';

export function buildOpportunityKey(input: GrowthIdentityInput): string;
```

Repository owns identities, immutable opportunity snapshots, score breakdowns, evidence, lifecycle/events and Topic identities/snapshots.

- [ ] **Step 1: Write failing identity/immutability tests**

Assert `QUERY_PAGE_GROWTH` identity is stable when `primaryType` changes; Cannibalization page order hashes identically; a changed material page set creates a different identity; old snapshots/breakdowns/evidence/topic snapshots cannot be updated.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/growth.persistence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add exact models**

Create `GrowthOpportunityIdentity`, `GrowthOpportunitySnapshot`, `GrowthScoreBreakdown`, `GrowthOpportunityEvidence`, `GrowthOpportunityLifecycle`, `GrowthOpportunityLifecycleEvent`, `GrowthTopicCluster`, `GrowthTopicClusterSnapshot` plus bounded member/provenance representation from the spec.

- [ ] **Step 4: Implement canonical identity serialization**

Use versioned canonical JSON + SHA-256; keep `topicClusterId` and `primaryType` out of normal stable identity.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/integration/growth.persistence.test.ts`
Expected: PASS.

```bash
git add prisma/models/growth-intelligence.prisma prisma/migrations/20260820220000_add_growth_intelligence src/modules/growth/growth.repository.ts tests/integration/growth.persistence.test.ts
git commit -m "feat: add immutable growth persistence"
```

---

### Task 6: P2/P3/P5/P6 Evidence Adapters and Root-Cause Dedupe

**Files:**
- Create: `src/modules/growth/growth-evidence.ts`
- Test: `tests/unit/growth.evidence.test.ts`
- Test: `tests/integration/growth.evidence.test.ts`

**Interfaces:**
- `loadGrowthEvidence(projectId, canonicalPages, window): Promise<GrowthEvidence[]>`
- `dedupeGrowthEvidence(evidence): GrowthEvidenceSet`

- [ ] **Step 1: Write failing provenance/dedupe tests**

A P5 `CONTENT_CITABILITY_SUPPORT` fact that wraps the same P3 Citability root cause must retain both provenance rows but contribute one scoring group. UNKNOWN upstream state remains UNKNOWN and cannot trigger FAIL/PASS.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/growth.evidence.test.ts tests/integration/growth.evidence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement bounded adapters**

Map only persisted P2 SEO issues, P3 GEO/Entity/Citability facts, P5 content/competitor facts and P6 completed metrics/comparisons/alerts. Do not invoke any upstream calculator/provider.

- [ ] **Step 4: Implement exact fingerprints**

```ts
fingerprint = sha256(canonicalJson({
  sourceModule,
  sourceType,
  sourceId,
  sourceFactVersion,
  ruleKey
}));
```

Use a separate deterministic `rootCauseKey` for scoring dedupe.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/growth.evidence.test.ts tests/integration/growth.evidence.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-evidence.ts tests/unit/growth.evidence.test.ts tests/integration/growth.evidence.test.ts
git commit -m "feat: normalize growth evidence"
```

---

### Task 7: `GROWTH_SCORE_V1` Pure Deterministic Calculator

**Files:**
- Create: `src/modules/growth/growth-score.ts`
- Test: `tests/unit/growth.score.test.ts`

**Interfaces:**
- `calculateGrowthScore(input): GrowthScoreResult`
- Result stores component states, available weight, evidence coverage, normalized score, priority and `rankingEligible`.

- [ ] **Step 1: Write table-driven failing tests**

Cover all Demand percentile bands, Position bands, CTR-gap bands, Site Gap severity mean, GSC decline signal, P6 visibility signal, COMPLETE/PARTIAL/UNKNOWN weight thresholds and rounding.

```ts
expect(calculateGrowthScore({
  demand: known(90),
  positionPotential: known(100),
  ctrGap: known(80),
  siteGap: known(70),
  trendVisibility: known(50)
})).toMatchObject({ score: 84, priority: 'HIGH', availableWeight: 100, evidenceQuality: 'COMPLETE', rankingEligible: true });
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/growth.score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement exact weights/state behavior**

```ts
export const GROWTH_SCORE_V1 = {
  demand: 30,
  positionPotential: 25,
  ctrGap: 20,
  siteGap: 15,
  trendVisibility: 10
} as const;
```

Known dimensions are normalized by `availableWeight`; `UNKNOWN` is excluded, never scored as 0. `50 <= availableWeight < 70` may expose a diagnostic score but `rankingEligible=false`; `<50` returns authoritative score/priority UNKNOWN.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx vitest run tests/unit/growth.score.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-score.ts tests/unit/growth.score.test.ts
git commit -m "feat: add deterministic growth score v1"
```

---

### Task 8: Seven Normal Query+Page Opportunity Detectors

**Files:**
- Create: `src/modules/growth/growth-detectors.ts`
- Test: `tests/unit/growth.detectors.test.ts`

**Interfaces:**
- Detects `RANKING_UPSIDE`, `CTR_UNDERPERFORMANCE`, `SEO_GAP`, `GEO_CITABILITY_GAP`, `CONTENT_GAP`, `AI_VISIBILITY_GAP`, `DECLINING_PERFORMANCE`.
- `selectPrimaryType(signals): { primaryType; secondaryTypes }`.

- [ ] **Step 1: Write failing boundary tests**

Position 4 and 20 trigger Ranking Upside; 3/21 do not. CTR Gap Score >=30 triggers. INFO-only SEO does not. P5 UNKNOWN does not. GSC degradation >=5% triggers Declining Performance. P6 known gap signal >=25 triggers AI Visibility Gap.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/growth.detectors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pure detectors**

No detector performs I/O. Primary type is the triggered type with greatest weighted contributing signal; exact ties use a versioned fixed catalog order.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx vitest run tests/unit/growth.detectors.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-detectors.ts tests/unit/growth.detectors.test.ts
git commit -m "feat: add growth opportunity catalog detectors"
```

---

### Task 9: Cannibalization and Conservative New Content Detectors

**Files:**
- Create: `src/modules/growth/cannibalization.ts`
- Create: `src/modules/growth/new-content.ts`
- Test: `tests/unit/growth.cannibalization.test.ts`
- Test: `tests/unit/growth.new-content.test.ts`

**Interfaces:**
- `detectKeywordCannibalization(queryAggregate, context)`
- `detectNewContentOpportunity(queryAggregate, context)`

- [ ] **Step 1: Write Cannibalization positive/negative tests**

Require Demand Score >=40; >=2 canonical pages; >=2 pages each >=20% Query impression share; no page >=80%; and either both material pages position <=30 or their position difference <=10. Canonical-equivalent URLs collapse. Cap page list at 20.

- [ ] **Step 2: Write primary-page-candidate tests**

Tie-break: higher impression share → better position → higher CTR → stronger deduplicated P3/P5 content/entity evidence. If still tied, candidate state is UNKNOWN.

- [ ] **Step 3: Write New Content tests**

Require Demand >=65, Query impressions >= project P50, best page position >20, no page >=70%, valid P3/P5 coverage gap, no deterministic duplicate landing page, minimum evidence known, and no active Cannibalization result for the same Query/window.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement detectors, run GREEN and commit**

Run: `npx vitest run tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/cannibalization.ts src/modules/growth/new-content.ts tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts
git commit -m "feat: detect cannibalization and new content opportunities"
```

---

### Task 10: Database-Only Materialization, Topic Rollups and Lifecycle Reconciliation

**Files:**
- Create: `src/modules/growth/topic-cluster.ts`
- Create: `src/modules/growth/growth.service.ts`
- Create: `src/modules/growth/growth.worker.ts`
- Create: `src/modules/growth/growth.observability.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/growth.topic-cluster.test.ts`
- Test: `tests/integration/growth.materialization.test.ts`
- Test: `tests/integration/growth.lifecycle.test.ts`

**Interfaces:**
- Queue name: `growth-materialization`.
- `materializeGrowthWindow(projectId, asOfDate, deps)`.
- `reconcileOpportunityLifecycle(identityId, currentSnapshot, history)`.

- [ ] **Step 1: Write failing zero-network materialization test**

Seed 56 selected GSC days and P2/P3/P5/P6 facts; inject Google/P6-provider/DeepSeek stubs that throw if called; assert a deterministic immutable snapshot is persisted with exact source provenance.

- [ ] **Step 2: Write failing lifecycle tests**

Same identity across windows advances `latestSnapshotId`; two consecutive non-actionable windows AUTO_RESOLVE; recurrence after DONE/RESOLVED AUTO_REOPENs; DISMISSED stays dismissed; PLANNED/IN_PROGRESS are never auto-DONE.

- [ ] **Step 3: Write failing Topic tests**

P3 entity/topic relationship wins; explicit deterministic alias map is second; normalized primary Query fallback is third; unresolved is `UNCLUSTERED`. Topic Score uses Top Opportunity 50%, demand-weighted opportunities 30%, trend/visibility 20%, with unknown-weight normalization.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement bounded/idempotent materialization**

Enforce candidate/snapshot/topic/member bounds. Deterministic BullMQ job ID hashes project + formula/materialization version + windows + cutoff + selected GSC source snapshot IDs.

- [ ] **Step 6: Emit safe growth events**

`growth.materialization.started/completed/failed` and `growth.lifecycle.changed`; no full Query/evidence payloads.

- [ ] **Step 7: Run GREEN and commit**

Run: `npx vitest run tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts`
Expected: PASS.

```bash
git add src/modules/growth src/queue tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts
git commit -m "feat: materialize growth opportunities"
```

---

### Task 11: Feature Gates and Bounded REST API

**Files:**
- Modify: `src/auth/feature-flags.ts`
- Modify: `src/auth/require-feature.ts`
- Modify: `src/modules/search-console/search-console.routes.ts`
- Create: `src/modules/growth/growth.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/search-console.api.test.ts`
- Test: `tests/integration/growth.api.test.ts`

**Interfaces:**
- Search Console prefix: `/api/projects/:projectId/search-console`.
- Growth prefix: `/api/projects/:projectId/growth`.
- Feature names: `SEARCH_CONSOLE`, `GROWTH_OPPORTUNITIES`, `GROWTH_TOPIC_CLUSTERS`, `GROWTH_CANNIBALIZATION`, `GROWTH_NEW_CONTENT`, `GROWTH_AI_EXPLANATION`, `PORTFOLIO_GROWTH`.

- [ ] **Step 1: Write failing plan-matrix tests**

Standard: Search Console + bounded basic ranking/CTR opportunities. Advanced: full Opportunity Center/history/lifecycle/Topics/Cannibalization/New Content/P6 contribution/AI explanation. Enterprise: Advanced + portfolio Growth. Restricted routes must fail before restricted DB reads or queue writes.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/search-console.api.test.ts tests/integration/growth.api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend exact feature matrix**

Update `Feature` union and Standard/Advanced/Enterprise sets in `src/auth/feature-flags.ts`; reuse `requireFeature` behavior from `src/auth/require-feature.ts` rather than inventing a second gate mechanism.

- [ ] **Step 4: Implement bounded routes**

Opportunity list max page size 100. Detail includes score breakdown, evidence and snapshot history. Lifecycle POST validates state transitions. GET endpoints do zero materialization/external work.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/integration/search-console.api.test.ts tests/integration/growth.api.test.ts`
Expected: PASS.

```bash
git add src/auth src/modules/search-console/search-console.routes.ts src/modules/growth/growth.routes.ts src/app.ts tests/integration/search-console.api.test.ts tests/integration/growth.api.test.ts
git commit -m "feat: expose P7-A growth APIs"
```

---

### Task 12: Search Console Settings and Growth Opportunity Center UI

**Files:**
- Create: `src/modules/search-console/search-console.web.routes.ts`
- Create: `src/modules/growth/growth.web.repository.ts`
- Create: `src/modules/growth/growth.web.routes.ts`
- Create: `src/views/search-console/settings.ejs`
- Create: `src/views/growth/index.ejs`
- Create: `src/views/growth/show.ejs`
- Create: `src/views/growth/topics.ejs`
- Create: `src/views/growth/cannibalization.ejs`
- Create: `src/views/growth/new-content.ejs`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/views/projects/show.ejs`
- Modify: `src/app.ts`
- Test: `tests/integration/search-console.web.test.ts`
- Test: `tests/integration/growth.web.test.ts`
- Test: `tests/e2e/growth.spec.ts`

**Interfaces:**
- GSC UI states: `NOT_CONNECTED`, `CONNECTED`, `PROPERTY_SELECTED`, `SYNCING`, `READY`, `TOKEN_REVOKED`, `PERMISSION_DENIED`, `PROPERTY_UNAVAILABLE`, `SYNC_FAILED`.
- Growth UI reads persisted data only.

- [ ] **Step 1: Write failing server-render tests**

Assert GSC page labels connection `只读`, displays property/freshness/coverage/health, and never prints token material. Assert Growth table defaults to `rankingEligible=true` + score descending and shows Evidence Quality separately from Priority.

- [ ] **Step 2: Write failing detail/special-view tests**

Detail must show deterministic Why/Score Breakdown/current-vs-previous/Evidence/Lifecycle and visually separated AI area. Cannibalization must not expose automatic redirect/canonical buttons. New Content wording is “建议评估新建专门内容页”.

- [ ] **Step 3: Write browser smoke**

`tests/e2e/growth.spec.ts` seeds fixture facts and navigates Search Console settings → Growth Center → Opportunity detail → Topics → Cannibalization → New Content.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/integration/search-console.web.test.ts tests/integration/growth.web.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement views/routes/repository; run GREEN**

Run: `npx vitest run tests/integration/search-console.web.test.ts tests/integration/growth.web.test.ts && npm run test:e2e -- --grep "Growth"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/search-console/search-console.web.routes.ts src/modules/growth src/views/search-console src/views/growth src/views/partials/sidebar.ejs src/views/projects/show.ejs src/app.ts tests/integration/search-console.web.test.ts tests/integration/growth.web.test.ts tests/e2e/growth.spec.ts
git commit -m "feat: add P7-A Growth Opportunity Center"
```

---

### Task 13: Project and Enterprise Portfolio Dashboard Integration

**Files:**
- Modify: `src/web/dashboard.repository.ts`
- Modify: `src/web/view-models.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/views/dashboard.ejs`
- Modify: `src/views/projects/show.ejs`
- Test: `tests/integration/dashboard.real-data.test.ts`
- Test: `tests/integration/projects.web.test.ts`
- Test: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- Project Growth summary: top eligible score, CRITICAL/HIGH counts, search impression/click trend, top declining opportunity/topic, top ranking upside, top Cannibalization risk, GSC freshness.
- Enterprise portfolio summary: per-project top eligible opportunity, critical count, freshness/connection health, resolved count and bounded cross-project ordering.

- [ ] **Step 1: Add failing real-data dashboard tests**

Seed Growth/GSC facts; inject external transports that throw; assert rendered values originate from persisted P7 facts. No eligible snapshot must render an explicit no-data state, not score 0.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/dashboard.real-data.test.ts tests/integration/projects.web.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend repository/view model/routes**

Only database reads. Standard receives its bounded basic summary; Advanced gets full project Growth summary; portfolio Growth is Enterprise-gated.

- [ ] **Step 4: Run GREEN + browser smoke and commit**

Run: `npx vitest run tests/integration/dashboard.real-data.test.ts tests/integration/projects.web.test.ts && npm run test:e2e -- tests/e2e/dashboard.spec.ts`
Expected: PASS.

```bash
git add src/web src/views/dashboard.ejs src/views/projects/show.ejs tests/integration/dashboard.real-data.test.ts tests/integration/projects.web.test.ts tests/e2e/dashboard.spec.ts
git commit -m "feat: integrate growth intelligence into dashboards"
```

---

### Task 14: User-Triggered DeepSeek `GROWTH_OPPORTUNITY_EXPLANATION`

**Files:**
- Create: `src/modules/ai/growth-opportunity-explanation.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/20260820230000_add_growth_opportunity_ai_task/migration.sql`
- Modify: `src/modules/growth/growth.routes.ts`
- Test: `tests/unit/ai.prompt-registry.test.ts`
- Test: `tests/unit/growth.ai.test.ts`
- Test: `tests/integration/growth.ai.test.ts`

**Interfaces:**
- Prisma enum adds `GROWTH_OPPORTUNITY_EXPLANATION`.
- Prompt ID adds `growth-opportunity-explanation-v1` in `src/modules/ai/prompts/prompt-registry.ts`.
- Builder follows the existing `visibility-trend-analysis.ts` pattern and uses `aiTaskService.createAndEnqueue` from `src/modules/ai/ai.service.ts`.

- [ ] **Step 1: Write failing prompt-registry test**

Add the new prompt ID to the exact immutable prompt list; require REASONING + JSON + supplied-facts/do-not-invent guardrails.

- [ ] **Step 2: Write failing bounded fact-builder test**

Input includes opportunity identity/type, score/breakdown, current/previous aggregate GSC metrics, selected deduped evidence summaries, evidence quality/UNKNOWN caveats and Topic context only. It excludes OAuth credentials, raw P6 provider bodies/reasoning and unbounded Query corpora.

- [ ] **Step 3: Write failing immutability test**

After successful AI completion, only generic AI task/run/result rows may change; Growth identity/snapshot/breakdown/evidence/lifecycle rows must remain unchanged.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/ai.prompt-registry.test.ts tests/unit/growth.ai.test.ts tests/integration/growth.ai.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement AI task through existing P4 pipeline**

Add output Zod validation and allowed-source-reference validation in `growth-opportunity-explanation.ts`; extend `expectedPromptId`, `resultSummary` and `parseTaskOutput` switches in `ai.worker.ts`. Do not instantiate a second DeepSeek provider.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/ai.prompt-registry.test.ts tests/unit/growth.ai.test.ts tests/integration/growth.ai.test.ts`
Expected: PASS.

```bash
git add prisma/models/ai-gateway.prisma prisma/migrations/20260820230000_add_growth_opportunity_ai_task src/modules/ai/growth-opportunity-explanation.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts src/modules/growth/growth.routes.ts tests/unit/ai.prompt-registry.test.ts tests/unit/growth.ai.test.ts tests/integration/growth.ai.test.ts
git commit -m "feat: add advisory growth opportunity explanation"
```

---

### Task 15: Safe Observability, Operator Guide and Exact-Head P7-A Release Gate

**Files:**
- Modify: `src/modules/search-console/search-console.observability.ts`
- Modify: `src/modules/growth/growth.observability.ts`
- Create: `docs/development/p7a-growth-opportunity-intelligence.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Test: `tests/integration/search-console.observability.test.ts`
- Test: `tests/integration/growth.observability.test.ts`

**Interfaces:**
- Allowlisted events: `gsc.connection.connected`, `gsc.connection.revoked`, `gsc.property.bound`, `gsc.sync.started/completed/failed`, `growth.materialization.started/completed/failed`, `growth.lifecycle.changed`, `growth.ai_explanation.completed/failed`.

- [ ] **Step 1: Write failing log-safety tests**

Allowed metadata: project/internal property IDs, source dates/window bounds, counts, duration, state, reason code, formula/materialization version. Prohibit access/refresh tokens, client secret, full Google account credential payloads, full Query arrays, full evidence payloads, raw AI prompt/response bodies, P6 raw provider bodies/reasoning.

- [ ] **Step 2: Run RED then implement allowlists**

Run: `npx vitest run tests/integration/search-console.observability.test.ts tests/integration/growth.observability.test.ts`
Expected first run: FAIL; after implementation: PASS.

- [ ] **Step 3: Write operator guide**

Document all five env vars, Google callback setup, read-only scope, AES key/key-version rotation, source freshness/completeness, 28+28/3-day window contract, daily re-import versioning, queue names, hard bounds, failure reason codes, UNKNOWN/PARTIAL behavior, lifecycle semantics, incident triage and rollback.

- [ ] **Step 4: Prove release invariants with focused tests**

Re-run OAuth replay rejection, daily sync idempotency, immutable source/Growth snapshots, `UNKNOWN != 0`, score determinism, root-cause dedupe, Cannibalization/New Content mutual exclusion, stable identity across primary-type changes, two-window resolve/reopen, DISMISSED no-auto-reopen, plan fail-before-read gates, and zero external calls during materialization/GET rendering.

- [ ] **Step 5: Run fresh full local gate**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Expected: every command exits 0 and test transports make zero live Google API calls.

- [ ] **Step 6: Ensure CI retains three exact-head jobs**

`.github/workflows/ci.yml` must run `verify`, Chromium `e2e`, and `production-audit`. Google credentials must not be required in CI; fixtures/mocks are mandatory.

- [ ] **Step 7: Update README only after exact-head green**

Mark P7-A complete only after the final PR head has all three CI jobs successful. Record exact head SHA + workflow run in PR/release evidence; do not infer post-merge CI that did not actually run.

- [ ] **Step 8: Commit release-gate docs**

```bash
git add src/modules/search-console/search-console.observability.ts src/modules/growth/growth.observability.ts docs/development/p7a-growth-opportunity-intelligence.md README.md .github/workflows/ci.yml tests/integration/search-console.observability.test.ts tests/integration/growth.observability.test.ts
git commit -m "docs: complete P7-A release gate"
```

---

## Self-Review Coverage Matrix

- Tasks 1–3: Search Console OAuth, encrypted credential boundary, property binding, immutable daily facts, source health.
- Task 4: exact 28/28/3-day window, Query+Page aggregates, project CTR curve.
- Task 5: stable identity + immutable Opportunity/Topic persistence + lifecycle event foundation.
- Task 6: P2/P3/P5/P6 source adapters and root-cause dedupe.
- Task 7: all five deterministic scoring dimensions + evidence-quality/ranking-eligibility contract.
- Task 8: seven normal Query+Page opportunity types + deterministic primary type.
- Task 9: balanced Cannibalization + conservative New Content + mutual exclusion.
- Task 10: database-only materialization + Topic rollups + resolve/reopen lifecycle.
- Task 11: exact plan matrix, fail-before-read gates, bounded REST APIs.
- Task 12: GSC settings + Growth Center + detail + Topic/Cannibalization/New Content UI.
- Task 13: project + Enterprise portfolio Dashboard integration from persisted facts.
- Task 14: optional P4 DeepSeek explanation only; deterministic Growth facts remain immutable.
- Task 15: safe observability, operations, full regression and exact-head release evidence.

## Execution Order and PR Strategy

Implement Tasks 1→15 in order. Each Task is an independently reviewable gate and should normally use a task-scoped branch/PR against the latest merged P7-A base. Tasks 1–5 are foundation; 6–9 are pure decision primitives; 10 is the integration/materialization boundary; 11–15 expose product surfaces and release evidence. Do not stack P8/P9 work onto these branches.
