# P8-B Multi-Channel Content Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add independent, auditable distribution artifacts for verified primary publications, supporting canonical reposts, adapted articles, summaries, and explicitly capability-declared secondary-site publishing/manual handoff without weakening primary-site ownership.

**Architecture:** Add `src/modules/distribution` as a separate subsystem that depends on a VERIFIED P8-A primary publication. Persist one independent `DistributionTarget` and immutable versioned `DistributionArtifact` per platform/mode. Reuse P4 DeepSeek for adaptation only; platforms declare `PREPARE_ONLY`, `MANUAL_HANDOFF`, or `PUBLISH_API` capability. P8-B never treats external distribution failure as primary-publication failure and never republishes silently when the source changes.

**Tech Stack:** Same repository stack as P8-A: Node.js 22, TypeScript, Express/EJS, Prisma/PostgreSQL, BullMQ/Redis, Zod, Vitest/Supertest, Playwright, existing P4 DeepSeek Gateway; native `fetch` only behind injected provider transports.

**Spec:** `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md`

## Global Constraints

- Primary publication must be `VERIFIED` before normal external distribution preparation is allowed.
- `xingshantang.org` remains ORIGINAL/source of truth; external artifacts always retain `originalUrl` and, for canonical repost mode, exact `canonicalUrl` back to the primary URL.
- External platform states are isolated: Medium/LinkedIn/Substack/WordPress/Blogger failure cannot downgrade a VERIFIED primary publication.
- Source content version changes mark dependent artifacts `OUTDATED`; never silently rewrite or republish them.
- DeepSeek may adapt content but cannot publish, approve, verify, invent platform capabilities, or remove original/canonical attribution rules.
- No unofficial browser automation/scraping is added merely to simulate a publish API.
- A platform without a trustworthy configured write adapter stops at `DRAFT_READY` / `MANUAL_ACTION_REQUIRED`.
- CI uses injected fake transports only; no real external platform credentials or writes.
- GET/rendering paths have zero side effects.
- Every task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### Persistence

- Create `prisma/models/distribution.prisma`
- Create `prisma/migrations/20260821180000_add_p8_distribution/migration.sql`

### New module

- `src/modules/distribution/distribution.types.ts`
- `src/modules/distribution/distribution.repository.ts`
- `src/modules/distribution/distribution.service.ts`
- `src/modules/distribution/distribution-adapter.ts`
- `src/modules/distribution/manual-handoff.adapter.ts`
- `src/modules/distribution/http-publishing.adapter.ts`
- `src/modules/distribution/distribution-ai.ts`
- `src/modules/distribution/distribution.queue.ts`
- `src/modules/distribution/distribution.worker.ts`
- `src/modules/distribution/distribution-observability.ts`
- `src/modules/distribution/distribution.routes.ts`
- `src/modules/distribution/distribution.web.repository.ts`
- `src/modules/distribution/distribution.web.routes.ts`

### UI

- `src/views/distribution/index.ejs`
- `src/views/distribution/show.ejs`
- `src/views/distribution/artifact.ejs`
- Modify `src/views/partials/sidebar.ejs`
- Modify `src/app.ts`
- Create `tests/e2e/distribution.spec.ts`

---

### Task 16: Distribution Persistence, Identity and Source-Version Staleness

**Files:**
- Create: `prisma/models/distribution.prisma`
- Create: `prisma/migrations/20260821180000_add_p8_distribution/migration.sql`
- Create: `src/modules/distribution/distribution.types.ts`
- Create: `src/modules/distribution/distribution.repository.ts`
- Test: `tests/integration/distribution.persistence.test.ts`

**Interfaces:**
- `DistributionTarget` identity: primary publication + platform + mode + account/site target key.
- Immutable `DistributionArtifact` version binds source draft/publication content version, adaptation version, artifact hash, original URL and canonical URL.

- [ ] **Step 1: Write failing persistence tests**

```ts
const target = await repository.ensureTarget({ publicationId, platform: 'MEDIUM', mode: 'CANONICAL_REPOST', targetKey: 'default' });
const a1 = await repository.createArtifact(target.id, { sourceContentVersion: 7, body: 'v1', artifactVersion: 1 });
expect(a1.sourceContentVersion).toBe(7);
```

Assert artifact rows are immutable and duplicate target identity upserts without duplicates.

- [ ] **Step 2: Write source-change staleness tests**

When primary content advances from V7 to V8, target/artifact status becomes `OUTDATED`; previous artifact content remains unchanged and auditable.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/integration/distribution.persistence.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add exact models/enums**

Platforms include `MEDIUM`, `LINKEDIN`, `SUBSTACK`, `WORDPRESS`, `BLOGGER` plus P8-C values reserved in the enum. Modes include `CANONICAL_REPOST`, `ADAPTED_ARTICLE`, `SUMMARY`, `SECONDARY_SITE`, `COMMUNITY_DRAFT`, `ENTITY_SUGGESTION`. Status includes `NOT_PREPARED`, `DRAFT_READY`, `APPROVED`, `PUBLISHED`, `VERIFIED`, `OUTDATED`, `FAILED`, `MANUAL_ACTION_REQUIRED`.

