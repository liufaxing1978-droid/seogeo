# P8-C Community GEO & Entity/Knowledge Graph Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe community-native draft preparation and structured entity/knowledge-graph suggestions on top of the completed P8 distribution control plane, with human-operated final actions and no autonomous community or knowledge-platform posting.

**Architecture:** P8-C reuses `DistributionTarget`, immutable `DistributionArtifact`, append-only `DistributionTargetEvent`, the existing P4 advisory AI task pipeline, and the P8-B distribution REST/UI. Community targets become explicit `MANUAL_HANDOFF` targets with bounded user/approved-discovery context and may record a public URL only after human action; entity targets remain `PREPARE_ONLY` and produce `ENTITY_SUGGESTION` artifacts for Enterprise users. Exact target context is hashed into AI request identity so changing a question/topic cannot reuse an old AI task or artifact.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest/Playwright, existing P4 DeepSeek AI Gateway.

**Spec:** `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md` sections 16, 17, 18, 19, 20, 21, 22, 23, 24, 25 and 26.

## Global Constraints

- Community channels are not article mirrors; output must be community-native, useful and source-backed.
- Community final publishing is human-operated. No unofficial browser automation, fake discussion, mass posting, fabricated endorsement or platform-policy bypass.
- Brand/source links are optional and never mandatory.
- Community capability is `MANUAL_HANDOFF`; it never exposes provider auto-publish.
- Entity targets (`WIKIDATA`, `WIKIPEDIA`, `BAIDU_BAIKE`) use `ENTITY_SUGGESTION` and remain `PREPARE_ONLY`.
- Entity/knowledge-graph management is Enterprise-only via existing `PUBLICATION_ENTERPRISE_GOVERNANCE`; community preparation uses existing Advanced+ `PUBLICATION_DISTRIBUTION`.
- Normal P8-C work still requires the bound primary `PublicationExecution` to be `VERIFIED` and exact-source-version matched.
- DeepSeek is advisory only. It cannot approve, publish, verify, assert a platform edit happened, invent citations/endorsements, or mutate deterministic P7/P8 facts.
- Returned AI source references must be a subset of supplied persisted source references.
- GET rendering reads persisted state only and performs zero queue, DeepSeek or provider side effects.
- Credentials, authorization headers, full prompts/responses, article bodies and raw provider payloads never enter observability metadata.
- No P8-C path auto-submits Wikipedia/Wikidata/Baidu Baike edits.
- All new list/string/object fields have explicit bounds; invalid or unsupported platform/mode combinations fail closed rather than being silently normalized.

---

### Task 22: Community platform vocabulary, target context and policy contract

**Files:**
- Modify: `prisma/models/distribution.prisma`
- Create: `prisma/migrations/20260822010000_add_p8c_community_target_context/migration.sql`
- Create: `src/modules/distribution/distribution-target-policy.ts`
- Modify: `src/modules/distribution/distribution-adapter.ts`
- Test: `tests/unit/distribution.p8c-policy.test.ts`
- Test: `tests/integration/distribution.p8c-persistence.test.ts`

**Interfaces:**
- Produces Prisma platforms `JIANSHU | TIEBA | PTT | DCARD | MOBILE01` in addition to existing `REDDIT | QUORA | ZHIHU` community and `WIKIDATA | WIKIPEDIA | BAIDU_BAIKE` entity platforms.
- Adds nullable `targetContext Json?` to `DistributionTarget`; it is bounded and validated by application code, not interpreted as provider credentials.
- Produces `assertDistributionTargetPolicy(input)` and `normalizeDistributionTargetContext(input)`.
- Community platforms require `COMMUNITY_DRAFT` and resolve to `MANUAL_HANDOFF`.
- Entity platforms require `ENTITY_SUGGESTION` and resolve to `PREPARE_ONLY`.

- [ ] **Step 1: Write failing policy tests**

Create `tests/unit/distribution.p8c-policy.test.ts` with contracts equivalent to:

