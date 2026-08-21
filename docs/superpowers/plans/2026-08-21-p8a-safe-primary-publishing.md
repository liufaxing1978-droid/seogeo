# P8-A Safe Primary Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a controlled primary-site publishing workflow that turns a P7 opportunity or manual intent into a versioned draft, deterministic preview, hash-bound human approval, Git-backed Draft PR, externally observed deployment, deterministic verification, and reviewable rollback proposal.

**Architecture:** Add a new `src/modules/publication` control-plane module rather than mixing P8 execution logic into P5 content or P7 growth modules. Persist versioned drafts, immutable plans/previews/approvals, execution and verification records in PostgreSQL; reuse the existing P4 AI task pipeline for advisory brief/article generation; route all external writes through a capability-declared mutation adapter. The first write adapter is GitHub-backed and may only create an isolated branch, commit the exact approved change, and open a Draft PR; it never updates or merges the default branch.

**Tech Stack:** Node.js 22, TypeScript 5.9, Express 5, EJS, PostgreSQL/Prisma 6.14, Redis/BullMQ 5, Zod 3, Vitest/Supertest, Playwright/Chromium, Node `crypto`, native `fetch`, existing P4 DeepSeek AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md`

## Global Constraints

- Primary public target V1 is `xingshantang.org`; `/news`, `/culture`, `/archives` are configurable `PublicationChannel` rows, never hard-coded executor branches.
- `seogeo` is the workflow/control-plane source of truth; the site repository + deployed site remain the source of truth for published page bodies.
- P7 may create a proposal but can never create an approval or call an executor.
- DeepSeek is advisory only: it may generate briefs, draft content, metadata, FAQs and variants, but cannot approve, execute, merge, deploy, verify or mutate P7 deterministic facts.
- Approval binds the exact `planHash`, `contentHash`, `previewHash`, target repository/branch, `baseSha`, touched-file blob hashes, risk class and plan version.
- Any approved content/plan/base/blob change makes the approval stale; no fuzzy patch application after approval.
- Never force-push, directly update the configured default branch, automatically merge a PR, automatically deploy production, or automatically rollback production.
- `PR_CREATED != DEPLOYED`; `DEPLOYED != VERIFIED`.
- P8-A rejects HIGH-risk operations. LOW and explicitly reviewed MEDIUM operations only.
- Per plan limits: max 20 files, max 50 typed operations, one primary target URL. Violations fail closed.
- Standard: proposal/draft/validation/export-only. Advanced: Git-backed primary publication. Enterprise inherits Advanced but HIGH-risk operations remain disabled.
- CI uses fake/injected Git transports and mock HTTP verification. No live GitHub write credentials, DeepSeek calls or production-site mutation are required in CI.
- UI/GET rendering has zero side effects: no queue enqueue, no remote writes, no DeepSeek call.
- Every behavior task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### Persistence

- Create `prisma/models/publication.prisma`
- Create `prisma/migrations/20260821160000_add_p8_publication_foundation/migration.sql`
- Later task may add a second forward migration for immutable triggers/index tightening; never edit an already-merged migration.

### New primary module

- `src/modules/publication/publication.types.ts`
- `src/modules/publication/publication.hash.ts`
- `src/modules/publication/publication-risk.ts`
- `src/modules/publication/publication.repository.ts`
- `src/modules/publication/publication.service.ts`
- `src/modules/publication/publication-validation.ts`
- `src/modules/publication/publication-plan.ts`
- `src/modules/publication/publication-approval.ts`
- `src/modules/publication/mutation-adapter.ts`
- `src/modules/publication/export-mutation.adapter.ts`
- `src/modules/publication/github-mutation.adapter.ts`
- `src/modules/publication/publication-execution.queue.ts`
- `src/modules/publication/publication-execution.worker.ts`
- `src/modules/publication/publication-verification.queue.ts`
- `src/modules/publication/publication-verification.worker.ts`
- `src/modules/publication/publication-verifier.ts`
- `src/modules/publication/publication-rollback.ts`
- `src/modules/publication/publication-observability.ts`
- `src/modules/publication/publication.routes.ts`
- `src/modules/publication/publication.web.repository.ts`
- `src/modules/publication/publication.web.routes.ts`

### AI integration

- Modify `prisma/models/ai-gateway.prisma`
- Modify `src/modules/ai/prompts/prompt-registry.ts`
- Modify `src/modules/ai/ai.worker.ts`
- Create `src/modules/publication/publication-ai.ts`

### Existing integration

- Modify `src/auth/feature-flags.ts`
- Modify `src/queue/queues.ts`
- Modify `src/queue/worker-bootstrap.ts`
- Modify `src/app.ts`
- Modify `src/views/partials/sidebar.ejs`
- Create `src/views/publication/opportunities.ejs`
- Create `src/views/publication/drafts.ejs`
- Create `src/views/publication/editor.ejs`
- Create `src/views/publication/preview.ejs`
- Create `src/views/publication/index.ejs`
- Create `src/views/publication/show.ejs`
- Create `src/views/publication/verification.ejs`
- Create `tests/e2e/publication.spec.ts`

---

### Task 1: Publication Persistence Foundation

**Files:**
- Create: `prisma/models/publication.prisma`
- Create: `prisma/migrations/20260821160000_add_p8_publication_foundation/migration.sql`
- Create: `src/modules/publication/publication.types.ts`
- Create: `src/modules/publication/publication.repository.ts`
- Test: `tests/integration/publication.persistence.test.ts`

**Interfaces:**
- Produces `PublicationRepository` methods for sites/channels, proposals, draft versions/source references, immutable plans/previews/approvals, executions/events, verifications and rollback proposals.
- Produces Prisma enums used by later tasks for proposal source, risk, operation, execution, verification and publication state.

- [ ] **Step 1: Write failing persistence tests**

```ts
it('stores a draft as mutable head plus immutable versions', async () => {
  const draft = await repository.createDraft({ projectId, title: 'A', body: 'V1', language: 'zh-CN' });
  await repository.appendDraftVersion(draft.id, { title: 'A', body: 'V2', generatedBy: 'HUMAN' });
  expect((await repository.listDraftVersions(draft.id)).map(v => v.body)).toEqual(['V1', 'V2']);
});

