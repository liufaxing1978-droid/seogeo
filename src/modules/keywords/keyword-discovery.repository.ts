import { Prisma, type KeywordDiscoveryCandidate, type PrismaClient } from '@prisma/client';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { KeywordRepository } from './keyword.repository.js';
import type { SearchFactView } from '../search-facts/search-fact.types.js';

export type KeywordDiscoveryRepositoryWindow = {
  facts: SearchFactView[];
  trackedKeywords: Array<{ id: string; normalizedText: string }>;
  candidates: KeywordDiscoveryCandidate[];
};

type KeywordDiscoveryDb = PrismaClient | Prisma.TransactionClient;

type DecisionRepositories = {
  discovery: KeywordDiscoveryRepository;
  keywords: KeywordRepository;
};

const KEYWORD_DISCOVERY_TRANSACTION_MAX_ATTEMPTS = 3;

function isRetryableTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === 'P2034' || error.code === 'P2002');
}

export class KeywordDiscoveryRepository {
  constructor(private readonly db: KeywordDiscoveryDb = prisma) {}

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

  findCandidate(projectId: string, candidateId: string) {
    return this.db.keywordDiscoveryCandidate.findFirst({
      where: { id: candidateId, projectId },
    });
  }

  updateDecision(input: {
    projectId: string;
    candidateId: string;
    status: 'ACCEPTED' | 'REJECTED';
    acceptedKeywordId?: string | null;
    decidedAt: Date;
    decidedByUserId: string;
  }) {
    return this.db.keywordDiscoveryCandidate.updateMany({
      where: { id: input.candidateId, projectId: input.projectId },
      data: {
        status: input.status,
        acceptedKeywordId: input.acceptedKeywordId ?? null,
        decidedAt: input.decidedAt,
        decidedByUserId: input.decidedByUserId,
      },
    });
  }

  async withSerializableTransaction<T>(
    work: (repositories: DecisionRepositories) => Promise<T>,
  ): Promise<T> {
    const db = this.db as PrismaClient;
    for (let attempt = 1; attempt <= KEYWORD_DISCOVERY_TRANSACTION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await db.$transaction(
          async (tx) => work({
            discovery: new KeywordDiscoveryRepository(tx),
            keywords: new KeywordRepository(tx),
          }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryableTransactionConflict(error) || attempt === KEYWORD_DISCOVERY_TRANSACTION_MAX_ATTEMPTS) {
          throw error;
        }
      }
    }

    throw new AppError(
      'Keyword discovery transaction retry exhausted',
      409,
      'KEYWORD_DISCOVERY_WRITE_CONFLICT',
    );
  }
}
