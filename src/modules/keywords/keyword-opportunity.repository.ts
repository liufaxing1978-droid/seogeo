import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { KeywordOpportunityScoreResult } from './keyword-opportunity-score.js';

export type AppendKeywordOpportunitySnapshotInput = KeywordOpportunityScoreResult & {
  projectId: string;
  keywordId: string;
  actorUserId: string;
};

export class KeywordOpportunityRepository {
  async appendSnapshot(input: AppendKeywordOpportunitySnapshotInput) {
    return prisma.$transaction(async (tx) => {
      const snapshot = await tx.keywordOpportunitySnapshot.create({
        data: {
          projectId: input.projectId,
          keywordId: input.keywordId,
          score: input.score,
          dataConfidence: input.dataConfidence,
          breakdown: input.breakdown as unknown as Prisma.InputJsonValue,
          sourceProvenance: input.sourceProvenance as unknown as Prisma.InputJsonValue,
          formulaVersion: input.formulaVersion,
          createdByUserId: input.actorUserId,
        },
      });

      await tx.keywordAuditEvent.create({
        data: {
          projectId: input.projectId,
          keywordId: input.keywordId,
          actorUserId: input.actorUserId,
          eventType: 'KEYWORD_OPPORTUNITY_CALCULATED',
          metadata: {
            snapshotId: snapshot.id,
            score: input.score,
            dataConfidence: input.dataConfidence,
            formulaVersion: input.formulaVersion,
          },
        },
      });

      return snapshot;
    });
  }

  findLatest(projectId: string, keywordId: string) {
    return prisma.keywordOpportunitySnapshot.findFirst({
      where: { projectId, keywordId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findLatestForKeywords(projectId: string, keywordIds: string[]) {
    if (keywordIds.length === 0) return new Map();
    const rows = await prisma.keywordOpportunitySnapshot.findMany({
      where: { projectId, keywordId: { in: keywordIds } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!latest.has(row.keywordId)) latest.set(row.keywordId, row);
    }
    return latest;
  }
}