```ts
import { describe, expect, it } from 'vitest';
import {
  assertDistributionTargetPolicy,
  normalizeDistributionTargetContext
} from '../../src/modules/distribution/distribution-target-policy.js';
import { resolveDistributionCapability } from '../../src/modules/distribution/distribution-adapter.js';

describe('P8-C target policy', () => {
  it('allows bounded community context only on COMMUNITY_DRAFT targets', () => {
    expect(normalizeDistributionTargetContext({
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      context: {
        sourceType: 'USER',
        question: 'How can a primary source explain this tradition?',
        topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
        includeBrandLink: false
      }
    })).toMatchObject({ sourceType: 'USER', includeBrandLink: false });
    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ADVANCED', platform: 'REDDIT', mode: 'SUMMARY'
    })).toThrowError(/COMMUNITY_DRAFT/);
  });

  it('keeps community targets manual and entity targets prepare-only', () => {
    expect(resolveDistributionCapability('REDDIT', { trustedPublishAdapterConfigured: true })).toBe('MANUAL_HANDOFF');
    expect(resolveDistributionCapability('WIKIPEDIA', { trustedPublishAdapterConfigured: true })).toBe('PREPARE_ONLY');
  });

  it('requires Enterprise governance for ENTITY_SUGGESTION', () => {
    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ADVANCED', platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION'
    })).toThrowError(/ENTERPRISE/);
    expect(() => assertDistributionTargetPolicy({
      planLevel: 'ENTERPRISE', platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION'
    })).not.toThrow();
  });
});
```

Also assert: question <= 4000 chars, topic URL <= 2048 and HTTP(S) only, `sourceType` is `USER | APPROVED_DISCOVERY`, and community/entity mode cannot be used with P8-B article platforms.

- [ ] **Step 2: Write failing persistence/migration tests**

In `tests/integration/distribution.p8c-persistence.test.ts`, create an Advanced project + VERIFIED publication and prove `DistributionTarget` can persist a bounded community `targetContext` without changing the immutable artifact/event guarantees. Create an Enterprise entity target and prove its context is project-scoped. Verify the new enum values exist by creating at least `JIANSHU`, `PTT` and `MOBILE01` targets.

- [ ] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/unit/distribution.p8c-policy.test.ts tests/integration/distribution.p8c-persistence.test.ts
```

Expected: FAIL because the new enum values, `targetContext` column and policy module do not exist.

- [ ] **Step 4: Add the forward-only Prisma migration**

Extend `DistributionPlatform` with:

```prisma
JIANSHU
TIEBA
PTT
DCARD
MOBILE01
```

Add to `DistributionTarget`:

```prisma
targetContext Json?
```

Migration uses `ALTER TYPE "DistributionPlatform" ADD VALUE IF NOT EXISTS ...` once per value and `ALTER TABLE "DistributionTarget" ADD COLUMN "targetContext" JSONB;`. Do not rewrite P8-B migrations.

- [ ] **Step 5: Implement the pure target policy**

Create `distribution-target-policy.ts` with explicit platform sets and a strict Zod community context:

```ts
const communityPlatforms = new Set<DistributionPlatform>([
  'REDDIT', 'QUORA', 'ZHIHU', 'JIANSHU', 'TIEBA', 'PTT', 'DCARD', 'MOBILE01'
]);
const entityPlatforms = new Set<DistributionPlatform>([
  'WIKIDATA', 'WIKIPEDIA', 'BAIDU_BAIKE'
]);

const CommunityTargetContextSchema = z.object({
  sourceType: z.enum(['USER', 'APPROVED_DISCOVERY']),
  question: z.string().trim().min(1).max(4000),
  topicUrl: z.string().url().max(2048).refine(isHttpUrl).nullable().optional(),
  includeBrandLink: z.boolean().default(false)
}).strict();
```

`assertDistributionTargetPolicy` must reject mismatched platform/mode and Advanced entity targets. It must never infer Enterprise from platform capability.

- [ ] **Step 6: Update capability resolution**

Change community platforms from P8-B reserved `PREPARE_ONLY` to explicit P8-C `MANUAL_HANDOFF`; keep all entity platforms `PREPARE_ONLY`. New community enum values are also `MANUAL_HANDOFF`.

- [ ] **Step 7: Run GREEN and commit**

Run:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npx vitest run tests/unit/distribution.p8c-policy.test.ts tests/integration/distribution.p8c-persistence.test.ts
```

Expected: PASS.

```bash
git add prisma src/modules/distribution/distribution-target-policy.ts src/modules/distribution/distribution-adapter.ts tests/unit/distribution.p8c-policy.test.ts tests/integration/distribution.p8c-persistence.test.ts
git commit -m "feat: add P8-C distribution target policy"
```

---

### Task 23: Community-native AI draft contract through P4

