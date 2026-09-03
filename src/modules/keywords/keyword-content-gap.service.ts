import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { KeywordCoverageService } from './keyword-coverage.service.js';

export class KeywordContentGapService {
  constructor(private readonly coverage = new KeywordCoverageService()) {}

  async evaluateKeyword(projectId: string, keywordId: string, actorUserId: string) {
    const keyword = await prisma.keyword.findFirst({ where: { id: keywordId, projectId } });
    if (!keyword) throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
    const coverage = await this.coverage.evaluateKeyword(projectId, keywordId);
    const [target, existing] = await Promise.all([
      prisma.keywordTargetMapping.findUnique({ where: { keywordId } }),
      prisma.keywordContentGap.findUnique({ where: { keywordId } }),
    ]);
    const unresolved = coverage.status === 'NONE' || coverage.status === 'UNKNOWN';
    const unresolvedStatus = existing && existing.status !== 'RESOLVED' ? existing.status : 'OPEN';
    return prisma.keywordContentGap.upsert({
      where: { keywordId },
      create: {
        projectId, keywordId, coverageStatus: coverage.status,
        status: unresolved ? unresolvedStatus : 'RESOLVED', targetUrl: target?.normalizedUrl ?? null,
        reasonCodes: [coverage.reason], sourceProvenance: { coverageStatus: coverage.status, coverageReason: coverage.reason }, createdByUserId: actorUserId,
      },
      update: {
        coverageStatus: coverage.status, status: unresolved ? unresolvedStatus : 'RESOLVED', targetUrl: target?.normalizedUrl ?? null,
        reasonCodes: [coverage.reason], sourceProvenance: { coverageStatus: coverage.status, coverageReason: coverage.reason },
      },
    });
  }

  async findKeyword(projectId: string, keywordId: string) {
    const keyword = await prisma.keyword.findFirst({ where: { id: keywordId, projectId }, select: { id: true } });
    if (!keyword) throw new AppError('Keyword not found', 404, 'KEYWORD_NOT_FOUND');
    return prisma.keywordContentGap.findFirst({ where: { projectId, keywordId } });
  }

  async planKeyword(projectId: string, keywordId: string, actorUserId: string) {
    const gap = await this.evaluateKeyword(projectId, keywordId, actorUserId);
    if (gap.status === 'RESOLVED') {
      throw new AppError('A covered keyword cannot be planned as a content gap', 409, 'KEYWORD_CONTENT_GAP_NOT_ACTIONABLE');
    }

    return prisma.keywordContentGap.update({
      where: { id: gap.id },
      data: { status: 'CONTENT_PLANNED' },
    });
  }
}
