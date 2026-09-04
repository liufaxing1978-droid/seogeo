# Keywords V1.1 P8 Content Brief Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create validated, project-scoped advisory Content Briefs from a Keyword Content Gap or a Keyword Cluster without creating a page or a parallel AI workflow.

**Architecture:** Add one `KeywordContentBriefRequest` bridge table that records a Gap or Cluster source, immutable facts snapshot, existing `CONTENT_BRIEF` AI task, and resulting existing `ContentBrief`. Refactor Content Brief task construction into a reusable internal builder so the existing document flow remains unchanged and Keyword P8 supplies only persisted keyword facts and source references.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, Zod, BullMQ-backed existing AI task service, EJS, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-03-keywords-v11-p8-content-brief-integration-design.md`

## Global Constraints

- Reuse `ContentBrief`, `CONTENT_BRIEF`, AI Worker, content screens, project RBAC, CSRF, and audit patterns; do not add a parallel provider call path.
- A request is created only by an authorized user. It never creates or modifies a page, Target URL, published content, entity, Keyword, Cluster, or Content Gap.
- Cluster requests aggregate active members and do not fan out into per-keyword requests.
- AI packets contain only persisted project facts and source references; output keeps existing schema validation and reference validation.
- Migration is additive, rollback-compatible at the application level, and contains no Production backfill.
- No main merge or Production deployment is part of P8.

---

### Task 1: Bridge schema and migration

**Files:**
- Modify: `prisma/models/keyword-demand.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_keyword_content_brief_requests/migration.sql`
- Test: `tests/integration/keyword-content-brief.persistence.test.ts`

**Interfaces:**
- Produces Prisma model `KeywordContentBriefRequest` with `projectId`, nullable `keywordId`, nullable `groupId`, nullable `contentGapId`, nullable `aiTaskId`, nullable `contentBriefId`, `snapshotHash`, `factsSnapshot`, `status`, and timestamps.
- Produces enum `KeywordContentBriefRequestStatus = PENDING | QUEUED | COMPLETED | FAILED`.

- [ ] **Step 1: Write failing persistence tests**

```ts
it('accepts one gap-backed request and one cluster-backed request', async () => {
  await expect(prisma.keywordContentBriefRequest.create({ data: gapRequest })).resolves.toMatchObject({ status: 'PENDING' });
  await expect(prisma.keywordContentBriefRequest.create({ data: clusterRequest })).resolves.toMatchObject({ status: 'PENDING' });
});

