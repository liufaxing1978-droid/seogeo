# P11-01 Keyword Demand Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped keyword demand capture center where an operator can manually declare strategic demand such as `符纸`, organize long-tail children, measure deterministic site-content coverage, and review DeepSeek suggestions before explicitly accepting them into the authoritative keyword library.

**Architecture:** Add a focused `src/modules/keywords` domain backed by Prisma. Manual keyword commands are authoritative; coverage is derived only from persisted `Page`/latest `PageSnapshot` facts; AI expansion reuses the existing queued `AiTask -> BullMQ -> DeepSeek -> structured output -> atomic materialize` pipeline and materializes only advisory `KeywordSuggestion` rows until a human accepts them.

**Tech Stack:** Node.js >=22, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL 17, Redis 7/BullMQ, EJS, Zod 3, Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-p11-01-keyword-demand-capture-design.md`

**Pinned design base:** `main@2136087a5ae74b474b1b191b4ef957b4c7b61e96`

## Global Constraints

- AI remains advisory only. DeepSeek output never creates or mutates authoritative `Keyword` rows directly.
- Manual creation is the primary authoritative keyword path.
- `(projectId, normalizedText)` is unique across **all** keyword statuses. Archived duplicates are restored, not recreated.
- Normalization is conservative: Unicode NFKC, trim, collapse whitespace, lowercase Latin; do not convert Traditional/Simplified Chinese and do not stem semantically.
- A keyword has at most one canonical parent in P11-01. Self-parenting and cycles are rejected.
- Strategic lock is server-enforced. Locked strategic mutations require explicit `acknowledgeLock: true`; role does not imply acknowledgement.
- Reads require `PROJECT_READ`; authoritative keyword mutations require `CONTENT_WRITE`; AI generation requires `AI_RUN`; browser mutations require CSRF.
- Cross-project identifiers fail closed as not-found and must not disclose foreign resource existence.
- Coverage values are only `STRONG`, `PARTIAL`, `NONE`, `UNKNOWN`. `UNKNOWN` is required when crawl evidence is insufficient; it must never be converted to `NONE`.
- Keyword-center reads must not enqueue crawls, invoke Search Console, invoke DeepSeek, or make any provider request.
- Search Console remains read-only. `PR_CREATED != DEPLOYED != VERIFIED` remains true. No publish/merge/deploy/rollback authority is added.
- P11-02 live rank/provider evidence is out of scope.
- Every task follows RED -> minimal GREEN -> focused verification -> commit.
- P11-01A, B, C, and D each receive exact-head full CI evidence before the next subsystem starts.

---

## File Map

Create:

- `src/modules/keywords/keyword-normalize.ts`
- `src/modules/keywords/keyword.types.ts`
- `src/modules/keywords/keyword.repository.ts`
- `src/modules/keywords/keyword.service.ts`
- `src/modules/keywords/keyword.routes.ts`
- `src/modules/keywords/keyword-coverage.ts`
- `src/modules/keywords/keyword-coverage.repository.ts`
- `src/modules/keywords/keyword-coverage.service.ts`
- `src/modules/keywords/keyword-ai.ts`
- `src/modules/keywords/keyword.web.repository.ts`
- `src/modules/keywords/keyword.web.routes.ts`
- `src/views/keywords/index.ejs`
- `src/public/css/p11-keywords.css`
- `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql`
- `tests/unit/keyword-normalize.test.ts`
- `tests/unit/keyword-coverage.test.ts`
- `tests/unit/keyword-ai.test.ts`
- `tests/integration/keywords.repository.test.ts`
- `tests/integration/keywords.service.test.ts`
- `tests/integration/keywords.api.test.ts`
- `tests/integration/keywords.coverage.test.ts`
- `tests/integration/keywords.web.test.ts`
- `tests/integration/keywords.ai-worker.test.ts`
- `tests/integration/keywords.suggestions.test.ts`
- `tests/e2e/keywords.spec.ts`

Modify:

- `prisma/schema.prisma`
- `src/app.ts`
- `src/modules/ai/ai.worker.ts`
- `src/modules/ai/prompts/prompt-registry.ts`
- `src/views/partials/sidebar.ejs`
- `src/views/layout.ejs`
- `tests/unit/ai.prompt-registry.test.ts`
- `tests/unit/ai.worker.test.ts`
- `tests/e2e/p10-shell.spec.ts`

---

# P11-01A — Keyword Domain Foundation

### Task 1: Add schema, migration, normalization, and shared types

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql`
- Create: `src/modules/keywords/keyword-normalize.ts`
- Create: `src/modules/keywords/keyword.types.ts`
- Create: `tests/unit/keyword-normalize.test.ts`

**Interfaces:**
- `normalizeKeywordText(text: string): string`
- Prisma enums: `KeywordType`, `KeywordIntent`, `KeywordPriority`, `KeywordStatus`, `KeywordSource`, `KeywordSuggestionStatus`
- Prisma models: `Keyword`, `KeywordRelation`, `KeywordGroup`, `KeywordGroupMembership`, `KeywordSuggestion`, `KeywordAuditEvent`
- Existing `AiTaskType` gains `KEYWORD_EXPANSION`

- [ ] **Step 1: Write RED normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeKeywordText } from '../../src/modules/keywords/keyword-normalize.js';

