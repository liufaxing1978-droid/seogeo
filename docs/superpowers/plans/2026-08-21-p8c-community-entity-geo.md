# P8-C Community GEO & Entity Knowledge Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add human-operated Community GEO drafting plus structured entity/knowledge-graph suggestion workflows for verified primary content, improving external answerability and entity consistency without autonomous community participation or encyclopedia publishing.

**Architecture:** Extend the P8-B `distribution` subsystem for community targets while adding a focused `src/modules/entity-distribution` module for entity suggestions. Community platforms are always capability-limited to prepare/manual handoff in P8-C: AI may draft platform-native questions/answers/posts from verified primary content and supplied sources, but cannot submit, vote, comment, impersonate users, or fabricate third-party consensus. Entity suggestions produce source-grounded candidate statements and relationship maps for Wikidata/Wikipedia/Baidu Baike review; no encyclopedia write adapter exists in P8-C.

**Tech Stack:** Node.js 22, TypeScript 5.9, Express 5, EJS, PostgreSQL/Prisma 6.14, Redis/BullMQ 5, Zod 3, Vitest/Supertest, Playwright/Chromium, existing P4 DeepSeek AI Gateway, existing P8 publication/distribution persistence.

**Spec:** `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md`

## Global Constraints

- Community GEO is AI-assisted drafting + human-operated handoff. P8-C never automatically creates Reddit/Quora/Zhihu/Jianshu/Tieba/PTT/Dcard/Mobile01/X/Threads posts, replies, votes, follows, accounts, or engagement.
- The system must not fabricate comments, testimonials, consensus, third-party endorsements, or pretend that AI output came from an independent community member.
- Community drafts are derived from VERIFIED primary content plus explicitly supplied source references; source links/claims are not invented.
- Default brand-link policy for community drafts is `OMIT_UNLESS_RELEVANT`; a direct primary-site link is a visible draft choice, never stealth-inserted.
- Wikipedia, Wikidata and Baidu Baike are entity-suggestion/research targets only in P8-C. No autonomous publishing/editing adapter exists.
- Entity suggestions must separate `SUPPORTED`, `NEEDS_SOURCE`, and `CONFLICTING` candidate claims. Missing evidence never becomes a confident statement.
- DeepSeek cannot mark a source verified, assert notability, approve edits, publish edits, or convert advisory relationships into deterministic P3/P7 facts.
- All platform capability decisions are server-side configuration. Request bodies cannot upgrade `MANUAL_HANDOFF` to `PUBLISH_API`.
- Primary publication must be VERIFIED before community/entity artifacts are prepared.
- GET/rendering paths have zero side effects and make zero AI/provider calls.
- CI uses fixtures/fake transports only; no real community or encyclopedia credentials/writes.
- Every task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### Persistence

- Create `prisma/models/entity-distribution.prisma`
- Create `prisma/migrations/20260821190000_add_p8_entity_distribution/migration.sql`
- Modify `prisma/models/distribution.prisma` only through a forward migration/model change if community-specific bounded fields are required.

### Community additions

- Create `src/modules/distribution/community-policy.ts`
- Create `src/modules/distribution/community-ai.ts`
- Create `src/modules/distribution/community-handoff.ts`

### Entity module

- `src/modules/entity-distribution/entity-distribution.types.ts`
- `src/modules/entity-distribution/entity-distribution.repository.ts`
- `src/modules/entity-distribution/entity-distribution.service.ts`
- `src/modules/entity-distribution/entity-distribution-ai.ts`
- `src/modules/entity-distribution/entity-distribution-observability.ts`
- `src/modules/entity-distribution/entity-distribution.routes.ts`
- `src/modules/entity-distribution/entity-distribution.web.repository.ts`
- `src/modules/entity-distribution/entity-distribution.web.routes.ts`

### AI integration

- Modify `prisma/models/ai-gateway.prisma`
- Modify `src/modules/ai/prompts/prompt-registry.ts`
- Modify `src/modules/ai/ai.worker.ts`

### UI/integration

- Modify `src/modules/distribution/distribution.routes.ts`
- Modify `src/modules/distribution/distribution.web.routes.ts`
- Modify `src/app.ts`
- Modify `src/views/partials/sidebar.ejs`
- Create `src/views/distribution/community.ejs`
- Create `src/views/entity-distribution/index.ejs`
- Create `src/views/entity-distribution/show.ejs`
- Create `tests/e2e/community-entity-geo.spec.ts`
- Modify `README.md`

---

### Task 22: Community GEO Policy and Manual-Handoff Contracts