**Files:**
- Modify: `prisma/models/ai-gateway.prisma`
- Create: `prisma/migrations/20260822013000_add_p8c_community_entity_ai_tasks/migration.sql`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/modules/distribution/distribution-ai.ts`
- Test: `tests/unit/distribution.p8c-community-ai.test.ts`
- Test: `tests/integration/distribution.p8c-community-ai.test.ts`
- Modify: `tests/unit/ai.prompt-registry.test.ts`

**Interfaces:**
- Produces prompt ID `distribution-community-draft-v1`.
- Reuses `PUBLICATION_CONTENT_ADAPTATION` task type unless the existing Prisma enum requires a new explicit value; no direct DeepSeek transport is introduced.
- `distributionAdaptationRequestKey` gains a context hash for `COMMUNITY_DRAFT` so changing the question/topic produces a different deterministic request identity.
- Community artifact freezes the exact question/topic policy context in `platformMetadata` and returned `sourceRefs`.

- [ ] **Step 1: Write failing community output-safety tests**

Create a strict `CommunityDraftOutputSchema` contract:

```ts
const CommunityDraftOutputSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(30000),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(120)).max(20),
  sourceRefs: z.array(z.string().min(1).max(300)).max(40),
  promotionalLanguageDetected: z.boolean(),
  brandLinkIncluded: z.boolean(),
  originalUrl: z.string().url(),
  canonicalUrl: z.null()
}).strict();
```

Tests must reject unknown source refs, a changed `originalUrl`, any `canonicalUrl` for community draft, `brandLinkIncluded=true` when target context says `includeBrandLink=false`, and unbounded body/tag fields.

- [ ] **Step 2: Lock context-hash identity**

Test:

```ts
expect(communityDistributionRequestKey({ ...base, question: 'A' }))
  .not.toBe(communityDistributionRequestKey({ ...base, question: 'B' }));