describe('normalizeKeywordText', () => {
  it('normalizes Unicode width, spaces, and Latin case', () => {
    expect(normalizeKeywordText('  Ｆｏｏ   符紙  ')).toBe('foo 符紙');
  });

  it('does not merge Traditional and Simplified Chinese terms', () => {
    expect(normalizeKeywordText('符紙')).not.toBe(normalizeKeywordText('符纸'));
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/keyword-normalize.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement normalization and shared coverage types**

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

export interface CoveragePageFact {
  pageId: string;
  url: string;
  path: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
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
export type KeywordCoverageEmptyReason = 'NO_ACTIVE_PAGE_EVIDENCE' | 'NO_USABLE_SNAPSHOT_EVIDENCE';

export interface KeywordCoverageResult {
  status: KeywordCoverageStatus;
  reason: 'MATCHED' | 'NO_MATCH' | KeywordCoverageEmptyReason;
  matches: KeywordCoverageEvidence[];
}

export interface KeywordListRecord {
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
}
```

- [ ] **Step 4: Add Prisma enums and models**

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

Add `KEYWORD_EXPANSION` to the existing `AiTaskType` enum.

Add these models:

```prisma
model Keyword {
  id                  String          @id @default(uuid()) @db.Uuid
  projectId           String          @db.Uuid
  text                String
  normalizedText      String
  type                KeywordType
  intent              KeywordIntent?
  priority            KeywordPriority @default(MEDIUM)
  status              KeywordStatus   @default(ACTIVE)
  locked              Boolean         @default(false)
  source              KeywordSource
  language            String?
  targetCountry       String?
  notes               String?
  createdByUserId     String?         @db.Uuid
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  project             Project                  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  parentEdges          KeywordRelation[]        @relation("KeywordParent")
  childEdge            KeywordRelation?         @relation("KeywordChild")
  groupMemberships     KeywordGroupMembership[]
  seededSuggestions    KeywordSuggestion[]      @relation("KeywordSuggestionSeed")
  acceptedSuggestions  KeywordSuggestion[]      @relation("KeywordSuggestionAccepted")
  auditEvents          KeywordAuditEvent[]

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
  id          String   @id @default(uuid()) @db.Uuid
  projectId   String   @db.Uuid
  keywordId   String?  @db.Uuid
  actorUserId String?  @db.Uuid
  eventType   String
  metadata    Json?
  createdAt   DateTime @default(now())

  project Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  keyword Keyword? @relation(fields: [keywordId], references: [id], onDelete: SetNull)

  @@index([projectId, createdAt])
  @@index([keywordId, createdAt])
}
```

Add these relations to `Project`:

```prisma
  keywords                Keyword[]
  keywordRelations        KeywordRelation[]
  keywordGroups           KeywordGroup[]
  keywordGroupMemberships KeywordGroupMembership[]
  keywordSuggestions      KeywordSuggestion[]
  keywordAuditEvents      KeywordAuditEvent[]
```

Create `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql` with the corresponding enum/table/index/foreign-key changes. It is a forward-only migration; do not create down-migration SQL.

- [ ] **Step 5: Verify Task 1 GREEN**

Run:

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
npm test -- tests/unit/keyword-normalize.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260828060000_add_keyword_demand_capture src/modules/keywords/keyword-normalize.ts src/modules/keywords/keyword.types.ts tests/unit/keyword-normalize.test.ts
git commit -m "feat(keywords): add keyword domain schema"
```

---

### Task 2: Add repository invariants and manual keyword service

**Files:**
- Create: `src/modules/keywords/keyword.repository.ts`
- Create: `src/modules/keywords/keyword.service.ts`
- Create: `tests/integration/keywords.repository.test.ts`
- Create: `tests/integration/keywords.service.test.ts`

**Interfaces:**
- `KeywordRepository`
- `KeywordService`
- singleton `keywordService`
- commands: `createManual`, `updateManual`, `setLocked`, `archive`, `restore`, `setParent`, `removeParent`, `createGroup`, `setGroups`, `list`

- [ ] **Step 1: Write repository RED tests**

Test these concrete invariants:

```ts
it('rejects a second normalized keyword in the same project', async () => {
  const repo = new KeywordRepository();
  await repo.createKeyword({ projectId, text: '符纸', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' });
  await expect(repo.createKeyword({ projectId, text: ' 符纸 ', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' }))
    .rejects.toMatchObject({ code: 'P2002' });
});
```

Also test:
- same normalized text is allowed in a different project;
- `childKeywordId` uniqueness prevents two canonical parent rows.

- [ ] **Step 2: Run repository RED**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Implement a transaction-friendly repository**

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

  appendAudit(
    projectId: string,
    keywordId: string | null,
    actorUserId: string | null,
    eventType: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.db.keywordAuditEvent.create({
      data: { projectId, keywordId, actorUserId, eventType, metadata },
    });
  }
}
```

Add project-scoped list/update/status/group/suggestion methods. Suggestion bulk create uses `skipDuplicates: true`.

- [ ] **Step 4: Run repository GREEN**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Write service RED tests**

Required RED cases:

```ts
it('requires restore rather than recreating archived logical identity', async () => {
  const created = await service.createManual({ actorUserId, projectId, text: '符纸', type: 'CORE' });
  await service.archive({ actorUserId, projectId, keywordId: created.id, acknowledgeLock: false });
  await expect(service.createManual({ actorUserId, projectId, text: ' 符纸 ', type: 'CORE' }))
    .rejects.toMatchObject({ code: 'KEYWORD_ARCHIVED_RESTORE_REQUIRED' });
});

it('blocks a locked strategic mutation without acknowledgement', async () => {
  const created = await service.createManual({ actorUserId, projectId, text: '符纸', type: 'CORE', locked: true });
  await expect(service.updateManual({ actorUserId, projectId, keywordId: created.id, text: '符纸文化', acknowledgeLock: false }))
    .rejects.toMatchObject({ code: 'KEYWORD_LOCKED' });
});
```

Also test:
- self-parent -> `KEYWORD_PARENT_SELF`;
- `A -> B -> C`, then `C -> A` -> `KEYWORD_RELATION_CYCLE`;
- foreign parent/group ID -> `KEYWORD_NOT_FOUND` or `KEYWORD_GROUP_NOT_FOUND` without foreign data disclosure;
- restore returns the same row ID;
- disabled/active duplicate create -> `KEYWORD_DUPLICATE`.

- [ ] **Step 6: Run service RED**

Run: `npm test -- tests/integration/keywords.service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 7: Implement serializable command semantics**

```ts
import { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
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

async function assertNoCycle(
  repo: KeywordRepository,
  projectId: string,
  childKeywordId: string,
  proposedParentKeywordId: string,
) {
  if (childKeywordId === proposedParentKeywordId) {
    throw new AppError('Keyword cannot parent itself', 409, 'KEYWORD_PARENT_SELF');
  }

  const seen = new Set<string>();
  let cursor: string | null = proposedParentKeywordId;
  while (cursor) {
    if (cursor === childKeywordId || seen.has(cursor)) {
      throw new AppError('Keyword relation would create a cycle', 409, 'KEYWORD_RELATION_CYCLE');
    }
    seen.add(cursor);
    cursor = (await repo.parentOf(projectId, cursor))?.parentKeywordId ?? null;
  }
}
```

`createManual` must normalize before identity lookup. Existing archived row -> `KEYWORD_ARCHIVED_RESTORE_REQUIRED`; existing active/disabled row -> `KEYWORD_DUPLICATE`. Catch Prisma `P2002`, re-read the winner, and return the same stable application error so concurrent creates are deterministic.

All successful commands write one audit row in the same transaction using these event strings:

- `KEYWORD_CREATED`
- `KEYWORD_UPDATED`
- `KEYWORD_LOCK_CHANGED`
- `KEYWORD_ARCHIVED`
- `KEYWORD_RESTORED`
- `KEYWORD_PARENT_SET`
- `KEYWORD_PARENT_REMOVED`
- `KEYWORD_GROUPS_CHANGED`

- [ ] **Step 8: Run GREEN and commit**

```bash
npm test -- tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
npm run typecheck
git add src/modules/keywords/keyword.repository.ts src/modules/keywords/keyword.service.ts tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
git commit -m "feat(keywords): add manual keyword commands"
```

---

### Task 3: Add secured keyword JSON API and freeze P11-01A

**Files:**
- Create: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.api.test.ts`

**Interfaces:**
- `createKeywordRoutes(service?: KeywordService, coverageService?: KeywordCoverageService, aiTaskService?: Pick<AiTaskService, 'createAndEnqueue'>)`
- API base: `/api/v1/projects/:projectId/keywords`

- [ ] **Step 1: Write authorization RED tests**

Use existing `seedAuthenticatedUser`, `deriveCsrfToken`, and `env`.

```ts
it('lets VIEWER read but rejects keyword mutation', async () => {
  const fixture = await seedAuthenticatedUser({
    role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
  });
  const csrf = deriveCsrfToken(env.SESSION_SECRET, fixture.csrfInput.sessionId, fixture.csrfInput.tokenHash);
  try {
    await request(createApp())
      .get(`/api/v1/projects/${fixture.project.id}/keywords`)
      .set('Cookie', fixture.sessionCookie)
      .expect(200);

    const response = await request(createApp())
      .post(`/api/v1/projects/${fixture.project.id}/keywords`)
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrf)
      .send({ text: '符纸', type: 'CORE' })
      .expect(403);

    expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
  } finally {
    await fixture.cleanup();
  }
});
```

Also test anonymous 401, non-member 404, missing/invalid CSRF 403, and OPERATOR mutation success.

- [ ] **Step 2: Run API RED**

Run: `npm test -- tests/integration/keywords.api.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement route middleware contracts**

Read:

```ts
router.get(
  '/projects/:projectId/keywords',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  async (req, res, next) => {
    try {
      res.json({ data: await service.list(projectId(req)) });
    } catch (error) {
      next(error);
    }
  },
);
```

Create:

```ts
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
    } catch (error) {
      next(error);
    }
  },
);
```

Add update, archive, restore, lock, parent-set/remove, group-create/assignment endpoints. Locked operations take explicit `acknowledgeLock` from the request body.

- [ ] **Step 4: Mount routes in `src/app.ts`**

Add `keywordService?: KeywordService` to `AppOptions` and mount after authentication:

```ts
app.use('/api/v1', createKeywordRoutes(options.keywordService));
```

- [ ] **Step 5: Run P11-01A focused GREEN**

```bash
npm test -- tests/unit/keyword-normalize.test.ts tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts tests/integration/keywords.api.test.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.api.test.ts
git commit -m "feat(keywords): expose secured keyword API"
```

- [ ] **Step 7: Obtain P11-01A exact-head CI**

Push the exact head. Require current repository `verify`, `production-audit`, `e2e`, and required deployment/runtime artifact checks to be green. Record exact head SHA and workflow run ID. Do not start Task 4 on a red A head.

---

# P11-01B — Deterministic Coverage Engine

### Task 4: Add pure coverage scoring and persisted-fact repository

**Files:**
- Create: `src/modules/keywords/keyword-coverage.ts`
- Create: `src/modules/keywords/keyword-coverage.repository.ts`
- Create: `tests/unit/keyword-coverage.test.ts`

**Interfaces:**
- `scoreKeywordAgainstPage(keywordText, page): KeywordCoverageEvidence`
- `resolveKeywordCoverage(keywordText, pages, emptyReason?): KeywordCoverageResult`
- `KeywordCoverageRepository.listActivePageFacts(projectId)` -> `{ usablePages, emptyReason }`

- [ ] **Step 1: Write coverage RED tests**

```ts
const base = {
  pageId: '00000000-0000-0000-0000-000000000001',
  url: 'https://example.com/culture/fuzhi',
  path: '/culture/fuzhi',
  title: null,
  h1: null,
  metaDescription: null,
};

it('returns STRONG for title or H1 evidence', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '符纸：传统用途与文化' }]).status).toBe('STRONG');
});

it('returns PARTIAL for weaker meta evidence', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, metaDescription: '介绍符纸的历史来源' }]).status).toBe('PARTIAL');
});

it('returns NONE only when usable evidence exists but has no match', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '六壬文化', h1: '民间信仰' }]).status).toBe('NONE');
});

it('returns UNKNOWN when usable crawl evidence is absent', () => {
  expect(resolveKeywordCoverage('符纸', [], 'NO_USABLE_SNAPSHOT_EVIDENCE').status).toBe('UNKNOWN');
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/keyword-coverage.test.ts`

Expected: FAIL because coverage module is absent.

- [ ] **Step 3: Implement transparent scoring**

```ts
const WEIGHTS = { title: 4, h1: 4, metaDescription: 2, path: 1 } as const;

function contains(value: string | null, normalizedKeyword: string): boolean {
  return value ? normalizeKeywordText(value).includes(normalizedKeyword) : false;
}

function safeDecodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function scoreKeywordAgainstPage(
  keywordText: string,
  page: CoveragePageFact,
): KeywordCoverageEvidence {
  const keyword = normalizeKeywordText(keywordText);
  const titleMatch = contains(page.title, keyword);
  const h1Match = contains(page.h1, keyword);
  const metaDescriptionMatch = contains(page.metaDescription, keyword);
  const pathMatch = contains(safeDecodePath(page.path), keyword);
  const score = Number(titleMatch) * WEIGHTS.title
    + Number(h1Match) * WEIGHTS.h1
    + Number(metaDescriptionMatch) * WEIGHTS.metaDescription
    + Number(pathMatch) * WEIGHTS.path;

  return {
    pageId: page.pageId,
    url: page.url,
    titleMatch,
    h1Match,
    metaDescriptionMatch,
    pathMatch,
    score,
  };
}

export function resolveKeywordCoverage(
  keywordText: string,
  pages: CoveragePageFact[],
  emptyReason: KeywordCoverageEmptyReason = 'NO_ACTIVE_PAGE_EVIDENCE',
): KeywordCoverageResult {
  if (pages.length === 0) return { status: 'UNKNOWN', reason: emptyReason, matches: [] };

  const evidence = pages
    .map((page) => scoreKeywordAgainstPage(keywordText, page))
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const matches = evidence.filter((item) => item.score > 0);

  if (matches.some((item) => item.score >= 4)) return { status: 'STRONG', reason: 'MATCHED', matches };
  if (matches.length > 0) return { status: 'PARTIAL', reason: 'MATCHED', matches };
  return { status: 'NONE', reason: 'NO_MATCH', matches: [] };
}
```

- [ ] **Step 4: Implement one latest-snapshot query**

```ts
const pages = await prisma.page.findMany({
  where: { projectId, isActive: true },
  select: {
    id: true,
    url: true,
    path: true,
    snapshots: {
      orderBy: { capturedAt: 'desc' },
      take: 1,
      select: {
        title: true,
        h1: true,
        metaDescription: true,
        statusCode: true,
        indexable: true,
      },
    },
  },
  orderBy: { normalizedUrl: 'asc' },
});
```

A usable snapshot requires `statusCode >= 200 && statusCode < 300 && indexable !== false`.

Return:
- no active pages -> `emptyReason: 'NO_ACTIVE_PAGE_EVIDENCE'`;
- active pages but no usable latest snapshot -> `emptyReason: 'NO_USABLE_SNAPSHOT_EVIDENCE'`.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- tests/unit/keyword-coverage.test.ts
npm run typecheck
git add src/modules/keywords/keyword-coverage.ts src/modules/keywords/keyword-coverage.repository.ts tests/unit/keyword-coverage.test.ts
git commit -m "feat(keywords): add deterministic coverage scoring"
```

---

### Task 5: Add coverage orchestration and secured read API

**Files:**
- Create: `src/modules/keywords/keyword-coverage.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.coverage.test.ts`

**Interfaces:**
- `KeywordCoverageService.evaluateProject(projectId, keywords)`
- `KeywordCoverageService.evaluateKeyword(projectId, keywordId)`
- `GET /api/v1/projects/:projectId/keywords/:keywordId/coverage`

- [ ] **Step 1: Write integration RED proving reads have no execution side effects**

Seed project, keyword, active page, and snapshot through Prisma. Inject spies into `createApp` and assert they are not called:

```ts
const crawlSpy = vi.fn();
const aiSpy = vi.fn();
const response = await request(createApp({
  crawlService: { enqueue: crawlSpy } as never,
  aiTaskService: { createAndEnqueue: aiSpy } as never,
}))
  .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/coverage`)
  .set('Cookie', fixture.sessionCookie)
  .expect(200);

expect(response.body.data.status).toBe('STRONG');
expect(crawlSpy).not.toHaveBeenCalled();
expect(aiSpy).not.toHaveBeenCalled();
```

Also test `UNKNOWN` for no usable snapshot and 404 for a foreign keyword ID.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/keywords.coverage.test.ts`

Expected: FAIL because service/route are absent.

- [ ] **Step 3: Implement project coverage service**

```ts
export class KeywordCoverageService {
  constructor(
    private readonly coverageRepository = new KeywordCoverageRepository(),
    private readonly keywordRepository = new KeywordRepository(),
  ) {}

  async evaluateProject(projectId: string, keywords: Array<{ id: string; text: string }>) {
    const facts = await this.coverageRepository.listActivePageFacts(projectId);
    return new Map(keywords.map((keyword) => [
      keyword.id,
      resolveKeywordCoverage(keyword.text, facts.usablePages, facts.emptyReason),
    ]));
  }

  async evaluateKeyword(projectId: string, keywordId: string) {
    const keyword = await this.keywordRepository.findKeyword(projectId, keywordId);
    if (!keyword) throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');
    return (await this.evaluateProject(projectId, [keyword])).get(keyword.id)!;
  }
}
```

- [ ] **Step 4: Add `PROJECT_READ` coverage route and app injection**

Add `keywordCoverageService?: KeywordCoverageService` to `AppOptions`; pass it to `createKeywordRoutes`. The GET route uses `requireAuthentication`, `requireProjectMembership`, `requireProjectCapability('PROJECT_READ')`; no CSRF for GET.

- [ ] **Step 5: Run P11-01B GREEN**

```bash
npm test -- tests/unit/keyword-coverage.test.ts tests/integration/keywords.coverage.test.ts tests/integration/keywords.api.test.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit and exact-head gate**

```bash
git add src/modules/keywords/keyword-coverage.service.ts src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.coverage.test.ts
git commit -m "feat(keywords): expose content coverage evidence"
```

Push exact head and require current full CI green before Task 6.

---

# P11-01C — Keyword Center UI

### Task 6: Build secured EJS keyword center and manual controls

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
- `createKeywordWebRoutes(service?: KeywordService, coverageService?: KeywordCoverageService)`
- `GET /projects/:id/keywords`
- POST forms for create/update/lock/archive/restore/parent/group operations

- [ ] **Step 1: Write web RED tests**

```ts
it('renders keyword facts without fabricated ranking', async () => {
  const fixture = await seedAuthenticatedUser({
    role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
  });
  try {
    await keywordService.createManual({
      actorUserId: fixture.user.id,
      projectId: fixture.project.id,
      text: '符纸',
      type: 'CORE',
      priority: 'HIGH',
      locked: true,
    });

    const response = await request(createApp())
      .get(`/projects/${fixture.project.id}/keywords`)
      .set('Cookie', fixture.sessionCookie)
      .expect(200);

    expect(response.text).toContain('关键词中心');
    expect(response.text).toContain('符纸');
    expect(response.text).toContain('站内内容覆盖');
    expect(response.text).toContain('排名数据：未接入');
    expect(response.text).not.toContain('Google 排名：1');
  } finally {
    await fixture.cleanup();
  }
});
```

Also test anonymous 401, non-member 404, VIEWER GET success, VIEWER mutation 403, invalid CSRF 403.

- [ ] **Step 2: Run web RED**

Run: `npm test -- tests/integration/keywords.web.test.ts`

Expected: FAIL because web module/view are absent.

- [ ] **Step 3: Implement read model with one coverage read**

```ts
export interface KeywordCenterViewModel {
  project: { id: string; name: string; defaultLanguage: string; targetCountry: string };
  summary: { active: number; locked: number; strong: number; partial: number; none: number; unknown: number };
  keywords: Array<KeywordListRecord & { parentKeywordId: string | null; coverage: KeywordCoverageResult }>;
  groups: Array<{ id: string; name: string }>;
  suggestions: Array<{
    id: string;
    seedKeywordId: string;
    suggestedText: string;
    status: string;
    rationale: string | null;
  }>;
}
```

The repository loads project-scoped keyword/tree/group/suggestion facts, then calls `KeywordCoverageService.evaluateProject` once for all visible keywords. Do not expose secrets, provider credentials, search volume, or fabricated ranking fields.

- [ ] **Step 4: Implement web security and CSRF token generation**

```ts
function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
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

Render `layout` with `activeNav: 'keywords'`, `currentProjectId`, `bodyTemplate: 'keywords/index'`, `csrfToken`, and `canWriteKeywords: hasProjectCapability(role, 'CONTENT_WRITE')`.

- [ ] **Step 5: Build stable EJS selectors and forms**

The page contains:

```html
<section data-ui="keyword-summary"></section>
<section data-ui="keyword-library"></section>
<section data-ui="keyword-tree"></section>
<section data-ui="keyword-coverage"></section>
<section data-ui="keyword-advisory" aria-label="AI 长尾建议"></section>
```

Manual form labels/fields:
- `关键词` / `text`
- `类型` / `type`
- `搜索意图` / `intent`
- `优先级` / `priority`
- `父关键词` / `parentKeywordId`
- `语言` / `language`
- `目标市场` / `targetCountry`
- `备注` / `notes`
- `战略锁定` / `locked`
- hidden `_csrf`

Coverage labels:
- `STRONG` -> `覆盖较强`
- `PARTIAL` -> `部分覆盖`
- `NONE` -> `内容缺口`
- `UNKNOWN` -> `证据不足`

Future evidence area renders exactly `排名数据：未接入`.

- [ ] **Step 6: Add sidebar and CSS**

In `sidebar.ejs` add `keywords: 'keywords'` to `centerByActiveNav` and insert:

```js
{ key: 'keywords', label: '关键词中心', icon: 'seo', href: projectHref('/keywords') },
```

between SEO and GEO. Reuse the existing SEO icon.

In `layout.ejs` add:

```html
<link rel="stylesheet" href="/assets/css/p11-keywords.css">
```

Scope new CSS under `.keyword-center`. At widths below 900px stack cards/forms and use an internal `.keyword-table-wrap { overflow-x: auto; }` so document-level overflow is not introduced.

- [ ] **Step 7: Mount web router and run GREEN**

```bash
npm test -- tests/integration/keywords.web.test.ts
npm run test:e2e -- tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/keywords/keyword.web.repository.ts src/modules/keywords/keyword.web.routes.ts src/views/keywords/index.ejs src/public/css/p11-keywords.css src/views/partials/sidebar.ejs src/views/layout.ejs src/app.ts tests/integration/keywords.web.test.ts tests/e2e/p10-shell.spec.ts
git commit -m "feat(keywords): add keyword center UI"
```

---

### Task 7: Add Playwright flow and freeze P11-01C

**Files:**
- Create: `tests/e2e/keywords.spec.ts`

- [ ] **Step 1: Write E2E RED**

```ts
import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('operator captures 符纸 demand and sees truthful coverage', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
  });
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
  } finally {
    await auth.cleanup();
  }
});
```

Add an 820px viewport test proving sidebar open/close still works and `document.documentElement.scrollWidth - clientWidth <= 1`.

- [ ] **Step 2: Run RED**

Run: `npm run test:e2e -- tests/e2e/keywords.spec.ts`

Expected: FAIL until all new-page selectors/form behavior exist.

- [ ] **Step 3: Make only demonstrated UI corrections**

Fix missing labels/selectors/redirects/responsive containment only. Do not redesign the P10 shell.

- [ ] **Step 4: Run P11-01C GREEN**

```bash
npm test -- tests/integration/keywords.web.test.ts tests/integration/keywords.api.test.ts tests/unit/keyword-coverage.test.ts tests/integration/keywords.coverage.test.ts
npm run test:e2e -- tests/e2e/keywords.spec.ts tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 5: Commit and exact-head gate**

