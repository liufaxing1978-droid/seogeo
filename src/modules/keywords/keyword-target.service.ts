import { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { normalizeProjectTargetUrl } from './keyword-target-url.js';

export class KeywordTargetService {
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
