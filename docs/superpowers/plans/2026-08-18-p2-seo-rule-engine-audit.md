# P2 SEO Rule Engine + Audit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic SEO audit layer on top of P1 crawl facts, producing versioned rule results, persistent issue lifecycle, explainable SEO scores, audit comparison, REST APIs and an actionable SEO Audit UI.

**Architecture:** P2 reads immutable P1 facts (`CrawlRun`, `Page`, `PageSnapshot`, `HttpResult`, `RobotsResult`, `SitemapSource`) and never rewrites them. A versioned rule registry evaluates facts into raw `SeoRuleResult` rows; failures aggregate into stable `SeoIssue` identities plus per-audit `SeoIssueOccurrence` snapshots. Scoring is deterministic and componentized. BullMQ runs audits asynchronously; Express APIs and EJS views expose the results. DeepSeek is explicitly excluded from fact detection and scoring.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL 17, Prisma 6.x, Redis 7, BullMQ, Zod, Vitest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-seo-geo-platform-design.md`

## Global Constraints

- P1 crawl facts are read-only inputs to P2.
- No SEO issue, affected-page count or SEO score may be invented by DeepSeek or another LLM.
- Rule definitions are versioned; an audit stores the exact rule version used.
- Raw rule results and user-facing issue aggregates remain separate data layers.
- Historical audit results are append-only; mutable lifecycle state is stored on stable issue identities.
- Severity values are exactly `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`.
- Severity multipliers are exactly: Critical `4.0`, High `2.5`, Medium `1.5`, Low `0.5`.
- P2 score baseline is `100`; score is clamped to `0..100`.
- The P2 score formula is deterministic: `penalty = weight × severityMultiplier × pageImpactFactor × importanceFactor`; P2 uses `importanceFactor = 1.0` until a later explicit page-importance model exists.
- `pageImpactFactor = affectedPages / max(1, eligiblePages)`, clamped to `0..1`.
- Rules that cannot determine a fact emit `UNKNOWN` or `NOT_APPLICABLE`; they must not silently become PASS.
- P2 does not implement GEO, DeepSeek AI Gateway, content generation, AI Visibility, Prompt monitoring or Citation monitoring.
- Follow existing module boundaries and EJS shell; do not restructure unrelated P0/P1 code.

---

## File/Module Map

P2 introduces one new bounded module, `src/modules/seo/`, split by responsibility:

- `seo.types.ts` — shared deterministic domain types and enums used by engine/repository/API.
- `rule-catalog.ts` — immutable built-in rule metadata and active version definitions.
- `rule-registry.ts` — maps `ruleCode` to pure evaluator functions.
- `rules/page-rules.ts` — page-local deterministic rules from `PageSnapshot`/`HttpResult`.
- `rules/crawl-rules.ts` — crawl/project-level rules from robots/sitemap facts.
- `seo.repository.ts` — Prisma persistence and audit input queries only.
- `audit-engine.ts` — audit orchestration: load facts → evaluate → persist → aggregate → score.
- `issue-service.ts` — stable issue identity, occurrence comparison and lifecycle sync.
- `score-engine.ts` — severity multipliers, score components, deterministic penalty math.
- `seo.schema.ts` — REST input/pagination schemas.
- `seo.routes.ts` — REST API endpoints.
- `seo.worker.ts` — BullMQ job processor for `seo-audit`.
- `seo.web.repository.ts` — read models for EJS views.

New EJS views:

- `src/views/seo/audit.ejs`
- `src/views/seo/issues.ejs`
- `src/views/seo/issue-show.ejs`
- `src/views/seo/compare.ejs`

Prisma adds audit/rule/result/issue/score models while retaining all existing P1 tables unchanged.

---

### Task 1: SEO Audit Persistence Foundation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_seo_audit_foundation/migration.sql`
- Test: `tests/integration/seo.persistence.test.ts`

**Interfaces:**
- Produces Prisma models: `SeoAuditRun`, `SeoRule`, `SeoRuleVersion`, `SeoRuleResult`, `SeoIssue`, `SeoIssueOccurrence`, `SeoIssuePage`, `SeoScore`, `SeoScoreComponent`.
- Later tasks rely on unique keys described below.

**Required schema decisions:**