**Files:**
- Create: `src/modules/distribution/community-policy.ts`
- Create: `src/modules/distribution/community-handoff.ts`
- Modify: `src/modules/distribution/distribution-adapter.ts`
- Test: `tests/unit/community-geo.policy.test.ts`
- Test: `tests/integration/community-geo.handoff.test.ts`

**Interfaces:**
- `COMMUNITY_PLATFORMS`: `REDDIT | QUORA | ZHIHU | JIANSHU | TIEBA | PTT | DCARD | MOBILE01 | X | THREADS`.
- `assertCommunityCapability(platform, requestedAction): void`.
- `buildCommunityHandoff(artifact): CommunityHandoffPackage`.
- Community capability is always `MANUAL_HANDOFF` in P8-C.

- [ ] **Step 1: Write failing no-auto-publish tests**

```ts
for (const platform of COMMUNITY_PLATFORMS) {
  expect(() => assertCommunityCapability(platform, 'PUBLISH')).toThrowErrorMatchingObject({
    code: 'DISTRIBUTION_MANUAL_ONLY'
  });
}
```

Also reject actions `REPLY`, `VOTE`, `FOLLOW`, `CREATE_ACCOUNT`, `SEND_DM` and any request to simulate third-party engagement.

- [ ] **Step 2: Write disclosure/link-policy tests**

Community artifact includes `brandLinkPolicy: 'OMIT_UNLESS_RELEVANT' | 'INCLUDE_EXPLICITLY'` and `authorshipMode: 'USER_REVIEW_REQUIRED'`. Default is omit-unless-relevant. Link inclusion is explicit in preview and cannot be hidden in generated markup.

- [ ] **Step 3: Run RED**

Run: `npx vitest run tests/unit/community-geo.policy.test.ts tests/integration/community-geo.handoff.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement server-side community capability registry**

No route input may override capability. Handoff package contains platform, title/question, body/answer, source list, optional explicit primary URL, review notes, and policy warnings. It contains no credentials/cookies/session data.

- [ ] **Step 5: Add distribution service guard**

Community targets can transition through `NOT_PREPARED -> DRAFT_READY -> APPROVED -> MANUAL_ACTION_REQUIRED`; `PUBLISHED` is recorded only after an authenticated human explicitly records a public URL/result after performing the action outside the automated path.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run tests/unit/community-geo.policy.test.ts tests/integration/community-geo.handoff.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution/community-policy.ts src/modules/distribution/community-handoff.ts src/modules/distribution/distribution-adapter.ts tests/unit/community-geo.policy.test.ts tests/integration/community-geo.handoff.test.ts
git commit -m "feat: add human-operated Community GEO policy"
```

---

### Task 23: Platform-Native Community Draft Generation Through P4

**Files:**
- Create: `src/modules/distribution/community-ai.ts`
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/20260821191000_add_p8_community_ai_task/migration.sql`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Test: `tests/unit/community-geo.ai.test.ts`
- Test: `tests/integration/community-geo.ai.test.ts`

**Interfaces:**
- New AI task type: `COMMUNITY_GEO_DRAFT`.
- Prompt ID: `community-geo-draft-v1`.
- `createCommunityGeoDraftTask(targetId, sourceContentVersion, actorId)`.

- [ ] **Step 1: Write failing source-grounding tests**

Assert factual claims/source refs in structured output must reference supplied primary publication/source IDs. Unknown claims are returned under `needsSource[]`, not presented as sourced facts.

- [ ] **Step 2: Write anti-impersonation/anti-consensus tests**

Prompt/parser rejects fields or phrases representing fabricated testimonials, fake commenters, vote counts, fake independent endorsements, or claims such as “the community agrees” without supplied evidence. Output has `voice: 'AUTHOR_OR_ORGANIZATION_DRAFT'` and never `INDEPENDENT_USER`.

- [ ] **Step 3: Write platform-shape tests**

Reddit/Quora/Zhihu-style artifacts may include question/title + answer/body; X/Threads artifacts are bounded short-form drafts. All include review notes and source refs; none include automation commands.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/community-geo.ai.test.ts tests/integration/community-geo.ai.test.ts`
Expected: FAIL.

- [ ] **Step 5: Add structured prompt/parser and existing AI-worker integration**

