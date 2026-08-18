# P5-A Content Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic owned-content intelligence layer with versioned content opportunities and bounded DeepSeek briefs/optimization, without allowing AI output to overwrite P1/P2/P3 facts.

**Architecture:** P5-A reads persisted owned-site facts from P1/P2/P3, materializes project-scoped `ContentDocument` facts, evaluates versioned deterministic `ContentSignal`/`ContentOpportunity` rules, and uses the existing P4 AI task/Gateway only for advisory briefs and optimization. Project-wide refreshes use a dedicated BullMQ `content` queue; paid AI calls continue through the existing `ai` queue with P4 idempotency/retry semantics.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL, Prisma 6.x, Redis/BullMQ, Zod, Vitest, Supertest, Playwright, existing P4 DeepSeek AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-19-p5a-content-intelligence-design.md`

## Global Constraints

- P1/P2/P3 deterministic facts remain authoritative; P5-A references them rather than creating conflicting SEO/GEO truth.
- P5-A cannot mark P2 SEO issues resolved or P3 GEO readiness fixed.
- `UNKNOWN` is preserved when source facts are unavailable.
- Content AI calls must use the existing P4 `AiTask -> AI Gateway -> Provider -> DeepSeek` path.
- No business module imports/calls the DeepSeek provider directly.
- No live DeepSeek calls in CI.
- AI inputs are bounded; never send cookies, auth headers, sessions, secrets, unlimited raw HTML, or provider `reasoning_content`.
- AI output is advisory and source-referenced; returned source refs must exist in the supplied fact packet.
- P5-A feature gate is exactly `CONTENT_INTELLIGENCE`, available to STANDARD/ADVANCED/ENTERPRISE.
- P5-A does not crawl competitors (P5-B), build cross-module reports (P5-C), or perform P6 Prompt/Citation/Visibility/SOV sampling.
- Project-wide content refreshes use a dedicated BullMQ queue named `content`.

---

## File Structure

### Persistence
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_content_intelligence_foundation/migration.sql`

### Content module
- Create: `src/modules/content/content.types.ts`
- Create: `src/modules/content/content.repository.ts`
- Create: `src/modules/content/content-facts.ts`
- Create: `src/modules/content/content-rules.ts`
- Create: `src/modules/content/content.service.ts`
- Create: `src/modules/content/content.worker.ts`
- Create: `src/modules/content/content-observability.ts`
- Create: `src/modules/content/content.routes.ts`

### AI integration
- Create: `src/modules/ai/content-intelligence.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: AI task-type schema/contracts only where required to add `CONTENT_BRIEF` and `CONTENT_OPTIMIZATION_ANALYSIS`.

### Queue / app / web
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/app.ts`
- Modify: `src/auth/feature-flags.ts`
- Modify: `src/web/routes.ts`
- Create: `src/modules/content/content.web.repository.ts`
- Create: `src/views/content/index.ejs`
- Create: `src/views/content/document-show.ejs`
- Create: `src/views/content/brief-show.ejs`

### Tests / docs
- Create: focused unit/integration tests under `tests/unit/content*` and `tests/integration/content*`
- Create: `tests/e2e/content-intelligence.spec.ts`
- Create: `docs/development/p5a-content-intelligence.md`
- Modify: `README.md`

---

### Task 1: Durable Content Intelligence persistence foundation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_content_intelligence_foundation/migration.sql`
- Test: `tests/integration/content.persistence.test.ts`

**Interfaces:**
- Produces enums `ContentSignalStatus`, `ContentPriority`, `ContentOpportunityStatus`.
- Produces models `ContentDocument`, `ContentSignal`, `ContentOpportunity`, `ContentBrief`.
- `ContentDocument` owns deterministic content facts for one project/page and references one latest `PageSnapshot`.
- `ContentBrief` references an existing P4 `AiTask`; it does not create a second provider-call persistence system.

- [ ] **Step 1: Write RED persistence contract**