```

The hash input must include normalized target context, publication ID, exact source content version, platform, mode and prompt version. Do not use mutable timestamps.

- [ ] **Step 3: Lock source-reference input**

Integration fixture creates `ContentSourceReference` rows on the bound draft. `buildDistributionAdaptationTaskInput` for `COMMUNITY_DRAFT` must supply bounded reference IDs in addition to the existing publication/draft-version refs. Returned AI refs not in that supplied set fail closed.

- [ ] **Step 4: Run RED**

Run:

```bash
npx vitest run tests/unit/distribution.p8c-community-ai.test.ts tests/integration/distribution.p8c-community-ai.test.ts tests/unit/ai.prompt-registry.test.ts
```

Expected: FAIL because `COMMUNITY_DRAFT` is currently rejected by `promptIdForDistributionMode` and the prompt is not registered.

- [ ] **Step 5: Register the community prompt**

Prompt contract must explicitly require:

```text
- answer the supplied question/topic rather than mirror the article;
- use only supplied primary/source-reference facts;
- never fabricate endorsement, independent user testimony, citations or platform activity;
- do not insert a brand/source link unless includeBrandLink=true;
- flag promotional language instead of hiding it;
- produce one draft for human review only; never claim it was posted.
```

The prompt returns only the strict JSON schema above.

- [ ] **Step 6: Extend distribution AI task/materialization**

`promptIdForDistributionMode('COMMUNITY_DRAFT')` returns `distribution-community-draft-v1`. Build fact snapshot includes normalized community target context. Materialization maps community output to immutable `DistributionArtifact`:

```ts
{
  title: output.title,
  body: output.body,
  summary: output.summary,
  tags: output.tags,
  originalUrl: output.originalUrl,
  canonicalUrl: null,
  sourceRefs: output.sourceRefs,
  platformMetadata: {
    kind: 'COMMUNITY_DRAFT',
    contextHash,
    question: normalized.question,
    topicUrl: normalized.topicUrl ?? null,
    includeBrandLink: normalized.includeBrandLink,
    promotionalLanguageDetected: output.promotionalLanguageDetected,
    brandLinkIncluded: output.brandLinkIncluded
  }
}
```

Successful materialization still stops target at `DRAFT_READY`.

- [ ] **Step 7: Run GREEN and commit**

Run the focused tests plus `npm run typecheck`. Expected: PASS.

```bash
git add prisma src/modules/ai src/modules/distribution/distribution-ai.ts tests/unit/distribution.p8c-community-ai.test.ts tests/integration/distribution.p8c-community-ai.test.ts tests/unit/ai.prompt-registry.test.ts
git commit -m "feat: prepare source-backed community GEO drafts"
```

---

### Task 24: Entity/knowledge-graph suggestion contract

**Files:**
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Modify: `src/modules/distribution/distribution-ai.ts`
- Create: `src/modules/distribution/entity-suggestion.ts`
- Test: `tests/unit/distribution.p8c-entity.test.ts`
- Test: `tests/integration/distribution.p8c-entity.test.ts`
- Modify: `tests/unit/ai.prompt-registry.test.ts`

**Interfaces:**
- Produces prompt ID `distribution-entity-suggestion-v1` for `ENTITY_SUGGESTION`.
- Produces strict `EntitySuggestionOutput` with bounded labels/descriptions, factual attributes, SameAs candidates, relationships, reliable-source refs, missing-data report, policy reminders and human checklist.
- Entity outputs are immutable distribution artifacts with `canonicalUrl=null` and `platformMetadata.kind='ENTITY_SUGGESTION'`.

- [ ] **Step 1: Write failing strict entity schema tests**

Define the output contract in tests first:

```ts
const expected = {
  entityName: '兴善堂',
  labels: [{ language: 'zh-CN', value: '兴善堂' }],
  descriptions: [{ language: 'zh-CN', value: '...' }],
  attributes: [{ property: 'officialWebsite', value: 'https://xingshantang.org', sourceRefs: ['CONTENT_SOURCE_REFERENCE:...'] }],
  sameAs: [{ url: 'https://example.org/id', sourceRefs: ['CONTENT_SOURCE_REFERENCE:...'] }],
  relationships: [],
  reliableSourceRefs: ['CONTENT_SOURCE_REFERENCE:...'],
  missingData: ['foundingDate'],
  policyReminders: ['Human review required; avoid promotional or conflict-of-interest editing.'],
  humanChecklist: ['Verify every factual claim against the cited reliable source before editing.']
};
```

Bound labels/descriptions/attributes/relationships/sameAs to <= 50 each; strings <= 2000 unless a tighter field limit applies; URLs HTTP(S) only; source refs <= 80 and must be supplied.

- [ ] **Step 2: Lock entity anti-fabrication behavior**

Tests reject:
- an attribute whose `sourceRefs` contain an unknown ref;
- a SameAs URL without a supplied supporting ref;
- empty `reliableSourceRefs` when factual attributes are emitted;
- provider output claiming an edit was submitted/published;
- unknown extra JSON keys.

- [ ] **Step 3: Run RED**

Run:

```bash
npx vitest run tests/unit/distribution.p8c-entity.test.ts tests/integration/distribution.p8c-entity.test.ts tests/unit/ai.prompt-registry.test.ts
```

Expected: FAIL because `ENTITY_SUGGESTION` has no prompt/parser/materializer.

- [ ] **Step 4: Implement `entity-suggestion.ts`**

Export:

```ts
export const EntitySuggestionOutputSchema: z.ZodType<...>;
export type EntitySuggestionOutput = z.infer<typeof EntitySuggestionOutputSchema>;
export function parseEntitySuggestionOutput(content: string, suppliedRefs: unknown): EntitySuggestionOutput;
export function renderEntitySuggestionBody(output: EntitySuggestionOutput): string;
```

`renderEntitySuggestionBody` deterministically creates a review-friendly Markdown body; structured fields remain frozen in `platformMetadata`.

- [ ] **Step 5: Register and route the entity prompt**

Prompt requires reliable supplied sources, factual language, missing-data disclosure, conflict-of-interest/policy reminders and a human edit checklist. It explicitly says the model must not claim submission, verification, notability acceptance or platform approval.

- [ ] **Step 6: Materialize immutable entity artifacts**

For `ENTITY_SUGGESTION`, store:

```ts
{
  title: output.entityName,
  body: renderEntitySuggestionBody(output),
  summary: output.descriptions[0]?.value ?? 'Entity suggestion for human review',
  tags: [],
  originalUrl: primaryOriginalUrl,
  canonicalUrl: null,
  sourceRefs: output.reliableSourceRefs,
  platformMetadata: { kind: 'ENTITY_SUGGESTION', ...output }
}
```

Target ends at `DRAFT_READY`; there is no provider publish path.

- [ ] **Step 7: Run GREEN and commit**

Run focused tests + `npm run typecheck`. Expected: PASS.

```bash
git add src/modules/ai src/modules/distribution/entity-suggestion.ts src/modules/distribution/distribution-ai.ts tests/unit/distribution.p8c-entity.test.ts tests/integration/distribution.p8c-entity.test.ts tests/unit/ai.prompt-registry.test.ts
git commit -m "feat: prepare P8-C entity suggestions"
```

---

### Task 25: P8-C service gates, lifecycle and safe observability

**Files:**
- Modify: `src/modules/distribution/distribution.service.ts`
- Modify: `src/modules/distribution/distribution-observability.ts`
- Modify: `src/modules/distribution/distribution.routes.ts`
- Test: `tests/integration/distribution.p8c-service.test.ts`
- Test: `tests/integration/distribution.p8c-api.test.ts`
- Test: `tests/unit/distribution.p8c-observability.test.ts`

**Interfaces:**
- Create-target applies `assertDistributionTargetPolicy` before persistence.
- Preparation applies mode-level plan gate before queue/AI work.
- Community approve -> manual handoff -> human-result URL path reuses existing manual-result lifecycle.
- Entity approve is allowed for review state, but publish/manual-result/verify routes reject before provider/service side effects because entity capability is `PREPARE_ONLY`.

- [ ] **Step 1: Write failing project/mode gate tests**

Lock these cases:

```text
STANDARD + REDDIT COMMUNITY_DRAFT -> FEATURE_NOT_AVAILABLE before repository/queue
ADVANCED + REDDIT COMMUNITY_DRAFT -> allowed
ADVANCED + WIKIDATA ENTITY_SUGGESTION -> FEATURE_NOT_AVAILABLE before repository/queue
ENTERPRISE + WIKIDATA ENTITY_SUGGESTION -> allowed
cross-project target ID -> 404 before preparation/approval/publish work
```

- [ ] **Step 2: Write failing lifecycle tests**

Community path:

```text
VERIFIED primary -> COMMUNITY_DRAFT target -> prepare -> DRAFT_READY -> approve -> APPROVED
-> publish action with manual adapter -> MANUAL_ACTION_REQUIRED
-> human records https URL -> PUBLISHED
```

Assert provider publish is never called.

Entity path:

```text
VERIFIED primary -> ENTITY_SUGGESTION target -> prepare -> DRAFT_READY -> approve -> APPROVED
-> publish/manual-result/verify requests all fail closed
```

Primary `PublicationExecution.status` remains `VERIFIED` throughout.

- [ ] **Step 3: Lock observability**

Add allowlisted events:

```text
community.draft.prepared
entity.suggestion.prepared
```

Metadata may contain project/target/artifact/platform/mode/status/sourceVersion/reason/duration/contextHash and safe counts only. Tests inject `body`, `question`, `prompt`, `token`, `sourceUrl`, `providerRaw`, `credential` and assert they are dropped.

- [ ] **Step 4: Run RED**

Run the three P8-C service/API/observability test files. Expected: FAIL on absent policy gates/events.

- [ ] **Step 5: Implement minimal service/API integration**

Create-target normalization persists only validated `targetContext`. Service gate logic uses:

```ts
if (target.mode === 'ENTITY_SUGGESTION') {
  require PUBLICATION_ENTERPRISE_GOVERNANCE;
} else {
  require PUBLICATION_DISTRIBUTION;
}
```

Do not add a new licensing feature unless the existing matrix cannot express the approved spec.

- [ ] **Step 6: Emit safe completion events**

Emit `community.draft.prepared` / `entity.suggestion.prepared` only after artifact materialization succeeds. Do not log output content.

- [ ] **Step 7: Run GREEN and commit**

Run focused tests and `npm run typecheck`. Expected: PASS.

```bash
git add src/modules/distribution tests/integration/distribution.p8c-service.test.ts tests/integration/distribution.p8c-api.test.ts tests/unit/distribution.p8c-observability.test.ts
git commit -m "feat: enforce P8-C human-operated workflows"
```

---

### Task 26: Community/Entity persisted-read Web UI and E2E

**Files:**
- Modify: `src/modules/distribution/distribution.web.repository.ts`
- Modify: `src/modules/distribution/distribution.web.routes.ts`
- Modify: `src/views/distribution/index.ejs`
- Modify: `src/views/distribution/show.ejs`
- Modify: `src/views/distribution/artifact.ejs`
- Test: `tests/e2e/distribution-p8c.spec.ts`

**Interfaces:**
- Existing `多渠道分发` remains the single top-level workspace.
- Community target detail shows question/topic, `MANUAL_HANDOFF`, promotional-language flag, optional-brand-link decision and explicit “人工发布 / 回填结果”.
- Entity target/artifact detail shows `ENTITY_SUGGESTION`, source-backed fields, missing-data report, policy reminder and human checklist; no auto-publish/manual-result button is rendered.
- GET routes remain database-only.

- [ ] **Step 1: Write failing E2E fixtures and assertions**

Seed:
- Advanced Reddit `COMMUNITY_DRAFT` artifact at `MANUAL_ACTION_REQUIRED` with `includeBrandLink=false` and `promotionalLanguageDetected=false`;
- Enterprise Wikidata `ENTITY_SUGGESTION` artifact at `DRAFT_READY` with reliable sources, missing data and policy reminder.

Assert the Distribution center shows separate Community GEO and Entity Suggestion semantics while keeping ORIGINAL primary URL visible.

- [ ] **Step 2: Lock misleading-control absence**

Playwright assertions:

```ts
await expect(communityPage.getByRole('button', { name: '自动发布' })).toHaveCount(0);
await expect(entityPage.getByRole('button', { name: '自动发布' })).toHaveCount(0);
await expect(entityPage.getByText('人工发布 / 回填结果')).toHaveCount(0);
```

- [ ] **Step 3: Run RED**

Run:

```bash
npx playwright test tests/e2e/distribution-p8c.spec.ts
```

Expected: FAIL because P8-C-specific persisted fields are not rendered.

- [ ] **Step 4: Extend persisted-read view model**

Decode only bounded known P8-C metadata from persisted `platformMetadata`. Do not invoke AI, queue or providers. Unknown metadata keys are ignored by the view model.

- [ ] **Step 5: Extend existing EJS views**

Use existing cards/badges/table patterns. Add clear labels:

```text
Community GEO · 人工发布
品牌链接：未包含 / 已明确允许
推广性语言：未检测 / 需人工复核
Entity Suggestion · 人工编辑清单
可靠来源
缺失数据
平台/利益冲突提醒
```

Do not add a second sidebar area or duplicate Distribution navigation.

- [ ] **Step 6: Run GREEN and commit**

Run the P8-C E2E plus existing `tests/e2e/distribution.spec.ts`. Expected: PASS.

```bash
git add src/modules/distribution/distribution.web.* src/views/distribution tests/e2e/distribution-p8c.spec.ts
git commit -m "feat: expose P8-C review workspace"
```

---

### Task 27: P8-C full regression, release docs and final integration gate

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-22-p8c-community-entity-support.md` only to mark completed evidence if the repository convention requires it; do not rewrite the approved spec.
- Test: all P8-C + full regression suites.