it('never updates an immutable plan in place', async () => {
  const plan = await seedPublicationPlan();
  await expect(repository.replacePlanPayload(plan.id, { operations: [] } as never)).rejects.toThrow();
});
```

Also cover one logical execution per execution key, append-only execution events and project-scoped site/channel uniqueness.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/integration/publication.persistence.test.ts`
Expected: FAIL because publication models/repository do not exist.

- [ ] **Step 3: Add exact domain models**

Create models for `PublicationSite`, `PublicationChannel`, `PublicationProposal`, `ContentDraft`, `ContentDraftVersion`, `ContentSourceReference`, `PublicationPlan`, `PublicationPreview`, `PublicationApproval`, `PublicationExecution`, `PublicationExecutionEvent`, `PublicationVerification`, `PublicationRollbackProposal`. Use unique keys for `(projectId, domain)`, `(siteId, pathPrefix)`, immutable plan `(proposalId, version)`, immutable draft version `(draftId, version)` and execution `executionKey`.

- [ ] **Step 4: Add database immutability guards**

Migration must add PostgreSQL trigger protection preventing UPDATE/DELETE of `PublicationPlan`, `PublicationPreview`, `PublicationApproval`, `ContentDraftVersion`, and `PublicationExecutionEvent`. Repository APIs expose creation/read only for those rows.

- [ ] **Step 5: Implement focused repository methods**

```ts
export interface PublicationRepository {
  createProposal(input: CreatePublicationProposalInput): Promise<PublicationProposal>;
  createDraft(input: CreateContentDraftInput): Promise<ContentDraft>;
  appendDraftVersion(draftId: string, input: AppendDraftVersionInput): Promise<ContentDraftVersion>;
  createPlan(input: CreatePublicationPlanInput): Promise<PublicationPlan>;
  createPreview(input: CreatePublicationPreviewInput): Promise<PublicationPreview>;
  createApproval(input: CreatePublicationApprovalInput): Promise<PublicationApproval>;
  createExecution(input: CreatePublicationExecutionInput): Promise<PublicationExecution>;
}
```