Test creates a project/page/snapshot, then a `ContentDocument` with unique `(projectId,pageId)`, a versioned signal, an opportunity, and a brief linked to an `AiTask`. Assert duplicate document identity fails and deleting P5 rows does not delete Page/PageSnapshot/SEO/GEO/AI history.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/integration/content.persistence.test.ts`
Expected: Prisma/type failure because P5-A models do not exist.

- [ ] **Step 3: Add schema**

Use these durable semantics:

```prisma
enum ContentSignalStatus { PASS FAIL UNKNOWN }
enum ContentPriority { HIGH MEDIUM LOW INFO }
enum ContentOpportunityStatus { OPEN IN_PROGRESS IGNORED VERIFIED_FIXED }

model ContentDocument {
  id                   String   @id @default(uuid()) @db.Uuid
  projectId            String   @db.Uuid
  pageId               String   @db.Uuid
  latestPageSnapshotId String   @db.Uuid
  canonicalUrl         String
  title                String?
  metaDescription      String?
  h1                   String?
  language             String?
  wordCount            Int?
  headingCount         Int?
  listCount            Int?
  tableCount           Int?
  imageCount           Int?
  internalLinkCount    Int?
  externalLinkCount    Int?
  schemaTypes          Json
  contentHash          String
  extractedAt          DateTime
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  @@unique([projectId, pageId])
  @@index([projectId, updatedAt])
}
```

Add relations to Project/Page/PageSnapshot. `ContentSignal` stores `ruleKey`, `ruleVersion`, `status`, `priority`, bounded numeric/text values and JSON source references. `ContentOpportunity` stores stable `(contentDocumentId, opportunityKey, opportunityVersion)` identity, category, priority/status, summary, source refs and detection/fix timestamps. `ContentBrief` links one `contentDocumentId?` and one unique `aiTaskId`, stores `promptVersion`, `factSnapshotHash`, validated `briefJson` and source refs. Entity support is derived via existing P3 `PageEntity`/`EntityObservation`; do not duplicate entity IDs as a mutable JSON authority on `ContentDocument`.

- [ ] **Step 4: Add migration and verify Prisma**

Run: `npx prisma validate && npx prisma generate && npx prisma migrate deploy`
Expected: success.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- --run tests/integration/content.persistence.test.ts && npm run typecheck`
Expected: success.

- [ ] **Step 6: Commit**

Commit: `feat: add P5-A content persistence foundation`

---

### Task 2: Deterministic Content Fact extraction

**Files:**
- Create: `src/modules/content/content.types.ts`
- Create: `src/modules/content/content-facts.ts`
- Create: `src/modules/content/content.repository.ts`
- Test: `tests/unit/content.facts.test.ts`
- Test: `tests/integration/content.refresh.repository.test.ts`

**Interfaces:**
- Produces `buildContentFacts(input): ContentFacts`.
- Produces repository methods `listLatestOwnedPageSources(projectId)` and `upsertContentDocument(facts)`.
- Facts are derived only from persisted Page/PageSnapshot plus existing P3 page/entity relationships.

- [ ] Write tests covering latest snapshot selection, null/UNKNOWN preservation, title/H1/language/word/link/image/schema counts, stable content hash and project isolation.
- [ ] Run RED: `npm test -- --run tests/unit/content.facts.test.ts tests/integration/content.refresh.repository.test.ts`.
- [ ] Implement the minimal extractor/repository; `headingCount` is deterministic `h1Count+h2Count+h3Count`; counts unavailable in source remain null rather than guessed; schema types come from persisted structured signals where available and otherwise empty with explicit source status.
- [ ] Run GREEN plus `npm run typecheck`.
- [ ] Commit: `feat: add deterministic P5-A content facts`.

---

### Task 3: Versioned Content Signal and Opportunity engine

**Files:**
- Create: `src/modules/content/content-rules.ts`
- Modify: `src/modules/content/content.repository.ts`
- Test: `tests/unit/content.rules.test.ts`
- Test: `tests/integration/content.opportunities.test.ts`

