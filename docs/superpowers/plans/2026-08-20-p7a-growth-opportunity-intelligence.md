# P7-A Growth Opportunity Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Google Search Console ingestion and a deterministic Growth Opportunity layer that converts persisted GSC + P2/P3/P5/P6 facts into immutable, auditable, prioritized growth opportunities.

**Architecture:** Add a `search-console` module for OAuth/property binding, encrypted credential references and immutable daily GSC facts, and a separate `growth` module for window aggregation, evidence adapters, deterministic scoring/detection, lifecycle reconciliation, topic rollups, API/UI and optional user-triggered DeepSeek explanation. Authoritative growth materialization is database-only after GSC facts have been persisted; render paths make zero Google/P6-provider/DeepSeek calls.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest, Playwright/Chromium, Node `crypto`, Google OAuth 2.0/Search Console REST API, existing P4 DeepSeek AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-20-p7a-growth-opportunity-intelligence-design.md`

## Global Constraints

- Google Search Console OAuth scope is exactly `https://www.googleapis.com/auth/webmasters.readonly`.
- OAuth callback `state` is random, high entropy, hashed at rest, expiring and single-use.
- OAuth credential JSON is encrypted at rest with AES-256-GCM; plaintext tokens never enter business tables, logs, HTML, reports or AI inputs.
- Default stable measurement contract is current 28 days + immediately previous 28 days, excluding the most recent 3 calendar days.
- A stable window is eligible only when all expected source days have a selected completed daily snapshot.
- `UNKNOWN` is never coerced to zero; failed source days are not zero-impression days.
- `GROWTH_SCORE_V1`: Demand 30%, Position Potential 25%, CTR Gap 20%, Site Gap 15%, Trend/Visibility 10%.
- `availableWeight >= 70` is ranking-eligible; 50–69 is diagnostic PARTIAL only; `<50` yields authoritative score/priority `UNKNOWN`.
- Normal opportunity identity is `projectId + QUERY_PAGE_GROWTH + normalizedQuery + canonicalPage`; dynamic `primaryType` is snapshot data, not identity.
- `KEYWORD_CANNIBALIZATION` and `NEW_CONTENT_OPPORTUNITY` use separate stable identities.
- Materialized GSC daily snapshots, Growth snapshots, score breakdowns, evidence and Topic snapshots are immutable.
- Growth materialization makes zero Google API calls, zero P6 provider calls and zero DeepSeek calls.
- DeepSeek explanation is explicit user-triggered advisory work and cannot mutate score, priority, triggers, Topic identity, lifecycle or upstream facts.
- V1 hard bounds: 25,000 GSC Query+Page rows/project/source-day; 50,000 growth candidates/materialization; 10,000 opportunity snapshots/project/window; API page size 100; 2,000 Topic Clusters/project; 500 member Queries/Topic; 20 competing pages/Cannibalization identity.
- Use TDD for every behavior change and keep commits task-scoped.

---

## File Structure Map

### New Search Console files

- `prisma/models/search-console.prisma` — OAuth state, encrypted credential vault metadata, connection/property, daily snapshot and Query+Page fact models.
- `src/modules/search-console/search-console.types.ts` — public domain types/constants.
- `src/modules/search-console/oauth-credential-vault.ts` — AES-256-GCM credential encryption/decryption abstraction.
- `src/modules/search-console/search-console.repository.ts` — project-scoped persistence only.
- `src/modules/search-console/google-search-console.client.ts` — fixture-injectable OAuth/Search Console HTTP client.
- `src/modules/search-console/search-console.service.ts` — OAuth/property/sync orchestration.
- `src/modules/search-console/search-console.routes.ts` — REST endpoints and callback handling.
- `src/modules/search-console/search-console.web.routes.ts` — settings UI.
- `src/modules/search-console/search-console.worker.ts` — bounded daily sync worker.
- `src/modules/search-console/search-console.observability.ts` — safe allowlisted events.

### New Growth files