- [ ] **Step 6: Run GREEN**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/integration/publication.persistence.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/models/publication.prisma prisma/migrations/20260821160000_add_p8_publication_foundation src/modules/publication/publication.types.ts src/modules/publication/publication.repository.ts tests/integration/publication.persistence.test.ts
git commit -m "feat: add P8 publication persistence foundation"
```

---

### Task 2: Canonical Hashes, Risk Classification and Operation Bounds

**Files:**
- Create: `src/modules/publication/publication.hash.ts`
- Create: `src/modules/publication/publication-risk.ts`
- Test: `tests/unit/publication.hash.test.ts`
- Test: `tests/unit/publication.risk.test.ts`

**Interfaces:**
- `canonicalPublicationJson(value): string`
- `contentHashV1(content): string`
- `previewHashV1(preview): string`
- `planHashV1(plan): string`
- `approvalHashV1(approvalBinding): string`
- `classifyPublicationRisk(operations): 'LOW' | 'MEDIUM' | 'HIGH'`
- `assertP8AOperationPolicy(plan): void`

- [ ] **Step 1: Write deterministic hash tests**

```ts
expect(planHashV1({ operations: [a, b], files: ['b', 'a'], baseSha: 'abc' }))
  .toBe(planHashV1({ files: ['a', 'b'], operations: [b, a], baseSha: 'abc' }));
expect(planHashV1({ files: ['a'], operations: [a], baseSha: 'abc' }))
  .not.toBe(planHashV1({ files: ['a'], operations: [a], baseSha: 'def' }));
```

- [ ] **Step 2: Write policy tests**

Assert >20 files, >50 operations, multiple primary URLs and HIGH operations fail closed. Assert `CREATE_CONTENT_PAGE`, ordinary title/meta/H1/internal-link/JSON-LD are LOW; existing-body/canonical/meta-robots changes are MEDIUM; deletion/bulk redirect/mass noindex/template/global navigation/deploy are HIGH.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.hash.test.ts tests/unit/publication.risk.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement canonical serialization and versioned SHA-256 hashes**

Canonicalize object keys and sort set-like operation/file collections by explicit stable identity. Preserve ordered text arrays where order is semantic. Prefix hash payloads with exact version labels such as `PUBLICATION_PLAN_HASH_V1`.

- [ ] **Step 5: Implement exact operation policy**

Reject HIGH in P8-A independent of account plan. Return a stable reason code from policy failures: `OPERATION_NOT_ALLOWED`, `PATH_NOT_ALLOWED`, or `PLAN_LIMIT_EXCEEDED`.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.hash.test.ts tests/unit/publication.risk.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication.hash.ts src/modules/publication/publication-risk.ts tests/unit/publication.hash.test.ts tests/unit/publication.risk.test.ts
git commit -m "feat: add publication hashes and risk policy"
```

---

### Task 3: Site/Channel Configuration and Product Feature Gates

**Files:**
- Modify: `src/auth/feature-flags.ts`
- Create: `src/modules/publication/publication-site.service.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Test: `tests/unit/publication.feature-flags.test.ts`
- Test: `tests/integration/publication.site-config.test.ts`

**Interfaces:**
- New features: `PUBLICATION_WORKSPACE`, `PUBLICATION_GIT_EXECUTION`, `PUBLICATION_DISTRIBUTION`, `PUBLICATION_ENTERPRISE_GOVERNANCE`.
- `PublicationSiteService.configureSite(...)`
- `PublicationSiteService.configureChannel(...)`

- [ ] **Step 1: Lock the plan matrix in failing tests**

```ts
expect(hasFeature('STANDARD', 'PUBLICATION_WORKSPACE')).toBe(true);
expect(hasFeature('STANDARD', 'PUBLICATION_GIT_EXECUTION')).toBe(false);
expect(hasFeature('ADVANCED', 'PUBLICATION_GIT_EXECUTION')).toBe(true);
expect(hasFeature('ENTERPRISE', 'PUBLICATION_ENTERPRISE_GOVERNANCE')).toBe(true);
```

- [ ] **Step 2: Lock first-site configuration semantics**

Test that one project can configure `xingshantang.org` and channel rows `/news`, `/culture`, `/archives`; executor logic receives channel mapping data and never infers filesystem paths from those URL strings without adapter configuration.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.feature-flags.test.ts tests/integration/publication.site-config.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement feature matrix and configuration validation**

Require absolute HTTPS domain, explicit repository identity, explicit base branch, repository content-path template and an allowlisted path prefix. A site may also be `EXPORT_ONLY` and omit remote-write credentials.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.feature-flags.test.ts tests/integration/publication.site-config.test.ts`
Expected: PASS.

