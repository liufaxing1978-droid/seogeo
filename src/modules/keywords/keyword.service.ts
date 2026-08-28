import {
  Prisma,
  type Keyword,
  type KeywordIntent,
  type KeywordPriority,
  type KeywordStatus,
  type KeywordType,
} from '@prisma/client';
import { AppError, ValidationError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { normalizeKeywordText } from './keyword-normalize.js';
import { KeywordRepository } from './keyword.repository.js';
import type { CreateManualKeywordInput } from './keyword.types.js';

export interface UpdateManualKeywordInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  text?: string;
  type?: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  status?: KeywordStatus;
  language?: string | null;
  targetCountry?: string | null;
  notes?: string | null;
  acknowledgeLock?: boolean;
}

export interface KeywordLockInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  locked: boolean;
  acknowledgeLock?: boolean;
}

export interface KeywordStatusCommandInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  acknowledgeLock?: boolean;
}

export interface SetKeywordParentInput {
  actorUserId: string;
  projectId: string;
  childKeywordId: string;
  parentKeywordId: string;
  acknowledgeLock?: boolean;
}

export interface RemoveKeywordParentInput {
  actorUserId: string;
  projectId: string;
  childKeywordId: string;
  acknowledgeLock?: boolean;
}

export interface CreateKeywordGroupInput {
  projectId: string;
  name: string;
  description?: string | null;
}

export interface SetKeywordGroupsInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  groupIds: string[];
  acknowledgeLock?: boolean;
}

const KEYWORD_TRANSACTION_MAX_ATTEMPTS = 3;

async function inKeywordTransaction<T>(
  work: (repo: KeywordRepository) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= KEYWORD_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => work(new KeywordRepository(tx)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === 'P2034';
      if (!retryable || attempt === KEYWORD_TRANSACTION_MAX_ATTEMPTS) {
        throw error;
      }
    }
  }

  throw new AppError('Keyword transaction retry exhausted', 409, 'KEYWORD_WRITE_CONFLICT');
}

function keywordNotFound(): AppError {
  return new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
}

function keywordGroupNotFound(): AppError {
  return new AppError('Keyword group not found', 404, 'KEYWORD_GROUP_NOT_FOUND');
}

function duplicateError(keyword: Keyword): AppError {
  if (keyword.status === 'ARCHIVED') {
    return new AppError(
      'Archived keyword must be restored rather than recreated',
      409,
      'KEYWORD_ARCHIVED_RESTORE_REQUIRED',
    );
  }
  return new AppError('Keyword already exists', 409, 'KEYWORD_DUPLICATE');
}

function assertUnlockedOrAcknowledged(locked: boolean, acknowledged: boolean | undefined): void {
  if (locked && acknowledged !== true) {
    throw new AppError('Keyword is strategically locked', 409, 'KEYWORD_LOCKED');
  }
}

async function requireKeyword(
  repo: KeywordRepository,
  projectId: string,
  keywordId: string,
): Promise<Keyword> {
  const keyword = await repo.findKeyword(projectId, keywordId);
  if (!keyword) throw keywordNotFound();
  return keyword;
}

async function requireGroups(
  repo: KeywordRepository,
  projectId: string,
  groupIds: string[],
): Promise<string[]> {
  const uniqueIds = [...new Set(groupIds)];
  for (const groupId of uniqueIds) {
    if (!(await repo.findGroup(projectId, groupId))) {
      throw keywordGroupNotFound();
    }
  }
  return uniqueIds;
}

