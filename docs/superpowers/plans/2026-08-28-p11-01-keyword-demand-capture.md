# P11-01 Keyword Demand Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped keyword demand capture center where operators can manually control strategic keywords such as `符纸`, measure deterministic site-content coverage, and review DeepSeek long-tail suggestions before explicitly accepting them into the authoritative keyword library.

**Architecture:** Add a focused `src/modules/keywords` domain backed by Prisma models for keywords, canonical parent relations, groups, advisory suggestions, and keyword audit events. Reuse existing project RBAC/CSRF boundaries, persisted `Page`/`PageSnapshot` facts for coverage, and the existing queued `AiTask -> BullMQ -> DeepSeek -> structured output -> atomic materialize` pipeline for advisory expansion. No keyword-center read may trigger a fresh crawl or provider request.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL 17, EJS, Zod 3, BullMQ/Redis 7, Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-p11-01-keyword-demand-capture-design.md`

**Pinned design base:** `main@2136087a5ae74b474b1b191b4ef957b4c7b61e96`

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
- Every implementation task follows RED -> minimal GREEN -> focused verification -> commit.
- Each P11-01A/B/C/D boundary receives exact-head full CI evidence before the next subsystem starts.

---

## File Structure

### New keyword-domain files

- `src/modules/keywords/keyword-normalize.ts` — conservative normalization only.
- `src/modules/keywords/keyword.types.ts` — command and coverage view types.
- `src/modules/keywords/keyword.repository.ts` — transaction-friendly Prisma persistence.
- `src/modules/keywords/keyword.service.ts` — authoritative commands, lock/restore/tree/group/suggestion decisions.
- `src/modules/keywords/keyword.routes.ts` — secured JSON API.
- `src/modules/keywords/keyword-coverage.repository.ts` — latest persisted active-page facts.
- `src/modules/keywords/keyword-coverage.ts` — pure multi-field coverage resolver.
- `src/modules/keywords/keyword-coverage.service.ts` — project coverage orchestration.
- `src/modules/keywords/keyword-ai.ts` — AI task builder, Zod parser, advisory materializer.
- `src/modules/keywords/keyword.web.repository.ts` — EJS read model.
- `src/modules/keywords/keyword.web.routes.ts` — secured EJS GET/POST flows.
- `src/views/keywords/index.ejs` — keyword-center UI.
- `src/public/css/p11-keywords.css` — responsive keyword-center styles.

### Existing files modified

- `prisma/schema.prisma`
- `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql`
- `src/app.ts`
- `src/modules/ai/ai.worker.ts`
- `src/modules/ai/prompts/prompt-registry.ts`
- `src/views/partials/sidebar.ejs`
- `src/views/layout.ejs`

### Tests

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
- modify `tests/unit/ai.prompt-registry.test.ts`
- modify `tests/unit/ai.worker.test.ts`
- modify `tests/e2e/p10-shell.spec.ts`

---

# P11-01A — Keyword Domain Foundation

### Task 1: Schema, migration, and normalization contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql`
- Create: `src/modules/keywords/keyword-normalize.ts`
- Create: `src/modules/keywords/keyword.types.ts`
- Create: `tests/unit/keyword-normalize.test.ts`

**Interfaces:**
- Produces `normalizeKeywordText(text: string): string`.
- Produces Prisma enums `KeywordType`, `KeywordIntent`, `KeywordPriority`, `KeywordStatus`, `KeywordSource`, `KeywordSuggestionStatus`.
- Produces Prisma models `Keyword`, `KeywordRelation`, `KeywordGroup`, `KeywordGroupMembership`, `KeywordSuggestion`, `KeywordAuditEvent`.
- Extends existing `AiTaskType` with `KEYWORD_EXPANSION`.

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

Expected: FAIL because `keyword-normalize.ts` does not exist.

- [ ] **Step 3: Implement the normalizer and coverage/domain types**

```ts
// src/modules/keywords/keyword-normalize.ts
export function normalizeKeywordText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}
```