```text
SeoAuditRun
  id UUID PK
  projectId UUID FK Project
  crawlRunId UUID FK CrawlRun
  status QUEUED|RUNNING|COMPLETED|FAILED|CANCELLED
  startedAt? finishedAt? errorMessage?
  engineVersion String
  eligiblePages Int default 0
  rulesEvaluated Int default 0
  createdAt updatedAt
  unique(projectId, crawlRunId)

SeoRule
  id UUID PK
  ruleCode String unique
  name String
  category String
  description String
  enabled Boolean default true
  createdAt updatedAt

SeoRuleVersion
  id UUID PK
  seoRuleId UUID FK
  version Int
  severity CRITICAL|HIGH|MEDIUM|LOW
  weight Float
  detectionType String
  detectionConfig Json?
  seoImpact String
  fixGuide String
  releasedAt DateTime
  deprecatedAt DateTime?
  unique(seoRuleId, version)

SeoRuleResult
  id UUID PK
  auditRunId UUID FK
  pageId UUID? FK Page
  ruleVersionId UUID FK
  outcome PASS|FAIL|UNKNOWN|NOT_APPLICABLE
  evidence Json?
  createdAt
  unique(auditRunId, pageId, ruleVersionId) where Prisma-supported identity uses a synthetic resultKey if nullable uniqueness is ambiguous

SeoIssue
  id UUID PK
  projectId UUID FK
  ruleId UUID FK
  issueKey String
  title String
  category String
  currentSeverity CRITICAL|HIGH|MEDIUM|LOW
  status OPEN|IN_PROGRESS|PARTIALLY_FIXED|RESOLVED|IGNORED|REGRESSED
  firstSeenAt lastSeenAt
  resolvedAt? ignoredAt?
  createdAt updatedAt
  unique(projectId, issueKey)

SeoIssueOccurrence
  id UUID PK
  seoIssueId UUID FK
  auditRunId UUID FK
  ruleVersionId UUID FK
  comparison NEW|PERSISTENT|REGRESSED
  severity CRITICAL|HIGH|MEDIUM|LOW
  affectedPagesCount Int
  evidenceSummary Json?
  createdAt
  unique(seoIssueId, auditRunId)

SeoIssuePage
  id UUID PK
  issueOccurrenceId UUID FK
  pageId UUID FK
  ruleResultId UUID FK
  evidence Json?
  unique(issueOccurrenceId, pageId)

SeoScore
  id UUID PK
  auditRunId UUID unique FK
  projectId UUID FK
  score Float
  previousScore Float?
  change Float?
  calculatedAt
  engineVersion String

SeoScoreComponent
  id UUID PK
  seoScoreId UUID FK
  componentCode String
  componentName String
  affectedPages Int
  eligiblePages Int
  pageImpactFactor Float
  severityMultiplier Float
  weight Float
  importanceFactor Float default 1
  penalty Float
  ruleVersionId UUID FK
  unique(seoScoreId, ruleVersionId)
```

- [ ] **Step 1: Write the failing persistence test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('SEO audit persistence', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('stores an audit run tied to one completed crawl without mutating crawl facts', async () => {
    const project = await prisma.project.create({
      data: { name: 'SEO Fixture', slug: `seo-${Date.now()}`, primaryDomain: 'example.com' }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
        crawlerVersion: '0.1.0'
      }
    });

    const audit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'QUEUED',
        engineVersion: '0.1.0'
      }
    });

    expect(audit.projectId).toBe(project.id);
    expect(audit.crawlRunId).toBe(crawl.id);
    expect(await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawl.id } })).toMatchObject({ status: 'COMPLETED' });
  });
});
```

- [ ] **Step 2: Run CI and verify RED**

Run through PR CI. Expected: TypeScript/Prisma failure because SEO models do not yet exist.

- [ ] **Step 3: Add enums/models and migration**

Add exact models above plus reverse relations on `Project`, `CrawlRun` and `Page`. Do not alter P1 factual columns.

- [ ] **Step 4: Run Prisma + tests**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma tests/integration/seo.persistence.test.ts
git commit -m "feat: add SEO audit persistence foundation"
```

---

### Task 2: Versioned Rule Catalog and Pure Evaluator Contract