async function assertNoCycle(
  repo: KeywordRepository,
  projectId: string,
  childKeywordId: string,
  proposedParentKeywordId: string,
): Promise<void> {
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

function assertUsableText(text: string): string {
  const normalized = normalizeKeywordText(text);
  if (!normalized) {
    throw new ValidationError('Keyword text is required');
  }
  return normalized;
}

async function rereadDuplicateAfterConstraint(
  projectId: string,
  normalizedText: string,
): Promise<never> {
  const winner = await new KeywordRepository().findByNormalized(projectId, normalizedText);
  if (winner) throw duplicateError(winner);
  throw new AppError('Keyword write conflict', 409, 'KEYWORD_WRITE_CONFLICT');
}

export class KeywordService {
  async createManual(input: CreateManualKeywordInput): Promise<Keyword> {
    const normalizedText = assertUsableText(input.text);

    try {
      return await inKeywordTransaction(async (repo) => {
        const existing = await repo.findByNormalized(input.projectId, normalizedText);
        if (existing) throw duplicateError(existing);

        if (input.parentKeywordId) {
          await requireKeyword(repo, input.projectId, input.parentKeywordId);
        }
        const groupIds = await requireGroups(repo, input.projectId, input.groupIds ?? []);

        const created = await repo.createKeyword({
          projectId: input.projectId,
          text: input.text.trim(),
          normalizedText,
          type: input.type,
          intent: input.intent ?? null,
          priority: input.priority ?? 'MEDIUM',
          status: 'ACTIVE',
          locked: input.locked ?? false,
          source: 'MANUAL',
          language: input.language ?? null,
          targetCountry: input.targetCountry ?? null,
          notes: input.notes ?? null,
          createdByUserId: input.actorUserId,
        });

        if (input.parentKeywordId) {
          await repo.upsertParent(input.projectId, input.parentKeywordId, created.id);
        }
        if (groupIds.length > 0) {
          await repo.replaceGroupMemberships(input.projectId, created.id, groupIds);
        }

        await repo.appendAudit(
          input.projectId,
          created.id,
          input.actorUserId,
          'KEYWORD_CREATED',
          { source: 'MANUAL' },
        );
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return rereadDuplicateAfterConstraint(input.projectId, normalizedText);
      }
      throw error;
    }
  }

  async updateManual(input: UpdateManualKeywordInput): Promise<Keyword> {
    return inKeywordTransaction(async (repo) => {
      const current = await requireKeyword(repo, input.projectId, input.keywordId);
      if (current.status === 'ARCHIVED') {
        throw new AppError(
          'Archived keyword must be restored before editing',
          409,
          'KEYWORD_ARCHIVED_RESTORE_REQUIRED',
        );
      }
      assertUnlockedOrAcknowledged(current.locked, input.acknowledgeLock);

      let normalizedText: string | undefined;
      if (input.text !== undefined) {
        normalizedText = assertUsableText(input.text);
        const duplicate = await repo.findByNormalized(input.projectId, normalizedText);
        if (duplicate && duplicate.id !== current.id) throw duplicateError(duplicate);
      }

      const data: Prisma.KeywordUncheckedUpdateManyInput = {};
      if (input.text !== undefined) data.text = input.text.trim();
      if (normalizedText !== undefined) data.normalizedText = normalizedText;
      if (input.type !== undefined) data.type = input.type;
      if (input.intent !== undefined) data.intent = input.intent;
      if (input.priority !== undefined) data.priority = input.priority;
      if (input.status !== undefined) data.status = input.status;
      if (input.language !== undefined) data.language = input.language;
      if (input.targetCountry !== undefined) data.targetCountry = input.targetCountry;
      if (input.notes !== undefined) data.notes = input.notes;

      try {
        await repo.updateKeyword(input.projectId, input.keywordId, data);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const identity = normalizedText ?? current.normalizedText;
          const duplicate = await repo.findByNormalized(input.projectId, identity);
          if (duplicate && duplicate.id !== current.id) throw duplicateError(duplicate);
        }
        throw error;
      }

      const updated = await requireKeyword(repo, input.projectId, input.keywordId);
      await repo.appendAudit(
        input.projectId,
        input.keywordId,
        input.actorUserId,
        'KEYWORD_UPDATED',
      );
      return updated;
    });
  }

  async setLocked(input: KeywordLockInput): Promise<Keyword> {
    return inKeywordTransaction(async (repo) => {
      const current = await requireKeyword(repo, input.projectId, input.keywordId);
      if (current.locked && input.locked === false) {
        assertUnlockedOrAcknowledged(true, input.acknowledgeLock);
      }

      await repo.updateKeyword(input.projectId, input.keywordId, { locked: input.locked });
      const updated = await requireKeyword(repo, input.projectId, input.keywordId);
      await repo.appendAudit(
        input.projectId,
        input.keywordId,
        input.actorUserId,
        'KEYWORD_LOCK_CHANGED',
        { locked: input.locked },
      );
      return updated;
    });
  }

  async archive(input: KeywordStatusCommandInput): Promise<Keyword> {
    return inKeywordTransaction(async (repo) => {
      const current = await requireKeyword(repo, input.projectId, input.keywordId);
      assertUnlockedOrAcknowledged(current.locked, input.acknowledgeLock);
      await repo.updateKeyword(input.projectId, input.keywordId, { status: 'ARCHIVED' });
      const updated = await requireKeyword(repo, input.projectId, input.keywordId);
      await repo.appendAudit(
        input.projectId,
        input.keywordId,
        input.actorUserId,
        'KEYWORD_ARCHIVED',
      );
      return updated;
    });
  }

  async restore(input: KeywordStatusCommandInput): Promise<Keyword> {
    return inKeywordTransaction(async (repo) => {
      const current = await requireKeyword(repo, input.projectId, input.keywordId);
      assertUnlockedOrAcknowledged(current.locked, input.acknowledgeLock);
      await repo.updateKeyword(input.projectId, input.keywordId, { status: 'ACTIVE' });
      const updated = await requireKeyword(repo, input.projectId, input.keywordId);
      await repo.appendAudit(
        input.projectId,
        input.keywordId,
        input.actorUserId,
        'KEYWORD_RESTORED',
      );
      return updated;
    });
  }

  async setParent(input: SetKeywordParentInput) {
    return inKeywordTransaction(async (repo) => {
      const child = await requireKeyword(repo, input.projectId, input.childKeywordId);
      assertUnlockedOrAcknowledged(child.locked, input.acknowledgeLock);
      if (input.childKeywordId === input.parentKeywordId) {
        throw new AppError('Keyword cannot parent itself', 409, 'KEYWORD_PARENT_SELF');
      }
      await requireKeyword(repo, input.projectId, input.parentKeywordId);
      await assertNoCycle(
        repo,
        input.projectId,
        input.childKeywordId,
        input.parentKeywordId,
      );

      const relation = await repo.upsertParent(
        input.projectId,
        input.parentKeywordId,
        input.childKeywordId,
      );
      await repo.appendAudit(
        input.projectId,
        input.childKeywordId,
        input.actorUserId,
        'KEYWORD_PARENT_SET',
        { parentKeywordId: input.parentKeywordId },
      );
      return relation;
    });
  }

  async removeParent(input: RemoveKeywordParentInput) {
    return inKeywordTransaction(async (repo) => {
      const child = await requireKeyword(repo, input.projectId, input.childKeywordId);
      assertUnlockedOrAcknowledged(child.locked, input.acknowledgeLock);
      const result = await repo.removeParent(input.projectId, input.childKeywordId);
      await repo.appendAudit(
        input.projectId,
        input.childKeywordId,
        input.actorUserId,
        'KEYWORD_PARENT_REMOVED',
      );
      return result;
    });
  }

  async createGroup(input: CreateKeywordGroupInput) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Keyword group name is required');
    return inKeywordTransaction((repo) => repo.createGroup(
      input.projectId,
      name,
      input.description,
    ));
  }

  async setGroups(input: SetKeywordGroupsInput) {
    return inKeywordTransaction(async (repo) => {
      const keyword = await requireKeyword(repo, input.projectId, input.keywordId);
      assertUnlockedOrAcknowledged(keyword.locked, input.acknowledgeLock);
      const groupIds = await requireGroups(repo, input.projectId, input.groupIds);
      await repo.replaceGroupMemberships(input.projectId, input.keywordId, groupIds);
      await repo.appendAudit(
        input.projectId,
        input.keywordId,
        input.actorUserId,
        'KEYWORD_GROUPS_CHANGED',
        { groupIds },
      );
      return repo.listGroupMemberships(input.projectId, input.keywordId);
    });
  }

  list(projectId: string) {
    return new KeywordRepository().listKeywords(projectId);
  }
}

export const keywordService = new KeywordService();