```bash
git add src/auth/feature-flags.ts src/modules/publication/publication-site.service.ts src/modules/publication/publication.repository.ts tests/unit/publication.feature-flags.test.ts tests/integration/publication.site-config.test.ts
git commit -m "feat: configure P8 publication sites and channels"
```

---

### Task 4: P7 Opportunity Intake, Manual Proposal and Versioned Draft Workspace

**Files:**
- Create: `src/modules/publication/publication.service.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Test: `tests/integration/publication.proposal-draft.test.ts`

**Interfaces:**
- `createProposalFromGrowthOpportunity(projectId, opportunityIdentityId, actorId)`
- `createManualProposal(projectId, input, actorId)`
- `createDraftFromProposal(proposalId, input)`
- `saveDraftVersion(draftId, expectedVersion, input, generatedBy)`

- [ ] **Step 1: Write failing P7 boundary tests**

Assert the service reads the latest persisted P7 opportunity snapshot and stores only stable refs/safe summaries needed for the proposal; it must not mutate Growth identity/snapshot/lifecycle and must not copy raw private provenance wholesale.

- [ ] **Step 2: Write optimistic draft-version tests**

```ts
const v2 = await service.saveDraftVersion(draft.id, 1, { body: 'human edit' }, 'HUMAN');
expect(v2.version).toBe(2);
await expect(service.saveDraftVersion(draft.id, 1, { body: 'stale' }, 'HUMAN'))
  .rejects.toMatchObject({ code: 'DRAFT_VERSION_CONFLICT' });
```

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/integration/publication.proposal-draft.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement proposal and draft service**

Manual proposals require an explicit reason and target project. P7-derived proposals store `opportunityIdentityId`, latest snapshot ID, opportunity type/priority/score/evidence quality, normalized query and canonical page where allowed.

- [ ] **Step 5: Add source-reference CRUD with bounded fields**

Store title, author, publisher, URL, source type, publication/access dates and internal/user marker. No source row is auto-marked verified merely because AI suggested it.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/integration/publication.proposal-draft.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication.service.ts src/modules/publication/publication.repository.ts tests/integration/publication.proposal-draft.test.ts
git commit -m "feat: add publication proposal and draft workspace"
```

---

### Task 5: Advisory Content Brief and Article Generation Through P4

**Files:**
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/20260821170000_add_p8_publication_ai_tasks/migration.sql`
- Create: `src/modules/publication/publication-ai.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Test: `tests/unit/publication.ai.test.ts`
- Test: `tests/integration/publication.ai.test.ts`

**Interfaces:**
- New AI task types: `PUBLICATION_CONTENT_BRIEF`, `PUBLICATION_ARTICLE_DRAFT`, `PUBLICATION_CONTENT_ADAPTATION` reserved for P8-B.
- Prompt IDs: `publication-content-brief-v1`, `publication-article-draft-v1`.
- `createPublicationBriefTask(...)`, `createPublicationArticleTask(...)`.

- [ ] **Step 1: Write failing prompt-authority tests**

Assert prompt system text says advisory only, cannot claim publication/verification, cannot invent sources, and output source refs must be a subset of supplied refs.

- [ ] **Step 2: Write idempotency/materialization tests**

One AI task per `{draftId, sourceVersion, promptVersion, action}` request key. Completion creates a new draft version with `generatedBy='DEEPSEEK'`; it never overwrites an approved plan/version.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.ai.test.ts tests/integration/publication.ai.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add structured brief/article schemas**

Brief output includes title candidates, intent, audience, recommended channel key, outline, entities, FAQ ideas, internal-link suggestions, source-gap notes. Article output includes title, excerpt, body, meta title/description, FAQ candidate, Schema candidate and source refs.

- [ ] **Step 5: Wire existing AI worker**