**Files:**
- Create: `src/modules/seo/seo.types.ts`
- Create: `src/modules/seo/rule-catalog.ts`
- Create: `src/modules/seo/rule-registry.ts`
- Create: `src/modules/seo/rules/page-rules.ts`
- Test: `tests/unit/seo.page-rules.test.ts`

**Interfaces:**

```ts
export type SeoRuleOutcome = 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';

export interface SeoPageFact {
  pageId: string;
  normalizedUrl: string;
  statusCode: number | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  metaRobots: string | null;
  h1: string | null;
  h1Count: number;
  wordCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  responseTimeMs: number | null;
  htmlSizeBytes: number | null;
  indexable: boolean | null;
}

export interface RuleEvaluation {
  outcome: SeoRuleOutcome;
  evidence: Record<string, unknown>;
}

export type PageRuleEvaluator = (fact: SeoPageFact) => RuleEvaluation;

export function getPageRuleEvaluator(ruleCode: string): PageRuleEvaluator;
```

**Initial active page rules and versions:**

| Rule code | Severity | Weight | Deterministic condition |
|---|---:|---:|---|
| `HTTP_5XX` | CRITICAL | 4 | status 500–599 |
| `HTTP_4XX` | HIGH | 3 | status 400–499 |
| `HTTP_REDIRECT` | MEDIUM | 1 | status 300–399 |
| `TITLE_MISSING` | HIGH | 3 | 2xx HTML page and empty title |
| `TITLE_TOO_SHORT` | LOW | 1 | title length 1–19 |
| `TITLE_TOO_LONG` | MEDIUM | 1.5 | title length > 60 |
| `META_DESCRIPTION_MISSING` | MEDIUM | 2 | 2xx HTML page and empty description |
| `META_DESCRIPTION_TOO_LONG` | LOW | 1 | description length > 160 |
| `H1_MISSING` | MEDIUM | 2 | 2xx HTML page and h1Count = 0 |
| `H1_MULTIPLE` | LOW | 1 | h1Count > 1 |
| `CANONICAL_MISSING` | MEDIUM | 1.5 | indexable 2xx HTML page and empty canonical |
| `THIN_CONTENT` | MEDIUM | 1.5 | indexable 2xx HTML page and wordCount < 200 |
| `IMAGE_ALT_MISSING` | LOW | 1 | imagesWithoutAlt > 0 |
| `SLOW_RESPONSE` | MEDIUM | 1.5 | responseTimeMs > 3000 |
| `HTML_TOO_LARGE` | MEDIUM | 1.5 | htmlSizeBytes > 2,000,000 |

Rules that require HTML content must return `NOT_APPLICABLE` for non-2xx/unknown facts rather than manufacturing a PASS.

- [ ] **Step 1: Write failing pure-rule tests**

```ts
it('marks a missing title as FAIL only when the page is an eligible 2xx document', () => {
  const evaluate = getPageRuleEvaluator('TITLE_MISSING');
  expect(evaluate({ ...baseFact, statusCode: 200, title: null }).outcome).toBe('FAIL');
  expect(evaluate({ ...baseFact, statusCode: 404, title: null }).outcome).toBe('NOT_APPLICABLE');
  expect(evaluate({ ...baseFact, statusCode: null, title: null }).outcome).toBe('UNKNOWN');
});

it('records exact evidence for a slow response', () => {
  const result = getPageRuleEvaluator('SLOW_RESPONSE')({ ...baseFact, responseTimeMs: 4200 });
  expect(result).toEqual({ outcome: 'FAIL', evidence: { responseTimeMs: 4200, thresholdMs: 3000 } });
});
```

- [ ] **Step 2: Verify RED**

Expected failure: module/functions absent.

- [ ] **Step 3: Implement catalog + pure evaluators**

`rule-catalog.ts` exports immutable metadata including `ruleCode`, `name`, `category`, `version`, `severity`, `weight`, `seoImpact`, `fixGuide`.

`rule-registry.ts` must throw for an unknown rule code; it must never silently skip a configured rule.

- [ ] **Step 4: Run unit tests**

```bash
npm test -- tests/unit/seo.page-rules.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/seo tests/unit/seo.page-rules.test.ts
git commit -m "feat: add versioned deterministic SEO page rules"
```

---

### Task 3: Rule Catalog Synchronization and Audit Fact Repository