The request key binds target ID, exact source content version, platform and prompt version. Successful AI completion persists a new immutable `COMMUNITY_DRAFT` distribution artifact and stops at `DRAFT_READY`.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/community-geo.ai.test.ts tests/integration/community-geo.ai.test.ts`
Expected: PASS.

```bash
git add src/modules/distribution/community-ai.ts prisma/models/ai-gateway.prisma prisma/migrations/20260821191000_add_p8_community_ai_task src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/community-geo.ai.test.ts tests/integration/community-geo.ai.test.ts
git commit -m "feat: generate source-grounded Community GEO drafts"
```

---

### Task 24: Entity/Knowledge-Graph Suggestion Persistence and Source-Grounded Analysis

**Files:**
- Create: `prisma/models/entity-distribution.prisma`
- Create: `prisma/migrations/20260821190000_add_p8_entity_distribution/migration.sql`
- Create: `src/modules/entity-distribution/entity-distribution.types.ts`
- Create: `src/modules/entity-distribution/entity-distribution.repository.ts`
- Create: `src/modules/entity-distribution/entity-distribution.service.ts`
- Create: `src/modules/entity-distribution/entity-distribution-ai.ts`
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/20260821192000_add_p8_entity_suggestion_ai_task/migration.sql`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Test: `tests/unit/entity-distribution.ai.test.ts`
- Test: `tests/integration/entity-distribution.persistence.test.ts`

**Interfaces:**
- Targets: `WIKIDATA | WIKIPEDIA | BAIDU_BAIKE`.
- New AI task type: `ENTITY_DISTRIBUTION_SUGGESTION`.
- Prompt ID: `entity-distribution-suggestion-v1`.
- Candidate evidence state: `SUPPORTED | NEEDS_SOURCE | CONFLICTING`.
- `createEntitySuggestionSet(publicationId, target, actorId)`.

- [ ] **Step 1: Write failing persistence/immutability tests**

A suggestion set binds VERIFIED primary publication ID/content version, target, entity key/name, source-ref set, prompt version, and immutable candidate statements/relationships. Later source/publication changes create a new version; old suggestions remain auditable.

- [ ] **Step 2: Write failing evidence-state tests**

```ts
expect(classifyCandidate({ sourceRefs: ['src-1'], conflicts: [] })).toBe('SUPPORTED');
expect(classifyCandidate({ sourceRefs: [], conflicts: [] })).toBe('NEEDS_SOURCE');
expect(classifyCandidate({ sourceRefs: ['src-1'], conflicts: ['src-2'] })).toBe('CONFLICTING');
```

AI output cannot override deterministic classification by labelling an unsupported claim supported.

- [ ] **Step 3: Write no-publish/notability tests**

There is no `publish()` interface for entity targets. Service rejects `PUBLISH`/`EDIT_REMOTE` with `ENTITY_AUTOMATION_NOT_ALLOWED`. Prompt says notability is a review question, not an AI-decided fact.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/unit/entity-distribution.ai.test.ts tests/integration/entity-distribution.persistence.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement source-grounded suggestion generation**

Structured result may contain candidate names/aliases/descriptions, sameAs/external identifiers, relationships, statement suggestions, missing evidence, conflicting evidence and human review notes. Every supported candidate lists source IDs that must be a subset of supplied refs.

- [ ] **Step 6: Persist immutable versioned suggestion sets**

Add PostgreSQL immutability trigger for suggestion version rows. AI completion materializes a suggestion version only; it never modifies P3 entity facts or P7 opportunity records.

- [ ] **Step 7: Run GREEN and commit**

Run: `npx prisma validate && npx prisma generate && npx vitest run tests/unit/entity-distribution.ai.test.ts tests/integration/entity-distribution.persistence.test.ts`
Expected: PASS.

```bash
git add prisma/models/entity-distribution.prisma prisma/migrations/20260821190000_add_p8_entity_distribution prisma/migrations/20260821192000_add_p8_entity_suggestion_ai_task src/modules/entity-distribution prisma/models/ai-gateway.prisma src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/entity-distribution.ai.test.ts tests/integration/entity-distribution.persistence.test.ts
git commit -m "feat: add source-grounded entity distribution suggestions"
```

---

### Task 25: Community/Entity APIs, Governance UI and Safe Observability

**Files:**
- Create: `src/modules/entity-distribution/entity-distribution-observability.ts`
- Create: `src/modules/entity-distribution/entity-distribution.routes.ts`
- Create: `src/modules/entity-distribution/entity-distribution.web.repository.ts`
- Create: `src/modules/entity-distribution/entity-distribution.web.routes.ts`
- Modify: `src/modules/distribution/distribution.routes.ts`
- Modify: `src/modules/distribution/distribution.web.routes.ts`
- Modify: `src/app.ts`
- Modify: `src/views/partials/sidebar.ejs`
- Create: `src/views/distribution/community.ejs`
- Create: `src/views/entity-distribution/index.ejs`
- Create: `src/views/entity-distribution/show.ejs`
- Test: `tests/integration/community-entity-geo.api.test.ts`

