import type {
  KeywordDiscoveryCandidate,
  PrismaClient,
} from '@prisma/client';
import type { SearchFactView } from '../search-facts/search-fact.types.js';

export type KeywordDiscoveryRepositoryWindow = {
  facts: SearchFactView[];
  trackedKeywords: Array<{ id: string; normalizedText: string }>;
  candidates: KeywordDiscoveryCandidate[];
};

export class KeywordDiscoveryRepository {
  constructor(private readonly db: PrismaClient) {}

  async loadWindow(input: {
    projectId: string;
    dateFrom: Date;
    dateTo: Date;
  }): Promise<KeywordDiscoveryRepositoryWindow> {
    const [factRows, trackedKeywords, candidates] = await Promise.all([
      this.db.searchFact.findMany({
        where: {
          projectId: input.projectId,
          sourceDate: { gte: input.dateFrom, lte: input.dateTo },
          factKind: { in: ['QUERY_PAGE', 'QUERY'] },
          query: { not: null },
          snapshot: {
            projectId: input.projectId,
            status: 'COMPLETED',
            completedAt: { not: null },
          },
        },
        include: {
          snapshot: true,
          metrics: true,
        },
        orderBy: [{ sourceDate: 'asc' }, { factKey: 'asc' }],
      }),
      this.db.keyword.findMany({
        where: { projectId: input.projectId },
        select: { id: true, normalizedText: true },
      }),
      this.db.keywordDiscoveryCandidate.findMany({
        where: { projectId: input.projectId },
        orderBy: [{ normalizedQuery: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const facts: SearchFactView[] = factRows.map((row) => ({
      snapshotId: row.snapshotId,
      projectId: row.projectId,
      provider: row.snapshot.provider,
      marketCode: row.snapshot.marketCode,
      locale: row.snapshot.locale,
      propertyRef: row.snapshot.propertyRef,
      propertyType: row.snapshot.propertyType,
      sourceKind: row.snapshot.sourceKind,
      sourceRef: row.snapshot.sourceRef,
      sourceObservationRef: row.sourceObservationRef,
      sourceCutoffAt: row.snapshot.sourceCutoffAt,
      sourceCompleteness: row.snapshot.sourceCompleteness,
      normalizationVersion: row.snapshot.normalizationVersion,
      factKey: row.factKey,
      factKind: row.factKind,
      sourceDate: row.sourceDate,
      query: row.query,
      normalizedQuery: row.normalizedQuery,
      queryNormalizationVersion: row.queryNormalizationVersion,
      page: row.page,
      canonicalPage: row.canonicalPage,
      canonicalizationVersion: row.canonicalizationVersion,
      metrics: row.metrics.map((metric) => ({
        metricSemantic: metric.metricSemantic,
        numericValue: metric.numericValue,
        evidenceState: metric.evidenceState,
        sourceField: metric.sourceField,
      })),
    }));

    return { facts, trackedKeywords, candidates };
  }

  createCandidate(input: {
    projectId: string;
    normalizedQuery: string;
    representativeText: string;
    firstObservedAt: Date;
    lastObservedAt: Date;
  }) {
    return this.db.keywordDiscoveryCandidate.create({
      data: {
        projectId: input.projectId,
        normalizedQuery: input.normalizedQuery,
        representativeText: input.representativeText,
        status: 'PENDING',
        acceptedKeywordId: null,
        firstObservedAt: input.firstObservedAt,
        lastObservedAt: input.lastObservedAt,
      },
    });
  }

  updateObservation(input: {
    projectId: string;
    candidateId: string;
    representativeText: string;
    firstObservedAt: Date;
    lastObservedAt: Date;
  }) {
    return this.db.keywordDiscoveryCandidate.updateMany({
      where: { id: input.candidateId, projectId: input.projectId },
      data: {
        representativeText: input.representativeText,
        firstObservedAt: input.firstObservedAt,
        lastObservedAt: input.lastObservedAt,
      },
    });
  }
}