**Files:**
- Create: `src/modules/seo/seo.repository.ts`
- Create: `src/modules/seo/rule-sync.ts`
- Test: `tests/integration/seo.rule-sync.test.ts`
- Test: `tests/integration/seo.audit-input.test.ts`

**Interfaces:**

```ts
export async function syncBuiltinRules(): Promise<Map<string, { ruleId: string; ruleVersionId: string }>>;

export interface AuditInput {
  auditRunId: string;
  projectId: string;
  crawlRunId: string;
  pages: SeoPageFact[];
  robots: Array<{ statusCode: number | null; parseError: string | null }>;
  sitemaps: Array<{ statusCode: number | null; type: string | null; parseError: string | null; discoveredUrlCount: number }>;
}

export interface SeoRepository {
  getAuditInput(auditRunId: string): Promise<AuditInput>;
  createRuleResults(rows: PersistedRuleResult[]): Promise<void>;
  // persistence methods used by Tasks 4–6
}
```

- [ ] **Step 1: Write failing tests** verifying that re-running sync is idempotent and that a rule version change creates a new `SeoRuleVersion` rather than overwriting version 1.

- [ ] **Step 2: Verify RED**.

- [ ] **Step 3: Implement `syncBuiltinRules()`** using upsert for rule identity and create-if-missing for `(ruleId, version)`.

- [ ] **Step 4: Implement `getAuditInput()`** so it loads only snapshots belonging to the audit's `crawlRunId`, including no later/older snapshot for the same Page.

- [ ] **Step 5: Test exact-run isolation**

```ts
expect(input.pages.map((p) => p.pageId)).toEqual([pageFromSelectedCrawl.id]);
expect(input.pages).not.toContainEqual(expect.objectContaining({ pageId: pageFromLaterCrawl.id }));
```

- [ ] **Step 6: Run integration suite and commit**.

---

### Task 4: Deterministic Audit Engine and Raw Rule Results

**Files:**
- Create: `src/modules/seo/audit-engine.ts`
- Extend: `src/modules/seo/seo.repository.ts`
- Test: `tests/integration/seo.audit-engine.test.ts`

**Interfaces:**

```ts
export interface RunSeoAuditOptions {
  repository?: SeoRepository;
  engineVersion?: string;
}

export async function executeSeoAudit(auditRunId: string, options?: RunSeoAuditOptions): Promise<void>;
```

**Required behavior:**

1. Load audit and verify linked crawl is `COMPLETED`.
2. Mark audit `RUNNING`.
3. Sync built-in rules and freeze active rule versions for this run.
4. Evaluate every eligible page against every active page rule.
5. Persist `PASS`, `FAIL`, `UNKNOWN`, `NOT_APPLICABLE` results with evidence.
6. Continue to Task 5 issue aggregation and Task 6 scoring through explicit services; do not embed UI logic.
7. Mark `COMPLETED`; on an exception mark `FAILED` with sanitized error text.

- [ ] **Step 1: Write failing integration test** with a crawl containing a 200 page missing title and a 404 page.

Expected assertions:

```ts
expect(await prisma.seoRuleResult.count({ where: { auditRunId: audit.id } })).toBeGreaterThan(0);
expect(await prisma.seoRuleResult.findFirst({
  where: { auditRunId: audit.id, pageId: home.id, ruleVersion: { seoRule: { ruleCode: 'TITLE_MISSING' } } }
})).toMatchObject({ outcome: 'FAIL' });
```

- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement minimal engine and persistence batch writes**.
- [ ] **Step 4: Add failure-path test** proving audit becomes `FAILED` while P1 snapshot remains unchanged.
- [ ] **Step 5: Run test/typecheck and commit**.

---

### Task 5: Issue Aggregation, Stable Identity and Audit Comparison

**Files:**
- Create: `src/modules/seo/issue-service.ts`
- Extend: `src/modules/seo/seo.repository.ts`
- Test: `tests/integration/seo.issue-lifecycle.test.ts`

**Interfaces:**

```ts
export async function syncAuditIssues(auditRunId: string, repository?: SeoRepository): Promise<void>;

export interface AuditIssueComparison {
  issueKey: string;
  comparison: 'NEW' | 'PERSISTENT' | 'REGRESSED';
}
```

**Identity rule:**