```ts
// src/modules/keywords/keyword.types.ts
import type { KeywordIntent, KeywordPriority, KeywordSource, KeywordStatus, KeywordType } from '@prisma/client';

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

- [ ] **Step 4: Add keyword enums/models and AI task type to Prisma**

Add:

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

Add:

```prisma
model Keyword {
  id               String          @id @default(uuid()) @db.Uuid
  projectId        String          @db.Uuid
  text             String
  normalizedText   String
  type             KeywordType
  intent           KeywordIntent?
  priority         KeywordPriority @default(MEDIUM)
  status           KeywordStatus   @default(ACTIVE)
  locked           Boolean         @default(false)
  source           KeywordSource
  language         String?
  targetCountry    String?
  notes            String?
  createdByUserId  String?         @db.Uuid
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

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

Add to `Project`:

```prisma
  keywords                Keyword[]
  keywordRelations        KeywordRelation[]
  keywordGroups           KeywordGroup[]
  keywordGroupMemberships KeywordGroupMembership[]
  keywordSuggestions      KeywordSuggestion[]
  keywordAuditEvents      KeywordAuditEvent[]
```

Create `prisma/migrations/20260828060000_add_keyword_demand_capture/migration.sql` matching the schema, including unique indexes and foreign keys. No down-migration.

- [ ] **Step 5: Validate the schema and normalizer GREEN**

Run:

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
npm test -- tests/unit/keyword-normalize.test.ts
npm run typecheck
```

Expected: all exit 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add prisma/schema.prisma prisma/migrations/20260828060000_add_keyword_demand_capture src/modules/keywords/keyword-normalize.ts src/modules/keywords/keyword.types.ts tests/unit/keyword-normalize.test.ts
git commit -m "feat(keywords): add keyword domain schema"
```

---

### Task 2: Repository invariants and authoritative manual commands

**Files:**
- Create: `src/modules/keywords/keyword.repository.ts`
- Create: `src/modules/keywords/keyword.service.ts`
- Create: `tests/integration/keywords.repository.test.ts`
- Create: `tests/integration/keywords.service.test.ts`

**Interfaces:**
- Produces `KeywordRepository`.
- Produces `KeywordService` and singleton `keywordService`.
- Commands: `createManual`, `updateManual`, `setLocked`, `archive`, `restore`, `setParent`, `removeParent`, `createGroup`, `setGroups`, `list`.

- [ ] **Step 1: Write repository RED for normalized identity and one parent**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';

const cleanupIds: string[] = [];

async function seedProject(prefix: string) {
  const suffix = randomUUID();
  const row = await prisma.project.create({
    data: { name: prefix, slug: `${prefix}-${suffix}`, primaryDomain: `${suffix}.example.com` },
  });
  cleanupIds.push(row.id);
  return row;
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: cleanupIds.splice(0) } } });
});