Extend `expectedPromptId`, parser selection and atomic completion materializer. No new direct DeepSeek transport is allowed in the publication module.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/publication.ai.test.ts tests/integration/publication.ai.test.ts`
Expected: PASS.

```bash
git add prisma/models/ai-gateway.prisma prisma/migrations/20260821170000_add_p8_publication_ai_tasks src/modules/publication/publication-ai.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/publication.ai.test.ts tests/integration/publication.ai.test.ts
git commit -m "feat: add advisory P8 content generation"
```

---

### Task 6: Deterministic Pre-Publication Validation

**Files:**
- Create: `src/modules/publication/publication-validation.ts`
- Test: `tests/unit/publication.validation.test.ts`

**Interfaces:**
- `validatePublicationDraft(input): PublicationValidationResult`
- Severity: `BLOCKING | WARNING | INFO`.
- Stable codes include `TITLE_REQUIRED`, `BODY_REQUIRED`, `TARGET_URL_INVALID`, `CANONICAL_MISMATCH`, `SCHEMA_INVALID`, `UNSAFE_HTML`, `DUPLICATE_SLUG`, `PATH_NOT_ALLOWED`.

- [ ] **Step 1: Write failing content/SEO/GEO/safety validation tests**

Cover empty title/body, malformed canonical, canonical outside configured primary host, script/iframe/event-handler HTML, invalid JSON-LD, duplicate URL conflict, missing H1-equivalent, source gaps as WARNING rather than fabricated truth, and safe valid content.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/publication.validation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic validation only**

Do not call AI, crawler, network or repository from the pure validator. Inputs contain the known target/site/channel plus any separately resolved URL conflict fact.

- [ ] **Step 4: Add exact publish gate**

`BLOCKING` prevents plan creation; `WARNING` may continue only if its codes are included in the explicit human review payload; `INFO` never blocks.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.validation.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-validation.ts tests/unit/publication.validation.test.ts
git commit -m "feat: add P8 publication validation gate"
```

---

### Task 7: Immutable Plan Builder and Exact Preview

**Files:**
- Create: `src/modules/publication/publication-plan.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Test: `tests/unit/publication.plan.test.ts`
- Test: `tests/integration/publication.plan-persistence.test.ts`

**Interfaces:**
- `buildPublicationPlan(input, targetSnapshot): PublicationPlanPayload`
- `createPublicationPreview(plan, adapterPreview): PublicationPreviewPayload`

- [ ] **Step 1: Write failing target mapping tests**

Given a configured `/culture` channel and adapter path template, assert target public URL and repository file path are deterministic. Assert existing URL cannot silently become CREATE; it must return `URL_CONFLICT` and require explicit update-plan intent.

- [ ] **Step 2: Write exact preview tests**

Preview records files created/modified/deleted (deleted must be zero in P8-A), typed operations, unified diff, expected outcomes, base SHA, touched blob SHA map, risk and validation results. Hash changes if any character, blob SHA, base SHA or operation changes.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.plan.test.ts tests/integration/publication.plan-persistence.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement plan builder and persistence**

Plan builder consumes a specific immutable draft version, never the mutable draft head. Persist plan before approval. Any regenerate action creates `version + 1` rather than update.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.plan.test.ts tests/integration/publication.plan-persistence.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-plan.ts src/modules/publication/publication.repository.ts tests/unit/publication.plan.test.ts tests/integration/publication.plan-persistence.test.ts
git commit -m "feat: add immutable publication plans and previews"
```

---

### Task 8: Hash-Bound Human Approval and Stale Protection

**Files:**
- Create: `src/modules/publication/publication-approval.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Test: `tests/unit/publication.approval.test.ts`
- Test: `tests/integration/publication.approval.test.ts`

**Interfaces:**
- `approvePublicationPlan(input): PublicationApproval`
- `assertApprovalCurrent(plan, preview, approval, liveTarget): void`

- [ ] **Step 1: Write failing approval-binding tests**

Assert approval stores and later compares `planHash`, `contentHash`, `previewHash`, `baseSha`, repository, branch, touched-file blob hashes and approved risk. Alter each one independently and expect `APPROVAL_STALE` or `TARGET_REVISION_CHANGED`.

- [ ] **Step 2: Write MEDIUM explicit-review test**

Approval of MEDIUM requires `confirmedWarningCodes` and `confirmedRisk='MEDIUM'`; LOW does not require an extra risk acknowledgement. HIGH always throws `OPERATION_NOT_ALLOWED`.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.approval.test.ts tests/integration/publication.approval.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement append-only approval creation**

Approver actor ID comes from authenticated context, never request body. Expired approval returns `APPROVAL_STALE`.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.approval.test.ts tests/integration/publication.approval.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-approval.ts src/modules/publication/publication.repository.ts tests/unit/publication.approval.test.ts tests/integration/publication.approval.test.ts
git commit -m "feat: add hash-bound publication approval"
```