For P2 page-aggregate rules, stable `issueKey` is exactly `rule:<RULE_CODE>`. One project therefore has one stable aggregate issue per rule. Per-page evidence lives in `SeoIssuePage`; the stable issue does not duplicate page-level evidence.

**Lifecycle behavior:**

- First failing audit → stable issue status `OPEN`; occurrence `NEW`.
- Fails in immediately previous audit → status remains existing actionable state; occurrence `PERSISTENT`.
- Was absent in previous audit after previously being seen/resolved → stable status `REGRESSED`; occurrence `REGRESSED`.
- Previously failing issue absent from current audit → stable status becomes `RESOLVED` and sets `resolvedAt`.
- `IGNORED` is user state and is not automatically changed to OPEN while the same issue persists. If an ignored issue disappears, it may remain IGNORED with `resolvedAt` set only when product policy explicitly changes; P2 keeps IGNORED stable.
- Reappearance after a previously `RESOLVED` state changes it to `REGRESSED`.

- [ ] **Step 1: Write a three-audit lifecycle test**: audit A fail → audit B pass → audit C fail.

```ts
expect(aOccurrence.comparison).toBe('NEW');
expect(afterB.status).toBe('RESOLVED');
expect(cOccurrence.comparison).toBe('REGRESSED');
expect(afterC.status).toBe('REGRESSED');
```

- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement aggregation from raw FAIL results only**.
- [ ] **Step 4: Persist occurrence and page evidence; update stable lifecycle state in a transaction**.
- [ ] **Step 5: Add persistent/ignored tests and commit**.

---

### Task 6: Explainable SEO Score and Components

**Files:**
- Create: `src/modules/seo/score-engine.ts`
- Extend: `src/modules/seo/seo.repository.ts`
- Test: `tests/unit/seo.score-engine.test.ts`
- Test: `tests/integration/seo.score-persistence.test.ts`

**Interfaces:**

```ts
export const SEVERITY_MULTIPLIER = {
  CRITICAL: 4,
  HIGH: 2.5,
  MEDIUM: 1.5,
  LOW: 0.5
} as const;

export function calculateRulePenalty(input: {
  weight: number;
  severity: keyof typeof SEVERITY_MULTIPLIER;
  affectedPages: number;
  eligiblePages: number;
  importanceFactor?: number;
}): ScoreComponentCalculation;

export async function calculateAndPersistSeoScore(auditRunId: string, repository?: SeoRepository): Promise<void>;
```

**Formula:**

```ts
pageImpactFactor = clamp(affectedPages / Math.max(1, eligiblePages), 0, 1)
importanceFactor = 1
penalty = weight * severityMultiplier * pageImpactFactor * importanceFactor
score = clamp(100 - sum(penalty), 0, 100)
```

`UNKNOWN`, `PASS`, `NOT_APPLICABLE` results contribute zero penalty. A rule contributes at most one project-level component per audit, based on the number of FAIL pages for that rule.

- [ ] **Step 1: Write pure math tests**, including zero eligible pages and 100-point lower clamp.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement pure calculation**.
- [ ] **Step 4: Persist one component per failing rule and previous score/change**.
- [ ] **Step 5: Verify re-running score persistence for the same audit is idempotent**.
- [ ] **Step 6: Commit**.

---

### Task 7: Crawl-Level Technical Rules (robots + sitemap)

**Files:**
- Create: `src/modules/seo/rules/crawl-rules.ts`
- Modify: `src/modules/seo/rule-catalog.ts`
- Modify: `src/modules/seo/rule-registry.ts`
- Modify: `src/modules/seo/audit-engine.ts`
- Test: `tests/unit/seo.crawl-rules.test.ts`
- Test: `tests/integration/seo.crawl-rules.test.ts`

**Initial crawl rules:**

| Rule code | Severity | Weight | Condition |
|---|---:|---:|---|
| `ROBOTS_FETCH_FAILED` | LOW | 1 | robots request has no factual status because transport failed |
| `ROBOTS_SERVER_ERROR` | MEDIUM | 1.5 | robots status 500–599 |
| `SITEMAP_UNAVAILABLE` | LOW | 1 | no usable sitemap source discovered/fetched |
| `SITEMAP_PARSE_ERROR` | MEDIUM | 1.5 | sitemap fetched but parseError is non-null |
| `SITEMAP_EMPTY` | LOW | 1 | usable URLSET reports zero discovered URLs |

