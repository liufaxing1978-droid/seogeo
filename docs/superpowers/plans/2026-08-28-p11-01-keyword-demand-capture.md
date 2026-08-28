# P11-01 Keyword Demand Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped keyword demand capture center where operators can manually control strategic keywords such as `符纸`, measure deterministic site-content coverage, and review DeepSeek long-tail suggestions before explicitly accepting them into the authoritative keyword library.

**Architecture:** Add a focused `src/modules/keywords` domain backed by Prisma models for keywords, canonical parent relations, groups, advisory suggestions, and keyword audit events. Reuse existing project RBAC/CSRF boundaries, persisted `Page`/`PageSnapshot` facts for coverage, and the existing queued `AiTask -> BullMQ -> DeepSeek -> structured output -> atomic materialize` pipeline for advisory expansion; no keyword-center read may trigger a fresh crawl or provider request.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL 17, EJS, Zod 3, BullMQ/Redis 7, Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-p11-01-keyword-demand-capture-design.md`

## Global Constraints

- AI remains advisory only; DeepSeek output never writes authoritative `Keyword` rows directly.
- Manual keyword creation is the primary authoritative path.
- Project + normalized keyword identity is unique across **all** statuses; an archived duplicate must be restored rather than recreated.
- Normalization is conservative: Unicode NFKC, trim, collapse repeated whitespace, lowercase Latin text; do not convert Traditional/Simplified Chinese or apply semantic stemming.
- A child has at most one canonical parent in P11-01; cycles and self-parenting are rejected.
- Locked keywords require explicit `acknowledgeLock: true` for destructive/strategic mutations; AI cannot bypass the lock.
- Keyword reads require `PROJECT_READ`; authoritative keyword mutations require `CONTENT_WRITE`; AI suggestion generation requires `AI_RUN`; browser mutations require CSRF.
- Cross-project identifiers fail closed and must not disclose whether the referenced resource exists elsewhere.
- Coverage truth is internal persisted-site evidence only: `STRONG`, `PARTIAL`, `NONE`, or `UNKNOWN`; it is not Google/Baidu/Bing rank or consumer AI visibility.
- Missing usable crawl evidence is `UNKNOWN`, never `NONE`.
- Keyword-center reads must not enqueue a crawl, make Search Console calls, or make AI/provider calls.
- Keep Search Console read-only, preserve `PR_CREATED != DEPLOYED != VERIFIED`, and do not grant merge/deploy/rollback/publication authority.
- Do not start P11-02 ranking/provider work in this plan.
- Every implementation task follows RED -> minimal GREEN -> focused verification -> commit. Each P11-01A/B/C/D boundary then receives exact-head full CI evidence before moving forward.

---

## File Structure

### New keyword-domain files

- `src/modules/keywords/keyword-normalize.ts` — conservative keyword normalization only.
- `src/modules/keywords/keyword.types.ts` — non-Prisma input/output interfaces and coverage view types.
- `src/modules/keywords/keyword.repository.ts` — Prisma persistence for keywords, relations, groups, suggestions, and audit rows; accepts a transaction client.
- `src/modules/keywords/keyword.service.ts` — authoritative manual keyword command semantics, lock checks, restore semantics, parent-cycle checks, group assignment, and suggestion decisions.
- `src/modules/keywords/keyword.routes.ts` — JSON API with project membership, capability, and CSRF middleware.
- `src/modules/keywords/keyword-coverage.repository.ts` — latest persisted active-page facts only.
- `src/modules/keywords/keyword-coverage.ts` — pure deterministic per-page scoring.
- `src/modules/keywords/keyword-coverage.service.ts` — project coverage orchestration with one persisted-fact read per project request.
- `src/modules/keywords/keyword-ai.ts` — AI task fact-packet builder, Zod output schema/parser, and atomic suggestion materializer.
- `src/modules/keywords/keyword.web.repository.ts` — read model for the keyword-center EJS page.
- `src/modules/keywords/keyword.web.routes.ts` — secured EJS GET/POST flows and CSRF token rendering.
- `src/views/keywords/index.ejs` — summary, library, tree/detail, coverage, manual mutation, and advisory suggestion UI.
- `src/public/css/p11-keywords.css` — responsive keyword-center styles only.

### Existing files modified

- `prisma/schema.prisma` — P11 keyword enums/models plus `AiTaskType.KEYWORD_EXPANSION` and project relations.
- `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql` — immutable forward migration for P11-01 schema.
- `src/app.ts` — mount keyword API and web routers and expose injectable test ports.
- `src/modules/ai/ai.worker.ts` — dispatch/parse/materialize `KEYWORD_EXPANSION` using existing AI execution semantics.
- `src/modules/ai/prompts/prompt-registry.ts` — add `keyword-expansion-v1` JSON prompt definition.
- `src/views/partials/sidebar.ejs` — add project-scoped `关键词中心` navigation.
- `src/views/layout.ejs` — load `p11-keywords.css`.

### New tests

- `tests/unit/keyword-normalize.test.ts`
- `tests/integration/keywords.repository.test.ts`
- `tests/integration/keywords.service.test.ts`
- `tests/integration/keywords.api.test.ts`
- `tests/unit/keyword-coverage.test.ts`
- `tests/integration/keywords.coverage.test.ts`
- `tests/integration/keywords.web.test.ts`
- `tests/unit/keyword-ai.test.ts`
- `tests/integration/keywords.ai-worker.test.ts`
- `tests/integration/keywords.suggestions.test.ts`
- `tests/e2e/keywords.spec.ts`

### Existing tests modified

- `tests/unit/ai.prompt-registry.test.ts` — register and validate `keyword-expansion-v1`.
- `tests/unit/ai.worker.test.ts` — cover prompt-id/result-summary dispatch for `KEYWORD_EXPANSION` if exhaustive task-type assertions require it.
- `tests/e2e/p10-shell.spec.ts` — assert the new project-scoped sidebar link without regressing the P10 shell.

---

# P11-01A — Keyword Domain Foundation

### Task 1: Add keyword schema, migration, and normalization contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql`
- Create: `src/modules/keywords/keyword-normalize.ts`
- Create: `src/modules/keywords/keyword.types.ts`
- Create: `tests/unit/keyword-normalize.test.ts`

**Interfaces:**
- Produces: `normalizeKeywordText(text: string): string`
- Produces Prisma enums: `KeywordType`, `KeywordIntent`, `KeywordPriority`, `KeywordStatus`, `KeywordSource`, `KeywordSuggestionStatus`
- Produces Prisma models: `Keyword`, `KeywordRelation`, `KeywordGroup`, `KeywordGroupMembership`, `KeywordSuggestion`, `KeywordAuditEvent`
- Extends Prisma `AiTaskType` with `KEYWORD_EXPANSION`

- [ ] **Step 1: Write the normalization RED test**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeKeywordText } from '../../src/modules/keywords/keyword-normalize.js';