---

### Task 9: Mutation Adapter Contract and Export-Only Fallback

**Files:**
- Create: `src/modules/publication/mutation-adapter.ts`
- Create: `src/modules/publication/export-mutation.adapter.ts`
- Test: `tests/unit/publication.mutation-adapter.test.ts`

**Interfaces:**

```ts
export interface MutationAdapter {
  readonly capability: 'EXPORT_ONLY' | 'DRAFT_PR';
  readTargetSnapshot(input: TargetRef): Promise<TargetSnapshot>;
  preview(plan: ApprovedPlanInput): Promise<MutationPreview>;
  apply(plan: ApprovedPlanInput): Promise<MutationApplyResult>;
  readExecutionState(execution: PublicationExecutionRef): Promise<MutationExecutionState>;
  rollback(execution: PublicationExecutionRef): Promise<MutationRollbackDraft>;
}
```

- [ ] **Step 1: Write failing export-only tests**

Assert export adapter can return exact diff/artifact but `apply` never performs a remote write and returns a stable `MANUAL_ACTION_REQUIRED`/export artifact result.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/publication.mutation-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement adapter data contracts**

Target snapshot must include repository identity, branch, head SHA and touched existing file blob SHAs. Preview must be deterministic and contain no credentials.

- [ ] **Step 4: Implement export-only adapter**

Standard-plan execution route uses this capability and never initializes a remote write transport.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.mutation-adapter.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/mutation-adapter.ts src/modules/publication/export-mutation.adapter.ts tests/unit/publication.mutation-adapter.test.ts
git commit -m "feat: add publication mutation adapter boundary"
```

---

### Task 10: GitHub Draft-PR Mutation Adapter

**Files:**
- Create: `src/modules/publication/github-mutation.adapter.ts`
- Test: `tests/unit/publication.github-adapter.test.ts`
- Test: `tests/integration/publication.github-adapter.test.ts`

**Interfaces:**
- Inject `GitHubPublicationTransport` with read branch/file, create branch, create/update file on mutation branch, create Draft PR, read PR/commit state and prepare revert patch.
- Branch format: `seogeo/p8/<publication-id>-<short-plan-hash>`.

- [ ] **Step 1: Write failing no-default-branch-write tests**

Fake transport records every write. Assert all writes target the unique mutation branch; no call may update `main`, configured base/default branch or use force update.

- [ ] **Step 2: Write stale base/blob tests**

Target head or touched file blob mismatch after approval returns `TARGET_REVISION_CHANGED` before `createBranch`.

- [ ] **Step 3: Write idempotent Draft PR tests**

One execution key creates one branch/commit/PR. Re-delivery returns existing result and performs zero duplicate remote writes.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/publication.github-adapter.test.ts tests/integration/publication.github-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement minimal GitHub transport adapter**

Create branch from exact approved `baseSha`, apply only approved files, commit with bounded message, open Draft PR, return branch/commit/PR identifiers. Never merge.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.github-adapter.test.ts tests/integration/publication.github-adapter.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/github-mutation.adapter.ts tests/unit/publication.github-adapter.test.ts tests/integration/publication.github-adapter.test.ts
git commit -m "feat: add GitHub Draft PR publication adapter"
```

---

### Task 11: Execution Queue, Worker and Audited Lifecycle

**Files:**
- Create: `src/modules/publication/publication-execution.queue.ts`
- Create: `src/modules/publication/publication-execution.worker.ts`
- Create: `src/modules/publication/publication-observability.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/publication.execution-worker.test.ts`
- Test: `tests/integration/publication.execution.test.ts`

**Interfaces:**
- Queue name: `site-mutation-execution`.
- Job data: `{ executionId: string }`.
- Deterministic job ID: `site-mutation-execution-<executionKey>`.

- [ ] **Step 1: Write failing fail-before-side-effect tests**

Execution without feature gate, current approval or configured adapter must fail before any adapter read/write. Duplicate job delivery performs one logical execution.

- [ ] **Step 2: Lock lifecycle transitions**