```bash
git add tests/e2e/keywords.spec.ts src/views/keywords/index.ejs src/public/css/p11-keywords.css
git commit -m "test(keywords): cover manual demand capture UI"
```

Push exact head and require current full CI green before Task 8.

---

# P11-01D — DeepSeek Long-Tail Advisory

### Task 8: Add queued keyword-expansion task and atomic advisory materialization

**Files:**
- Create: `src/modules/keywords/keyword-ai.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Create: `tests/unit/keyword-ai.test.ts`
- Modify: `tests/unit/ai.prompt-registry.test.ts`
- Modify: `tests/unit/ai.worker.test.ts`
- Create: `tests/integration/keywords.ai-worker.test.ts`

**Interfaces:**
- `KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1'`
- `KeywordExpansionOutputSchema`
- `parseKeywordExpansionOutput(content, seedText)`
- `buildKeywordExpansionTaskInput(projectId, seedKeywordId)`
- `createKeywordExpansionTask(projectId, seedKeywordId, service?)`
- `materializeKeywordSuggestions(task, output, providerMeta, tx)`

- [ ] **Step 1: Write parser RED**

```ts
it('de-duplicates normalized suggestions and excludes the seed', () => {
  const output = parseKeywordExpansionOutput(JSON.stringify({
    suggestions: [
      { text: '六壬符纸', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '更窄的相关主题' },
      { text: ' 六壬符纸 ', type: 'LONG_TAIL', intent: 'INFORMATIONAL', rationale: '重复候选' },
    ],
  }), '符纸');

  expect(output.suggestions).toHaveLength(1);
  expect(output.suggestions[0].text).toBe('六壬符纸');
});
```