describe('normalizeKeywordText', () => {
  it('normalizes Unicode/spacing/Latin case without changing Chinese semantics', () => {
    expect(normalizeKeywordText('  Ｆｏｏ   符紙  ')).toBe('foo 符紙');
    expect(normalizeKeywordText('符紙')).not.toBe(normalizeKeywordText('符纸'));
  });
});
```

- [ ] **Step 2: Run the RED test**

Run: `npm test -- tests/unit/keyword-normalize.test.ts`

Expected: FAIL because `src/modules/keywords/keyword-normalize.ts` does not exist.

- [ ] **Step 3: Implement the minimal normalizer and domain view types**

```ts
// src/modules/keywords/keyword-normalize.ts
export function normalizeKeywordText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}
```

```ts
// src/modules/keywords/keyword.types.ts
import type {
  KeywordIntent,
  KeywordPriority,
  KeywordSource,
  KeywordStatus,
  KeywordType,
} from '@prisma/client';

export interface CreateManualKeywordInput {
  actorUserId: string;
  projectId: string;
  text: string;
  type: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  parentKeywordId?: string | null;
  groupIds?: string[];
  language?: string | null;
  targetCountry?: string | null;
  notes?: string | null;
  locked?: boolean;
}

export interface KeywordCoverageEvidence {
  pageId: string;
  url: string;
  titleMatch: boolean;
  h1Match: boolean;
  metaDescriptionMatch: boolean;
  pathMatch: boolean;
  score: number;
}

export type KeywordCoverageStatus = 'STRONG' | 'PARTIAL' | 'NONE' | 'UNKNOWN';

export interface KeywordCoverageResult {
  status: KeywordCoverageStatus;
  reason: 'MATCHED' | 'NO_MATCH' | 'NO_ACTIVE_PAGE_EVIDENCE' | 'NO_USABLE_SNAPSHOT_EVIDENCE';
  matches: KeywordCoverageEvidence[];
}

export type KeywordListRecord = {
  id: string;
  projectId: string;
  text: string;
  normalizedText: string;
  type: KeywordType;
  intent: KeywordIntent | null;
  priority: KeywordPriority;
  status: KeywordStatus;
  locked: boolean;
  source: KeywordSource;
};
```

- [ ] **Step 4: Add the Prisma schema exactly around project/AI relations**

Add these enums:

```prisma
enum KeywordType {
  CORE
  LONG_TAIL
  BRAND
  QUESTION
  LOCAL
  COMMERCIAL
}

enum KeywordIntent {
  INFORMATIONAL
  NAVIGATIONAL
  COMMERCIAL_INVESTIGATION
  TRANSACTIONAL
  LOCAL
  UNKNOWN
}

enum KeywordPriority {
  HIGH
  MEDIUM
  LOW
}

enum KeywordStatus {
  ACTIVE
  DISABLED
  ARCHIVED
}

enum KeywordSource {
  MANUAL
  AI_ACCEPTED
}

enum KeywordSuggestionStatus {
  PENDING
  ACCEPTED
  REJECTED
  EXPIRED
}
```

Add `KEYWORD_EXPANSION` to the existing `AiTaskType` enum. Add these models, using `String` for audit event type so future audit labels do not require an enum migration:

```prisma
model Keyword {
  id              String          @id @default(uuid()) @db.Uuid
  projectId       String          @db.Uuid
  text            String
  normalizedText  String
  type            KeywordType
  intent          KeywordIntent?
  priority        KeywordPriority @default(MEDIUM)
  status          KeywordStatus   @default(ACTIVE)
  locked          Boolean         @default(false)
  source          KeywordSource
  language        String?
  targetCountry   String?
  notes           String?
  createdByUserId String?         @db.Uuid
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  project           Project                  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parentEdges        KeywordRelation[]        @relation("KeywordParent")
  childEdge          KeywordRelation?         @relation("KeywordChild")
  groupMemberships   KeywordGroupMembership[]
  seededSuggestions  KeywordSuggestion[]      @relation("KeywordSuggestionSeed")
  acceptedSuggestions KeywordSuggestion[]     @relation("KeywordSuggestionAccepted")
  auditEvents        KeywordAuditEvent[]

  @@unique([projectId, normalizedText])
  @@index([projectId, status])
  @@index([projectId, type])
  @@index([projectId, priority])
}

model KeywordRelation {
  id              String   @id @default(uuid()) @db.Uuid
  projectId       String   @db.Uuid
  parentKeywordId String   @db.Uuid
  childKeywordId  String   @unique @db.Uuid
  createdAt       DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parent  Keyword @relation("KeywordParent", fields: [parentKeywordId], references: [id], onDelete: Cascade)
  child   Keyword @relation("KeywordChild", fields: [childKeywordId], references: [id], onDelete: Cascade)

  @@unique([parentKeywordId, childKeywordId])
  @@index([projectId, parentKeywordId])
}

model KeywordGroup {
  id          String   @id @default(uuid()) @db.Uuid
  projectId   String   @db.Uuid
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  project     Project                  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  memberships KeywordGroupMembership[]

  @@unique([projectId, name])
  @@index([projectId])
}

model KeywordGroupMembership {
  id        String   @id @default(uuid()) @db.Uuid
  projectId String   @db.Uuid
  groupId   String   @db.Uuid
  keywordId String   @db.Uuid
  createdAt DateTime @default(now())

  project Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  group   KeywordGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)
  keyword Keyword      @relation(fields: [keywordId], references: [id], onDelete: Cascade)

  @@unique([groupId, keywordId])
  @@index([projectId, keywordId])
}

model KeywordSuggestion {
  id                String                  @id @default(uuid()) @db.Uuid
  projectId         String                  @db.Uuid
  seedKeywordId     String                  @db.Uuid
  acceptedKeywordId String?                 @db.Uuid
  suggestedText     String
  normalizedText    String
  suggestedType     KeywordType?
  suggestedIntent   KeywordIntent?
  rationale         String?
  status            KeywordSuggestionStatus @default(PENDING)
  provider          String
  model             String
  aiTaskId          String                  @db.Uuid
  responseId        String?
  createdAt         DateTime                @default(now())
  decidedAt         DateTime?
  decidedByUserId   String?                 @db.Uuid

  project         Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  seedKeyword     Keyword  @relation("KeywordSuggestionSeed", fields: [seedKeywordId], references: [id], onDelete: Cascade)
  acceptedKeyword Keyword? @relation("KeywordSuggestionAccepted", fields: [acceptedKeywordId], references: [id], onDelete: SetNull)

  @@unique([projectId, seedKeywordId, normalizedText])
  @@index([projectId, status, createdAt])
  @@index([aiTaskId])
}

model KeywordAuditEvent {
  id           String   @id @default(uuid()) @db.Uuid
  projectId    String   @db.Uuid
  keywordId    String?  @db.Uuid
  actorUserId  String?  @db.Uuid
  eventType    String
  metadata     Json?
  createdAt    DateTime @default(now())

  project Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  keyword Keyword? @relation(fields: [keywordId], references: [id], onDelete: SetNull)

  @@index([projectId, createdAt])
  @@index([keywordId, createdAt])
}
```

Add the corresponding arrays to `Project`:

```prisma
  keywords                Keyword[]
  keywordRelations        KeywordRelation[]
  keywordGroups           KeywordGroup[]
  keywordGroupMemberships KeywordGroupMembership[]
  keywordSuggestions      KeywordSuggestion[]
  keywordAuditEvents      KeywordAuditEvent[]