`PLANNED -> PREVIEW_READY -> APPROVED -> QUEUED -> EXECUTING -> PR_CREATED`; errors go to `APPROVAL_STALE`, `TARGET_REVISION_CHANGED`, `FAILED`. Every transition creates append-only event.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts`
Expected: FAIL.

- [ ] **Step 4: Register queue and worker**

Worker concurrency is 2. Job attempts are 1 for policy/stale errors and at most 2 for explicitly classified transient Git provider failures; do not retry permission/stale/validation failures.

- [ ] **Step 5: Add safe observability**

Events: `publication.execution.started`, `publication.execution.pr_created`, `publication.execution.failed`, with allowlisted IDs/status/reason/duration/count metadata only. Never emit article body/diff, Git credential, provider raw body or AI payload.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-execution.queue.ts src/modules/publication/publication-execution.worker.ts src/modules/publication/publication-observability.ts src/queue/queues.ts src/queue/worker-bootstrap.ts tests/unit/publication.execution-worker.test.ts tests/integration/publication.execution.test.ts
git commit -m "feat: execute approved publication plans safely"
```

---

### Task 12: Deployment Observation and Real-Site Verification

**Files:**
- Create: `src/modules/publication/publication-verification.queue.ts`
- Create: `src/modules/publication/publication-verification.worker.ts`
- Create: `src/modules/publication/publication-verifier.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Test: `tests/unit/publication.verifier.test.ts`
- Test: `tests/integration/publication.verification.test.ts`

**Interfaces:**
- Queue name: `site-mutation-verification`.
- `verifyPublishedTarget(expectation, htmlResponse): PublicationVerificationResult`.
- Verification reasons include `DEPLOYMENT_NOT_OBSERVED`, `PAGE_NOT_FOUND`, `EXPECTED_TITLE_NOT_FOUND`, `CANONICAL_MISMATCH`, `NOINDEX_DETECTED`, `SCHEMA_INVALID`, `DEPLOYED_CONTENT_MISMATCH`.

- [ ] **Step 1: Write failing verifier tests**

Using injected fetch responses, cover HTTP 200, title/meta/canonical/H1/indexability, JSON-LD parseability and expected bounded content fingerprint. Assert PR open/merged state alone can never produce VERIFIED.

- [ ] **Step 2: Write retry/observation tests**

A merged PR whose public URL is not yet updated remains `DEPLOYED`/`VERIFYING` with `DEPLOYMENT_NOT_OBSERVED`; verification jobs may be explicitly re-enqueued by user action but not on GET rendering.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.verifier.test.ts tests/integration/publication.verification.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement deterministic real-site verifier**

Use injected native fetch transport with bounded timeout/response bytes and Cheerio for HTML. Do not reuse live GSC or AI facts as proof of deployment.

- [ ] **Step 5: Persist verification and lifecycle**

Only all required deterministic checks passing transitions to `VERIFIED`; regressions stay `VERIFICATION_FAILED` with explicit findings.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.verifier.test.ts tests/integration/publication.verification.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-verification.queue.ts src/modules/publication/publication-verification.worker.ts src/modules/publication/publication-verifier.ts src/queue/queues.ts src/queue/worker-bootstrap.ts tests/unit/publication.verifier.test.ts tests/integration/publication.verification.test.ts
git commit -m "feat: verify deployed publications against the real site"
```

---

### Task 13: Repair and Rollback Planner

**Files:**
- Create: `src/modules/publication/publication-rollback.ts`
- Modify: `src/modules/publication/publication.repository.ts`
- Test: `tests/unit/publication.rollback.test.ts`
- Test: `tests/integration/publication.rollback.test.ts`

**Interfaces:**
- `createRepairProposal(verificationId, actorId)`
- `createRollbackProposal(executionId, actorId)`

- [ ] **Step 1: Write failing rollback safety tests**

Assert verifier failure never directly calls an adapter rollback. A rollback proposal references exact execution/commit/plan and produces a new reviewable plan/preview; it requires a fresh approval.

- [ ] **Step 2: Write post-change stale tests**

If target repository changed after original publication, rollback plan uses the current base and explicit revert operations; it must not force-reset history.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/publication.rollback.test.ts tests/integration/publication.rollback.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement repair/rollback planning**