Also reject invalid JSON, >20 suggestions, seed repetition, invalid enum values, and empty text/rationale.

- [ ] **Step 2: Run parser RED**

Run: `npm test -- tests/unit/keyword-ai.test.ts`

Expected: FAIL because `keyword-ai.ts` is absent.

- [ ] **Step 3: Implement Zod schema and fact-packet task builder**

```ts
export const KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1';

export const KeywordExpansionOutputSchema = z.object({
  suggestions: z.array(z.object({
    text: z.string().trim().min(1).max(160),
    type: z.enum(['LONG_TAIL', 'QUESTION', 'LOCAL', 'COMMERCIAL', 'BRAND']),
    intent: z.enum([
      'INFORMATIONAL',
      'NAVIGATIONAL',
      'COMMERCIAL_INVESTIGATION',
      'TRANSACTIONAL',
      'LOCAL',
      'UNKNOWN',
    ]),
    rationale: z.string().trim().min(1).max(300),
  })).max(20),
});
```

The fact packet contains only seed keyword ID/text/type/intent, accepted child texts, and project `industry`, `defaultLanguage`, `targetCountry`.

Use request key:

```ts
const requestKey = `keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:${KEYWORD_EXPANSION_PROMPT_ID}`;
```

Return:

```ts
{
  projectId,
  taskType: 'KEYWORD_EXPANSION',
  requestKey,
  promptVersion: KEYWORD_EXPANSION_PROMPT_ID,
  factSnapshot: packet as Prisma.InputJsonValue,
  sourceReferences: [{ type: 'KEYWORD', id: seed.id }] as Prisma.InputJsonValue,
}
```