it('keeps one normalized keyword per project across statuses', async () => {
  const project = await seedProject('keyword-repo');
  const repo = new KeywordRepository();
  await repo.createKeyword({ projectId: project.id, text: '符纸', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' });
  await expect(repo.createKeyword({ projectId: project.id, text: ' 符纸 ', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' }))
    .rejects.toMatchObject({ code: 'P2002' });
});
```

Add a second project test showing the same normalized text is allowed there. Add a relation test showing a child cannot have two canonical parent rows.

- [ ] **Step 2: Run repository RED**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: FAIL because `KeywordRepository` does not exist.

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
    return this.db.keyword.findUnique({ where: { projectId_normalizedText: { projectId, normalizedText } } });
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

Add project-scoped list/update/status/group/suggestion methods. `createManySuggestions` must use `skipDuplicates: true`.

- [ ] **Step 4: Run repository GREEN**

Run: `npm test -- tests/integration/keywords.repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Write service RED for restore, lock, self-parent, cycle, and foreign project IDs**

```ts
it('requires restore rather than recreating an archived logical keyword', async () => {
  const created = await service.createManual({ actorUserId: user.id, projectId: project.id, text: '符纸', type: 'CORE' });
  await service.archive({ actorUserId: user.id, projectId: project.id, keywordId: created.id, acknowledgeLock: false });
  await expect(service.createManual({ actorUserId: user.id, projectId: project.id, text: ' 符纸 ', type: 'CORE' }))
    .rejects.toMatchObject({ code: 'KEYWORD_ARCHIVED_RESTORE_REQUIRED' });
});

it('blocks a locked strategic mutation without acknowledgement', async () => {
  const created = await service.createManual({ actorUserId: user.id, projectId: project.id, text: '符纸', type: 'CORE', locked: true });
  await expect(service.updateManual({ actorUserId: user.id, projectId: project.id, keywordId: created.id, text: '符纸文化', acknowledgeLock: false }))
    .rejects.toMatchObject({ code: 'KEYWORD_LOCKED' });
});
```

Add `A -> B -> C` then reject `C -> A`, reject self-parent, and pass a parent ID from another project expecting `KEYWORD_NOT_FOUND`.

- [ ] **Step 6: Run service RED**

Run: `npm test -- tests/integration/keywords.service.test.ts`

Expected: FAIL because `KeywordService` does not exist.

- [ ] **Step 7: Implement serializable command semantics**

```ts
import { Prisma } from '@prisma/client';
import { AppError, NotFoundError } from '../../core/errors.js';
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

async function assertNoCycle(repo: KeywordRepository, projectId: string, childId: string, proposedParentId: string) {
  if (childId === proposedParentId) throw new AppError('Keyword cannot parent itself', 409, 'KEYWORD_PARENT_SELF');
  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === childId || seen.has(cursor)) throw new AppError('Keyword relation would create a cycle', 409, 'KEYWORD_RELATION_CYCLE');
    seen.add(cursor);
    cursor = (await repo.parentOf(projectId, cursor))?.parentKeywordId ?? null;
  }
}
```

`createManual` rules:
- normalize before identity check;
- existing `ARCHIVED` -> `KEYWORD_ARCHIVED_RESTORE_REQUIRED`;
- existing active/disabled -> `KEYWORD_DUPLICATE`;
- catch Prisma `P2002`, re-read winning row, emit the same stable application error;
- validate every parent/group with the same `projectId`;
- append `KEYWORD_CREATED` inside the transaction.

Every successful mutation appends one of: `KEYWORD_UPDATED`, `KEYWORD_LOCK_CHANGED`, `KEYWORD_ARCHIVED`, `KEYWORD_RESTORED`, `KEYWORD_PARENT_SET`, `KEYWORD_PARENT_REMOVED`, `KEYWORD_GROUPS_CHANGED`.

- [ ] **Step 8: Run Task 2 GREEN and commit**

Run:

```bash
npm test -- tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
npm run typecheck
```

Expected: PASS.

Commit:

```bash
git add src/modules/keywords/keyword.repository.ts src/modules/keywords/keyword.service.ts tests/integration/keywords.repository.test.ts tests/integration/keywords.service.test.ts
git commit -m "feat(keywords): add manual keyword commands"
```

---

### Task 3: Secured keyword API and P11-01A gate

**Files:**
- Create: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.api.test.ts`

**Interfaces:**
- Produces `createKeywordRoutes(service?: KeywordService, coverageService?: KeywordCoverageService, aiTaskService?: Pick<AiTaskService, 'createAndEnqueue'>)`.
- API base `/api/v1/projects/:projectId/keywords`.

- [ ] **Step 1: Write API authorization RED**

Use existing `seedAuthenticatedUser`, `deriveCsrfToken`, and `env`.

```ts
it('lets VIEWER read but rejects mutation', async () => {
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

Add anonymous 401, non-member 404, invalid CSRF 403, and OPERATOR mutation success.

- [ ] **Step 2: Run API RED**

Run: `npm test -- tests/integration/keywords.api.test.ts`

Expected: FAIL because keyword routes are absent.

- [ ] **Step 3: Implement API middleware contracts**

Read route:

```ts
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
```

Create route:

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
    } catch (error) { next(error); }
  },
);
```

Add update/archive/restore/lock/parent/group endpoints. Every locked strategic mutation receives `acknowledgeLock` from an explicit request boolean; role never implies acknowledgement.

- [ ] **Step 4: Mount in `src/app.ts`**

Add `keywordService?: KeywordService` to `AppOptions` and mount:

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

Push the exact head. Require the repository's current `verify`, `production-audit`, `e2e`, and required deployment/runtime artifact checks green before Task 4. Record exact head SHA and workflow run ID.

---

# P11-01B — Deterministic Coverage Engine

### Task 4: Pure coverage scoring and persisted-fact repository

**Files:**
- Create: `src/modules/keywords/keyword-coverage.ts`
- Create: `src/modules/keywords/keyword-coverage.repository.ts`
- Create: `tests/unit/keyword-coverage.test.ts`

**Interfaces:**
- Produces `scoreKeywordAgainstPage(keywordText, pageFact): KeywordCoverageEvidence`.
- Produces `resolveKeywordCoverage(keywordText, pageFacts, emptyReason?): KeywordCoverageResult`.
- Produces `KeywordCoverageRepository.listActivePageFacts(projectId)` returning `{ usablePages, emptyReason }`.

- [ ] **Step 1: Write scoring RED**

```ts
const base = {
  pageId: '00000000-0000-0000-0000-000000000001',
  url: 'https://example.com/culture/fuzhi',
  path: '/culture/fuzhi',
  title: null,
  h1: null,
  metaDescription: null,
};

it('is STRONG for title/H1 evidence', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '符纸：传统用途与文化' }]).status).toBe('STRONG');
});

