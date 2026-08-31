import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type KeywordDb = Pick<
  Prisma.TransactionClient,
  | 'keyword'
  | 'keywordRelation'
  | 'keywordGroup'
  | 'keywordGroupMembership'
  | 'keywordSuggestion'
  | 'keywordAuditEvent'
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

  listKeywords(projectId: string) {
    return this.db.keyword.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { normalizedText: 'asc' }],
    });
  }

  updateKeyword(
    projectId: string,
    keywordId: string,
    data: Prisma.KeywordUncheckedUpdateManyInput,
  ) {
    return this.db.keyword.updateMany({ where: { id: keywordId, projectId }, data });
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

  createGroup(projectId: string, name: string, description?: string | null) {
    return this.db.keywordGroup.create({
      data: { projectId, name, description: description ?? null },
    });
  }

  findGroup(projectId: string, groupId: string) {
    return this.db.keywordGroup.findFirst({ where: { id: groupId, projectId } });
  }

  listGroups(projectId: string) {
    return this.db.keywordGroup.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listGroupMemberships(projectId: string, keywordId: string) {
    return this.db.keywordGroupMembership.findMany({
      where: { projectId, keywordId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async replaceGroupMemberships(projectId: string, keywordId: string, groupIds: string[]) {
    await this.db.keywordGroupMembership.deleteMany({ where: { projectId, keywordId } });
    if (groupIds.length === 0) return;
    await this.db.keywordGroupMembership.createMany({
      data: groupIds.map((groupId) => ({ projectId, keywordId, groupId })),
      skipDuplicates: true,
    });
  }

  createSuggestions(data: Prisma.KeywordSuggestionCreateManyInput[]) {
    if (data.length === 0) return Promise.resolve({ count: 0 });
    return this.db.keywordSuggestion.createMany({ data, skipDuplicates: true });
  }

  findSuggestion(projectId: string, suggestionId: string) {
    return this.db.keywordSuggestion.findFirst({ where: { id: suggestionId, projectId } });
  }

  updateSuggestion(
    projectId: string,
    suggestionId: string,
    data: Prisma.KeywordSuggestionUncheckedUpdateManyInput,
  ) {
    return this.db.keywordSuggestion.updateMany({
      where: { id: suggestionId, projectId },
      data,
    });
  }

  appendAudit(
    projectId: string,
    keywordId: string | null,
    actorUserId: string | null,
    eventType: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.db.keywordAuditEvent.create({
      data: {
        projectId,
        keywordId,
        actorUserId,
        eventType,
        ...(metadata === undefined ? {} : { metadata }),
      },
    });
  }
}