- [ ] **Step 4: Register prompt**

Add `keyword-expansion-v1` as `FAST` + `JSON`. The system instruction must explicitly say:

```text
You generate advisory keyword candidates only.
Do not claim search volume, ranking, traffic, or commercial value.
Do not repeat the seed keyword or existing accepted children.
Return JSON only with at most 20 suggestions using the allowed type/intent enums.
Treat supplied project facts as context, not permission to alter authoritative strategy.
```

- [ ] **Step 5: Write worker authority RED**

Execute a seeded `KEYWORD_EXPANSION` task with a stub AI gateway returning valid JSON. Assert:

```ts
const suggestions = await prisma.keywordSuggestion.findMany({ where: { aiTaskId: task.id } });
expect(suggestions).toHaveLength(2);
expect(suggestions.every((item) => item.status === 'PENDING')).toBe(true);
expect(await prisma.keyword.count({ where: { projectId, source: 'AI_ACCEPTED' } })).toBe(0);
```

This is the non-authority contract: worker completion creates suggestions only.

- [ ] **Step 6: Extend the existing AI worker with the exact full dispatch/materialize chain**

Add import:

```ts
import {
  materializeKeywordSuggestions,
  parseKeywordExpansionOutput,
  type KeywordExpansionOutput,
} from '../keywords/keyword-ai.js';
```