- `prisma/models/growth-intelligence.prisma` — identity/snapshot/score/evidence/lifecycle/topic persistence.
- `src/modules/growth/growth.types.ts` — V1 contracts/constants.
- `src/modules/growth/gsc-window.ts` — stable window and aggregate primitives.
- `src/modules/growth/ctr-curve.ts` — project CTR baseline.
- `src/modules/growth/growth-evidence.ts` — P2/P3/P5/P6 adapters and root-cause dedupe.
- `src/modules/growth/growth-score.ts` — pure deterministic score calculator.
- `src/modules/growth/growth-detectors.ts` — normal opportunity catalog detection.
- `src/modules/growth/cannibalization.ts` — balanced Cannibalization detector.
- `src/modules/growth/new-content.ts` — conservative New Content detector.
- `src/modules/growth/topic-cluster.ts` — deterministic Topic identity/rollup.
- `src/modules/growth/growth.repository.ts` — immutable materialization persistence.
- `src/modules/growth/growth.service.ts` — materialization/lifecycle orchestration.
- `src/modules/growth/growth.worker.ts` — database-only BullMQ worker.
- `src/modules/growth/growth.routes.ts` — REST API.
- `src/modules/growth/growth.web.repository.ts` — bounded persisted UI reads.
- `src/modules/growth/growth.web.routes.ts` — Opportunity/Topic/special views.
- `src/modules/growth/growth.observability.ts` — allowlisted events.
- `src/modules/ai/growth-opportunity-explanation.ts` — bounded advisory input/output contract.

### Existing integration points

- `src/config/env.ts` — OAuth client/config and vault key env parsing.
- `src/queue/queues.ts` — `search-console-sync` and `growth-materialization` queues.
- `src/queue/worker-bootstrap.ts` — worker registration.
- `src/app.ts` — API/web route mounting.
- `src/web/dashboard.repository.ts` — persisted Growth summary joins.
- `src/web/routes.ts` and existing dashboard EJS views — Growth Intelligence dashboard blocks/navigation.
- `src/modules/ai/*` and `prisma/models/ai-gateway.prisma` — register `GROWTH_OPPORTUNITY_EXPLANATION` without changing deterministic P7 facts.
- `.github/workflows/ci.yml` — retain exact-head verify/e2e/production-audit gates; no live Google calls.
- `README.md` and `docs/development/p7a-growth-opportunity-intelligence.md` — operational docs/release evidence.

---

### Task 1: Search Console Persistence and Encrypted Credential Vault

**Files:**
- Create: `prisma/models/search-console.prisma`
- Create: `src/modules/search-console/search-console.types.ts`
- Create: `src/modules/search-console/oauth-credential-vault.ts`
- Create: `src/modules/search-console/search-console.repository.ts`
- Modify: `src/config/env.ts`
- Create migration under: `prisma/migrations/<timestamp>_p7a_search_console_foundation/migration.sql`
- Test: `tests/unit/search-console.credential-vault.test.ts`
- Test: `tests/integration/search-console.persistence.test.ts`

**Interfaces:**
- Produces `OAuthCredentialVault.put/get/replace/revoke`.
- Produces `SearchConsoleRepository` methods for OAuth state, connection/property and daily snapshot persistence used by Tasks 2–4.

- [ ] **Step 1: Write failing credential-vault tests**

```ts
it('round-trips credential JSON without storing plaintext', async () => {
  const vault = createOAuthCredentialVault({ key: Buffer.alloc(32, 7), keyVersion: 'v1', store });
  const ref = await vault.put('project-1', 'GOOGLE_SEARCH_CONSOLE', { access_token: 'secret-a', refresh_token: 'secret-r' });
  expect(JSON.stringify(store.rows)).not.toContain('secret-a');
  expect(await vault.get(ref)).toEqual({ access_token: 'secret-a', refresh_token: 'secret-r' });
});

it('fails closed when the encryption key is missing or invalid', () => {
  expect(() => parseOAuthCredentialKey('bad')).toThrow(/32 bytes/);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npx vitest run tests/unit/search-console.credential-vault.test.ts`
Expected: FAIL because the vault module does not exist.

- [ ] **Step 3: Add Prisma models and repository constraints**

Create explicit models for `OAuthStateNonce`, `OAuthCredentialRecord`, `SearchConsoleConnection`, `SearchConsoleProperty`, `GscDailySnapshot`, and `GscQueryPageFact`. Enforce one active connection/property by service + unique active identity, immutable completed source versions by repository API, and `(projectId, propertyId, date, syncVersion)` uniqueness.

- [ ] **Step 4: Implement AES-256-GCM vault**

```ts
export interface OAuthCredentialVault {
  put(projectId: string, provider: 'GOOGLE_SEARCH_CONSOLE', payload: unknown): Promise<string>;
  get(credentialRef: string): Promise<unknown>;
  replace(credentialRef: string, payload: unknown): Promise<void>;
  revoke(credentialRef: string): Promise<void>;
}
```

