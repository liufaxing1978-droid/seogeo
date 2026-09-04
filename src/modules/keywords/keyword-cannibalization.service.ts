import { prisma } from '../../db/prisma.js';
import { KeywordCoverageService } from './keyword-coverage.service.js';
import { evaluateKeywordCannibalization } from './keyword-cannibalization.js';

export class KeywordCannibalizationService {
  async calculateKeyword(projectId: string, keywordId: string, actorUserId: string) {
    const keyword = await prisma.keyword.findFirst({ where: { id: keywordId, projectId } });
    if (!keyword) throw new Error('Keyword not found');
    const [growth, coverage, direct, memberships] = await Promise.all([
      prisma.growthOpportunitySnapshot.findFirst({
        where: { projectId, primaryType: 'KEYWORD_CANNIBALIZATION', identity: { normalizedQuery: keyword.normalizedText } },
        orderBy: { createdAt: 'desc' }, include: { identity: true },
      }),
      new KeywordCoverageService().evaluateKeyword(projectId, keywordId),
      prisma.keywordTargetMapping.findUnique({ where: { keywordId } }),
      prisma.keywordGroupMembership.findMany({ where: { projectId, keywordId }, select: { groupId: true } }),
    ]);
    const inherited = memberships.length === 0 ? [] : await prisma.keywordTargetMapping.findMany({ where: { groupId: { in: memberships.map((item) => item.groupId) } }, select: { normalizedUrl: true } });
    const mappingConflict = !direct && new Set(inherited.map((item) => item.normalizedUrl)).size > 1;
    const urls = [...new Set([direct?.normalizedUrl, ...inherited.map((item) => item.normalizedUrl), ...coverage.matches.map((match) => match.url)]
      .filter((url): url is string => Boolean(url)))].sort();
    const result = evaluateKeywordCannibalization({
      growthDetected: Boolean(growth), mappingConflict,
      coverageUrls: coverage.matches.map((match) => match.url),
    });
    return prisma.keywordCannibalizationSnapshot.create({ data: {
      projectId, keywordId, risk: result.risk, recommendedAction: result.recommendedAction,
      urls,
      reasons: result.reasonCodes,
      sourceProvenance: { growthSnapshotId: growth?.id ?? null, coverageStatus: coverage.status, targetMapping: direct ? 'DIRECT' : inherited.length > 0 ? 'INHERITED' : 'NONE' },
      confidence: result.confidence, formulaVersion: 'keyword-cannibalization-v1', createdByUserId: actorUserId,
    }});
  }

  findLatestKeyword(projectId: string, keywordId: string) {
    return prisma.keywordCannibalizationSnapshot.findFirst({ where: { projectId, keywordId }, orderBy: { createdAt: 'desc' } });
  }
}