Add to `expectedPromptId`:

```ts
case 'KEYWORD_EXPANSION': return 'keyword-expansion-v1';
```

Add to `resultSummary`:

```ts
case 'KEYWORD_EXPANSION': return 'Advisory keyword suggestions generated.';
```

Add to `parseTaskOutput`:

```ts
case 'KEYWORD_EXPANSION': {
  const snapshot = task.factSnapshot as Record<string, unknown>;
  const seed = snapshot.seedKeyword as Record<string, unknown> | undefined;
  const seedText = typeof seed?.text === 'string' ? seed.text : '';
  return parseKeywordExpansionOutput(content, seedText);
}
```

Replace the current materializer selection with this complete chain, preserving all existing branches and inserting `KEYWORD_EXPANSION` first:

```ts
const materialize = task.taskType === 'KEYWORD_EXPANSION'
  ? (tx: Prisma.TransactionClient) => materializeKeywordSuggestions(
      task,
      output as KeywordExpansionOutput,
      { model: response.model, responseId: response.responseId },
      tx,
    )
  : task.taskType === 'OPTIMIZATION_PLAN_RANKING'
    ? (tx: Prisma.TransactionClient) => materializeOptimizationRankingSuccess(
        task,
        output as OptimizationPlanRankingOutput,
        tx,
      )
    : task.taskType === 'CONTENT_BRIEF'
      ? (tx: Prisma.TransactionClient) => persistContentBrief(
          task,
          output as ReturnType<typeof parseContentBriefOutput>,
          tx,
        ).then(() => undefined)
      : task.taskType === 'PUBLICATION_ARTICLE_GENERATION'
        ? (tx: Prisma.TransactionClient) => materializeArticleGenerationOutput(
            task,
            output as ReturnType<typeof parsePublicationArticleGenerationOutput>,
            tx,
          )
        : task.taskType === 'PUBLICATION_CONTENT_ADAPTATION'
          ? (tx: Prisma.TransactionClient) => materializeDistributionAdaptationOutput(
              task,
              output as ReturnType<typeof parseDistributionAdaptationTaskOutput>,
              tx,
            )
          : undefined;
```