```

Create `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql` matching this schema, including the unique indexes and foreign keys. Do not add any down-migration.

- [ ] **Step 5: Validate schema, generate client, deploy migration, and rerun the normalizer test**

Run:

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
npm test -- tests/unit/keyword-normalize.test.ts
npm run typecheck
```

Expected: all commands exit 0; the unit test passes.

- [ ] **Step 6: Commit Task 1**

```bash
git add prisma/schema.prisma prisma/migrations/20260828060000_add_keyword_demand_capture src/modules/keywords/keyword-normalize.ts src/modules/keywords/keyword.types.ts tests/unit/keyword-normalize.test.ts
git commit -m "feat(keywords): add keyword domain schema"
```

---

### Task 2: Implement repository invariants and manual keyword commands

**Files:**
- Create: `src/modules/keywords/keyword.repository.ts`
- Create: `src/modules/keywords/keyword.service.ts`
- Create: `tests/integration/keywords.repository.test.ts`
- Create: `tests/integration/keywords.service.test.ts`

**Interfaces:**
- Produces: `KeywordRepository`
- Produces: `KeywordService`
- Produces singleton: `keywordService`
- Key methods: `createManual`, `updateManual`, `setLocked`, `archive`, `restore`, `setParent`, `removeParent`, `createGroup`, `setGroups`, `list`

- [ ] **Step 1: Write repository RED tests for normalized identity and canonical parent uniqueness**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';

const createdProjectIds: string[] = [];
afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds.splice(0) } } });
});

async function project(name: string) {
  const row = await prisma.project.create({
    data: { name, slug: `${name}-${crypto.randomUUID()}`, primaryDomain: `${crypto.randomUUID()}.example.com` },
  });
  createdProjectIds.push(row.id);
  return row;
}

