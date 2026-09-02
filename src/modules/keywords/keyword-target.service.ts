import { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { normalizeProjectTargetUrl } from './keyword-target-url.js';

export class KeywordTargetService {
  async setKeywordTargetUrlBulk(input: {
    actorUserId: string; projectId: string; keywordIds: string[]; targetUrl: string; acknowledgeLock?: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      const ids = [...new Set(input.keywordIds)];
      const keywords = await tx.keyword.findMany({ where: { projectId: input.projectId, id: { in: ids } } });
      if (keywords.length !== ids.length) throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
      if (keywords.some((keyword) => keyword.locked) && input.acknowledgeLock !== true) throw new AppError('Keyword is strategically locked', 409, 'KEYWORD_LOCKED');
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
      const normalizedUrl = normalizeProjectTargetUrl(input.targetUrl, project.primaryDomain);
      const page = await tx.page.findFirst({ where: { projectId: input.projectId, normalizedUrl }, select: { id: true } });
      const mappings = await Promise.all(keywords.map((keyword) => tx.keywordTargetMapping.upsert({
        where: { keywordId: keyword.id },
        create: { projectId: input.projectId, keywordId: keyword.id, targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId },
        update: { targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, updatedByUserId: input.actorUserId },
      })));
      await tx.keyword.updateMany({ where: { projectId: input.projectId, id: { in: keywords.filter((k) => ['DISCOVERED', 'EVALUATING', 'APPROVED'].includes(k.lifecycleStatus)).map((k) => k.id) } }, data: { lifecycleStatus: 'MAPPED' } });
      return mappings;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setGroupTargetUrl(input: { actorUserId: string; projectId: string; groupId: string; targetUrl: string }) {
    return prisma.$transaction(async (tx) => {
      const group = await tx.keywordGroup.findFirst({ where: { id: input.groupId, projectId: input.projectId } });
      if (!group) throw new AppError('Keyword group not found', 404, 'KEYWORD_GROUP_NOT_FOUND');
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
      const normalizedUrl = normalizeProjectTargetUrl(input.targetUrl, project.primaryDomain);
      const page = await tx.page.findFirst({ where: { projectId: input.projectId, normalizedUrl }, select: { id: true } });
      return tx.keywordTargetMapping.upsert({ where: { groupId: group.id }, create: { projectId: input.projectId, groupId: group.id, targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId }, update: { targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, updatedByUserId: input.actorUserId } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async setKeywordTargetUrl(input: {
    actorUserId: string;
    projectId: string;
    keywordId: string;
    targetUrl: string;
    acknowledgeLock?: boolean;
  }) {
    return prisma.$transaction(async (tx) => {
      const keyword = await tx.keyword.findFirst({ where: { id: input.keywordId, projectId: input.projectId } });
      if (!keyword) throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
      if (keyword.locked && input.acknowledgeLock !== true) {
        throw new AppError('Keyword is strategically locked', 409, 'KEYWORD_LOCKED');
      }
      const project = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
      const normalizedUrl = normalizeProjectTargetUrl(input.targetUrl, project.primaryDomain);
      const page = await tx.page.findFirst({ where: { projectId: input.projectId, normalizedUrl }, select: { id: true } });
      const mapping = await tx.keywordTargetMapping.upsert({
        where: { keywordId: input.keywordId },
        create: { projectId: input.projectId, keywordId: input.keywordId, targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, createdByUserId: input.actorUserId, updatedByUserId: input.actorUserId },
        update: { targetUrl: input.targetUrl, normalizedUrl, pageId: page?.id ?? null, updatedByUserId: input.actorUserId },
      });
      if (['DISCOVERED', 'EVALUATING', 'APPROVED'].includes(keyword.lifecycleStatus)) {
        await tx.keyword.update({ where: { id: keyword.id }, data: { lifecycleStatus: 'MAPPED' } });
      }
      await tx.keywordAuditEvent.create({ data: { projectId: input.projectId, keywordId: keyword.id, actorUserId: input.actorUserId, eventType: 'KEYWORD_TARGET_URL_SET', metadata: { normalizedUrl } } });
      return mapping;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
