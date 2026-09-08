# P13-A Rules-First Content Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a manual, rules-only Content Quality review workflow for internal-link support, content decay, and existing Content QA facts, with auditable human handoff to a publication proposal.

**Architecture:** Add P13-A run/finding/history records, a deterministic evaluator over persisted `PageSnapshot`/P5-A facts, and one BullMQ job on the existing content queue. Expose protected project APIs and a Content Center view; acceptance creates only an existing `PublicationProposal` with P13-A evidence, never a draft, plan, AI task, CMS write, or publish action.

**Tech Stack:** TypeScript, Express 5, Prisma/PostgreSQL, BullMQ/Redis, EJS, Zod, Vitest, Supertest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-06-p13a-rules-first-content-quality-design.md`

## Global Constraints

- Run only from an explicit authorized user request; do not add scheduler/automation definitions.
- Read persisted facts only: never re-crawl, call an AI provider, call a CMS adapter, or generate/publish content.
- Preserve `UNKNOWN` for absent/non-comparable facts; never coerce it to `0` or `FAIL`.
- Do not claim link edges, PageRank, rankings, traffic, conversion, or observed external impact.
- Reuse project scope, `requireAuthentication`, CSRF, active membership, project capabilities and actor attribution.
- Keep migrations additive; use `prisma migrate dev` only against the isolated development database.
- Follow RED → GREEN, then exact-HEAD unit/integration/E2E/typecheck CI gates.
- Preserve all pre-existing untracked screenshot files; never stage them.
- PR merge, staging deployment, and production deployment remain separate user approvals.

---

## File structure

| Path | Responsibility |
|---|---|
| `prisma/models/content-intelligence.prisma` | P13-A enums/models and relations to ContentDocument/PublicationProposal. |
| `prisma/migrations/<timestamp>_add_content_quality_findings/migration.sql` | Additive production migration. |
| `src/modules/content/content-quality.types.ts` | Rule, finding, run, comparator and command contracts. |
| `src/modules/content/content-quality.rules.ts` | Pure deterministic Internal Link, Decay and QA evaluators. |
| `src/modules/content/content-quality.repository.ts` | Project-scoped persistence and idempotent state/proposal handoff. |
| `src/modules/content/content-quality.service.ts` | Queue command and active-job deduplication. |
| `src/modules/content/content-quality.worker.ts` | Read-only analysis run lifecycle and finding materialization. |
| `src/modules/content/content-quality.observability.ts` | Bounded lifecycle/event contract. |
| `src/modules/content/content.routes.ts`, `content.web.*`, `src/app.ts` | Protected REST/form routes and read models. |
| `src/queue/worker-bootstrap.ts` | Register the one `content-quality` worker. |
| `src/views/content/quality-index.ejs`, `quality-detail.ejs` | Evidence-first review UI. |
| `tests/unit/content-quality.rules.test.ts` | Pure deterministic rule tests. |
| `tests/integration/content-quality.*.test.ts` | Persistence, queue, worker, API and web contracts. |
| `tests/e2e/content-quality.spec.ts` | Authorized operator browser flow. |

### Task 1: Add the additive persistence contract

**Files:**
- Modify: `prisma/models/content-intelligence.prisma`
- Create: `prisma/migrations/<generated>_add_content_quality_findings/migration.sql`
- Test: `tests/integration/content-quality.persistence.test.ts`

**Interfaces:**
- Produce enums `ContentQualityRunStatus`, `ContentQualityFindingStatus`, `ContentQualityCategory`.
- Produce models `ContentQualityRun`, `ContentQualityFinding`, `ContentQualityFindingHistory`.
- `ContentQualityFinding` has unique `(contentDocumentId, findingKey, ruleVersion)` and nullable `acceptedPublicationProposalId`.

- [ ] **Step 1: Write the failing persistence test**

```ts
it('keeps one stable finding per document/rule/version and append-only history', async () => {
  const first = await prisma.contentQualityFinding.upsert({ /* initial input */ });
  const second = await prisma.contentQualityFinding.upsert({ /* same identity, new evidence */ });
  expect(second.id).toBe(first.id);
  await prisma.contentQualityFindingHistory.create({ data: { findingId: first.id, fromStatus: 'OPEN', toStatus: 'IN_REVIEW', actorId: 'user-1' } });
  expect(await prisma.contentQualityFindingHistory.count({ where: { findingId: first.id } })).toBe(1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/integration/content-quality.persistence.test.ts`

Expected: FAIL because P13-A Prisma models/delegates do not exist.

- [ ] **Step 3: Implement the smallest additive schema**

Add UUID project/document/run relations; indexes on project/status/category/priority; append-only history relation; nullable unique proposal relation. Generate the migration against the isolated development database, inspect the SQL for only type/table/index/foreign-key additions, then run `npm run prisma:generate`.

```prisma
model ContentQualityFinding {
  id String @id @default(uuid()) @db.Uuid
  projectId String @db.Uuid
  contentDocumentId String @db.Uuid
  findingKey String
  ruleVersion Int
  status ContentQualityFindingStatus @default(OPEN)
  @@unique([contentDocumentId, findingKey, ruleVersion])
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/integration/content-quality.persistence.test.ts`

Expected: PASS; generated Prisma delegates preserve repeat-upsert identity and history is append-only. Repository transition behavior is explicitly deferred to Task 3.

- [ ] **Step 5: Commit this unit**

```bash
git add prisma tests/integration/content-quality.persistence.test.ts
git commit -m "feat: add content quality persistence contract"
```

### Task 2: Implement pure versioned rules before queue/API work

**Files:**
- Create: `src/modules/content/content-quality.types.ts`
- Create: `src/modules/content/content-quality.rules.ts`
- Test: `tests/unit/content-quality.rules.test.ts`

**Interfaces:**
- Produce `CONTENT_QUALITY_RULESET_V1`, `evaluateInternalLinkSupport`, `evaluateContentDecay`, `surfaceContentQaFinding`, `ContentQualityEvaluation`.
- Consume current content facts, ordered historical snapshots, and P5-A opportunity/signal references.
- Produce only `PASS`, `FAIL`, `UNKNOWN` evidence objects; the worker persists only failures.

- [ ] **Step 1: Write failing rule examples**

```ts
it('returns UNKNOWN instead of zero when the internal link count is absent', () => {
  expect(evaluateInternalLinkSupport(facts({ internalLinkCount: null }))).toMatchObject({ status: 'UNKNOWN' });
});
it('detects only an observed comparable regression', () => {
  expect(evaluateContentDecay([eligibleSnapshot({ wordCount: 900 }), eligibleSnapshot({ wordCount: 300 })]))
    .toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_DECAY_WORD_COUNT_DROP' });
});
it('does not identify a specific internal-link source or target', () => {
  expect(evaluateInternalLinkSupport(facts({ internalLinkCount: 1 })).evidence).not.toHaveProperty('targetPageId');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/unit/content-quality.rules.test.ts`

Expected: FAIL because evaluator exports do not exist.

- [ ] **Step 3: Implement deterministic V1**

Place thresholds in one frozen V1 catalog. Sort snapshots by `capturedAt`, then `id`; require two eligible comparable snapshots. Emit decay only for indexability, 2xx HTML eligibility, material word-count decrease, title removal, or H1 removal. Surface existing P5-A failed opportunities as QA evidence without modifying them.

```ts
export function evaluateContentDecay(history: ComparableSnapshot[]): ContentQualityEvaluation {
  if (history.length < 2 || !comparable(history[0], history.at(-1)!)) {
    return unknown('INSUFFICIENT_COMPARABLE_HISTORY');
  }
  return pass();
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/unit/content-quality.rules.test.ts`

Expected: PASS for unknown safety, stable comparator ordering and no link-edge claim.

- [ ] **Step 5: Commit this unit**

```bash
git add src/modules/content/content-quality.types.ts src/modules/content/content-quality.rules.ts tests/unit/content-quality.rules.test.ts
git commit -m "feat: add deterministic content quality rules"
```

### Task 3: Add repository, manual queue, worker and observability

**Files:**
- Create: `src/modules/content/content-quality.repository.ts`
- Create: `src/modules/content/content-quality.service.ts`
- Create: `src/modules/content/content-quality.worker.ts`
- Create: `src/modules/content/content-quality.observability.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/integration/content-quality.queue.test.ts`
- Test: `tests/integration/content-quality.worker.test.ts`

**Interfaces:**
- `ContentQualityService.enqueueRun(projectId, actorId)` returns `{ jobId, runId, deduplicated }`.
- `processContentQualityJob(job)` reads sources, completes a run and materializes deterministic failed findings.
- `repository.acceptFinding(projectId, findingId, actorId)` creates/returns one existing proposal, never a draft or adapter call.

- [ ] **Step 1: Write failing queue/worker tests**

```ts
it('deduplicates an active manual analysis request', async () => {
  await expect(service.enqueueRun('project-1', 'user-1')).resolves.toMatchObject({ deduplicated: false });
  await expect(service.enqueueRun('project-1', 'user-1')).resolves.toMatchObject({ deduplicated: true });
});
it('materializes findings without fetch, AI, draft, or mutation-adapter calls', async () => {
  await processContentQualityJob({ data: { projectId, runId } } as Job<ContentQualityJobData>);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(aiSpy).not.toHaveBeenCalled();
  expect(adapterSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/integration/content-quality.queue.test.ts tests/integration/content-quality.worker.test.ts`

Expected: FAIL because P13-A service/worker/repository do not exist.

- [ ] **Step 3: Implement the single manual BullMQ path**

Create the run before enqueueing with active job key `content-quality-${projectId}`. The worker transitions `QUEUED → RUNNING → COMPLETED|FAILED`, records bounded counters/error code, reads only Prisma data, invokes pure rules, and registers one `content-quality` worker. Do not add repeat options or scheduler calls.

```ts
await queue.add('content-quality-run', { projectId, runId }, {
  jobId: `content-quality-${projectId}`,
  attempts: 1, removeOnComplete: 100, removeOnFail: 100,
});
```

- [ ] **Step 4: Implement idempotent state/proposal handoff**

Reruns update evidence/last-seen only for open/in-review findings. Human transitions write exactly one history row. Acceptance writes P13-A metadata (`findingId`, `ruleVersion`, snapshot IDs) to the existing compatible proposal source and enforces one linked proposal. Do not access draft/plan/execution tables.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/integration/content-quality.queue.test.ts tests/integration/content-quality.worker.test.ts`

Expected: PASS; active request deduplicates, failed run stores error code, no prohibited integration is invoked.

- [ ] **Step 6: Commit this unit**

```bash
git add src/modules/content/content-quality.* src/queue/worker-bootstrap.ts tests/integration/content-quality.queue.test.ts tests/integration/content-quality.worker.test.ts
git commit -m "feat: add manual content quality analysis worker"
```

### Task 4: Add capability-guarded REST contracts

**Files:**
- Modify: `src/modules/content/content.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/content-quality.api.test.ts`

**Interfaces:**
- Add `POST /api/v1/projects/:projectId/content-quality/runs` (202), read/list/detail finding endpoints, transition endpoints and acceptance endpoint.
- Reads use `PROJECT_READ`; mutations use the least-privilege existing content/publication write capability chosen from `project-capabilities.ts` and asserted in tests.
- Mutations require authentication, CSRF, active membership and capability before service invocation.

- [ ] **Step 1: Write failing API guard/contract tests**

```ts
it('rejects a viewer before calling manual analysis', async () => {
  await request(app).post(`/api/v1/projects/${project.id}/content-quality/runs`)
    .set('Cookie', viewer.sessionCookie).set('X-CSRF-Token', csrf(viewer)).send({}).expect(403);
  expect(fakeService.enqueueRun).not.toHaveBeenCalled();
});
it('accepts idempotently and returns only a proposal reference', async () => {
  const response = await request(app).post(`/api/v1/projects/${project.id}/content-quality/findings/${finding.id}/accept`)
    .set('Cookie', operator.sessionCookie).set('X-CSRF-Token', csrf(operator)).send({}).expect(201);
  expect(response.body.data).toMatchObject({ proposalId: expect.any(String) });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/integration/content-quality.api.test.ts`

Expected: FAIL because routes/injected ports do not exist.

- [ ] **Step 3: Add Zod schemas, guards and handlers**

Use the official-sync guard order: authentication, CSRF for mutations, membership, capability. Strictly validate filters/status/reason; resolve findings by both ID and project ID; derive actor from `req.auth`, never request body. Add a narrow injected quality-service port to `AppOptions`.

```ts
router.post('/projects/:projectId/content-quality/runs', ...mutationGuards, async (req, res, next) => {
  const data = await qualityService.enqueueRun(req.params.projectId, req.auth!.userId);
  res.status(202).json({ data });
});
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/integration/content-quality.api.test.ts`

Expected: PASS for success, CSRF-first failure, viewer denial, foreign-project 404, strict validation and idempotent acceptance.

- [ ] **Step 5: Commit this unit**

```bash
git add src/modules/content/content.routes.ts src/app.ts tests/integration/content-quality.api.test.ts
git commit -m "feat: add protected content quality APIs"
```

### Task 5: Add the evidence-first Content Center UI

**Files:**
- Modify: `src/modules/content/content.web.repository.ts`
- Modify: `src/modules/content/content.web.routes.ts`
- Create: `src/views/content/quality-index.ejs`
- Create: `src/views/content/quality-detail.ejs`
- Modify: `src/views/content/index.ejs`
- Test: `tests/integration/content-quality.web.test.ts`
- Test: `tests/e2e/content-quality.spec.ts`

**Interfaces:**
- `/projects/:id/content/quality` renders run/finding summary; `/quality/:findingId` renders evidence/history.
- POST forms enqueue a run or transition/accept a finding and redirect with 303.
- P13-A UI exposes no AI/CMS/publishing execution control.

- [ ] **Step 1: Write failing web/E2E tests**

```ts
it('renders evidence and labels missing comparison data as 证据不足', async () => {
  const response = await request(app).get(`/projects/${project.id}/content/quality`).set('Cookie', operator.sessionCookie).expect(200);
  expect(response.text).toContain('内容质量建议');
  expect(response.text).toContain('证据不足');
});
test('operator requests analysis without a publish action', async ({ page }) => {
  await page.goto(`/projects/${projectId}/content/quality`);
  await page.getByRole('button', { name: '分析内容质量' }).click();
  await expect(page.getByText('发布执行')).toHaveCount(0);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/integration/content-quality.web.test.ts && npm run test:e2e -- tests/e2e/content-quality.spec.ts`

Expected: FAIL because P13-A routes/templates do not exist.

- [ ] **Step 3: Implement the smallest safe review UI**

Query only project-scoped run/finding/document/history/proposal data. Render snapshot IDs/times, before/after values, rule version, priority and human state. Use explicit `证据不足` for `UNKNOWN`, existing CSRF conventions, safe 303 redirects, and a link to proposal detail rather than execution.

```ejs
<form action="/projects/<%= project.id %>/content/quality/runs" method="post">
  <input type="hidden" name="_csrf" value="<%= csrfToken %>">
  <button type="submit">分析内容质量</button>
</form>
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/integration/content-quality.web.test.ts && npm run test:e2e -- tests/e2e/content-quality.spec.ts`

Expected: PASS for operator view/action, viewer denial, evidence/no-data state, and safe redirect.

- [ ] **Step 5: Commit this unit**

```bash
git add src/modules/content/content.web.repository.ts src/modules/content/content.web.routes.ts src/views/content tests/integration/content-quality.web.test.ts tests/e2e/content-quality.spec.ts
git commit -m "feat: add content quality review center"
```

### Task 6: Run exact-HEAD verification and prepare review evidence

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-p13a-rules-first-content-quality-design.md` only if verification exposes a spec/code mismatch
- Test: all P13-A tests and repository CI commands

**Interfaces:**
- Produce a clean P13-A change set and exact-HEAD verification evidence; do not create/merge/deploy a PR without separate user approval.

- [ ] **Step 1: Run focused P13-A tests**

```bash
npm test -- tests/unit/content-quality.rules.test.ts tests/integration/content-quality.persistence.test.ts tests/integration/content-quality.queue.test.ts tests/integration/content-quality.worker.test.ts tests/integration/content-quality.api.test.ts tests/integration/content-quality.web.test.ts
npm run test:e2e -- tests/e2e/content-quality.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run generated-client, type and full test verification**

```bash
npm run prisma:generate
npm run typecheck
npm test
npm run build
```

Expected: all commands PASS at exact current HEAD.

- [ ] **Step 3: Inspect migration and forbidden-path evidence**

```bash
git diff --check
git status --short
rg -n "repeat:|addRepeatable|createContentBriefTask|createContentOptimizationTask|mutationAdapter|executePlan" src/modules/content/content-quality* tests/*/content-quality* || true
```

Expected: no whitespace errors; no scheduler/AI/mutation-adapter/P13-A execution path; existing user screenshots remain unstaged.

- [ ] **Step 4: Commit verification/docs only if changed**

```bash
git add docs/superpowers/specs/2026-09-06-p13a-rules-first-content-quality-design.md
git commit -m "docs: verify p13a content quality constraints"
```

- [ ] **Step 5: Request review; do not merge or deploy**

Report the exact commit SHA, test results, migration review and external decisions. Create a PR only after explicit user authorization; merging and deployments remain separate approvals.

## Self-review

### Spec coverage

- Manual-only lifecycle: Task 3.
- Rules-first Internal Link, Decay and existing QA: Task 2.
- Unknown-safe no-impact claims: Tasks 2 and 6.
- Stable findings, history and proposal linkage: Tasks 1 and 3.
- RBAC/CSRF/audit: Tasks 4 and 5.
- Evidence-first UI: Task 5.
- No AI/CMS/draft/plan/publish/scheduler: Tasks 3–6.
- RED/GREEN/exact-HEAD Definition of Done: every task, finalized in Task 6.

### Placeholder scan

No unresolved placeholder language remains. The migration directory is generated from its timestamp by Prisma; Task 1 specifies the exact generation and SQL inspection.

### Type consistency

`ContentQualityService.enqueueRun`, `processContentQualityJob`, `ContentQualityEvaluation`, and the quality route/view paths are introduced once and used consistently. The only publication output is an existing `proposalId`.