it('rejects a request with both a gap and a cluster source', async () => {
  await expect(prisma.keywordContentBriefRequest.create({ data: invalidRequest })).rejects.toThrow();
});
```

- [ ] **Step 2: Run the persistence test to verify it fails**

Run: `npx vitest run tests/integration/keyword-content-brief.persistence.test.ts`

Expected: FAIL because `keywordContentBriefRequest` and its migration do not exist.

- [ ] **Step 3: Add the additive model and SQL migration**

```prisma
model KeywordContentBriefRequest {
  id String @id @default(uuid()) @db.Uuid
  projectId String @db.Uuid
  keywordId String? @db.Uuid
  groupId String? @db.Uuid
  contentGapId String? @db.Uuid
  aiTaskId String? @unique @db.Uuid
  contentBriefId String? @unique @db.Uuid
  snapshotHash String
  factsSnapshot Json
  status KeywordContentBriefRequestStatus @default(PENDING)
  createdByUserId String? @db.Uuid
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Use database `CHECK` constraints: Gap source requires `keywordId` and forbids `groupId`; Cluster source requires `groupId` and forbids `keywordId`/`contentGapId`. Add foreign keys and project/source indexes. Do not mutate existing `ContentBrief` data.

- [ ] **Step 4: Apply the migration to a fresh isolated database and rerun tests**

Run: `DATABASE_URL="$TEST_DATABASE_URL" npx prisma migrate deploy && npx vitest run tests/integration/keyword-content-brief.persistence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit schema work**

```bash
git add prisma tests/integration/keyword-content-brief.persistence.test.ts
git commit -m "feat(keywords): persist content brief requests"
```

### Task 2: Keyword facts packet and idempotent request service

**Files:**
- Create: `src/modules/keywords/keyword-content-brief.service.ts`
- Modify: `src/modules/ai/content-intelligence.ts`
- Test: `tests/integration/keyword-content-brief.service.test.ts`
- Test: `tests/unit/keyword-content-brief-packet.test.ts`

**Interfaces:**
- Produces `KeywordContentBriefService.createFromGap(input)` and `.createFromGroup(input)` returning `{ request, task }`.
- Produces `buildAdvisoryContentBriefTaskInput(input)` in `content-intelligence.ts`, accepting a project ID, request key, fact packet, and source references.

- [ ] **Step 1: Write failing packet and service tests**

```ts
expect(packet.keyword.normalizedText).toBe(keyword.normalizedText);
expect(packet.gap.reasonCodes).toEqual(gap.reasonCodes);
expect(packet.entities).toContainEqual(expect.objectContaining({ sourceRef: `ENTITY:${entity.id}` }));
expect(JSON.stringify(packet)).not.toContain('fake ranking');
await expect(service.createFromGroup(input)).resolves.toMatchObject({ request: { status: 'QUEUED' } });
expect(await service.createFromGroup(input)).toMatchObject({ request: { id: first.request.id } });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/keyword-content-brief-packet.test.ts tests/integration/keyword-content-brief.service.test.ts`

Expected: FAIL because the packet builder and service do not exist.

- [ ] **Step 3: Implement packet construction and request creation**

Implement the service in one transaction: load only project-local Gap/Keyword or Cluster/active memberships, resolve persisted Target URLs and active Entity mappings, assemble typed source references, hash stable JSON, then `upsert` the request by its source/snapshot identity. Call the existing `AiTaskService.createAndEnqueue` through the generalized builder with task type `CONTENT_BRIEF`, request key `keyword-content-brief:<requestId>:<snapshotHash>:content-brief-v1`, and no provider call in the request service.

The generalized builder must preserve existing `buildContentBriefTaskInput(projectId, documentId)` behavior exactly; it only extracts shared limits and `CreateAiTaskInput` assembly.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `npx vitest run tests/unit/keyword-content-brief-packet.test.ts tests/integration/keyword-content-brief.service.test.ts tests/unit/content.ai.test.ts`

Expected: PASS; the second identical request returns the same bridge/task and a Cluster creates one request regardless of member count.

- [ ] **Step 5: Commit service work**

```bash
git add src/modules/keywords/keyword-content-brief.service.ts src/modules/ai/content-intelligence.ts tests
git commit -m "feat(keywords): create advisory briefs from gap evidence"
```

### Task 3: Worker completion linkage and failure visibility

**Files:**
- Modify: `src/modules/ai/content-intelligence.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Test: `tests/integration/keyword-content-brief.worker.test.ts`

**Interfaces:**
- `persistContentBrief(task, output, tx)` additionally links a matching Keyword request to the upserted `ContentBrief` and sets it `COMPLETED`.
- AI task failure marks only its matching request `FAILED` using sanitized error metadata.

- [ ] **Step 1: Write failing worker integration tests**

```ts
await executeAiTask(task.id, { repository, gateway: successfulGateway });
expect(await prisma.keywordContentBriefRequest.findUniqueOrThrow({ where: { id: request.id } }))
  .toMatchObject({ status: 'COMPLETED', aiTaskId: task.id, contentBriefId: expect.any(String) });

await executeAiTask(failedTask.id, { repository, gateway: failingGateway });
expect(await prisma.keywordContentBriefRequest.findUniqueOrThrow({ where: { id: failed.id } }))
  .toMatchObject({ status: 'FAILED', contentBriefId: null });
```

- [ ] **Step 2: Run the worker test to verify it fails**

Run: `npx vitest run tests/integration/keyword-content-brief.worker.test.ts`

Expected: FAIL because request status/linkage is absent.

- [ ] **Step 3: Implement transactional linkage**

After the existing ContentBrief upsert, update only a request whose `projectId` and `aiTaskId` match. In the existing worker failure transaction, similarly update only that matching request. Do not persist raw provider response/error strings.

- [ ] **Step 4: Run the worker and existing content tests**

Run: `npx vitest run tests/integration/keyword-content-brief.worker.test.ts tests/integration/content.persistence.test.ts tests/integration/ai.worker-execution.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit worker linkage**

```bash
git add src/modules/ai/content-intelligence.ts src/modules/ai/ai.worker.ts tests
git commit -m "feat(keywords): link brief requests to AI completion"
```

### Task 4: Guarded API and Keywords workbench actions

**Files:**
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/views/keywords/index.ejs`
- Test: `tests/integration/keywords.api.test.ts`
- Test: `tests/integration/keywords.web.test.ts`

**Interfaces:**
- `POST /api/v1/projects/:projectId/keywords/:keywordId/content-gap/brief`
- `POST /api/v1/projects/:projectId/keyword-groups/:groupId/content-brief`
- GET request-state routes require `PROJECT_READ`; creation routes require authentication, CSRF, membership, and `CONTENT_WRITE`.

- [ ] **Step 1: Write failing API and web tests**

```ts
await request(app).post(`/api/v1/projects/${project.id}/keywords/${keyword.id}/content-gap/brief`)
  .set(authHeaders).send({}).expect(201);
await request(app).post(`/projects/${project.id}/keyword-groups/${group.id}/content-brief`)
  .set('Cookie', csrfCookie).send({ _csrf: token }).expect(303);
expect(page.text).toContain('Create Content Brief');
expect(page.text).toContain('QUEUED');
```

- [ ] **Step 2: Run the API/web tests to verify they fail**

Run: `npx vitest run tests/integration/keywords.api.test.ts tests/integration/keywords.web.test.ts`

Expected: FAIL with missing routes and workbench state.

- [ ] **Step 3: Implement guarded routes and view model**

Parse an empty strict request body, call the service with the authenticated actor, and return the request/task state. Extend the existing Keyword workbench view model with source-local request summaries. Show real pending/queued/completed/failed state and link a completed request to its existing Content Brief detail page. Do not show an action for a resolved/non-actionable Gap, and do not render placeholders.

- [ ] **Step 4: Run API/web tests to verify they pass**

Run: `npx vitest run tests/integration/keywords.api.test.ts tests/integration/keywords.web.test.ts`

Expected: PASS including CSRF, role, project isolation, and redirects.

- [ ] **Step 5: Commit transport/UI work**

```bash
git add src/modules/keywords src/views/keywords/index.ejs tests/integration/keywords.api.test.ts tests/integration/keywords.web.test.ts
git commit -m "feat(keywords): expose content brief requests"
```

### Task 5: Completion verification and exact-head CI

**Files:**
- Modify: no production files unless a failing verification identifies a tested defect.

- [ ] **Step 1: Run fresh migration verification**

Run: `DATABASE_URL="$FRESH_TEST_DATABASE_URL" npx prisma migrate deploy && DATABASE_URL="$FRESH_TEST_DATABASE_URL" npx prisma validate`

Expected: all migrations, including the P8 request migration, apply successfully.

- [ ] **Step 2: Run focused and full verification**

Run: `npm run typecheck && npm test -- --reporter=dot && npm run build && npm run test:e2e`

Expected: all commands pass; record test totals and E2E result.

- [ ] **Step 3: Review staged change scope and commit any verification-only fixes**

Run: `git diff --check && git status --short`

Expected: only P8 source, migration, tests, and approved documentation are staged; user screenshot assets remain untracked.

- [ ] **Step 4: Push branch and verify exact-head CI**

Run: `git push origin feat/keyword-v11-p1-p3 && gh run list --branch feat/keyword-v11-p1-p3 --commit "$(git rev-parse HEAD)" --limit 5`

Expected: exact-head `verify`, `e2e`, `deployment-artifact`, and `production-audit` jobs succeed.

- [ ] **Step 5: Report P8 closure without merge or deployment**

Report migration name, API/UI changes, test results, exact SHA/CI URL, and explicitly state that `main` and Production were not changed.