A 404 robots.txt response is **not** automatically an error: absence of robots.txt means no crawl restrictions and should not be scored as a high-severity problem.

Crawl-level rule result has `pageId = null` and a deterministic synthetic uniqueness key `crawl:<RULE_CODE>` if needed by persistence.

- [ ] **Step 1: Write tests proving robots 404 is PASS/NOT_APPLICABLE rather than FAIL**.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Add pure crawl evaluators and catalog versions**.
- [ ] **Step 4: Persist null-page raw results and aggregate them into stable issues without fake affected page URLs**.
- [ ] **Step 5: Run full SEO suite and commit**.

---

### Task 8: BullMQ SEO Audit Worker and REST API

**Files:**
- Create: `src/modules/seo/seo.schema.ts`
- Create: `src/modules/seo/seo.routes.ts`
- Create: `src/modules/seo/seo.worker.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/app.ts` or existing API route registration file
- Test: `tests/integration/seo.api.test.ts`
- Test: `tests/unit/seo.worker.test.ts`

**Interfaces / endpoints:**

```http
POST /api/projects/:projectId/seo-audits
GET  /api/projects/:projectId/seo/summary
GET  /api/projects/:projectId/seo/audits
GET  /api/seo/audits/:auditRunId
GET  /api/projects/:projectId/seo/issues?severity=&status=&limit=&offset=
GET  /api/seo/issues/:issueId
PATCH /api/seo/issues/:issueId/status
GET  /api/projects/:projectId/seo/compare?currentAuditId=&previousAuditId=
```

**Create audit request:**

```json
{
  "crawlRunId": "uuid"
}
```

If omitted, service selects the latest `COMPLETED` crawl for the project. Creating an audit for a non-completed crawl returns HTTP 409. Re-requesting the same `(projectId,crawlRunId)` returns the existing audit id and does not enqueue duplicate work.

BullMQ job id is deterministic: `seo-audit:<auditRunId>`.

- [ ] **Step 1: Write failing API tests** for create, duplicate/idempotent create, non-completed crawl rejection and issue status mutation validation.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement schemas/routes** with no scoring logic inside controllers.
- [ ] **Step 4: Implement `processSeoAuditJob({ auditRunId })` calling `executeSeoAudit`**.
- [ ] **Step 5: Replace the current placeholder `seo-audit` worker in `worker-bootstrap.ts` with the real processor**; leave unrelated queues untouched.
- [ ] **Step 6: Run API/worker tests and commit**.

---

### Task 9: SEO Audit Dashboard, Issue Center and Issue Detail UI

**Files:**
- Create: `src/modules/seo/seo.web.repository.ts`
- Create: `src/views/seo/audit.ejs`
- Create: `src/views/seo/issues.ejs`
- Create: `src/views/seo/issue-show.ejs`
- Modify: `src/web/routes.ts`
- Modify: `src/views/layout.ejs` only if navigation links require actual href wiring
- Modify: project view/tab links as needed without redesigning shell
- Test: `tests/integration/seo.web.test.ts`
- Test: `tests/e2e/seo-audit.spec.ts`

**Routes:**

```text
/projects/:projectId/seo
/projects/:projectId/seo/issues
/seo/issues/:issueId
```

**SEO Audit page must show:**

- SEO Score and change from previous audit.
- Audit status, crawl source and completion time.
- Severity counts: Critical / High / Medium / Low.
- Rule component table: rule, severity, affected pages, impact %, penalty.
- Top issues table with issue status and affected-page count.
- CTA to start audit from latest completed crawl.
- No DeepSeek panel in P2 factual audit implementation.

**Issue Detail page must show:**

- Rule name/code/version/severity/category.
- Deterministic detection explanation.
- Evidence and affected page URLs from the selected/latest occurrence.
- First seen / last seen / current lifecycle status.
- `seoImpact` and deterministic `fixGuide` from rule version.
- Status actions: OPEN, IN_PROGRESS, PARTIALLY_FIXED, IGNORED. `RESOLVED` cannot be manually asserted as factual fix verification; it is set by a later audit that no longer detects the issue.