Implement materializer:

```ts
export async function materializeKeywordSuggestions(
  task: AiTask,
  output: KeywordExpansionOutput,
  providerMeta: { model: string; responseId: string | null },
  tx: Prisma.TransactionClient,
): Promise<void> {
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
      model: providerMeta.model,
      aiTaskId: task.id,
      responseId: providerMeta.responseId,
    })),
    skipDuplicates: true,
  });
}
```

Because this closure is passed to existing `repository.completeRun(...)`, the validated AI run and advisory suggestions commit atomically.

- [ ] **Step 7: Run AI GREEN**

```bash
npm test -- tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/keywords/keyword-ai.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
git commit -m "feat(keywords): add advisory AI expansion"
```

---

### Task 9: Add human generate/accept/reject workflow and advisory review UI

**Files:**
- Modify: `src/modules/keywords/keyword.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/views/keywords/index.ejs`
- Create: `tests/integration/keywords.suggestions.test.ts`
- Modify: `tests/e2e/keywords.spec.ts`

**Interfaces:**
- `acceptSuggestion({ actorUserId, projectId, suggestionId, editedText? })`
- `rejectSuggestion({ actorUserId, projectId, suggestionId })`
- Generate: `POST /api/v1/projects/:projectId/keywords/:keywordId/suggestions/generate` with `AI_RUN` + CSRF
- Accept/reject: `POST /api/v1/projects/:projectId/keyword-suggestions/:suggestionId/accept|reject` with `CONTENT_WRITE` + CSRF

- [ ] **Step 1: Write suggestion decision RED**

```ts
it('accepts a pending suggestion idempotently and creates one AI_ACCEPTED child', async () => {
  const first = await service.acceptSuggestion({ actorUserId, projectId, suggestionId: suggestion.id });
  const second = await service.acceptSuggestion({ actorUserId, projectId, suggestionId: suggestion.id });

  expect(second.id).toBe(first.id);
  expect(first.source).toBe('AI_ACCEPTED');
  expect((await prisma.keywordRelation.findUnique({ where: { childKeywordId: first.id } }))?.parentKeywordId)
    .toBe(seed.id);
});
```

Also test:
- rejected/expired suggestion cannot become authoritative;
- existing active/disabled normalized keyword is linked, not duplicated;
- existing archived normalized keyword -> `KEYWORD_ARCHIVED_RESTORE_REQUIRED`;
- edited acceptance text is re-normalized;
- generation requires `AI_RUN`;
- accept/reject require `CONTENT_WRITE` + CSRF;
- foreign suggestion ID returns 404.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/keywords.suggestions.test.ts`

Expected: FAIL because commands/routes are absent.

- [ ] **Step 3: Implement idempotent acceptance in a serializable transaction**

Start with:

```ts
if (suggestion.status === 'ACCEPTED' && suggestion.acceptedKeywordId) {
  const linked = await repo.findKeyword(projectId, suggestion.acceptedKeywordId);
  if (linked) return linked;
}