- [ ] **Step 5: Add immutability triggers and repository methods**

Protect artifact versions from UPDATE/DELETE. Target lifecycle may be mutable but every publish/status change receives an append-only event or bounded audit row.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/integration/distribution.persistence.test.ts`
Expected: PASS.

```bash
git add prisma/models/distribution.prisma prisma/migrations/20260821180000_add_p8_distribution src/modules/distribution/distribution.types.ts src/modules/distribution/distribution.repository.ts tests/integration/distribution.persistence.test.ts
git commit -m "feat: add P8 distribution persistence"
```

---

### Task 17: Distribution Adapter Capability Contract

**Files:**
- Create: `src/modules/distribution/distribution-adapter.ts`
- Create: `src/modules/distribution/manual-handoff.adapter.ts`
- Test: `tests/unit/distribution.adapter.test.ts`

**Interfaces:**

```ts
export interface DistributionAdapter {
  readonly platform: DistributionPlatform;
  readonly capability: 'PREPARE_ONLY' | 'MANUAL_HANDOFF' | 'PUBLISH_API';
  prepare(input: DistributionPrepareInput): Promise<DistributionPreparedArtifact>;
  preview(artifact: DistributionPreparedArtifact): Promise<DistributionPreview>;
  publish?(artifact: ApprovedDistributionArtifact): Promise<DistributionPublishResult>;
  verify?(result: DistributionPublishResult): Promise<DistributionVerifyResult>;
}
```

- [ ] **Step 1: Write failing capability tests**

A `MANUAL_HANDOFF` adapter exposes no usable automatic publish path. Calling distribution service `publish()` against it returns `DISTRIBUTION_MANUAL_ONLY` before any remote call.

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/distribution.adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement manual handoff adapter**

It returns title/body/summary/tags/canonical/original URL plus a safe handoff instruction object; no provider credential is needed and no browser automation occurs.

- [ ] **Step 4: Add platform capability registry**

Initial default: Medium, LinkedIn, Substack are `MANUAL_HANDOFF` unless a specifically configured trusted adapter exists; WordPress/Blogger may become `PUBLISH_API` only when configured with a supported transport.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx vitest run tests/unit/distribution.adapter.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution/distribution-adapter.ts src/modules/distribution/manual-handoff.adapter.ts tests/unit/distribution.adapter.test.ts
git commit -m "feat: add distribution adapter capabilities"
```

---

### Task 18: Platform-Native Adaptation Through Existing AI Gateway

**Files:**
- Create: `src/modules/distribution/distribution-ai.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Test: `tests/unit/distribution.ai.test.ts`
- Test: `tests/integration/distribution.ai.test.ts`

**Interfaces:**
- Prompt IDs: `distribution-canonical-repost-v1`, `distribution-adapted-article-v1`, `distribution-summary-v1`.
- Uses existing `PUBLICATION_CONTENT_ADAPTATION` AI task type introduced in P8-A.

- [ ] **Step 1: Write failing adaptation-policy tests**

Canonical repost output must keep exact original/canonical URL; adapted article/summary may rewrite prose but cannot invent sources or claim a different original source. Returned source refs must be subset of supplied refs.

- [ ] **Step 2: Write deterministic request-key tests**

Request identity binds publication ID + exact source content version + platform + mode + prompt version. Repeating same request returns existing AI task/artifact rather than duplicate work.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/distribution.ai.test.ts tests/integration/distribution.ai.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement structured platform artifact parsers**

Return bounded `title`, `body`, `summary`, `tags`, `originalUrl`, `canonicalUrl`, `sourceRefs`, and optional platform-specific metadata. Persist a new immutable artifact version on successful completion.

- [ ] **Step 5: Extend AI worker only through registry/parser switch**

No direct DeepSeek dependency in `distribution` module. AI cannot transition a target past `DRAFT_READY`.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/distribution.ai.test.ts tests/integration/distribution.ai.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution/distribution-ai.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/distribution.ai.test.ts tests/integration/distribution.ai.test.ts
git commit -m "feat: generate platform-native distribution artifacts"
```

---

### Task 19: WordPress/Blogger-Style Trusted HTTP Publishing Adapter Boundary

**Files:**
- Create: `src/modules/distribution/http-publishing.adapter.ts`
- Test: `tests/unit/distribution.http-adapter.test.ts`
- Test: `tests/integration/distribution.publish.test.ts`

**Interfaces:**
- Inject `DistributionHttpTransport` and per-site configuration; no credential strings are stored in artifact payloads/logs.
- Adapter capability is `PUBLISH_API` only when configuration explicitly enables it.

- [ ] **Step 1: Write failing no-config/no-side-effect tests**

Missing endpoint/credential reference returns `DISTRIBUTION_NOT_CONFIGURED` before transport invocation. Manual-only platform cannot be upgraded by request body.

- [ ] **Step 2: Write publish/verify idempotency tests**

One approved artifact version gets one provider publish key. Retry after known success reuses recorded provider object URL/ID. Provider transient error may retry; validation/permission error does not.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/distribution.http-adapter.test.ts tests/integration/distribution.publish.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement generic trusted REST adapter**

