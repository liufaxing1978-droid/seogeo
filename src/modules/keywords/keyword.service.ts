import {
  Prisma,
  type Keyword,
  type KeywordIntent,
  type KeywordLifecycleStatus,
  type KeywordPriority,
  type KeywordStatus,
  type KeywordSuggestion,
  type KeywordType,
} from '@prisma/client';
import { AppError, ValidationError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { planKeywordBulkCreate, type KeywordBulkDuplicate } from './keyword-bulk.js';
import { normalizeKeywordText } from './keyword-normalize.js';
import { KeywordRepository } from './keyword.repository.js';
import type { KeywordListQuery } from './keyword.schema.js';
import type {
  CreateManualKeywordInput,
  CreateManualKeywordsBulkInput,
} from './keyword.types.js';

export interface UpdateManualKeywordInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  text?: string;
  type?: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  status?: KeywordStatus;
  lifecycleStatus?: KeywordLifecycleStatus;
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

export interface RenameKeywordGroupInput {
  actorUserId: string;
  projectId: string;
  groupId: string;
  name: string;
}

export interface SetKeywordGroupPrimaryInput {
  actorUserId: string;
  projectId: string;
  groupId: string;
  primaryKeywordId: string | null;
  acknowledgeLock?: boolean;
}

export interface AssignKeywordsToGroupInput {
  actorUserId: string;
  projectId: string;
  groupId: string;
  keywordIds: string[];
  acknowledgeLock?: boolean;
}

export interface SetKeywordGroupsInput {
  actorUserId: string;
  projectId: string;
  keywordId: string;
  groupIds: string[];
  acknowledgeLock?: boolean;
}

export interface AcceptKeywordSuggestionInput {
  actorUserId: string;
  projectId: string;
  suggestionId: string;
  editedText?: string;
}

export interface RejectKeywordSuggestionInput {
  actorUserId: string;
  projectId: string;
  suggestionId: string;
}

export interface AcceptKeywordSuggestionsInput {
  actorUserId: string;
  projectId: string;
  suggestionIds: string[];
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

function keywordGroupDuplicate(): AppError {
  return new AppError('Keyword group already exists', 409, 'KEYWORD_GROUP_DUPLICATE');
}

function keywordSuggestionNotFound(): AppError {
  return new AppError('Keyword suggestion not found', 404, 'KEYWORD_SUGGESTION_NOT_FOUND');
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

function suggestionAlreadyDecided(): AppError {
  return new AppError(
    'Keyword suggestion already decided',
    409,
    'KEYWORD_SUGGESTION_ALREADY_DECIDED',
  );
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

async function requireSuggestion(
  repo: KeywordRepository,
  projectId: string,
  suggestionId: string,
): Promise<KeywordSuggestion> {
  const suggestion = await repo.findSuggestion(projectId, suggestionId);
  if (!suggestion) throw keywordSuggestionNotFound();
  return suggestion;
}

async function requireGroup(
  repo: KeywordRepository,
  projectId: string,
  groupId: string,
) {
  const group = await repo.findGroup(projectId, groupId);
  if (!group) throw keywordGroupNotFound();
  return group;
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

async function acceptSuggestionInTransaction(
  repo: KeywordRepository,
  input: AcceptKeywordSuggestionInput,
): Promise<Keyword> {
  const suggestion = await requireSuggestion(repo, input.projectId, input.suggestionId);

  if (suggestion.status === 'ACCEPTED' && suggestion.acceptedKeywordId) {
    const linked = await repo.findKeyword(input.projectId, suggestion.acceptedKeywordId);
    if (linked) return linked;
    throw suggestionAlreadyDecided();
  }
  if (suggestion.status !== 'PENDING') throw suggestionAlreadyDecided();

  const seed = await requireKeyword(repo, input.projectId, suggestion.seedKeywordId);
  const rawText = input.editedText ?? suggestion.suggestedText;
  const normalizedText = assertUsableText(rawText);
  let keyword = await repo.findByNormalized(input.projectId, normalizedText);

  if (keyword?.status === 'ARCHIVED') throw duplicateError(keyword);

  if (keyword) {
    assertUnlockedOrAcknowledged(keyword.locked, undefined);
  } else {
    const projectDefaults = await repo.findProjectKeywordDefaults(input.projectId);
    keyword = await repo.createKeyword({
      projectId: input.projectId,
      text: rawText.trim(),
      normalizedText,
      type: suggestion.suggestedType ?? 'LONG_TAIL',
      intent: suggestion.suggestedIntent,
      priority: 'MEDIUM',
      status: 'ACTIVE',
      locked: false,
      source: 'AI_ACCEPTED',
      language: seed.language ?? projectDefaults?.defaultLanguage ?? null,
      targetCountry: seed.targetCountry ?? projectDefaults?.targetCountry ?? null,
      notes: null,
      createdByUserId: input.actorUserId,
    });
  }

  await assertNoCycle(repo, input.projectId, keyword.id, seed.id);
  await repo.upsertParent(input.projectId, seed.id, keyword.id);
  const decidedAt = new Date();
  await repo.updateSuggestion(input.projectId, suggestion.id, {
    status: 'ACCEPTED',
    acceptedKeywordId: keyword.id,
    decidedAt,
    decidedByUserId: input.actorUserId,
  });
  await repo.appendAudit(
    input.projectId,
    keyword.id,
    input.actorUserId,
    'KEYWORD_SUGGESTION_ACCEPTED',
    { suggestionId: suggestion.id, seedKeywordId: seed.id },
  );
  return keyword;
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
          lifecycleStatus: input.lifecycleStatus ?? 'DISCOVERED',
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

  async createManualBulk(input: CreateManualKeywordsBulkInput): Promise<{
    created: Keyword[];
    duplicates: KeywordBulkDuplicate[];
  }> {
    return inKeywordTransaction(async (repo) => {
      const existing = await repo.listNormalizedKeywords(input.projectId);
      const plan = planKeywordBulkCreate({
        text: input.text,
        existingNormalized: new Set(existing.map((item) => item.normalizedText)),
      });
      const groupIds = await requireGroups(repo, input.projectId, input.groupIds ?? []);
      const created: Keyword[] = [];

      for (const candidate of plan.candidates) {
        const keyword = await repo.createKeyword({
          projectId: input.projectId,
          text: candidate.text,
          normalizedText: candidate.normalizedText,
          type: input.type,
          intent: input.intent ?? null,
          priority: input.priority ?? 'MEDIUM',
          status: 'ACTIVE',
          lifecycleStatus: input.lifecycleStatus ?? 'DISCOVERED',
          locked: input.locked ?? false,
          source: 'MANUAL',
          language: input.language ?? null,
          targetCountry: input.targetCountry ?? null,
          notes: input.notes ?? null,
          createdByUserId: input.actorUserId,
        });
        if (groupIds.length > 0) {
          await repo.replaceGroupMemberships(input.projectId, keyword.id, groupIds);
        }
        await repo.appendAudit(
          input.projectId,
          keyword.id,
          input.actorUserId,
          'KEYWORD_CREATED',
          { source: 'MANUAL', bulk: true, line: candidate.line },
        );
        created.push(keyword);
      }

      return { created, duplicates: plan.duplicates };
    });
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
      if (input.lifecycleStatus !== undefined) data.lifecycleStatus = input.lifecycleStatus;
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

  async renameGroup(input: RenameKeywordGroupInput) {
    const name = input.name.trim();
    if (!name) throw new ValidationError('Keyword group name is required');

    try {
      return await inKeywordTransaction(async (repo) => {
        const group = await requireGroup(repo, input.projectId, input.groupId);
        const duplicate = await repo.findGroupByName(input.projectId, name);
        if (duplicate && duplicate.id !== group.id) throw keywordGroupDuplicate();

        await repo.renameGroup(input.projectId, input.groupId, name);
        await repo.appendAudit(
          input.projectId,
          null,
          input.actorUserId,
          'KEYWORD_GROUP_RENAMED',
          { groupId: input.groupId, previousName: group.name, name },
        );
        return requireGroup(repo, input.projectId, input.groupId);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw keywordGroupDuplicate();
      }
      throw error;
    }
  }

  async setGroupPrimaryKeyword(input: SetKeywordGroupPrimaryInput) {
    return inKeywordTransaction(async (repo) => {
      await requireGroup(repo, input.projectId, input.groupId);
      if (input.primaryKeywordId) {
        const keyword = await requireKeyword(repo, input.projectId, input.primaryKeywordId);
        assertUnlockedOrAcknowledged(keyword.locked, input.acknowledgeLock);
        await repo.addGroupMemberships(input.projectId, input.groupId, [keyword.id]);
      }

      await repo.setGroupPrimaryKeyword(
        input.projectId,
        input.groupId,
        input.primaryKeywordId,
      );
      await repo.appendAudit(
        input.projectId,
        input.primaryKeywordId,
        input.actorUserId,
        'KEYWORD_GROUP_PRIMARY_CHANGED',
        { groupId: input.groupId, primaryKeywordId: input.primaryKeywordId },
      );
      return requireGroup(repo, input.projectId, input.groupId);
    });
  }

  async assignKeywordsToGroup(input: AssignKeywordsToGroupInput) {
    return inKeywordTransaction(async (repo) => {
      await requireGroup(repo, input.projectId, input.groupId);
      const keywordIds = [...new Set(input.keywordIds)];
      if (keywordIds.length === 0) {
        throw new ValidationError('At least one keyword is required');
      }

      for (const keywordId of keywordIds) {
        const keyword = await requireKeyword(repo, input.projectId, keywordId);
        assertUnlockedOrAcknowledged(keyword.locked, input.acknowledgeLock);
      }

      await repo.addGroupMemberships(input.projectId, input.groupId, keywordIds);
      for (const keywordId of keywordIds) {
        await repo.appendAudit(
          input.projectId,
          keywordId,
          input.actorUserId,
          'KEYWORD_GROUP_ASSIGNED',
          { groupId: input.groupId },
        );
      }
      return repo.listMembershipsForGroup(input.projectId, input.groupId);
    });
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

  async acceptSuggestion(input: AcceptKeywordSuggestionInput): Promise<Keyword> {
    return inKeywordTransaction((repo) => acceptSuggestionInTransaction(repo, input));
  }

  async acceptSuggestions(input: AcceptKeywordSuggestionsInput): Promise<Keyword[]> {
    const suggestionIds = [...new Set(input.suggestionIds)];
    if (suggestionIds.length === 0) {
      throw new ValidationError('At least one keyword suggestion is required');
    }
    return inKeywordTransaction(async (repo) => {
      const accepted: Keyword[] = [];
      for (const suggestionId of suggestionIds) {
        accepted.push(await acceptSuggestionInTransaction(repo, { ...input, suggestionId }));
      }
      return accepted;
    });
  }

  async rejectSuggestion(input: RejectKeywordSuggestionInput): Promise<KeywordSuggestion> {
    return inKeywordTransaction(async (repo) => {
      const suggestion = await requireSuggestion(repo, input.projectId, input.suggestionId);
      if (suggestion.status !== 'PENDING') throw suggestionAlreadyDecided();
      const seed = await requireKeyword(repo, input.projectId, suggestion.seedKeywordId);
      const decidedAt = new Date();

      await repo.updateSuggestion(input.projectId, suggestion.id, {
        status: 'REJECTED',
        decidedAt,
        decidedByUserId: input.actorUserId,
      });
      await repo.appendAudit(
        input.projectId,
        seed.id,
        input.actorUserId,
        'KEYWORD_SUGGESTION_REJECTED',
        { suggestionId: suggestion.id },
      );
      return requireSuggestion(repo, input.projectId, suggestion.id);
    });
  }

  list(projectId: string, filters: KeywordListQuery = {}) {
    return new KeywordRepository().listKeywords(projectId, filters);
  }
}

export const keywordService = new KeywordService();