**Interfaces:**
- README milestone becomes `P0 - P8-C complete` only after pre-release exact-head tests pass.
- Final P8-C integration PR targets `main` and independently runs `verify`, Chromium `e2e`, `production-audit` on the real merge ref.

- [ ] **Step 1: Run focused P8-C gate**

```bash
npm run typecheck
npx vitest run tests/unit/distribution.p8c-*.test.ts tests/integration/distribution.p8c-*.test.ts
npx playwright test tests/e2e/distribution-p8c.spec.ts tests/e2e/distribution.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run exact full release gate**

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

Expected: PASS.

- [ ] **Step 3: Update README release boundary**

Document:
- community = human-operated `MANUAL_HANDOFF`, source-backed and non-mandatory brand link;
- entity = Enterprise `ENTITY_SUGGESTION`, `PREPARE_ONLY`, no auto-submit;
- target-context hash/idempotency;
- exact-source-version and primary VERIFIED prerequisites;
- safe observability and no real community/knowledge-platform credentials in CI;
- exact pre-integration head/run evidence.

- [ ] **Step 4: Re-run exact-head CI after README commit**

The README-marked head must independently pass `verify`, Chromium `e2e` and `production-audit` before final integration.

- [ ] **Step 5: Open final P8-C integration PR to `main`**

PR body records the exact head SHA, workflow run, safety invariants and no-live-provider evidence. Require branch comparison `ahead > 0`, `behind = 0` before merge.

- [ ] **Step 6: Merge only the verified exact head**

Use expected-head SHA guarding. Do not merge if CI has been superseded by a newer head.

- [ ] **Step 7: Continue to the next approved program milestone**

After the final integration merge, re-read the roadmap/spec before creating any new autonomous execution capability. P8-C does not authorize P9 self-optimization.