**Interfaces:**
- Produces immutable `CONTENT_RULESET_V1`.
- Produces `evaluateContentDocument(document, relatedFacts): EvaluatedContentRule[]`.
- Produces stable opportunity keys from document identity + rule key/version.

- [ ] Write RED tests for `CONTENT_TITLE_PRESENT`, `CONTENT_H1_PRESENT`, `CONTENT_META_DESCRIPTION_PRESENT`, `CONTENT_BODY_SUBSTANTIVE`, `CONTENT_HEADING_STRUCTURE`, `CONTENT_INTERNAL_LINK_SUPPORT`, `CONTENT_STRUCTURED_DATA_SUPPORT`, `CONTENT_ENTITY_SUPPORT`, `CONTENT_CITABILITY_SUPPORT`.
- [ ] Assert unavailable inputs map to `UNKNOWN`, not zero/fail.
- [ ] Assert duplicated P2/P3 defects are referenced through source refs rather than copied as a second authority.
- [ ] Implement conservative V1 thresholds as named/versioned constants and persist signals/opportunities idempotently.
- [ ] Assert only a later deterministic refresh can set `VERIFIED_FIXED`; manual workflow only allows `IN_PROGRESS`/`IGNORED`.
- [ ] Run GREEN and commit: `feat: add P5-A content opportunity engine`.

---

### Task 4: Durable Content refresh queue and worker

**Files:**
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Create: `src/modules/content/content.service.ts`
- Create: `src/modules/content/content.worker.ts`
- Test: `tests/integration/content.queue.test.ts`
- Test: `tests/integration/content.worker.test.ts`

**Interfaces:**
- Queue name exactly `content`.
- Job ID exactly `content-refresh-<projectId>` for one active logical refresh.
- Worker reads persisted P1/P2/P3 data only; it does not trigger network crawling.

- [ ] Write RED tests for idempotent enqueue, project isolation, deterministic refresh, completion/failure state, and no HTTP/network dependency.
- [ ] Add dedicated BullMQ queue and worker with bounded concurrency.
- [ ] Run GREEN and typecheck.
- [ ] Commit: `feat: add P5-A content refresh worker`.

---

### Task 5: Bounded Content Brief and Optimization AI integration