Rollback strategy for Git-backed V1 is a reviewable revert/change PR. No production command, force push or auto-merge exists.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/publication.rollback.test.ts tests/integration/publication.rollback.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication-rollback.ts src/modules/publication/publication.repository.ts tests/unit/publication.rollback.test.ts tests/integration/publication.rollback.test.ts
git commit -m "feat: add reviewable publication repair and rollback plans"
```

---

### Task 14: Bounded REST API for Content and Publication Workflow

**Files:**
- Create: `src/modules/publication/publication.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/publication.api.test.ts`

**Interfaces:**
- `/api/v1/projects/:projectId/publication/proposals`
- `/api/v1/projects/:projectId/publication/drafts`
- `/api/v1/projects/:projectId/publication/drafts/:draftId/versions`
- `/api/v1/projects/:projectId/publication/plans`
- `/api/v1/projects/:projectId/publication/plans/:planId/approve`
- `/api/v1/projects/:projectId/publication/plans/:planId/execute`
- `/api/v1/projects/:projectId/publication/executions/:executionId/verify`
- bounded GET detail/list surfaces.

- [ ] **Step 1: Write failing auth/gate tests**

Standard can create/read workspace + export preview but receives 403 before Git adapter reads for execution. Advanced can execute. Cross-project IDs return not found/forbidden without leaking target existence.

- [ ] **Step 2: Write Zod/body bounds tests**

List limit max 100; body/title/source arrays are bounded; route cannot accept `approvedBy`, `planHash`, `baseSha` overrides that bypass server-computed facts.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/integration/publication.api.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement explicit mutation endpoints**

All side effects require POST. GET routes are persisted-read only. Actor ID comes from existing request identity/test fixture path, not arbitrary body fields.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/integration/publication.api.test.ts`
Expected: PASS.

```bash
git add src/modules/publication/publication.routes.ts src/app.ts tests/integration/publication.api.test.ts
git commit -m "feat: expose bounded P8 publication APIs"
```

---

### Task 15: Publication Workspace Web UI, E2E and P8-A Release Gate

**Files:**
- Create: `src/modules/publication/publication.web.repository.ts`
- Create: `src/modules/publication/publication.web.routes.ts`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Create: `src/views/publication/opportunities.ejs`
- Create: `src/views/publication/drafts.ejs`
- Create: `src/views/publication/editor.ejs`
- Create: `src/views/publication/preview.ejs`
- Create: `src/views/publication/index.ejs`
- Create: `src/views/publication/show.ejs`
- Create: `src/views/publication/verification.ejs`
- Create: `tests/e2e/publication.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Primary UI navigation: opportunity intake → draft/editor → validation → channel/URL → preview → approval → publication center → execution detail → verification.

- [ ] **Step 1: Write failing web rendering tests**

Add integration tests if needed to assert `/projects/:id/publication` and detail pages render persisted facts only and never enqueue jobs or call AI/Git transports.

- [ ] **Step 2: Implement six P8-A user surfaces**

Content opportunities, drafts/editor, publication preview, publication center, publication detail and verification detail. The editor visibly separates deterministic validation from AI advisory actions. Preview shows final URL, file list, exact diff, risk, base SHA and warnings.

- [ ] **Step 3: Add sidebar navigation**

Under 内容 add `内容与发布` pointing to `/projects/:id/publication`; keep existing P5 Content Center unchanged.

- [ ] **Step 4: Add E2E happy path with fakes**

```text
P7 opportunity -> create draft -> edit -> select /culture -> validation -> preview -> approve -> fake Draft PR -> observe fake deploy -> verify -> VERIFIED
```

- [ ] **Step 5: Add E2E stale and validation paths**

Cover base SHA change leading to `STALE_REVIEW_REQUIRED`, canonical mismatch blocking approval, and Standard export-only mode showing no Git execute control.

- [ ] **Step 6: Run focused GREEN**

Run: `npm run typecheck && npx vitest run tests/unit/publication.*.test.ts tests/integration/publication.*.test.ts && npx playwright test tests/e2e/publication.spec.ts`
Expected: PASS.

- [ ] **Step 7: Run exact P8-A release gate**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Expected: all PASS. On PR exact head, GitHub Actions jobs `verify`, Chromium `e2e`, and `production-audit` must all succeed before P8-A is marked complete.

- [ ] **Step 8: Commit release documentation**

```bash
git add src/modules/publication src/views/publication src/views/partials/sidebar.ejs src/app.ts tests/e2e/publication.spec.ts README.md
git commit -m "feat: complete P8-A safe primary publishing"
```

Record exact head SHA and workflow run in the P8-A integration PR. After exact-head green, merge P8-A into the P8 integration branch and continue immediately to P8-B without reopening architecture.