**Interfaces:**
- Community UI: prepared drafts, source refs, brand-link policy, manual-handoff status and user-recorded public URL.
- Entity UI: entity candidate, target platform, SUPPORTED/NEEDS_SOURCE/CONFLICTING statements, exact source refs, version/history and copy/export actions.

- [ ] **Step 1: Write failing feature/project-boundary tests**

Advanced can use Community GEO draft workflow. Enterprise enables entity/governance center. Cross-project target/publication/suggestion IDs are rejected before reads of private data. Entity routes expose no automatic publish endpoint.

- [ ] **Step 2: Write no-side-effect GET tests**

GET community/entity pages must not create AI tasks, queue jobs, distribution targets or provider requests.

- [ ] **Step 3: Write explicit human completion tests**

Only POST action with actor context may record a manually published community URL. It validates public HTTPS URL and stores actor/time; it does not claim content was independently authored or verified by the platform.

- [ ] **Step 4: Run RED**

Run: `npx vitest run tests/integration/community-entity-geo.api.test.ts`
Expected: FAIL.

- [ ] **Step 5: Implement bounded API/web surfaces**

No arbitrary platform names/actions. Entity export produces structured JSON/text handoff only. Community page visibly states “人工发布/人工审核” and never renders an auto-publish button for community targets.

- [ ] **Step 6: Add safe observability**

Events: `community.draft.prepared`, `community.handoff.recorded`, `entity.suggestion.completed`, `entity.suggestion.failed`. Metadata allowlist: internal IDs, target platform, status/reason, source-ref count, candidate count, duration; never article/draft body, account credentials, prompt/response, raw sources or private provenance.

- [ ] **Step 7: Run GREEN and commit**

Run: `npx vitest run tests/integration/community-entity-geo.api.test.ts`
Expected: PASS.

```bash
git add src/modules/entity-distribution src/modules/distribution/distribution.routes.ts src/modules/distribution/distribution.web.routes.ts src/app.ts src/views/partials/sidebar.ejs src/views/distribution/community.ejs src/views/entity-distribution tests/integration/community-entity-geo.api.test.ts
git commit -m "feat: expose Community GEO and entity suggestion workflows"
```

---

### Task 26: P8-C E2E, Operator Documentation and Release Gate

**Files:**
- Create: `tests/e2e/community-entity-geo.spec.ts`
- Create: `docs/development/p8-safe-publishing-distribution.md`
- Modify: `README.md`

**Interfaces:**
- Final P8-C user path covers VERIFIED primary content → community draft/manual handoff and VERIFIED primary content → entity suggestion review/export.

- [ ] **Step 1: Add Community GEO E2E**

```text
VERIFIED /culture publication
  -> create Reddit COMMUNITY_DRAFT
  -> generate source-grounded draft
  -> review shows MANUAL_HANDOFF
  -> no auto-publish control exists
  -> human records external public URL
```

Assert a forged request attempting `PUBLISH` returns `DISTRIBUTION_MANUAL_ONLY`.

- [ ] **Step 2: Add entity suggestion E2E**

```text
VERIFIED publication
  -> create Wikidata suggestion set
  -> show SUPPORTED / NEEDS_SOURCE / CONFLICTING candidates
  -> export suggestion package
  -> no remote-edit action exists
```

- [ ] **Step 3: Write operator guide**

Document P8-A/B/C queues, feature gates, site/channel setup, Git write safety, approval/stale contract, verification semantics, manual-handoff platforms, entity non-automation boundary, safe observability, incident triage and rollback. Explicitly document that community/encyclopedia credentials are not required or supported for automated posting in P8-C.

- [ ] **Step 4: Run focused GREEN**

Run:

```bash
npm run typecheck
npx vitest run tests/unit/community-geo.*.test.ts tests/unit/entity-distribution.*.test.ts tests/integration/community-geo.*.test.ts tests/integration/entity-distribution.*.test.ts tests/integration/community-entity-geo.api.test.ts
npx playwright test tests/e2e/community-entity-geo.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run exact P8-C release gate**

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

Expected: PASS locally and exact-head GitHub Actions `verify`, Chromium `e2e`, and `production-audit` PASS.

- [ ] **Step 6: Commit P8-C completion**

```bash
git add tests/e2e/community-entity-geo.spec.ts docs/development/p8-safe-publishing-distribution.md README.md
git commit -m "feat: complete P8-C Community GEO and entity distribution"
```

Record exact head SHA/workflow run. Merge P8-C into the common P8 integration branch, then execute the P8 Program final integration/release plan without stopping for a new architecture decision.