describe('KeywordRepository', () => {
  it('keeps one normalized logical keyword per project across archived status', async () => {
    const p = await project('keywords-repo');
    const repo = new KeywordRepository();
    await repo.createKeyword({ projectId: p.id, text: '符纸', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' });
    await expect(repo.createKeyword({ projectId: p.id, text: '  符纸 ', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' }))
      .rejects.toMatchObject({ code: 'P2002' });
  });
});
```

Add a second assertion proving the same normalized keyword can exist in a different project, and a relation test proving `childKeywordId` is unique.

- [ ] **Step 2: Run repository RED**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: FAIL because `KeywordRepository` does not exist.

- [ ] **Step 3: Implement `KeywordRepository` as a transaction-friendly persistence adapter**

Use this constructor shape so the service can re-read state inside one transaction:

```ts
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type KeywordDb = Pick<
  Prisma.TransactionClient,
  'keyword' | 'keywordRelation' | 'keywordGroup' | 'keywordGroupMembership' | 'keywordSuggestion' | 'keywordAuditEvent'
>;

export class KeywordRepository {
  constructor(private readonly db: KeywordDb = prisma) {}

  createKeyword(data: Prisma.KeywordUncheckedCreateInput) {
    return this.db.keyword.create({ data });
  }

  findKeyword(projectId: string, keywordId: string) {
    return this.db.keyword.findFirst({ where: { id: keywordId, projectId } });
  }

  findByNormalized(projectId: string, normalizedText: string) {
    return this.db.keyword.findUnique({
      where: { projectId_normalizedText: { projectId, normalizedText } },
    });
  }

  parentOf(projectId: string, childKeywordId: string) {
    return this.db.keywordRelation.findFirst({ where: { projectId, childKeywordId } });
  }

  upsertParent(projectId: string, parentKeywordId: string, childKeywordId: string) {
    return this.db.keywordRelation.upsert({
      where: { childKeywordId },
      create: { projectId, parentKeywordId, childKeywordId },
      update: { projectId, parentKeywordId },
    });
  }

  removeParent(projectId: string, childKeywordId: string) {
    return this.db.keywordRelation.deleteMany({ where: { projectId, childKeywordId } });
  }

  appendAudit(projectId: string, keywordId: string | null, actorUserId: string | null, eventType: string, metadata?: Prisma.InputJsonValue) {
    return this.db.keywordAuditEvent.create({ data: { projectId, keywordId, actorUserId, eventType, metadata } });
  }
}
```

Add repository methods for list/update/status, group CRUD/memberships, suggestion reads/decisions, and `createManySuggestions`. Keep every lookup project-scoped.

- [ ] **Step 4: Run repository GREEN**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Write service RED tests for restore, lock, self-parent, cycle, and cross-project fail-closed behavior**

```ts
it('requires restore instead of recreating an archived normalized keyword', async () => {
  const created = await service.createManual({ actorUserId: user.id, projectId: p.id, text: '符纸', type: 'CORE' });
  await service.archive({ actorUserId: user.id, projectId: p.id, keywordId: created.id, acknowledgeLock: false });
  await expect(service.createManual({ actorUserId: user.id, projectId: p.id, text: ' 符纸 ', type: 'CORE' }))
    .rejects.toMatchObject({ code: 'KEYWORD_ARCHIVED_RESTORE_REQUIRED' });
});

it('does not mutate a locked keyword without explicit acknowledgement', async () => {
  const created = await service.createManual({ actorUserId: user.id, projectId: p.id, text: '符纸', type: 'CORE', locked: true });
  await expect(service.updateManual({ actorUserId: user.id, projectId: p.id, keywordId: created.id, text: '符纸文化', acknowledgeLock: false }))
    .rejects.toMatchObject({ code: 'KEYWORD_LOCKED' });
});
```

Add explicit tests for self-parenting, `A -> B -> C` then attempting `C -> A`, and using a parent ID from another project returning `KEYWORD_NOT_FOUND` without exposing that project's data.

- [ ] **Step 6: Run service RED**

Run: `npm test -- tests/integration/keywords.service.test.ts`

Expected: FAIL because `KeywordService` does not exist.

- [ ] **Step 7: Implement transactional command semantics**

Use serializable transactions for state-changing commands that depend on current lock/parent/suggestion state:

```ts
import { Prisma } from '@prisma/client';
import { AppError, NotFoundError, ValidationError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { normalizeKeywordText } from './keyword-normalize.js';
import { KeywordRepository } from './keyword.repository.js';

async function inKeywordTransaction<T>(work: (repo: KeywordRepository) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    (tx) => work(new KeywordRepository(tx)),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function assertUnlockedOrAcknowledged(locked: boolean, acknowledged: boolean | undefined) {
  if (locked && acknowledged !== true) {
    throw new AppError('Keyword is strategically locked', 409, 'KEYWORD_LOCKED');
  }
}
```

Implement `createManual` so `findByNormalized` is checked before create; if status is `ARCHIVED`, throw `KEYWORD_ARCHIVED_RESTORE_REQUIRED`, otherwise `KEYWORD_DUPLICATE`. Catch Prisma `P2002` and re-read the winning row so concurrent creates return the same stable application error.

Implement cycle detection inside the same transaction:

```ts
async function assertNoCycle(repo: KeywordRepository, projectId: string, childId: string, proposedParentId: string) {
  if (childId === proposedParentId) {
    throw new AppError('Keyword cannot parent itself', 409, 'KEYWORD_PARENT_SELF');
  }
  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId) throw new AppError('Keyword relation would create a cycle', 409, 'KEYWORD_RELATION_CYCLE');
    if (seen.has(cursor)) throw new AppError('Existing keyword relation cycle detected', 409, 'KEYWORD_RELATION_CYCLE');
    seen.add(cursor);
    cursor = (await repo.parentOf(projectId, cursor))?.parentKeywordId ?? null;
  }
}
```

Every successful mutation appends a `KeywordAuditEvent` inside the same transaction with event types such as `KEYWORD_CREATED`, `KEYWORD_UPDATED`, `KEYWORD_LOCK_CHANGED`, `KEYWORD_ARCHIVED`, `KEYWORD_RESTORED`, `KEYWORD_PARENT_SET`, `KEYWORD_PARENT_REMOVED`, `KEYWORD_GROUPS_CHANGED`.

- [ ] **Step 8: Run Task 2 GREEN and commit**

Run:

```bash
npm test -- tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

Commit:

```bash
git add src/modules/keywords/keyword.repository.ts src/modules/keywords/keyword.service.ts tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
git commit -m "feat(keywords): add manual keyword commands"
```

---

### Task 3: Expose secured keyword API and freeze P11-01A

**Files:**
- Create: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.api.test.ts`

**Interfaces:**
- Produces: `createKeywordRoutes(service?: KeywordService, coverageService?: KeywordCoverageService, aiTaskService?: Pick<AiTaskService, 'createAndEnqueue'>)`; the coverage/AI parameters may remain unused until later tasks but keep app wiring stable.
- API base: `/api/v1/projects/:projectId/keywords`

- [ ] **Step 1: Write API authorization RED tests**

Use `seedAuthenticatedUser` and `deriveCsrfToken` from the existing auth fixtures.

```ts
it('lets VIEWER read but rejects authoritative mutation', async () => {
  const fixture = await seedAuthenticatedUser({ role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  const csrf = deriveCsrfToken(env.SESSION_SECRET, fixture.csrfInput.sessionId, fixture.csrfInput.tokenHash);
  try {
    await request(createApp()).get(`/api/v1/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).expect(200);
    const response = await request(createApp())
      .post(`/api/v1/projects/${fixture.project.id}/keywords`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrf)
      .send({ text: '符纸', type: 'CORE' })
      .expect(403);
    expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
  } finally { await fixture.cleanup(); }
});
```

Add tests for anonymous 401, non-member 404, missing/invalid CSRF 403, and OPERATOR/OWNER mutation success because they hold `CONTENT_WRITE`.

- [ ] **Step 2: Run API RED**

Run: `npm test -- tests/integration/keywords.api.test.ts`

Expected: FAIL because keyword routes are not mounted.

- [ ] **Step 3: Implement the router with existing middleware order**

```ts
export function createKeywordRoutes(service = keywordService) {
  const router = Router();

  router.get(
    '/projects/:projectId/keywords',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try { res.json({ data: await service.list(projectId(req)) }); }
      catch (error) { next(error); }
    },
  );

  router.post(
    '/projects/:projectId/keywords',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
    async (req, res, next) => {
      try {
        const keyword = await service.createManual({
          actorUserId: req.auth!.userId,
          projectId: projectId(req),
          text: req.body?.text,
          type: req.body?.type,
          intent: req.body?.intent ?? null,
          priority: req.body?.priority,
          parentKeywordId: req.body?.parentKeywordId ?? null,
          groupIds: req.body?.groupIds,
          language: req.body?.language ?? null,
          targetCountry: req.body?.targetCountry ?? null,
          notes: req.body?.notes ?? null,
          locked: req.body?.locked === true,
        });
        res.status(201).json({ data: keyword });
      } catch (error) { next(error); }
    },
  );

  return router;
}
```

Add PATCH/update, archive, restore, lock, parent set/remove, and group endpoints. For every mutation, pass `acknowledgeLock` from an explicit boolean request field; never infer acknowledgement from role.

- [ ] **Step 4: Mount the router in `src/app.ts`**

Add imports and an optional `keywordService?: KeywordService` to `AppOptions`, then mount:

```ts
app.use('/api/v1', createKeywordRoutes(options.keywordService));
```

Keep it after authentication middleware and before the final error handler.

- [ ] **Step 5: Run focused P11-01A verification**

Run:

```bash
npm test -- tests/unit/keyword-normalize.test.ts tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts tests/integration/keywords.api.test.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.api.test.ts
git commit -m "feat(keywords): expose secured keyword API"
```

- [ ] **Step 7: Obtain P11-01A exact-head CI evidence before starting coverage**

Push the exact branch head and require the repository's normal exact-head checks (`verify`, `production-audit`, `e2e`, and deployment/runtime artifact checks required by current main) to be green. Record the immutable head SHA and workflow run in the PR/working notes. Do not start Task 4 on a red P11-01A head.

---

# P11-01B — Deterministic Coverage Engine

### Task 4: Implement pure coverage scoring and persisted-fact repository

**Files:**
- Create: `src/modules/keywords/keyword-coverage.ts`
- Create: `src/modules/keywords/keyword-coverage.repository.ts`
- Create: `tests/unit/keyword-coverage.test.ts`

**Interfaces:**
- Produces: `scoreKeywordAgainstPage(keywordText, pageFact): KeywordCoverageEvidence`
- Produces: `resolveKeywordCoverage(keywordText, pageFacts): KeywordCoverageResult`
- Produces: `KeywordCoverageRepository.listActivePageFacts(projectId)`

- [ ] **Step 1: Write pure scoring RED tests**

```ts
const base = {
  pageId: '00000000-0000-0000-0000-000000000001',
  url: 'https://example.com/culture/fuzhi',
  path: '/culture/fuzhi',
  title: null,
  h1: null,
  metaDescription: null,
  indexable: true,
};

it('is STRONG when title or H1 explicitly covers the keyword', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '符纸：传统用途与文化' }]).status).toBe('STRONG');
});

it('is PARTIAL for weaker meta/path evidence', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, metaDescription: '介绍符纸的历史来源' }]).status).toBe('PARTIAL');
});

it('is NONE only with usable evidence and no match', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '六壬文化', h1: '民间信仰' }]).status).toBe('NONE');
});

it('is UNKNOWN when no usable snapshots exist', () => {
  expect(resolveKeywordCoverage('符纸', []).status).toBe('UNKNOWN');
});
```

- [ ] **Step 2: Run scoring RED**

Run: `npm test -- tests/unit/keyword-coverage.test.ts`

Expected: FAIL because coverage functions do not exist.

- [ ] **Step 3: Implement transparent multi-field scoring**

```ts
const WEIGHTS = { title: 4, h1: 4, metaDescription: 2, path: 1 } as const;

function contains(haystack: string | null, needle: string): boolean {
  if (!haystack) return false;
  return normalizeKeywordText(haystack).includes(needle);
}

export function scoreKeywordAgainstPage(keywordText: string, page: CoveragePageFact): KeywordCoverageEvidence {
  const keyword = normalizeKeywordText(keywordText);
  const titleMatch = contains(page.title, keyword);
  const h1Match = contains(page.h1, keyword);
  const metaDescriptionMatch = contains(page.metaDescription, keyword);
  const pathMatch = contains(safeDecodePath(page.path), keyword);
  const score = Number(titleMatch) * WEIGHTS.title
    + Number(h1Match) * WEIGHTS.h1
    + Number(metaDescriptionMatch) * WEIGHTS.metaDescription
    + Number(pathMatch) * WEIGHTS.path;
  return { pageId: page.pageId, url: page.url, titleMatch, h1Match, metaDescriptionMatch, pathMatch, score };
}
```

Resolution rule:
- no usable page facts -> `UNKNOWN`;
- any evidence score `>= 4` -> `STRONG`;
- otherwise any score `>= 1` -> `PARTIAL`;
- otherwise -> `NONE`.

Keep evidence sorted descending by score then URL for deterministic output.

- [ ] **Step 4: Implement latest persisted active-page fact read**

Use one query that returns active pages with only their latest snapshot:

```ts
return prisma.page.findMany({
  where: { projectId, isActive: true },
  select: {
    id: true,
    url: true,
    path: true,
    snapshots: {
      orderBy: { capturedAt: 'desc' },
      take: 1,
      select: { title: true, h1: true, metaDescription: true, statusCode: true, indexable: true, capturedAt: true },
    },
  },
  orderBy: { normalizedUrl: 'asc' },
});
```

Map only snapshots with a successful 2xx status and `indexable !== false` into usable facts. If active pages exist but none have a usable snapshot, the service must later return `UNKNOWN/NO_USABLE_SNAPSHOT_EVIDENCE`.

- [ ] **Step 5: Run unit GREEN and typecheck**

Run:

```bash
npm test -- tests/unit/keyword-coverage.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/modules/keywords/keyword-coverage.ts src/modules/keywords/keyword-coverage.repository.ts tests/unit/keyword-coverage.test.ts
git commit -m "feat(keywords): add deterministic coverage scoring"
```

---

### Task 5: Add project coverage orchestration and API evidence

**Files:**
- Create: `src/modules/keywords/keyword-coverage.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.coverage.test.ts`

**Interfaces:**
- Produces: `KeywordCoverageService.evaluateKeyword(projectId, keywordId)`
- Produces: `KeywordCoverageService.evaluateProject(projectId, keywords)`
- API: `GET /api/v1/projects/:projectId/keywords/:keywordId/coverage`

- [ ] **Step 1: Write integration RED proving persisted-fact truth and no fresh execution**

Seed a project, keyword, active page, and latest snapshot directly with Prisma. Then assert `STRONG/PARTIAL/NONE/UNKNOWN` from the service. Inject spies/stubs into `createApp` and assert the GET route does not call crawler, Search Console, or AI service ports.

```ts
const response = await request(createApp({
  crawlService: { enqueue: vi.fn() } as never,
  aiTaskService: { createAndEnqueue: vi.fn() } as never,
})).get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/coverage`)
  .set('Cookie', fixture.sessionCookie)
  .expect(200);
expect(response.body.data.status).toBe('STRONG');
```

- [ ] **Step 2: Run coverage integration RED**

Run: `npm test -- tests/integration/keywords.coverage.test.ts`

Expected: FAIL because coverage service/API are missing.

- [ ] **Step 3: Implement one-read project evaluation**

```ts
export class KeywordCoverageService {
  constructor(private readonly repository = new KeywordCoverageRepository()) {}

  async evaluateProject(projectId: string, keywords: Array<{ id: string; text: string }>) {
    const factSet = await this.repository.listActivePageFacts(projectId);
    return new Map(keywords.map((keyword) => [
      keyword.id,
      resolveKeywordCoverage(keyword.text, factSet.usablePages, factSet.reasonWhenEmpty),
    ]));
  }
}
```

`listActivePageFacts` should return both `usablePages` and an empty reason so `UNKNOWN` distinguishes no active pages from active pages with unusable snapshots.

- [ ] **Step 4: Add the secured read endpoint and app injection**

Require `PROJECT_READ`, never CSRF for GET. `KeywordCoverageService.evaluateKeyword` must first project-scope the keyword lookup so a foreign keyword ID returns 404.

- [ ] **Step 5: Run P11-01B focused verification**

Run:

```bash
npm test -- tests/unit/keyword-coverage.test.ts tests/integration/keywords.coverage.test.ts tests/integration/keywords.api.test.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit and obtain P11-01B exact-head CI evidence**

```bash
git add src/modules/keywords/keyword-coverage.service.ts src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.coverage.test.ts
git commit -m "feat(keywords): expose content coverage evidence"
```

Push the exact head and require the current repository full CI suite green before P11-01C.

---

# P11-01C — Keyword Center UI

### Task 6: Build the secured keyword-center read model and manual forms

**Files:**
- Create: `src/modules/keywords/keyword.web.repository.ts`
- Create: `src/modules/keywords/keyword.web.routes.ts`
- Create: `src/views/keywords/index.ejs`
- Create: `src/public/css/p11-keywords.css`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/views/layout.ejs`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.web.test.ts`
- Modify: `tests/e2e/p10-shell.spec.ts`

**Interfaces:**
- Produces: `createKeywordWebRoutes(service?: KeywordService, coverageService?: KeywordCoverageService)`
- Web page: `GET /projects/:id/keywords`
- Manual forms: create, update, lock/unlock, archive/restore, parent change; all POST and CSRF-protected.

- [ ] **Step 1: Write web RED tests for project access and truthful labels**

```ts
it('renders keyword facts separately from advisory/ranking placeholders', async () => {
  const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  try {
    await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '符纸', type: 'CORE', priority: 'HIGH', locked: true });
    const response = await request(createApp()).get(`/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).expect(200);
    expect(response.text).toContain('关键词中心');
    expect(response.text).toContain('符纸');
    expect(response.text).toContain('站内内容覆盖');
    expect(response.text).not.toContain('Google 排名：1');
  } finally { await fixture.cleanup(); }
});
```

Add anonymous 401, non-member 404, VIEWER GET success, VIEWER form mutation 403, and CSRF rejection tests.

- [ ] **Step 2: Run web RED**

Run: `npm test -- tests/integration/keywords.web.test.ts`

Expected: FAIL because web routes/view do not exist.

- [ ] **Step 3: Implement the keyword-center read model**

`keyword.web.repository.ts` should call the keyword repository once for library/tree/group/suggestion data and call `KeywordCoverageService.evaluateProject` once for coverage. Return a view model with explicit fact/suggestion sections:

```ts
export interface KeywordCenterViewModel {
  project: { id: string; name: string; defaultLanguage: string; targetCountry: string };
  summary: { active: number; locked: number; strong: number; partial: number; none: number; unknown: number };
  keywords: Array<KeywordListRecord & { parentKeywordId: string | null; coverage: KeywordCoverageResult }>;
  groups: Array<{ id: string; name: string }>;
  suggestions: Array<{ id: string; seedKeywordId: string; suggestedText: string; status: string; rationale: string | null }>;
}
```

Do not include secrets, API keys, provider health claims, or fabricated rank/search-volume fields.

- [ ] **Step 4: Implement secured EJS routes and CSRF rendering using the established project-admin pattern**

```ts
function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}
```

GET chain:

```ts
requireAuthentication(),
requireProjectMembership(),
requireProjectCapability('PROJECT_READ')
```

Mutation chain:

```ts
requireAuthentication(),
requireCsrf(),
requireProjectMembership(),
requireProjectCapability('CONTENT_WRITE')
```

Render `layout` with `activeNav: 'keywords'`, `currentProjectId`, `bodyTemplate: 'keywords/index'`, `csrfToken`, and role booleans computed from `hasProjectCapability`.

- [ ] **Step 5: Build one-page EJS UI with explicit fact/advisory separation**

The page must contain stable test selectors:

```html
<section data-ui="keyword-summary">...</section>
<section data-ui="keyword-library">...</section>
<section data-ui="keyword-tree">...</section>
<section data-ui="keyword-coverage">...</section>
<section data-ui="keyword-advisory" aria-label="AI 长尾建议">...</section>
```

Manual create form fields: `text`, `type`, `intent`, `priority`, `parentKeywordId`, `language`, `targetCountry`, `notes`, `locked`, `_csrf`.

Coverage labels must render exactly as facts:
- `STRONG` -> `覆盖较强`
- `PARTIAL` -> `部分覆盖`
- `NONE` -> `内容缺口`
- `UNKNOWN` -> `证据不足`

Future ranking area may say `排名数据：未接入` but must not fabricate positions.

- [ ] **Step 6: Add navigation and responsive styling**

In `sidebar.ejs`, add:

```js
keywords: 'keywords'
```

to `centerByActiveNav`, and add:

```js
{ key: 'keywords', label: '关键词中心', icon: 'seo', href: projectHref('/keywords') },
```

between SEO and GEO. Reuse the existing SEO icon; do not expand the icon sprite for P11-01.

In `layout.ejs` add:

```html
<link rel="stylesheet" href="/assets/css/p11-keywords.css">
```

Style grid/table/cards under `.keyword-center` and add a mobile rule that stacks forms/cards and allows the table container to scroll horizontally without causing document-level overflow.

- [ ] **Step 7: Mount the web router and run UI integration GREEN**

Run:

```bash
npm test -- tests/integration/keywords.web.test.ts tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: integration tests pass; Playwright shell test will be executed through `npm run test:e2e -- tests/e2e/p10-shell.spec.ts` if the local E2E server contract is available.

- [ ] **Step 8: Commit Task 6**

```bash
git add src/modules/keywords/keyword.web.repository.ts src/modules/keywords/keyword.web.routes.ts src/views/keywords/index.ejs src/public/css/p11-keywords.css src/views/partials/sidebar.ejs src/views/layout.ejs src/app.ts tests/integration/keywords.web.test.ts tests/e2e/p10-shell.spec.ts
git commit -m "feat(keywords): add keyword center UI"
```

---

### Task 7: Add browser E2E for manual keyword control and freeze P11-01C

**Files:**
- Create: `tests/e2e/keywords.spec.ts`

**Interfaces:**
- Verifies the user-facing flow from authenticated project page to manual keyword creation, lock state, parent tree, and coverage display.

- [ ] **Step 1: Write E2E RED**

```ts
import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('operator manually captures 符纸 demand and sees truthful coverage state', async ({ page, context }) => {
  const auth = await authenticateE2e(context, { role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  try {
    await page.goto(`/projects/${auth.project.id}/keywords`);
    await page.getByLabel('关键词').fill('符纸');
    await page.getByLabel('类型').selectOption('CORE');
    await page.getByLabel('优先级').selectOption('HIGH');
    await page.getByLabel('战略锁定').check();
    await page.getByRole('button', { name: '添加关键词' }).click();
    await expect(page.locator('[data-ui="keyword-library"]')).toContainText('符纸');
    await expect(page.locator('[data-ui="keyword-library"]')).toContainText('锁定');
    await expect(page.locator('[data-ui="keyword-coverage"]')).toContainText(/证据不足|内容缺口|部分覆盖|覆盖较强/);
  } finally { await auth.cleanup(); }
});
```

Add a second test at 820px viewport proving no document-level horizontal overflow and that the navigation opens/closes normally.

- [ ] **Step 2: Run E2E RED**

Run: `npm run test:e2e -- tests/e2e/keywords.spec.ts`

Expected: FAIL until any missing selectors/form behavior are completed.

- [ ] **Step 3: Make only the minimal UI corrections required for E2E GREEN**

Do not redesign P10 shell. Fix only missing labels, selectors, redirect targets, and responsive containment required by the new keyword page.

- [ ] **Step 4: Run P11-01C full focused verification**

Run:

```bash
npm test -- tests/integration/keywords.web.test.ts tests/integration/keywords.api.test.ts tests/unit/keyword-coverage.test.ts tests/integration/keywords.coverage.test.ts
npm run test:e2e -- tests/e2e/keywords.spec.ts tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 5: Commit and obtain P11-01C exact-head CI evidence**

```bash
git add tests/e2e/keywords.spec.ts src/views/keywords/index.ejs src/public/css/p11-keywords.css
git commit -m "test(keywords): cover manual demand capture UI"
```

Push the exact head and require the current repository full CI suite green before AI advisory work.

---

# P11-01D — DeepSeek Long-Tail Advisory

### Task 8: Add queued keyword-expansion AI task, prompt, parser, and atomic suggestion materializer

**Files:**
- Create: `src/modules/keywords/keyword-ai.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Create: `tests/unit/keyword-ai.test.ts`
- Modify: `tests/unit/ai.prompt-registry.test.ts`
- Modify: `tests/unit/ai.worker.test.ts`
- Create: `tests/integration/keywords.ai-worker.test.ts`

**Interfaces:**
- Produces: `KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1'`
- Produces: `KeywordExpansionOutputSchema`
- Produces: `parseKeywordExpansionOutput(content, suppliedSeed): KeywordExpansionOutput`
- Produces: `buildKeywordExpansionTaskInput(projectId, seedKeywordId): Promise<CreateAiTaskInput>`
- Produces: `createKeywordExpansionTask(projectId, seedKeywordId, service?)`
- Produces: `materializeKeywordSuggestions(task, output, tx): Promise<void>`

- [ ] **Step 1: Write parser RED tests**

```ts
it('normalizes and de-duplicates advisory suggestions without accepting them', () => {
  const output = parseKeywordExpansionOutput(JSON.stringify({
    suggestions: [
      { text: '六壬符纸', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: 'Narrower topic' },
      { text: ' 六壬符纸 ', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: 'Duplicate' },
    ],
  }), '符纸');
  expect(output.suggestions).toHaveLength(1);
  expect(output.suggestions[0].text).toBe('六壬符纸');
});
```

Also reject: seed keyword repeated as a suggestion, more than 20 suggestions, unsupported type/intent, empty rationale/text, and invalid JSON.

- [ ] **Step 2: Run parser RED**

Run: `npm test -- tests/unit/keyword-ai.test.ts`

Expected: FAIL because `keyword-ai.ts` does not exist.

- [ ] **Step 3: Implement Zod schema and task fact packet**

```ts
export const KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1';

export const KeywordExpansionOutputSchema = z.object({
  suggestions: z.array(z.object({
    text: z.string().trim().min(1).max(160),
    type: z.enum(['LONG_TAIL', 'QUESTION', 'LOCAL', 'COMMERCIAL', 'BRAND']),
    intent: z.enum(['INFORMATIONAL', 'NAVIGATIONAL', 'COMMERCIAL_INVESTIGATION', 'TRANSACTIONAL', 'LOCAL', 'UNKNOWN']),
    rationale: z.string().trim().min(1).max(300),
  })).max(20),
});
```

`buildKeywordExpansionTaskInput` must load only project-scoped allowed facts: seed keyword, accepted existing child keyword text, project `industry`, `defaultLanguage`, and `targetCountry`. It must not include secrets or unrelated user data.

Use stable source references and request key:

```ts
return {
  projectId,
  taskType: 'KEYWORD_EXPANSION',
  requestKey: `keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:${KEYWORD_EXPANSION_PROMPT_ID}`,
  promptVersion: KEYWORD_EXPANSION_PROMPT_ID,
  factSnapshot: packet as Prisma.InputJsonValue,
  sourceReferences: [{ type: 'KEYWORD', id: seed.id }] as Prisma.InputJsonValue,
};
```

- [ ] **Step 4: Add the prompt definition to `prompt-registry.ts`**

Register `keyword-expansion-v1` as `FAST` + `JSON`. System instruction must contain these semantic constraints:

```text
You generate advisory keyword candidates only.
Do not claim search volume, ranking, traffic, or commercial value.
Do not repeat the seed keyword or existing accepted children.
Return JSON only with at most 20 suggestions using the allowed type/intent enums.
Treat supplied project facts as context, not permission to alter authoritative strategy.
```

`buildUserMessage` must serialize only the fact packet.

- [ ] **Step 5: Write AI worker/materialization RED**

Create a queued `KEYWORD_EXPANSION` task, execute `executeAiTask` with a stub gateway returning valid JSON, then assert:

```ts
const suggestions = await prisma.keywordSuggestion.findMany({ where: { aiTaskId: task.id } });
expect(suggestions).toHaveLength(2);
expect(suggestions.every((item) => item.status === 'PENDING')).toBe(true);
expect(await prisma.keyword.count({ where: { projectId, source: 'AI_ACCEPTED' } })).toBe(0);
```

This is the hard authority test: worker completion may materialize `KeywordSuggestion`, never authoritative `Keyword`.

- [ ] **Step 6: Extend `ai.worker.ts` task dispatch and atomic materializer**

Add `KEYWORD_EXPANSION` to:
- `expectedPromptId`
- `resultSummary`
- `parseTaskOutput`
- the `materialize` branch inside the existing `repository.completeRun(...)` transaction.

Materializer behavior:

```ts
export async function materializeKeywordSuggestions(task: AiTask, output: KeywordExpansionOutput, tx: Prisma.TransactionClient) {
  const seedId = extractSeedKeywordId(task);
  const seed = await tx.keyword.findFirst({ where: { id: seedId, projectId: task.projectId } });
  if (!seed) throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');

  await tx.keywordSuggestion.createMany({
    data: output.suggestions.map((item) => ({
      projectId: task.projectId,
      seedKeywordId: seed.id,
      suggestedText: item.text.trim(),
      normalizedText: normalizeKeywordText(item.text),
      suggestedType: item.type,
      suggestedIntent: item.intent,
      rationale: item.rationale,
      status: 'PENDING',
      provider: 'DEEPSEEK',
      model: task.runs?.[0]?.model ?? 'DEEPSEEK',
      aiTaskId: task.id,
    })),
    skipDuplicates: true,
  });
}
```

If the current `AiTask` fetch does not include run/model data, pass the provider response model into the materializer or use the current configured model deterministically; do **not** query provider state again.

- [ ] **Step 7: Run AI GREEN**

Run:

```bash
npm test -- tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit Task 8**

```bash
git add src/modules/keywords/keyword-ai.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
git commit -m "feat(keywords): add advisory AI expansion"
```

---

### Task 9: Add explicit suggestion generate/accept/reject commands and web review UI

**Files:**
- Modify: `src/modules/keywords/keyword.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/views/keywords/index.ejs`
- Create: `tests/integration/keywords.suggestions.test.ts`
- Modify: `tests/e2e/keywords.spec.ts`

**Interfaces:**
- Produces service methods: `acceptSuggestion`, `rejectSuggestion`
- API: `POST /api/v1/projects/:projectId/keywords/:keywordId/suggestions/generate` (`AI_RUN` + CSRF)
- API: `POST /api/v1/projects/:projectId/keyword-suggestions/:suggestionId/accept` (`CONTENT_WRITE` + CSRF)
- API: `POST /api/v1/projects/:projectId/keyword-suggestions/:suggestionId/reject` (`CONTENT_WRITE` + CSRF)
- Equivalent browser POST routes redirect to `/projects/:id/keywords`.

- [ ] **Step 1: Write suggestion decision RED tests**

```ts
it('accepts one pending suggestion exactly once and creates an AI_ACCEPTED child keyword', async () => {
  const first = await service.acceptSuggestion({ actorUserId: user.id, projectId: p.id, suggestionId: suggestion.id });
  const second = await service.acceptSuggestion({ actorUserId: user.id, projectId: p.id, suggestionId: suggestion.id });
  expect(second.id).toBe(first.id);
  expect(first.source).toBe('AI_ACCEPTED');
  expect((await prisma.keywordRelation.findUnique({ where: { childKeywordId: first.id } }))?.parentKeywordId).toBe(seed.id);
});
```

Add tests proving:
- REJECTED/EXPIRED cannot become authoritative;
- existing ACTIVE/DISABLED normalized keyword is linked, not duplicated;
- existing ARCHIVED normalized keyword returns `KEYWORD_ARCHIVED_RESTORE_REQUIRED` and is not silently restored;
- acceptance uses edited text when supplied and re-normalizes it;
- generation route requires `AI_RUN`;
- acceptance/rejection require `CONTENT_WRITE` and CSRF;
- accepting a suggestion from another project returns 404.

- [ ] **Step 2: Run suggestion RED**

Run: `npm test -- tests/integration/keywords.suggestions.test.ts`

Expected: FAIL because suggestion decision methods/routes are incomplete.

- [ ] **Step 3: Implement idempotent acceptance in one serializable transaction**

Required state machine:

```ts
if (suggestion.status === 'ACCEPTED' && suggestion.acceptedKeywordId) {
  const linked = await repo.findKeyword(projectId, suggestion.acceptedKeywordId);
  if (linked) return linked;
}
if (suggestion.status !== 'PENDING') {
  throw new AppError('Keyword suggestion already decided', 409, 'KEYWORD_SUGGESTION_ALREADY_DECIDED');
}
```

Then normalize edited/original text, re-read existing keyword, create or link according to status, set canonical parent to `seedKeywordId` only after cycle/same-project validation, mark suggestion `ACCEPTED` with `decidedAt/decidedByUserId/acceptedKeywordId`, and append `KEYWORD_SUGGESTION_ACCEPTED` in the same transaction. Never change seed strategy fields.

Reject must atomically transition only `PENDING -> REJECTED` and append `KEYWORD_SUGGESTION_REJECTED`.

- [ ] **Step 4: Add generation/decision API routes**

Generation must call `createKeywordExpansionTask(projectId, keywordId, aiTaskService)` and return `202` with the AI task ID. It does not create a keyword suggestion synchronously; the worker materializes suggestions after validated completion.

- [ ] **Step 5: Add web review controls with advisory labeling**

Render each suggestion inside `data-ui="keyword-advisory"` with visible `建议 / Advisory` text, rationale, type, intent, optional editable text input, `接受` and `拒绝` buttons. Generation button label: `生成长尾关键词建议`.

Never label `PENDING` suggestions as accepted keywords, ranking opportunities, or proven search demand.

- [ ] **Step 6: Extend E2E without live DeepSeek dependency**

For browser E2E, seed a `KeywordSuggestion` directly in the database (or use an existing deterministic E2E fixture) so the test exercises human review/acceptance without external provider calls:

```ts
await prisma.keywordSuggestion.create({
  data: {
    projectId: auth.project.id,
    seedKeywordId: seed.id,
    suggestedText: '六壬符纸',
    normalizedText: '六壬符纸',
    suggestedType: 'LONG_TAIL',
    suggestedIntent: 'INFORMATIONAL',
    rationale: '更窄的相关主题',
    provider: 'DEEPSEEK',
    model: 'e2e-fixture',
    aiTaskId: seededAiTask.id,
  },
});
```

Then click `接受` and assert the keyword library/tree contains `六壬符纸` under `符纸` and still labels the source as AI accepted/advisory-origin rather than manual.

- [ ] **Step 7: Run P11-01D focused GREEN**

Run:

```bash
npm test -- tests/unit/keyword-ai.test.ts tests/integration/keywords.ai-worker.test.ts tests/integration/keywords.suggestions.test.ts tests/integration/keywords.web.test.ts tests/integration/keywords.api.test.ts
npm run test:e2e -- tests/e2e/keywords.spec.ts tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 8: Commit Task 9**

```bash
git add src/modules/keywords/keyword.service.ts src/modules/keywords/keyword.routes.ts src/modules/keywords/keyword.web.routes.ts src/modules/keywords/keyword.web.repository.ts src/views/keywords/index.ejs tests/integration/keywords.suggestions.test.ts tests/e2e/keywords.spec.ts
git commit -m "feat(keywords): add human-reviewed AI suggestions"
```

---

### Task 10: Final exact-head regression and P11-01 closure evidence

**Files:**
- Modify only if verification finds a scoped P11-01 defect; no feature expansion.
- Add a P11-01 closure document only after exact-head evidence exists: `docs/development/p11-01-keyword-demand-capture-verification.md`

**Interfaces:**
- Produces immutable evidence that P11-01 is complete without claiming P11-02 ranking or production deployment.

- [ ] **Step 1: Run database/schema verification from a clean generated-client state**

Run:

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
```

Expected: all exit 0; no pending/failed migration error.

- [ ] **Step 2: Run the complete local verification suite**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: zero failures. If any command fails, fix only the demonstrated P11-01 regression and rerun the **entire** command that failed.

- [ ] **Step 3: Verify the exact branch diff is scoped**

Run:

```bash
git status --short
git diff --check
git diff --stat <P11_BASE_SHA>...HEAD
```

Expected:
- working tree clean;
- `git diff --check` produces no output and exits 0;
- diff contains only P11-01 keyword domain/schema/migration/AI dispatch/UI/tests/docs changes; no P11-02 rank provider, autonomous publication, merge, deploy, rollback, or unrelated refactor.

At execution start, replace `<P11_BASE_SHA>` in the shell command with the exact frozen integration-base SHA recorded for the implementation branch; do not commit the angle-bracket token into repository files.

- [ ] **Step 4: Push exact head and require all repository CI gates green**

Record:
- exact implementation head SHA;
- workflow run ID;
- `verify` result;
- `production-audit` result;
- `e2e` result;
- deployment/runtime artifact results required by current `main`.

Do not mark P11-01 complete from local tests alone.

- [ ] **Step 5: Write the closure evidence document using only observed results**

`docs/development/p11-01-keyword-demand-capture-verification.md` must record:
- base SHA and final exact head SHA;
- migration name;
- focused RED/GREEN milestones for P11-01A/B/C/D;
- final CI run and green jobs;
- authoritative manual keyword semantics;
- `UNKNOWN != NONE` coverage truth;
- AI advisory-only materialization (`KeywordSuggestion` before human acceptance);
- strategic-lock behavior;
- explicit exclusions: P11-02 ranking, production deployment, autonomous publish/merge/deploy/rollback.

Do not write `100% complete` until every required exact-head gate is actually green.

- [ ] **Step 6: Commit closure evidence**

```bash
git add docs/development/p11-01-keyword-demand-capture-verification.md
git commit -m "docs: record P11-01 verification evidence"
```

After this documentation commit, obtain a **new** exact-head CI run for the new head. The closure document may reference the immediately preceding implementation evidence, but final branch integration requires the documentation head's required CI gates to be green as well.

---

## Spec Coverage Self-Check

- Manual keyword create/edit/archive/restore/enable-disable: Tasks 1-3.
- Strategic lock and explicit acknowledgement: Task 2, API/UI in Tasks 3/6.
- Type/intent/priority/market/language metadata: Tasks 1-3 and UI Task 6.
- One canonical parent, self/cycle/cross-project safety: Tasks 1-2.
- Groups/topics: Tasks 1-2 and UI Task 6.
- Normalized uniqueness across all statuses and restore semantics: Tasks 1-2.
- Deterministic `STRONG/PARTIAL/NONE/UNKNOWN` coverage from persisted page facts: Tasks 4-5.
- No fresh crawl/provider call from keyword reads: Task 5 tests and Global Constraints.
- Keyword-center summary/library/tree/detail/coverage UI: Tasks 6-7.
- DeepSeek advisory expansion via existing queued AI architecture: Task 8.
- Suggestions persisted non-authoritatively before review: Task 8 hard authority test.
- Explicit accept/reject/idempotency: Task 9.
- RBAC/CSRF and fail-closed project scoping: Tasks 3, 6, 9.
- Auditability/observability: Keyword audit rows in Tasks 1-2/9 plus existing AI observability in Task 8.
- Exact-head full regression and truth-boundary closure: Task 10.
- P11-02 rank/provider work remains excluded throughout.

## Execution Order

Execute strictly in this sequence:

`Task 1 -> Task 2 -> Task 3 -> P11-01A exact-head CI -> Task 4 -> Task 5 -> P11-01B exact-head CI -> Task 6 -> Task 7 -> P11-01C exact-head CI -> Task 8 -> Task 9 -> P11-01D focused GREEN -> Task 10 final exact-head CI/closure`.

Do not combine the A/B/C/D CI gates into one late verification run: each boundary is a reviewer/rollback point and must be independently green before the next subsystem starts.