if (suggestion.status !== 'PENDING') {
  throw new AppError(
    'Keyword suggestion already decided',
    409,
    'KEYWORD_SUGGESTION_ALREADY_DECIDED',
  );
}
```

Then execute in order:
1. normalize edited/original text;
2. re-read keyword identity;
3. active/disabled existing -> link it;
4. archived existing -> throw `KEYWORD_ARCHIVED_RESTORE_REQUIRED`;
5. absent -> create source `AI_ACCEPTED`, priority `MEDIUM`, suggested type/intent;
6. validate/set canonical parent to seed;
7. mark suggestion `ACCEPTED` with decision actor/time/acceptedKeywordId;
8. append `KEYWORD_SUGGESTION_ACCEPTED` in the same transaction.

Reject only transitions `PENDING -> REJECTED` and appends `KEYWORD_SUGGESTION_REJECTED` atomically.

- [ ] **Step 4: Add generation and decision routes**

Generation:

```ts
const task = await createKeywordExpansionTask(
  projectId(req),
  keywordId(req),
  aiTaskService,
);
res.status(202).json({ data: { aiTaskId: task.id } });
```

Generation does not synchronously create suggestions; the worker creates them after validated AI completion.

- [ ] **Step 5: Add advisory review UI**

Inside `data-ui="keyword-advisory"`, render visible `建议 / Advisory`, text/type/intent/rationale, editable acceptance text, `接受`, `拒绝`, and `生成长尾关键词建议` controls. Pending suggestions must never be presented as rank, search volume, traffic forecast, or proven commercial opportunity.

- [ ] **Step 6: Extend E2E without live DeepSeek**

Seed an AI task:

```ts
const seededAiTask = await prisma.aiTask.create({
  data: {
    projectId: auth.project.id,
    taskType: 'KEYWORD_EXPANSION',
    requestKey: `e2e-keyword-expansion:${randomUUID()}`,
    promptVersion: 'keyword-expansion-v1',
    factSnapshot: { seedKeyword: { id: seed.id, text: seed.text } },
    sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
  },
});
```

Seed the advisory suggestion:

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

Reload, click `接受`, and assert `六壬符纸` appears under `符纸` with AI-accepted origin.

- [ ] **Step 7: Run P11-01D focused GREEN**

```bash
npm test -- tests/unit/keyword-ai.test.ts tests/integration/keywords.ai-worker.test.ts tests/integration/keywords.suggestions.test.ts tests/integration/keywords.web.test.ts tests/integration/keywords.api.test.ts
npm run test:e2e -- tests/e2e/keywords.spec.ts tests/e2e/p10-shell.spec.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/keywords/keyword.service.ts src/modules/keywords/keyword.routes.ts src/modules/keywords/keyword.web.routes.ts src/modules/keywords/keyword.web.repository.ts src/views/keywords/index.ejs tests/integration/keywords.suggestions.test.ts tests/e2e/keywords.spec.ts
git commit -m "feat(keywords): add human-reviewed AI suggestions"
```

---

### Task 10: Final exact-head regression and closure evidence

**Files:**
- Create after implementation evidence exists: `docs/development/p11-01-keyword-demand-capture-verification.md`
- Modify production files only for demonstrated P11-01 defects found by verification.

- [ ] **Step 1: Verify database/schema contract**

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
```

Expected: all exit 0.

- [ ] **Step 2: Run complete local suite**

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: zero failures. If any command fails, fix only the demonstrated P11-01 regression and rerun the complete failed command.

- [ ] **Step 3: Verify scope against pinned base**

```bash
git status --short
git diff --check
git diff --stat 2136087a5ae74b474b1b191b4ef957b4c7b61e96...HEAD
```

Expected:
- clean worktree;
- `git diff --check` no output and exit 0;
- diff limited to P11-01 keyword schema/domain/coverage/AI/UI/tests/docs;
- no P11-02 rank provider, autonomous publication, merge, deploy, rollback, or unrelated refactor.

If the approved integration base changes before Task 1 starts, amend both spec and plan base in a documentation-only commit before implementation; never silently execute against a different base.

- [ ] **Step 4: Obtain exact-head repository CI**

Record exact implementation head SHA, workflow run ID, `verify`, `production-audit`, `e2e`, and current required deployment/runtime artifact checks. Local tests alone do not close P11-01.

- [ ] **Step 5: Write closure evidence using observed results only**

`docs/development/p11-01-keyword-demand-capture-verification.md` records:
- base SHA and final implementation head;
- migration name;
- A/B/C/D RED/GREEN milestones;
- exact-head CI run/jobs;
- manual authoritative keyword semantics;
- `UNKNOWN != NONE` coverage truth;
- AI creates `KeywordSuggestion` before any human acceptance;
- strategic-lock behavior;
- explicit exclusions: P11-02 ranking, production deployment, autonomous publish/merge/deploy/rollback.

Do not state `100% complete` until all required exact-head gates are green.

- [ ] **Step 6: Commit closure evidence and re-run CI on the documentation head**

```bash
git add docs/development/p11-01-keyword-demand-capture-verification.md
git commit -m "docs: record P11-01 verification evidence"
```

Because HEAD changes, obtain a new required CI run for that exact documentation head before integration.

---

## Spec Coverage Self-Check

- Manual create/edit/archive/restore/enable-disable: Tasks 1-3.
- Strategic lock + explicit acknowledgement: Task 2; exposed in Tasks 3/6.
- Type/intent/priority/market/language metadata: Tasks 1-3 and 6.
- One canonical parent + self/cycle/cross-project safety: Tasks 1-2.
- Groups/topics: Tasks 1-2 and 6.
- Normalized uniqueness across all statuses + restore semantics: Tasks 1-2.
- Deterministic `STRONG/PARTIAL/NONE/UNKNOWN`: Tasks 4-5.
- No fresh crawl/provider request on reads: Task 5.
- Summary/library/tree/detail/coverage UI: Tasks 6-7.
- DeepSeek advisory expansion through existing queued AI architecture: Task 8.
- Suggestions remain non-authoritative until review: Task 8 hard authority test.
- Explicit accept/reject/idempotency: Task 9.
- RBAC/CSRF/fail-closed project scoping: Tasks 3, 6, 9.
- Keyword audit events + existing AI observability: Tasks 1-2 and 8-9.
- Exact-head full regression and truth-boundary closure: Task 10.
- P11-02 ranking/provider work remains excluded.

## Execution Order

Execute strictly:

`Task 1 -> Task 2 -> Task 3 -> P11-01A exact-head CI -> Task 4 -> Task 5 -> P11-01B exact-head CI -> Task 6 -> Task 7 -> P11-01C exact-head CI -> Task 8 -> Task 9 -> P11-01D focused GREEN -> Task 10 final exact-head CI/closure`.

Do not combine the A/B/C/D exact-head gates into one late run. Each is an independent reviewer/rollback boundary.