Use 12-byte random IVs, 16-byte auth tags and explicit `keyVersion`; never log plaintext.

- [ ] **Step 5: Add persistence integration tests**

Assert completed snapshots reject mutation, later `syncVersion` can coexist, selected source version is highest COMPLETED, and failed snapshots never become selected.

- [ ] **Step 6: Validate and run tests**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/search-console.credential-vault.test.ts tests/integration/search-console.persistence.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma src/config/env.ts src/modules/search-console tests/unit/search-console.credential-vault.test.ts tests/integration/search-console.persistence.test.ts
git commit -m "feat: add Search Console persistence foundation"
```

---

### Task 2: OAuth State, Read-Only Google Connection and Property Binding

**Files:**
- Create: `src/modules/search-console/google-search-console.client.ts`
- Create: `src/modules/search-console/search-console.service.ts`
- Create: `src/modules/search-console/search-console.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/unit/search-console.oauth.test.ts`
- Test: `tests/integration/search-console.api.test.ts`

**Interfaces:**
- Consumes `OAuthCredentialVault` and `SearchConsoleRepository` from Task 1.
- Produces `beginGoogleOAuth(projectId, actorId)`, `completeGoogleOAuth(code, state)`, `listProperties(projectId)`, `bindProperty(projectId, propertyUri)`.

- [ ] **Step 1: Write failing OAuth contract tests**

```ts
expect(authorizeUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
expect(authorizeUrl.searchParams.get('access_type')).toBe('offline');
```

Also test expired, mismatched and replayed state are rejected before token exchange.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/search-console.oauth.test.ts`
Expected: FAIL because OAuth service is absent.

- [ ] **Step 3: Implement fixture-injectable Google transport**

```ts
export interface GoogleSearchConsoleTransport {
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokenPayload>;
  refreshToken(refreshToken: string): Promise<GoogleTokenPayload>;
  listSites(accessToken: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>>;
  querySearchAnalytics(accessToken: string, siteUrl: string, request: SearchAnalyticsRequest): Promise<SearchAnalyticsResponse>;
}
```

No test may require network.

- [ ] **Step 4: Implement OAuth state and property validation**

Persist only hashed state nonce with actor/project/expiry; mark consumed atomically before completing connection. Property binding must verify the selected property appears in `listSites` with readable permission.

- [ ] **Step 5: Add REST API integration coverage**

Cover connection status, begin OAuth, callback success/failure, property listing and binding; assert unauthorized project access fails before credential reads.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/search-console.oauth.test.ts tests/integration/search-console.api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/search-console src/app.ts tests/unit/search-console.oauth.test.ts tests/integration/search-console.api.test.ts
git commit -m "feat: add read-only Search Console OAuth flow"
```

---

### Task 3: Fixture-Safe Daily GSC Synchronization

**Files:**
- Create: `src/modules/search-console/search-console.worker.ts`
- Create: `src/modules/search-console/search-console.observability.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/search-console.worker.test.ts`
- Test: `tests/integration/search-console.sync.test.ts`

**Interfaces:**
- Produces queue `search-console-sync` and `syncSearchConsoleDay({ projectId, propertyId, date })`.
- Persists at most 25,000 Query+Page rows/source-day and immutable completed daily versions.

- [ ] **Step 1: Write failing worker/idempotency tests**

```ts
await worker.process({ projectId, propertyId, date: '2026-08-01' });
await worker.process({ projectId, propertyId, date: '2026-08-01' });
expect(await countSelectedCompletedVersions(projectId, '2026-08-01')).toBe(1);
```

Assert `TOKEN_REVOKED`, `PERMISSION_DENIED`, `RATE_LIMITED`, `INVALID_RESPONSE`, and persistence failure are classified without fabricating successful data.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement one-day Search Analytics request**

Use dimensions `query,page`, one source day per job, bounded row limit/pagination supported by the official endpoint, normalized Query/page values and explicit `sourceCompletenessState`.

- [ ] **Step 4: Persist atomically**

Write PENDING/RUNNING snapshot, bounded facts, then COMPLETED in one final transaction. A failure leaves FAILED and never becomes an authoritative selected source day.

- [ ] **Step 5: Register queue/worker and safe observability**

Allow only project/property internal IDs, date, counts, duration, status/reasonCode. Never log Query rows or OAuth payloads.

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/search-console src/queue tests/unit/search-console.worker.test.ts tests/integration/search-console.sync.test.ts
git commit -m "feat: add immutable daily Search Console sync"
```

---

### Task 4: Stable Windows, Query+Page Aggregates and Project CTR Curve

**Files:**
- Create: `src/modules/growth/growth.types.ts`
- Create: `src/modules/growth/gsc-window.ts`
- Create: `src/modules/growth/ctr-curve.ts`
- Test: `tests/unit/growth.gsc-window.test.ts`
- Test: `tests/unit/growth.ctr-curve.test.ts`

**Interfaces:**
- Produces `resolveStableWindows(asOfDate)`.
- Produces `aggregateQueryPageFacts(selectedDailyFacts)`.
- Produces `buildProjectCtrCurve(samples): CtrCurveV1`.

- [ ] **Step 1: Write failing window tests**

```ts
expect(resolveStableWindows(new Date('2026-08-20T12:00:00Z'))).toEqual({
  cutoffDate: '2026-08-17',
  current: { start: '2026-07-21', end: '2026-08-17' },
  previous: { start: '2026-06-23', end: '2026-07-20' }
});
```

Assert one missing/failed day makes the window ineligible.

- [ ] **Step 2: Write failing CTR curve tests**

A bucket requires rows with >=10 impressions and >=30 eligible samples; median CTR is deterministic; buckets below 30 samples return `UNKNOWN`.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement pure primitives**

```ts
export const GROWTH_WINDOW_V1 = { days: 28, excludeRecentDays: 3 } as const;
export const CTR_BUCKET_MIN_IMPRESSIONS = 10;
export const CTR_BUCKET_MIN_SAMPLES = 30;
```

Aggregate position as impression-weighted average; aggregate CTR as totalClicks/totalImpressions, not average of daily CTR percentages.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts`
Expected: PASS.

```bash
git add src/modules/growth tests/unit/growth.gsc-window.test.ts tests/unit/growth.ctr-curve.test.ts
git commit -m "feat: add deterministic GSC growth aggregates"
```

---

### Task 5: Growth Persistence Foundation

**Files:**
- Create: `prisma/models/growth-intelligence.prisma`
- Create: `src/modules/growth/growth.repository.ts`
- Create migration: `prisma/migrations/<timestamp>_p7a_growth_foundation/migration.sql`
- Test: `tests/integration/growth.persistence.test.ts`

**Interfaces:**
- Produces repository APIs for stable identities, immutable snapshots/breakdowns/evidence, lifecycle/events and Topic snapshots.

- [ ] **Step 1: Write failing persistence tests**

Assert normal identity remains the same when `primaryType` changes, completed snapshot rows cannot be updated, Cannibalization page order hashes identically, new page-set identity hashes differently, and lifecycle events append without mutating snapshots.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/integration/growth.persistence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add models and deterministic identity helpers**

```ts
export type GrowthIdentityType = 'QUERY_PAGE_GROWTH' | 'KEYWORD_CANNIBALIZATION' | 'NEW_CONTENT_OPPORTUNITY';
export function buildOpportunityKey(input: GrowthIdentityInput): string;
```

Use versioned canonical serialization + SHA-256.

- [ ] **Step 4: Add immutable repository operations**

Expose create/read methods; do not expose generic update APIs for snapshot/evidence/breakdown/topic snapshot tables.

- [ ] **Step 5: Validate and run tests**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/integration/growth.persistence.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma src/modules/growth/growth.repository.ts tests/integration/growth.persistence.test.ts
git commit -m "feat: add immutable growth persistence"
```

---

### Task 6: P2/P3/P5/P6 Evidence Adapters and Root-Cause Dedupe

**Files:**
- Create: `src/modules/growth/growth-evidence.ts`
- Test: `tests/unit/growth.evidence.test.ts`
- Test: `tests/integration/growth.evidence-repository.test.ts`

**Interfaces:**
- Produces `loadGrowthEvidence(projectId, canonicalPages, window): Promise<GrowthEvidence[]>`.
- Produces `dedupeGrowthEvidence(evidence): { provenance; scoringGroups }`.

- [ ] **Step 1: Write failing evidence tests**

Assert P5 `CONTENT_CITABILITY_SUPPORT` wrapping the same P3 Citability fact retains both provenance rows but one `rootCauseKey` scoring group; UNKNOWN evidence never becomes FAIL/PASS.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/growth.evidence.test.ts tests/integration/growth.evidence-repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement bounded adapters**

Map only persisted authoritative facts and retain `sourceModule/sourceType/sourceId/sourceFactVersion/ruleKey/rootCauseKey/evidenceState/severity`.

- [ ] **Step 4: Implement deterministic fingerprints**

```ts
fingerprint = sha256(canonicalJson({ sourceModule, sourceType, sourceId, sourceFactVersion, ruleKey }));
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/unit/growth.evidence.test.ts tests/integration/growth.evidence-repository.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-evidence.ts tests/unit/growth.evidence.test.ts tests/integration/growth.evidence-repository.test.ts
git commit -m "feat: normalize growth evidence"
```

---

### Task 7: Deterministic Opportunity Score V1

**Files:**
- Create: `src/modules/growth/growth-score.ts`
- Test: `tests/unit/growth.score.test.ts`

**Interfaces:**
- Produces `calculateGrowthScore(input): GrowthScoreResult` with all component states, `availableWeight`, `evidenceCoverage`, `rankingEligible`, `priority`.

- [ ] **Step 1: Write table-driven failing tests**

Cover Demand bands, Position bands, CTR gap bands, root-cause Site Gap mean, GSC trend ratios, P6 visibility signals, COMPLETE/PARTIAL/UNKNOWN weight rules and exact tie/rounding behavior.

```ts
expect(calculateGrowthScore({ demand: 90, position: 100, ctrGap: 80, siteGap: 70, trendVisibility: 50 })).toMatchObject({
  score: 84,
  priority: 'HIGH',
  availableWeight: 100,
  evidenceQuality: 'COMPLETE',
  rankingEligible: true
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/growth.score.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `GROWTH_SCORE_V1`**

```ts
export const GROWTH_SCORE_V1 = {
  demand: 30,
  positionPotential: 25,
  ctrGap: 20,
  siteGap: 15,
  trendVisibility: 10
} as const;
```

Normalize only known weights; never substitute unknown with 0. Persist diagnostic normalized score for availableWeight 50–69 but mark `rankingEligible=false`; below 50 return authoritative score/priority null/UNKNOWN.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/unit/growth.score.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-score.ts tests/unit/growth.score.test.ts
git commit -m "feat: add deterministic growth score v1"
```

---

### Task 8: Opportunity Catalog Detection and Primary/Secondary Type Selection

**Files:**
- Create: `src/modules/growth/growth-detectors.ts`
- Test: `tests/unit/growth.detectors.test.ts`

**Interfaces:**
- Produces detection for `RANKING_UPSIDE`, `CTR_UNDERPERFORMANCE`, `SEO_GAP`, `GEO_CITABILITY_GAP`, `CONTENT_GAP`, `AI_VISIBILITY_GAP`, `DECLINING_PERFORMANCE`.
- Produces deterministic `selectPrimaryType(triggeredSignals)`.

- [ ] **Step 1: Write failing positive/negative boundary tests**

Examples: position 4 and 20 trigger ranking upside, 3 and 21 do not; CTR gap score >=30 triggers; INFO-only SEO does not; P5 UNKNOWN does not; decline threshold is >=5%; P6 gap needs known signal >=25.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/growth.detectors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement pure detectors and primary type selection**

Select the type with highest weighted contributing signal; use a fixed versioned catalog order only for exact ties.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/unit/growth.detectors.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/growth-detectors.ts tests/unit/growth.detectors.test.ts
git commit -m "feat: add growth opportunity catalog detectors"
```

---

### Task 9: Keyword Cannibalization and Conservative New Content Detectors

**Files:**
- Create: `src/modules/growth/cannibalization.ts`
- Create: `src/modules/growth/new-content.ts`
- Test: `tests/unit/growth.cannibalization.test.ts`
- Test: `tests/unit/growth.new-content.test.ts`

**Interfaces:**
- Produces `detectKeywordCannibalization(queryAggregate, context)`.
- Produces `detectNewContentOpportunity(queryAggregate, context)`.

- [ ] **Step 1: Write Cannibalization boundary tests**

Require Query Demand Score >=40, at least two canonical pages each >=20% share, no page >=80%, and ranking competition (`both <=30` OR position difference <=10). Canonically equivalent pages collapse. Cap at 20 pages.

- [ ] **Step 2: Write New Content boundary tests**

Require Demand >=65, Query impressions >= project P50, best page >20, no page >=70%, valid P3/P5 gap, no deterministic duplicate, and no active Cannibalization result for the same Query/window.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement deterministic primary-page candidate**

Tie-break in order: impressions share, better position, higher CTR, stronger deduplicated P3/P5 content/entity evidence; return UNKNOWN if still indistinguishable.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts`
Expected: PASS.

```bash
git add src/modules/growth/cannibalization.ts src/modules/growth/new-content.ts tests/unit/growth.cannibalization.test.ts tests/unit/growth.new-content.test.ts
git commit -m "feat: detect cannibalization and new content opportunities"
```

---

### Task 10: Growth Materialization, Topic Rollups and Lifecycle Reconciliation

**Files:**
- Create: `src/modules/growth/topic-cluster.ts`
- Create: `src/modules/growth/growth.service.ts`
- Create: `src/modules/growth/growth.worker.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/growth.topic-cluster.test.ts`
- Test: `tests/integration/growth.materialization.test.ts`
- Test: `tests/integration/growth.lifecycle.test.ts`

**Interfaces:**
- Produces queue `growth-materialization`.
- Produces `materializeGrowthWindow(projectId, asOfDate)` and `reconcileOpportunityLifecycle(...)`.

- [ ] **Step 1: Write failing end-to-end materialization test using only database fixtures**

Seed selected GSC source days + P2/P3/P5/P6 facts; stub Google/DeepSeek/P6 transports to throw if called; assert one immutable `GROWTH_OPPORTUNITY_V1` snapshot with exact provenance and no external calls.

- [ ] **Step 2: Write lifecycle tests**

Same stable identity across windows updates `latestSnapshotId`; two consecutive non-trigger windows AUTO_RESOLVE; DONE/RESOLVED recurrence AUTO_REOPEN; DISMISSED stays dismissed; system never auto-DONEs PLANNED/IN_PROGRESS.

- [ ] **Step 3: Write Topic tests**

P3 entity/topic relationship wins, configured alias fallback is deterministic, unresolved Query is `UNCLUSTERED`, Topic Score uses 50/30/20 known-weight normalization and member bounds.

- [ ] **Step 4: Verify RED**

Run: `npx vitest run tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement bounded materialization**

Enforce 50,000 candidates, 10,000 persisted snapshots/window, 2,000 clusters/project and 500 members/cluster. Job ID hashes project/formula/window/cutoff/selected-source IDs. Authoritative worker makes zero external calls.

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts`
Expected: PASS.

```bash
git add src/modules/growth src/queue tests/unit/growth.topic-cluster.test.ts tests/integration/growth.materialization.test.ts tests/integration/growth.lifecycle.test.ts
git commit -m "feat: materialize growth opportunities"
```

---

### Task 11: Growth/Search Console REST API and Feature Gates

**Files:**
- Create/Modify: `src/modules/growth/growth.routes.ts`
- Modify: `src/modules/search-console/search-console.routes.ts`
- Modify: existing plan/feature gate source discovered during implementation; add exact gates from spec
- Modify: `src/app.ts`
- Test: `tests/integration/growth.api.test.ts`
- Test: `tests/integration/search-console.api.test.ts`

**Interfaces:**
- Search Console prefix `/api/projects/:projectId/search-console`.
- Growth prefix `/api/projects/:projectId/growth`.

- [ ] **Step 1: Write failing gate/API tests**

Standard can connect/search basic ranking/CTR top opportunities only; Advanced gets full Opportunity/Topic/Cannibalization/New Content/history/lifecycle/AI explanation; Enterprise gets portfolio growth. Restricted routes must reject before restricted DB reads or queue side effects.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/integration/growth.api.test.ts tests/integration/search-console.api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement gates**

Add exact feature names: `SEARCH_CONSOLE`, `GROWTH_OPPORTUNITIES`, `GROWTH_TOPIC_CLUSTERS`, `GROWTH_CANNIBALIZATION`, `GROWTH_NEW_CONTENT`, `GROWTH_AI_EXPLANATION`, `PORTFOLIO_GROWTH`.

- [ ] **Step 4: Implement bounded routes**

Opportunity list page size max 100; detail exposes score breakdown/evidence/history; lifecycle mutations validate allowed state transition; GET routes do zero external calls and no materialization.

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/integration/growth.api.test.ts tests/integration/search-console.api.test.ts`
Expected: PASS.

```bash
git add src/app.ts src/modules/growth src/modules/search-console tests/integration/growth.api.test.ts tests/integration/search-console.api.test.ts
git commit -m "feat: expose P7-A growth APIs"
```

---

### Task 12: Search Console Settings and Growth Opportunity Web UI

**Files:**
- Create: `src/modules/search-console/search-console.web.routes.ts`
- Create: `src/modules/growth/growth.web.repository.ts`
- Create: `src/modules/growth/growth.web.routes.ts`
- Create: `src/views/projects/search-console.ejs`
- Create: `src/views/projects/growth-opportunities.ejs`
- Create: `src/views/projects/growth-opportunity-detail.ejs`
- Create: `src/views/projects/growth-topics.ejs`
- Create: `src/views/projects/growth-cannibalization.ejs`
- Create: `src/views/projects/growth-new-content.ejs`
- Modify: project navigation/shared views as required
- Test: `tests/integration/growth.web.test.ts`
- Test: `tests/integration/search-console.web.test.ts`
- Test: `tests/e2e/growth.spec.ts`

**Interfaces:**
- UI reads persisted data only; DeepSeek is a separate POST action.

- [ ] **Step 1: Write failing rendering tests**

Assert read-only GSC label, connection/sync states, Opportunity default ordering by `rankingEligible=true, score desc`, evidence quality display, current/previous windows, separated AI section, and no redirect/canonical execution action.

- [ ] **Step 2: Write browser smoke test**

Navigate settings → Growth Center → detail → Topics → Cannibalization/New Content filters using seeded fixtures.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/integration/growth.web.test.ts tests/integration/search-console.web.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement web repositories/routes/views**

Keep Query corpora bounded; render deterministic reasons and evidence separately from advisory AI output.

- [ ] **Step 5: Run integration and E2E tests**

Run: `npx vitest run tests/integration/growth.web.test.ts tests/integration/search-console.web.test.ts && npm run test:e2e -- --grep "Growth"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/search-console src/modules/growth src/views tests/integration tests/e2e/growth.spec.ts
git commit -m "feat: add P7-A Growth Opportunity Center"
```

---

### Task 13: Project and Portfolio Dashboard Growth Intelligence

**Files:**
- Modify: `src/web/dashboard.repository.ts`
- Modify: `src/web/routes.ts`
- Modify: relevant dashboard EJS templates under `src/views`
- Test: `tests/integration/dashboard.web.test.ts`
- Test: `tests/e2e/dashboard.spec.ts` or existing dashboard smoke file

**Interfaces:**
- Project dashboard reads persisted Growth summaries: top score, CRITICAL/HIGH counts, impression/click trend, top decline/ranking/cannibalization, GSC freshness.
- Enterprise portfolio uses bounded project summaries only.

- [ ] **Step 1: Add failing dashboard tests**

Seed Growth snapshots and assert dashboard renders real persisted facts; stub Google/DeepSeek to throw if called.

- [ ] **Step 2: Verify RED**

Run the existing dashboard integration test file with the new assertions.

- [ ] **Step 3: Extend repository/view models**

No recomputation in render path; if no eligible Growth snapshot exists, display explicit no-data state rather than zero scores.

- [ ] **Step 4: Run dashboard integration/E2E tests and commit**

```bash
git add src/web src/views tests/integration tests/e2e
git commit -m "feat: integrate growth intelligence into dashboards"
```

---

### Task 14: Optional DeepSeek `GROWTH_OPPORTUNITY_EXPLANATION`

**Files:**
- Create: `src/modules/ai/growth-opportunity-explanation.ts`
- Modify: AI task enum/model registration in `prisma/models/ai-gateway.prisma` and associated migration if required
- Modify: existing prompt registry and AI worker/task service files
- Modify: `src/modules/growth/growth.routes.ts`
- Test: `tests/unit/growth.ai.test.ts`
- Test: `tests/integration/growth.ai.test.ts`

**Interfaces:**
- Produces user-triggered advisory AI task `GROWTH_OPPORTUNITY_EXPLANATION`.

- [ ] **Step 1: Write failing bounded-input tests**

Assert input includes score/breakdown/current-previous aggregate metrics/selected deduped evidence/caveats/Topic context only; excludes OAuth tokens, raw P6 provider bodies/reasoning and unbounded Query lists.

- [ ] **Step 2: Write immutability test**

Run successful explanation and assert Growth identity/snapshot/score/evidence/lifecycle rows are byte-for-byte unchanged; only AI result/task rows change.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/unit/growth.ai.test.ts tests/integration/growth.ai.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement prompt/input/output contract via existing P4 Gateway**

Do not add a second DeepSeek client. Keep user-triggered POST separate from GET detail rendering.

- [ ] **Step 5: Run tests and commit**

```bash
git add prisma src/modules/ai src/modules/growth tests/unit/growth.ai.test.ts tests/integration/growth.ai.test.ts
git commit -m "feat: add advisory growth opportunity explanation"
```

---

### Task 15: Safe Observability, Operator Guide, Full Regression and P7-A Release Gate

**Files:**
- Complete: `src/modules/search-console/search-console.observability.ts`
- Complete: `src/modules/growth/growth.observability.ts`
- Create: `docs/development/p7a-growth-opportunity-intelligence.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml` only if needed to guarantee fixture-only Google behavior / exact-head gates
- Test: `tests/integration/growth.observability.test.ts`
- Test: `tests/integration/search-console.observability.test.ts`
- Test: full existing test suite

**Interfaces:**
- Safe events: `gsc.connection.connected`, `gsc.connection.revoked`, `gsc.property.bound`, `gsc.sync.started/completed/failed`, `growth.materialization.started/completed/failed`, `growth.lifecycle.changed`, `growth.ai_explanation.completed/failed`.

- [ ] **Step 1: Write failing observability allowlist tests**

Assert logs may contain project/internal property IDs, source dates/windows, counts, duration, state/reason/formula version; reject/token-scan OAuth credentials, full Query arrays, full evidence payloads, raw AI prompts/responses and P6 provider bodies/reasoning.

- [ ] **Step 2: Verify RED then implement allowlists**

Run focused observability tests, implement only metadata named in the spec, rerun to PASS.

- [ ] **Step 3: Write operator guide**

Document required env vars, Google OAuth callback configuration, read-only scope, credential key rotation/versioning, source freshness, 28-day/3-day window contract, resync/version behavior, hard bounds, queue names, failure reason codes, lifecycle semantics, unknown/partial behavior, rollback and incident triage.

- [ ] **Step 4: Run full fresh local verification**

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

Expected: every command exits 0; tests use Google fixtures/mocks only.

- [ ] **Step 5: Run release-specific invariants**

Verify duplicate daily sync idempotency, OAuth replay rejection, completed source/snapshot immutability, UNKNOWN non-zero-coercion, score determinism, root-cause dedupe, Cannibalization/New Content mutual exclusion, stable identity across primary-type changes, two-window resolve/reopen behavior, Standard/Advanced/Enterprise fail-before-read gates, and zero external calls during Growth GET/materialization.

- [ ] **Step 6: Update README milestone only after exact-head green evidence**

Mark P7-A complete only after exact-head CI `verify`, Chromium E2E and `production-audit` all succeed. Record exact head SHA and workflow run in the PR/release notes.

- [ ] **Step 7: Commit final release-gate docs**

```bash
git add src/modules/search-console src/modules/growth docs/development/p7a-growth-opportunity-intelligence.md README.md .github/workflows/ci.yml tests
git commit -m "docs: complete P7-A release gate"
```

---

## Plan Self-Review Checklist

Before implementation starts, the executor must confirm:

- [ ] Tasks 1–3 cover all Search Console/OAuth/source-fact requirements.
- [ ] Tasks 4–10 cover every deterministic score/detector/history/topic/lifecycle rule from the spec.
- [ ] Tasks 11–13 cover plan gates, REST, Growth Center, special views and dashboard integration.
- [ ] Task 14 uses the existing P4 Gateway only and cannot mutate deterministic P7 data.
- [ ] Task 15 proves safe observability and exact-head release evidence.
- [ ] No implementation task introduces P8 site mutation or P9 autonomous orchestration.
- [ ] No task treats missing GSC/P6/P2/P3/P5 evidence as zero/PASS.
- [ ] No live Google call is required by CI.

## Recommended PR/Review Strategy

Use one task-scoped branch/PR per independently reviewable task where practical. Tasks 1–5 are foundation and should merge sequentially; Tasks 6–9 depend on the Growth foundation and pure primitives; Task 10 integrates them; Tasks 11–15 build product surfaces and release evidence. Do not stack unrelated P8 work onto P7-A branches.
