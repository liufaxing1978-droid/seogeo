import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

type Mapping = { id: string; projectId: string; keywordId: string | null; groupId: string | null; entityId: string; createdAt: Date; updatedAt: Date };

export class KeywordEntityService {
  async listKeywordEntities(projectId: string, keywordId: string) {
    await this.requireKeyword(projectId, keywordId);
    return prisma.keywordEntityMapping.findMany({
      where: { projectId, keywordId },
      include: { entity: { select: { id: true, entityType: true, canonicalName: true, status: true, confidence: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listGroupEntities(projectId: string, groupId: string) {
    await this.requireGroup(projectId, groupId);
    return prisma.keywordEntityMapping.findMany({
      where: { projectId, groupId },
      include: { entity: { select: { id: true, entityType: true, canonicalName: true, status: true, confidence: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setKeywordEntities(input: { actorUserId: string; projectId: string; keywordId: string; entityIds: string[] }): Promise<Mapping[]> {
    return prisma.$transaction(async (tx) => {
      await this.requireKeyword(input.projectId, input.keywordId, tx);
      const mappings = await this.replace({ ...input, entityIds: unique(input.entityIds) }, tx);
      await tx.keywordAuditEvent.create({
        data: { projectId: input.projectId, keywordId: input.keywordId, actorUserId: input.actorUserId, eventType: 'KEYWORD_ENTITIES_SET', metadata: { entityIds: mappings.map((mapping) => mapping.entityId) } },
      });
      return mappings;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setGroupEntities(input: { actorUserId: string; projectId: string; groupId: string; entityIds: string[] }): Promise<Mapping[]> {
    return prisma.$transaction(async (tx) => {
      await this.requireGroup(input.projectId, input.groupId, tx);
      return this.replace({ ...input, entityIds: unique(input.entityIds) }, tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async replace(
    input: { projectId: string; keywordId?: string; groupId?: string; entityIds: string[] },
    tx: Prisma.TransactionClient,
  ): Promise<Mapping[]> {
    const entities = await tx.entity.findMany({
      where: { projectId: input.projectId, id: { in: input.entityIds }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (entities.length !== input.entityIds.length) {
      throw new AppError('Entity not found', 404, 'ENTITY_NOT_FOUND');
    }
    const subject = input.keywordId ? { keywordId: input.keywordId } : { groupId: input.groupId! };
    await tx.keywordEntityMapping.deleteMany({ where: { projectId: input.projectId, ...subject } });
    if (!input.entityIds.length) return [];
    await tx.keywordEntityMapping.createMany({
      data: input.entityIds.map((entityId) => ({ projectId: input.projectId, entityId, ...subject })),
    });
    return tx.keywordEntityMapping.findMany({ where: { projectId: input.projectId, ...subject }, orderBy: { createdAt: 'asc' } });
  }

  private async requireKeyword(projectId: string, keywordId: string, tx: PrismaClient | Prisma.TransactionClient = prisma) {
    const keyword = await tx.keyword.findFirst({ where: { projectId, id: keywordId }, select: { id: true } });
    if (!keyword) throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
  }

  private async requireGroup(projectId: string, groupId: string, tx: PrismaClient | Prisma.TransactionClient = prisma) {
    const group = await tx.keywordGroup.findFirst({ where: { projectId, id: groupId }, select: { id: true } });
    if (!group) throw new AppError('Keyword group not found', 404, 'KEYWORD_GROUP_NOT_FOUND');
  }
}

function unique(values: string[]) {
  return [...new Set(values)];
}