Transport sends only configured endpoint payload mapped from approved artifact. It must not support arbitrary user-supplied URLs/headers. Provider responses are Zod-validated and reduced to bounded provider ID/public URL/status.

- [ ] **Step 5: Verify canonical/original ownership**

For `SECONDARY_SITE` or canonical repost, adapter rejects payload if required canonical/original URL does not equal VERIFIED primary publication URL.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/distribution.http-adapter.test.ts tests/integration/distribution.publish.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution/http-publishing.adapter.ts tests/unit/distribution.http-adapter.test.ts tests/integration/distribution.publish.test.ts
git commit -m "feat: add trusted API distribution adapter"
```

---

### Task 20: Distribution Queue, Service, Feature Gates and Observability

**Files:**
- Create: `src/modules/distribution/distribution.service.ts`
- Create: `src/modules/distribution/distribution.queue.ts`
- Create: `src/modules/distribution/distribution.worker.ts`
- Create: `src/modules/distribution/distribution-observability.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`
- Modify: `src/auth/feature-flags.ts`
- Test: `tests/unit/distribution.worker.test.ts`
- Test: `tests/integration/distribution.service.test.ts`

**Interfaces:**
- Queue name: `distribution-preparation`.
- Job: `{ targetId: string, sourceContentVersion: number }` with deterministic job ID.

- [ ] **Step 1: Write failing VERIFIED-primary prerequisite tests**

Non-VERIFIED primary publication returns `PRIMARY_PUBLICATION_NOT_VERIFIED` before AI/adapter/provider work. OUTDATED artifact cannot be published without creating/approving a new artifact version.

- [ ] **Step 2: Lock feature gates**

`PUBLICATION_DISTRIBUTION` is Advanced+ for platform artifact workflow; Enterprise governance additions do not bypass adapter capabilities.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/distribution.worker.test.ts tests/integration/distribution.service.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement preparation worker/service**

Preparation may invoke the P4 AI task pipeline or deterministic/manual adapter; it must stop at DRAFT_READY. Publish is a separate explicit POST/user action and requires artifact approval.

- [ ] **Step 5: Add safe observability**

Events: `distribution.preparation.started/completed/failed`, `distribution.publish.completed/failed`, `distribution.artifact.outdated`. Metadata contains IDs/platform/mode/status/reason only; never body, prompt, token, provider raw payload.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/distribution.worker.test.ts tests/integration/distribution.service.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution src/queue/queues.ts src/queue/worker-bootstrap.ts src/auth/feature-flags.ts tests/unit/distribution.worker.test.ts tests/integration/distribution.service.test.ts
git commit -m "feat: orchestrate P8 distribution preparation"
```

---

### Task 21: Distribution REST/Web UI, E2E and P8-B Release Gate

**Files:**
- Create: `src/modules/distribution/distribution.routes.ts`
- Create: `src/modules/distribution/distribution.web.repository.ts`
- Create: `src/modules/distribution/distribution.web.routes.ts`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Create: `src/views/distribution/index.ejs`
- Create: `src/views/distribution/show.ejs`
- Create: `src/views/distribution/artifact.ejs`
- Create: `tests/integration/distribution.api.test.ts`
- Create: `tests/e2e/distribution.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Project distribution center lists verified primary publications and per-platform targets/status.
- POST actions: create target, prepare artifact, approve artifact, publish only when adapter capability permits, mark manual handoff result with public URL after user action.

- [ ] **Step 1: Write failing API gate/bounds tests**

GET reads persisted data only. POST prepare cannot target another project/publication. Publish route fails before provider call when adapter is manual-only or feature unavailable.

- [ ] **Step 2: Implement distribution UI**

Show `ORIGINAL` primary URL prominently. For each platform display mode, source content version, DRAFT_READY/OUTDATED/PUBLISHED/VERIFIED status and capability badge. Manual adapters expose copy/open-platform workflow, not a misleading auto-publish button.

- [ ] **Step 3: Add E2E flow**

```text
VERIFIED /culture publication -> create Medium CANONICAL_REPOST -> generate artifact -> approve -> MANUAL_ACTION_REQUIRED
VERIFIED publication -> create configured fake WordPress target -> generate -> approve -> fake publish -> verify
source V8 created -> old V7 artifacts show OUTDATED
```

- [ ] **Step 4: Run focused GREEN**

Run: `npm run typecheck && npx vitest run tests/unit/distribution.*.test.ts tests/integration/distribution.*.test.ts && npx playwright test tests/e2e/distribution.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run exact P8-B release gate**

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

Expected: PASS locally and exact-head `verify`, Chromium `e2e`, `production-audit` PASS in CI.

- [ ] **Step 6: Commit release docs**

```bash
git add src/modules/distribution src/views/distribution src/views/partials/sidebar.ejs src/app.ts tests README.md
git commit -m "feat: complete P8-B multi-channel distribution"
```

Record exact head SHA/run, merge into P8 integration branch, and continue immediately to P8-C.