it('is PARTIAL for weaker metadata evidence', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, metaDescription: '介绍符纸的历史来源' }]).status).toBe('PARTIAL');
});

it('is NONE only when usable evidence exists but does not match', () => {
  expect(resolveKeywordCoverage('符纸', [{ ...base, title: '六壬文化', h1: '民间信仰' }]).status).toBe('NONE');
});

it('is UNKNOWN without usable evidence', () => {
  expect(resolveKeywordCoverage('符纸', [], 'NO_USABLE_SNAPSHOT_EVIDENCE').status).toBe('UNKNOWN');
});
```

- [ ] **Step 2: Run scoring RED**

Run: `npm test -- tests/unit/keyword-coverage.test.ts`

Expected: FAIL because coverage functions do not exist.

- [ ] **Step 3: Implement deterministic multi-field scoring**

```ts
const WEIGHTS = { title: 4, h1: 4, metaDescription: 2, path: 1 } as const;

function contains(value: string | null, normalizedKeyword: string): boolean {
  return value ? normalizeKeywordText(value).includes(normalizedKeyword) : false;
}

function safeDecodePath(path: string): string {
  try { return decodeURIComponent(path); } catch { return path; }
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

export function resolveKeywordCoverage(
  keywordText: string,
  pageFacts: CoveragePageFact[],
  emptyReason: KeywordCoverageEmptyReason = 'NO_ACTIVE_PAGE_EVIDENCE',
): KeywordCoverageResult {
  if (pageFacts.length === 0) return { status: 'UNKNOWN', reason: emptyReason, matches: [] };
  const evidence = pageFacts.map((page) => scoreKeywordAgainstPage(keywordText, page)).sort((a, b) => b.score - a.score || a.url.localeCompare(b.url));
  const matches = evidence.filter((item) => item.score > 0);
  if (matches.some((item) => item.score >= 4)) return { status: 'STRONG', reason: 'MATCHED', matches };
  if (matches.length > 0) return { status: 'PARTIAL', reason: 'MATCHED', matches };
  return { status: 'NONE', reason: 'NO_MATCH', matches: [] };
}
```

- [ ] **Step 4: Implement one persisted page query**

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
      select: { title: true, h1: true, metaDescription: true, statusCode: true, indexable: true },
    },
  },
  orderBy: { normalizedUrl: 'asc' },
});
```

Usable snapshots require `statusCode >= 200 && statusCode < 300 && indexable !== false`. Return:
- zero active pages -> `{ usablePages: [], emptyReason: 'NO_ACTIVE_PAGE_EVIDENCE' }`;
- active pages but zero usable snapshots -> `{ usablePages: [], emptyReason: 'NO_USABLE_SNAPSHOT_EVIDENCE' }`.

- [ ] **Step 5: Run GREEN and commit**

```bash
npm test -- tests/unit/keyword-coverage.test.ts
npm run typecheck
git add src/modules/keywords/keyword-coverage.ts src/modules/keywords/keyword-coverage.repository.ts tests/unit/keyword-coverage.test.ts
git commit -m "feat(keywords): add deterministic coverage scoring"
```

---

### Task 5: Project coverage orchestration and API evidence

**Files:**
- Create: `src/modules/keywords/keyword-coverage.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/keywords.coverage.test.ts`

**Interfaces:**
- Produces `KeywordCoverageService.evaluateKeyword(projectId, keywordId)`.
- Produces `KeywordCoverageService.evaluateProject(projectId, keywords)`.
- Adds `GET /api/v1/projects/:projectId/keywords/:keywordId/coverage`.

- [ ] **Step 1: Write integration RED for persisted truth and no execution side effects**

Seed a keyword, active page, and `PageSnapshot`. Assert a read returns expected coverage. Inject crawler/AI spies into `createApp` and assert they are untouched.

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

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/keywords.coverage.test.ts`

Expected: FAIL because service/route are absent.

- [ ] **Step 3: Implement one-read project evaluation**

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

- [ ] **Step 4: Add secured coverage API and app injection**

The route requires `PROJECT_READ` and no CSRF. Add `keywordCoverageService?: KeywordCoverageService` to `AppOptions` and pass it to `createKeywordRoutes`.

- [ ] **Step 5: Run P11-01B focused GREEN**

```bash
npm test -- tests/unit/keyword-coverage.test.ts tests/integration/keywords.coverage.test.ts tests/integration/keywords.api.test.ts
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit and gate**

```bash
git add src/modules/keywords/keyword-coverage.service.ts src/modules/keywords/keyword.routes.ts src/app.ts tests/integration/keywords.coverage.test.ts
git commit -m "feat(keywords): expose content coverage evidence"
```

Push the exact head and require full current CI green before Task 6.

---

# P11-01C — Keyword Center UI

### Task 6: Secured EJS center, manual controls, navigation, responsive UI

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
- Produces `createKeywordWebRoutes(service?: KeywordService, coverageService?: KeywordCoverageService)`.
- Adds `GET /projects/:id/keywords` and CSRF-protected form POSTs for manual commands.

- [ ] **Step 1: Write web RED for truthful rendering and auth**

```ts
it('renders keyword facts without fabricated ranking', async () => {
  const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  try {
    await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '符纸', type: 'CORE', priority: 'HIGH', locked: true });
    const response = await request(createApp()).get(`/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).expect(200);
    expect(response.text).toContain('关键词中心');
    expect(response.text).toContain('符纸');
    expect(response.text).toContain('站内内容覆盖');
    expect(response.text).toContain('排名数据：未接入');
    expect(response.text).not.toContain('Google 排名：1');
  } finally { await fixture.cleanup(); }
});
```

Add anonymous 401, non-member 404, VIEWER read success, VIEWER form mutation 403, CSRF rejection.

- [ ] **Step 2: Run web RED**

Run: `npm test -- tests/integration/keywords.web.test.ts`

Expected: FAIL because web routes/view are absent.

- [ ] **Step 3: Build the read model**

```ts
export interface KeywordCenterViewModel {
  project: { id: string; name: string; defaultLanguage: string; targetCountry: string };
  summary: { active: number; locked: number; strong: number; partial: number; none: number; unknown: number };
  keywords: Array<KeywordListRecord & { parentKeywordId: string | null; coverage: KeywordCoverageResult }>;
  groups: Array<{ id: string; name: string }>;
  suggestions: Array<{ id: string; seedKeywordId: string; suggestedText: string; status: string; rationale: string | null }>;
}
```

Load project-scoped keyword/tree/group/suggestion facts, then call `KeywordCoverageService.evaluateProject` once for all visible keywords. Do not add provider secrets, search volume, or rank fields.

- [ ] **Step 4: Implement secured web routes and CSRF token rendering**

Reuse the project-admin pattern:

```ts
function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}
```

GET middleware:

```ts
requireAuthentication(),
requireProjectMembership(),
requireProjectCapability('PROJECT_READ')
```

Mutation middleware:

```ts
requireAuthentication(),
requireCsrf(),
requireProjectMembership(),
requireProjectCapability('CONTENT_WRITE')
```

Render `layout` with `activeNav: 'keywords'`, `bodyTemplate: 'keywords/index'`, `currentProjectId`, `csrfToken`, and `canWriteKeywords` from `hasProjectCapability(role, 'CONTENT_WRITE')`.

- [ ] **Step 5: Build one-page EJS UI with stable selectors**

```html
<section data-ui="keyword-summary">...</section>
<section data-ui="keyword-library">...</section>
<section data-ui="keyword-tree">...</section>
<section data-ui="keyword-coverage">...</section>
<section data-ui="keyword-advisory" aria-label="AI 长尾建议">...</section>
```

Manual create form labels/fields:
- `关键词` -> `text`
- `类型` -> `type`
- `搜索意图` -> `intent`
- `优先级` -> `priority`
- `父关键词` -> `parentKeywordId`
- `语言` -> `language`
- `目标市场` -> `targetCountry`
- `备注` -> `notes`
- `战略锁定` -> `locked`
- hidden `_csrf`.

Coverage labels:
- `STRONG` -> `覆盖较强`
- `PARTIAL` -> `部分覆盖`
- `NONE` -> `内容缺口`
- `UNKNOWN` -> `证据不足`.

Render `排名数据：未接入` in the future-evidence area.

- [ ] **Step 6: Add sidebar and stylesheet**

In `sidebar.ejs` add `keywords: 'keywords'` to `centerByActiveNav` and:

```js
{ key: 'keywords', label: '关键词中心', icon: 'seo', href: projectHref('/keywords') },
```

between SEO and GEO. Reuse the existing SEO icon.

In `layout.ejs` add:

```html
<link rel="stylesheet" href="/assets/css/p11-keywords.css">
```

`p11-keywords.css` must scope rules under `.keyword-center`; at widths below 900px stack cards/forms and use an internal `.keyword-table-wrap { overflow-x: auto; }` so document scroll width does not exceed viewport.

- [ ] **Step 7: Mount web router and run GREEN**

Run:

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

### Task 7: Browser E2E and P11-01C gate

**Files:**
- Create: `tests/e2e/keywords.spec.ts`

- [ ] **Step 1: Write E2E RED for manual `符纸` capture**

```ts
import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('operator captures 符纸 demand and sees truthful coverage', async ({ page, context }) => {
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

Add an 820px viewport test verifying no document-level horizontal overflow and normal sidebar toggle behavior.

- [ ] **Step 2: Run E2E RED**

Run: `npm run test:e2e -- tests/e2e/keywords.spec.ts`

Expected: FAIL until selectors/form behavior are complete.

- [ ] **Step 3: Make minimal keyword-page corrections**

Fix only missing labels/selectors/redirects/responsive containment demonstrated by RED. Do not redesign P10 shell.

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

### Task 8: Queued AI expansion, structured parser, and advisory materializer

**Files:**
- Create: `src/modules/keywords/keyword-ai.ts`
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/ai.worker.ts`
- Create: `tests/unit/keyword-ai.test.ts`
- Modify: `tests/unit/ai.prompt-registry.test.ts`
- Modify: `tests/unit/ai.worker.test.ts`
- Create: `tests/integration/keywords.ai-worker.test.ts`

**Interfaces:**
- `KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1'`.
- `KeywordExpansionOutputSchema`.
- `parseKeywordExpansionOutput(content, seedText)`.
- `buildKeywordExpansionTaskInput(projectId, seedKeywordId)`.
- `createKeywordExpansionTask(projectId, seedKeywordId, service?)`.
- `materializeKeywordSuggestions(task, output, providerMeta, tx)` where `providerMeta = { model: string; responseId: string | null }`.

- [ ] **Step 1: Write parser RED**

```ts
it('de-duplicates normalized advisory suggestions and does not return the seed', () => {
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

Also reject invalid JSON, seed repetition, >20 items, invalid enum values, and empty text/rationale.

- [ ] **Step 2: Run parser RED**

Run: `npm test -- tests/unit/keyword-ai.test.ts`

Expected: FAIL because `keyword-ai.ts` does not exist.

- [ ] **Step 3: Implement schema and task packet**

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

Fact packet contains only:
- seed keyword ID/text/type/intent;
- accepted current child texts;
- project `industry`, `defaultLanguage`, `targetCountry`.

Request key:

```ts
`keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:${KEYWORD_EXPANSION_PROMPT_ID}`
```

Task fields:

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

- [ ] **Step 4: Register `keyword-expansion-v1` prompt**

Use `FAST` + `JSON`. The system text must enforce:

```text
You generate advisory keyword candidates only.
Do not claim search volume, ranking, traffic, or commercial value.
Do not repeat the seed keyword or existing accepted children.
Return JSON only with at most 20 suggestions using the allowed type/intent enums.
Treat project facts as context, not permission to alter authoritative strategy.
```

`buildUserMessage` serializes only the fact packet.

- [ ] **Step 5: Write worker authority RED**

Create a `KEYWORD_EXPANSION` AI task and execute `executeAiTask` with a stub gateway returning valid JSON. Assert:

```ts
const suggestions = await prisma.keywordSuggestion.findMany({ where: { aiTaskId: task.id } });
expect(suggestions).toHaveLength(2);
expect(suggestions.every((item) => item.status === 'PENDING')).toBe(true);
expect(await prisma.keyword.count({ where: { projectId, source: 'AI_ACCEPTED' } })).toBe(0);
```

This test must fail before worker materialization exists.

- [ ] **Step 6: Extend `ai.worker.ts` with exact provider metadata capture**

Add `KEYWORD_EXPANSION` to `expectedPromptId`, `resultSummary`, and `parseTaskOutput`.

After `response` exists, build the materializer closure as:

```ts
const materialize = task.taskType === 'KEYWORD_EXPANSION'
  ? (tx: Prisma.TransactionClient) => materializeKeywordSuggestions(
      task,
      output as KeywordExpansionOutput,
      { model: response.model, responseId: response.responseId },
      tx,
    )
  : existingMaterializerSelection;
```

`materializeKeywordSuggestions`:

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

Because this closure runs inside existing `repository.completeRun(...)`, validated AI output and suggestions commit atomically with task completion.

- [ ] **Step 7: Run AI GREEN**

```bash
npm test -- tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/keywords/keyword-ai.ts src/modules/ai/prompts/prompt-registry.ts src/modules/ai/ai.worker.ts tests/unit/keyword-ai.test.ts tests/unit/ai.prompt-registry.test.ts tests/unit/ai.worker.test.ts tests/integration/keywords.ai-worker.test.ts
git commit -m "feat(keywords): add advisory AI expansion"
```

---

### Task 9: Human generate/accept/reject workflow and advisory UI

**Files:**
- Modify: `src/modules/keywords/keyword.service.ts`
- Modify: `src/modules/keywords/keyword.routes.ts`
- Modify: `src/modules/keywords/keyword.web.routes.ts`
- Modify: `src/modules/keywords/keyword.web.repository.ts`
- Modify: `src/views/keywords/index.ejs`
- Create: `tests/integration/keywords.suggestions.test.ts`
- Modify: `tests/e2e/keywords.spec.ts`

**Interfaces:**
- `acceptSuggestion({ actorUserId, projectId, suggestionId, editedText? })`.
- `rejectSuggestion({ actorUserId, projectId, suggestionId })`.
- Generate API: `POST /api/v1/projects/:projectId/keywords/:keywordId/suggestions/generate` with `AI_RUN` + CSRF.
- Accept/reject API: `POST /api/v1/projects/:projectId/keyword-suggestions/:suggestionId/{accept|reject}` with `CONTENT_WRITE` + CSRF.
- Equivalent browser POST routes redirect to `/projects/:id/keywords`.

- [ ] **Step 1: Write decision RED**

```ts
it('accepts a pending suggestion idempotently and creates one AI_ACCEPTED child keyword', async () => {
  const first = await service.acceptSuggestion({ actorUserId: user.id, projectId: project.id, suggestionId: suggestion.id });
  const second = await service.acceptSuggestion({ actorUserId: user.id, projectId: project.id, suggestionId: suggestion.id });
  expect(second.id).toBe(first.id);
  expect(first.source).toBe('AI_ACCEPTED');
  expect((await prisma.keywordRelation.findUnique({ where: { childKeywordId: first.id } }))?.parentKeywordId).toBe(seed.id);
});
```

Add tests:
- `REJECTED`/`EXPIRED` cannot become authoritative;
- existing ACTIVE/DISABLED normalized keyword is linked, not duplicated;
- existing ARCHIVED normalized keyword throws `KEYWORD_ARCHIVED_RESTORE_REQUIRED`;
- edited accepted text is re-normalized;
- generation requires `AI_RUN`;
- decisions require `CONTENT_WRITE` + CSRF;
- foreign-project suggestion ID returns 404.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/integration/keywords.suggestions.test.ts`

Expected: FAIL because decision commands/routes are absent.

- [ ] **Step 3: Implement idempotent acceptance in one serializable transaction**

State gate:

```ts
if (suggestion.status === 'ACCEPTED' && suggestion.acceptedKeywordId) {
  const linked = await repo.findKeyword(projectId, suggestion.acceptedKeywordId);
  if (linked) return linked;
}
if (suggestion.status !== 'PENDING') {
  throw new AppError('Keyword suggestion already decided', 409, 'KEYWORD_SUGGESTION_ALREADY_DECIDED');
}
```

Then:
1. normalize edited/original text;
2. re-read existing keyword by normalized identity;
3. active/disabled existing -> link it;
4. archived existing -> throw restore-required error;
5. otherwise create `source: 'AI_ACCEPTED'`, priority `MEDIUM`, suggested type/intent;
6. validate/set canonical parent to `seedKeywordId`;
7. set suggestion `ACCEPTED`, `decidedAt`, `decidedByUserId`, `acceptedKeywordId`;
8. append `KEYWORD_SUGGESTION_ACCEPTED` in the same transaction.

Reject only transitions `PENDING -> REJECTED` and appends `KEYWORD_SUGGESTION_REJECTED` atomically.

- [ ] **Step 4: Add generation and decision routes**

Generation calls:

```ts
const task = await createKeywordExpansionTask(projectId(req), keywordId(req), aiTaskService);
res.status(202).json({ data: { aiTaskId: task.id } });
```

Generation does not synchronously create a `KeywordSuggestion`; the worker does that after validated completion.

- [ ] **Step 5: Add advisory review UI**

Inside `data-ui="keyword-advisory"`, show visible `建议 / Advisory`, suggested text/type/intent/rationale, editable text input, and `接受`/`拒绝` forms. Add `生成长尾关键词建议` button to a selected seed keyword.

Never label pending suggestions as accepted keywords, rankings, proven search demand, or traffic forecasts.

- [ ] **Step 6: Extend E2E with deterministic seeded advisory data**

Create the AI task first:

```ts
const seededAiTask = await prisma.aiTask.create({
  data: {
    projectId: auth.project.id,
    taskType: 'KEYWORD_EXPANSION',
    requestKey: `e2e-keyword-expansion:${randomUUID()}`,
    promptVersion: 'keyword-expansion-v1',
    factSnapshot: { seedKeywordId: seed.id },
    sourceReferences: [{ type: 'KEYWORD', id: seed.id }],
  },
});
```

Then seed the suggestion:

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

Reload, click `接受`, and assert the library/tree contains `六壬符纸` beneath `符纸` and indicates AI-accepted origin.

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
- Create after verified implementation: `docs/development/p11-01-keyword-demand-capture-verification.md`
- Modify implementation files only for demonstrated P11-01 defects found by verification.

- [ ] **Step 1: Verify schema from a clean generated-client state**

```bash
npx prisma validate
npm run prisma:generate
npx prisma migrate deploy
```

Expected: all exit 0.

- [ ] **Step 2: Run the complete local suite**

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Expected: zero failures. If a command fails, fix only the demonstrated P11-01 regression and rerun the complete failed command.

- [ ] **Step 3: Verify scope against the pinned design base**

```bash
git status --short
git diff --check
git diff --stat 2136087a5ae74b474b1b191b4ef957b4c7b61e96...HEAD
```

Expected:
- clean working tree;
- `git diff --check` no output and exit 0;
- diff contains only P11-01 keyword schema/domain/coverage/AI/UI/tests/docs changes;
- no P11-02 rank provider, autonomous publication, merge, deploy, rollback, or unrelated refactor.

If the approved integration base changes before implementation starts, amend this plan and spec base in a documentation-only commit **before** executing Task 1; do not silently run against a different base.

- [ ] **Step 4: Push exact head and require all current repository CI gates green**

Record exact implementation head SHA, workflow run ID, `verify`, `production-audit`, `e2e`, and required deployment/runtime artifact results. Local tests alone do not close P11-01.

- [ ] **Step 5: Write closure evidence from observed results only**

`docs/development/p11-01-keyword-demand-capture-verification.md` records:
- base SHA and final implementation head;
- migration name;
- P11-01A/B/C/D RED/GREEN milestones;
- final CI run/jobs;
- manual authoritative keyword semantics;
- `UNKNOWN != NONE` coverage truth;
- AI advisory-only materialization (`KeywordSuggestion` before human acceptance);
- strategic-lock behavior;
- explicit exclusions: P11-02 ranking, production deployment, autonomous publish/merge/deploy/rollback.

Do not write `100% complete` until required exact-head gates are actually green.

- [ ] **Step 6: Commit closure evidence and re-run exact-head CI**

```bash
git add docs/development/p11-01-keyword-demand-capture-verification.md
git commit -m "docs: record P11-01 verification evidence"
```

Because the documentation commit changes HEAD, obtain a new required CI run for that exact documentation head before integration.

---

## Spec Coverage Self-Check

- Manual create/edit/archive/restore/enable-disable: Tasks 1-3.
- Strategic lock and explicit acknowledgement: Task 2; API/UI Tasks 3/6.
- Type/intent/priority/market/language metadata: Tasks 1-3 and Task 6.
- Canonical parent, self/cycle/cross-project safety: Tasks 1-2.
- Groups/topics: Tasks 1-2 and Task 6.
- Normalized uniqueness across all statuses and restore semantics: Tasks 1-2.
- Deterministic `STRONG/PARTIAL/NONE/UNKNOWN`: Tasks 4-5.
- No fresh crawl/provider call from reads: Task 5.
- Summary/library/tree/detail/coverage UI: Tasks 6-7.
- DeepSeek advisory expansion through existing queued AI pipeline: Task 8.
- Suggestions remain non-authoritative before review: Task 8 hard authority test.
- Explicit accept/reject/idempotency: Task 9.
- RBAC/CSRF/fail-closed project scoping: Tasks 3, 6, 9.
- Persisted keyword audit events plus existing AI observability: Tasks 1-2 and 8-9.
- Exact-head full regression and truth-boundary closure: Task 10.
- P11-02 ranking/provider work is excluded.

## Execution Order

Execute strictly:

`Task 1 -> Task 2 -> Task 3 -> P11-01A exact-head CI -> Task 4 -> Task 5 -> P11-01B exact-head CI -> Task 6 -> Task 7 -> P11-01C exact-head CI -> Task 8 -> Task 9 -> P11-01D focused GREEN -> Task 10 final exact-head CI/closure`.

Do not combine A/B/C/D gates into one late run; each is an independent reviewer and rollback point.