- [ ] **Step 1: Write integration tests expecting 200 pages with factual issue data**.
- [ ] **Step 2: Verify RED because views/routes are absent**.
- [ ] **Step 3: Implement web read models and EJS templates**.
- [ ] **Step 4: Add Playwright E2E** creating fixture DB state before browser navigation; do not crawl public internet in CI.
- [ ] **Step 5: Run integration + browser tests and commit**.

---

### Task 10: Audit Compare UI and Regression View

**Files:**
- Create: `src/views/seo/compare.ejs`
- Extend: `src/modules/seo/seo.web.repository.ts`
- Modify: `src/web/routes.ts`
- Test: `tests/integration/seo.compare.web.test.ts`

**Route:**

```text
/projects/:projectId/seo/compare?current=<auditId>&previous=<auditId>
```

**Comparison groups:**

- `NEW`: present current, absent previous, not a reappearance after an older resolution.
- `PERSISTENT`: present current and previous.
- `REGRESSED`: present current, absent previous, but stable issue existed before and had resolved.
- `FIXED`: present previous, absent current.

The compare page derives groups from stored audit occurrences/stable issue history. It does not infer changes by comparing HTML text ad hoc.

- [ ] **Step 1: Write failing compare read-model test** with A/B/C audits.
- [ ] **Step 2: Implement compare repository query** returning exact group arrays.
- [ ] **Step 3: Implement EJS view with counts and links to issue details**.
- [ ] **Step 4: Run tests and commit**.

---

### Task 11: P2 Observability, Documentation and Final Release Gate

**Files:**
- Modify: `src/modules/seo/audit-engine.ts`
- Modify: `README.md`
- Create: `docs/development/p2-seo-audit.md`
- Modify: `.github/workflows/ci.yml` only if required to add deterministic SEO browser smoke coverage; retain P1 `verify`, `production-audit`, `e2e` gates.
- Test: `tests/integration/seo.observability.test.ts`

**Structured events:**

```text
seo.audit.started
seo.rule.evaluated.summary
seo.issues.synced
seo.score.calculated
seo.audit.completed
seo.audit.failed
```

Logs may contain ids, rule codes, counts, score and sanitized errors. Do not log raw HTML, authorization/session data, page query strings, full evidence payloads containing page content, or database connection strings.

- [ ] **Step 1: Write failing observability test** expecting `seo.audit.started` and `seo.audit.completed` during a successful fixture audit.
- [ ] **Step 2: Implement structured event logging with sanitized fields**.
- [ ] **Step 3: Write P2 operations documentation** explaining rule versioning, score formula, lifecycle semantics, rerun behavior and P1/P2 ownership boundary.
- [ ] **Step 4: Run full release gate**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: all green in GitHub Actions using PostgreSQL 17 + Redis 7 + Chromium.

- [ ] **Step 5: Confirm production runtime audit remains green** and no new high-severity runtime dependency was introduced.

- [ ] **Step 6: Review changed files for scope**: no GEO, DeepSeek, AI Visibility, Prompt or Citation code.

- [ ] **Step 7: Merge P2 only after all CI gates are green**.

---

## P2 Acceptance Criteria

P2 is complete only when all of the following are true:

1. A completed P1 crawl can produce a P2 SEO audit without modifying P1 facts.
2. Rules are deterministic, versioned and reproducible.
3. Raw `SeoRuleResult` rows are retained separately from issue aggregates.
4. Issue identity remains stable across audits while per-audit occurrences remain historical.
5. New, Persistent, Fixed and Regressed states are demonstrably correct across at least three audits.
6. SEO Score is reproducible from persisted score components and the documented formula.
7. Unknown facts do not become PASS and do not create invented penalties.
8. REST API supports audit creation, summary, history, issue filtering/detail/status and compare.
9. EJS UI provides SEO Audit, Issue Center, Issue Detail and Audit Compare.
10. Manual user action cannot falsely mark an issue RESOLVED; a later deterministic audit verifies resolution.
11. BullMQ `seo-audit` is a real worker, not the P0 placeholder.
12. CI `verify`, runtime security audit and Chromium E2E all pass.
13. No DeepSeek/LLM code participates in rule truth, affected-page counts or score calculation.

## Implementation Order

Execute Tasks 1 → 11 sequentially. Each task uses its own feature branch and PR when practical. After a task is green and reviewed, merge it into `main`; create the next task branch from the new `main`. This preserves the same discipline used in P1 and keeps regressions attributable to one bounded change.