**Files:**
- Modify: Prisma/AI task enum migration only as required for `CONTENT_BRIEF`, `CONTENT_OPTIMIZATION_ANALYSIS`.
- Create: `src/modules/ai/content-intelligence.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Test: `tests/unit/content.ai.test.ts`
- Test: `tests/integration/content.ai.test.ts`

**Interfaces:**
- Prompt IDs exactly `content-brief-v1` and `content-optimization-v1`.
- Request keys exactly `content-brief:<contentDocumentId>:<contentHash>:content-brief-v1` and `content-opt:<contentDocumentId>:<contentHash>:content-optimization-v1`.
- Uses existing P4 AI service/queue, `attempts:1`, manual retry semantics and structured-output validation.

- [ ] Write RED schemas for brief fields `objective`, `audience`, `primaryTopic`, `supportingTopics`, `recommendedOutline`, `entitiesToCover`, `questionsToAnswer`, `internalLinkSuggestions`, `evidenceNotes`, `sourceReferences`.
- [ ] Write RED schemas for optimization fields `summary`, `priorities`, `sectionRecommendations`, `entityRecommendations`, `internalLinkRecommendations`, `citabilityRecommendations`, `doNotChange`, `sourceReferences`.
- [ ] Assert source refs must be supplied, text excerpts are bounded/deterministically reduced, secrets/raw headers/full HTML are excluded, and changed content hash creates a new logical task.
- [ ] Implement prompt registry entries and bounded fact packet builder using P4 Gateway only.
- [ ] Run GREEN with mocked provider only.
- [ ] Commit: `feat: add bounded P5-A content intelligence`.

---

### Task 6: Feature gate and REST API

**Files:**
- Modify: `src/auth/feature-flags.ts`
- Create: `src/modules/content/content.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/content.api.test.ts`

**Interfaces:**
- Feature gate exactly `CONTENT_INTELLIGENCE` for STANDARD/ADVANCED/ENTERPRISE.
- Endpoints exactly:
  - `GET /api/v1/projects/:projectId/content/documents`
  - `GET /api/v1/projects/:projectId/content/documents/:documentId`
  - `POST /api/v1/projects/:projectId/content/refresh`
  - `GET /api/v1/projects/:projectId/content/opportunities`
  - `PATCH /api/v1/projects/:projectId/content/opportunities/:opportunityId`
  - `POST /api/v1/projects/:projectId/content/documents/:documentId/brief`
  - `POST /api/v1/projects/:projectId/content/documents/:documentId/optimization`
  - `GET /api/v1/projects/:projectId/content/briefs`

- [ ] Write RED API tests for auth/feature gate/project isolation/idempotency/valid state transitions/no P6 gate reuse.
- [ ] Implement routes using content service + existing AI service.
- [ ] Run GREEN and commit: `feat: add P5-A content REST API`.

---

### Task 7: Content Center Web UI

**Files:**
- Create: `src/modules/content/content.web.repository.ts`
- Create: `src/views/content/index.ejs`
- Create: `src/views/content/document-show.ejs`
- Create: `src/views/content/brief-show.ejs`
- Modify: `src/web/routes.ts`
- Modify existing project navigation so `内容` routes to `/projects/:id/content`.
- Test: `tests/integration/content.web.test.ts`
- Test: `tests/e2e/content-intelligence.spec.ts`

**Interfaces:**
- Routes exactly `/projects/:id/content`, `/projects/:id/content/documents/:documentId`, `/projects/:id/content/briefs/:briefId`.
- AI sections visibly label recommendations as advisory; deterministic facts and AI output are visually separated.

- [ ] Write RED integration/E2E tests for summary cards, inventory, opportunities, source-ref links, document detail and persisted mock AI brief.
- [ ] Implement pages using existing dark admin layout; do not wire AI Visibility.
- [ ] Run integration tests and Chromium E2E.
- [ ] Commit: `feat: add P5-A Content Center`.

---

### Task 8: Safe Content observability and operator documentation

**Files:**
- Create: `src/modules/content/content-observability.ts`
- Wire: content service/worker
- Create: `docs/development/p5a-content-intelligence.md`
- Test: `tests/integration/content.observability.test.ts`

**Interfaces:**
- Event names exactly `content.refresh.queued`, `content.refresh.started`, `content.document.updated`, `content.opportunity.updated`, `content.refresh.completed`, `content.refresh.failed`.

- [ ] Write RED log-contract tests asserting IDs/aggregate counts may appear while full page text, full prompt/output, cookies, Authorization, secrets and provider reasoning never appear.
- [ ] Implement bounded structured event sink and wire lifecycle points.
- [ ] Document refresh semantics, ruleset/versioning, feature gate, AI boundaries, queue/operator troubleshooting and P5-A vs P5-B/P5-C/P6 boundaries.
- [ ] Run GREEN and commit: `docs: add P5-A observability and operations`.

---

### Task 9: P5-A final release gate

**Files:**
- Modify: `README.md`
- Final range/CI verification only.

- [ ] Update roadmap to `P5-A Content Intelligence — complete` and `P5-B Competitor Intelligence — next` only after fresh green verification.
- [ ] Run/confirm:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

- [ ] Confirm production runtime dependency audit green.
- [ ] Confirm CI has no live DeepSeek key/request.
- [ ] Range check: no P5-B competitor implementation, no P5-C reporting implementation, no P6 prompt/citation/visibility/SOV sampling.
- [ ] Commit: `feat: complete P5-A Content Intelligence release gate`.

## Acceptance Summary

P5-A is complete only when deterministic owned-content facts/opportunities are durable and explainable, UNKNOWN semantics remain intact, AI briefs/optimization are bounded/source-referenced/advisory, `CONTENT_INTELLIGENCE` is correctly gated, project-scoped API/UI is covered, sensitive material is excluded from logs/AI packets, and the full Prisma/TypeScript/tests/build/runtime-audit/Chromium E2E gate is green.
