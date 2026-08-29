import type { Prisma, PrismaClient, SearchFactSnapshot } from '@prisma/client';
import type {
  NormalizedSearchFactDraft,
  SearchFactMaterializeIdentity,
  SearchFactReadFilter,
  SearchFactSnapshotReadFilter,
  SearchFactSnapshotView,
  SearchFactView
} from './search-fact.types.js';

const assertIdentity = (identity: SearchFactMaterializeIdentity): void => {
  if (
    identity.projectId.trim().length === 0 ||
    identity.locale.trim().length === 0 ||
    identity.propertyRef.trim().length === 0 ||
    identity.propertyType.trim().length === 0 ||
    identity.sourceRef.trim().length === 0 ||
    identity.normalizationVersion.trim().length === 0 ||
    Number.isNaN(identity.sourceCutoffAt.getTime())
  ) {
    throw new Error('SEARCH_FACT_INVALID_IDENTITY');
  }
};

const assertDrafts = (
  identity: SearchFactMaterializeIdentity,
  drafts: readonly NormalizedSearchFactDraft[]
): void => {
  const factKeys = new Set<string>();

  for (const draft of drafts) {
    if (
      draft.factKey.trim().length === 0 ||
      draft.sourceObservationRef.trim().length === 0 ||
      Number.isNaN(draft.sourceDate.getTime()) ||
      draft.sourceDate.getTime() > identity.sourceCutoffAt.getTime()
    ) {
      throw new Error('SEARCH_FACT_INVALID_DRAFT');
    }
    if (factKeys.has(draft.factKey)) {
      throw new Error('SEARCH_FACT_DUPLICATE_FACT_KEY');
    }
    factKeys.add(draft.factKey);

    const semantics = new Set<string>();
    for (const metric of draft.metrics) {
      if (metric.sourceField.trim().length === 0 || semantics.has(metric.metricSemantic)) {
        throw new Error('SEARCH_FACT_INVALID_METRIC');
      }
      semantics.add(metric.metricSemantic);

      if (metric.evidenceState === 'KNOWN_PRESENT') {
        if (
          metric.numericValue === null ||
          !Number.isFinite(metric.numericValue) ||
          metric.numericValue < 0
        ) {
          throw new Error('SEARCH_FACT_INVALID_METRIC');
        }
      } else if (metric.numericValue !== null) {
        throw new Error('SEARCH_FACT_INVALID_METRIC');
      }
    }
  }
};

const assertReadFilter = (filter: SearchFactReadFilter): void => {
  const required = filter.projectId.trim();
  if (required.length === 0) {
    throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
  }

  for (const value of [
    filter.locale,
    filter.propertyRef,
    filter.canonicalPage,
    filter.normalizedQuery
  ]) {
    if (value !== undefined && value.trim().length === 0) {
      throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
    }
  }

  if (
    (filter.sourceDateFrom && Number.isNaN(filter.sourceDateFrom.getTime())) ||
    (filter.sourceDateTo && Number.isNaN(filter.sourceDateTo.getTime())) ||
    (filter.sourceDateFrom &&
      filter.sourceDateTo &&
      filter.sourceDateFrom.getTime() > filter.sourceDateTo.getTime())
  ) {
    throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
  }
};

const assertSnapshotReadFilter = (filter: SearchFactSnapshotReadFilter): void => {
  if (filter.projectId.trim().length === 0) {
    throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
  }

  for (const value of [filter.locale, filter.propertyRef]) {
    if (value !== undefined && value.trim().length === 0) {
      throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
    }
  }

  if (
    (filter.sourceCutoffFrom && Number.isNaN(filter.sourceCutoffFrom.getTime())) ||
    (filter.sourceCutoffTo && Number.isNaN(filter.sourceCutoffTo.getTime())) ||
    (filter.sourceCutoffFrom &&
      filter.sourceCutoffTo &&
      filter.sourceCutoffFrom.getTime() > filter.sourceCutoffTo.getTime())
  ) {
    throw new Error('SEARCH_FACT_INVALID_READ_FILTER');
  }
};

export class SearchFactRepository {
  constructor(private readonly db: PrismaClient) {}

  async persistCompletedSnapshot(
    identity: SearchFactMaterializeIdentity,
    drafts: readonly NormalizedSearchFactDraft[],
    inputHash: string
  ): Promise<SearchFactSnapshot> {
    assertIdentity(identity);
    assertDrafts(identity, drafts);
    if (inputHash.trim().length === 0) {
      throw new Error('SEARCH_FACT_INVALID_INPUT_HASH');
    }

    return this.db.$transaction(async (tx) => {
      const existing = await tx.searchFactSnapshot.findFirst({
        where: {
          projectId: identity.projectId,
          provider: identity.provider,
          marketCode: identity.marketCode,
          locale: identity.locale,
          propertyRef: identity.propertyRef,
          sourceKind: identity.sourceKind,
          sourceRef: identity.sourceRef,
          normalizationVersion: identity.normalizationVersion
        }
      });

      if (existing) {
        if (existing.status !== 'COMPLETED' || existing.inputHash !== inputHash) {
          throw new Error('SEARCH_FACT_PERSISTENCE_CONFLICT');
        }

        const factCount = await tx.searchFact.count({
          where: { snapshotId: existing.id }
        });
        if (factCount !== existing.factCount || factCount !== drafts.length) {
          throw new Error('SEARCH_FACT_PERSISTENCE_CONFLICT');
        }
        return existing;
      }

      const startedAt = new Date();
      const snapshot = await tx.searchFactSnapshot.create({
        data: {
          projectId: identity.projectId,
          provider: identity.provider,
          marketCode: identity.marketCode,
          locale: identity.locale,
          propertyRef: identity.propertyRef,
          propertyType: identity.propertyType,
          sourceKind: identity.sourceKind,
          sourceRef: identity.sourceRef,
          sourceCutoffAt: identity.sourceCutoffAt,
          sourceCompleteness: identity.sourceCompleteness,
          normalizationVersion: identity.normalizationVersion,
          inputHash,
          status: 'RUNNING',
          factCount: 0,
          startedAt,
          errorCode: null
        }
      });

      for (const draft of drafts) {
        await tx.searchFact.create({
          data: {
            snapshotId: snapshot.id,
            projectId: identity.projectId,
            factKey: draft.factKey,
            factKind: draft.factKind,
            sourceObservationRef: draft.sourceObservationRef,
            sourceDate: draft.sourceDate,
            query: draft.query,
            normalizedQuery: draft.normalizedQuery,
            queryNormalizationVersion: draft.queryNormalizationVersion,
            page: draft.page,
            canonicalPage: draft.canonicalPage,
            canonicalizationVersion: draft.canonicalizationVersion,
            metrics: {
              create: draft.metrics.map((metric) => ({
                metricSemantic: metric.metricSemantic,
                numericValue: metric.numericValue,
                evidenceState: metric.evidenceState,
                sourceField: metric.sourceField
              }))
            }
          }
        });
      }

      return tx.searchFactSnapshot.update({
        where: { id: snapshot.id },
        data: {
          status: 'COMPLETED',
          factCount: drafts.length,
          completedAt: new Date(),
          errorCode: null
        }
      });
    });
  }

  async listCompletedSnapshots(
    filter: SearchFactSnapshotReadFilter
  ): Promise<SearchFactSnapshotView[]> {
    assertSnapshotReadFilter(filter);

    const sourceCutoffAt =
      filter.sourceCutoffFrom || filter.sourceCutoffTo
        ? {
            ...(filter.sourceCutoffFrom ? { gte: filter.sourceCutoffFrom } : {}),
            ...(filter.sourceCutoffTo ? { lte: filter.sourceCutoffTo } : {})
          }
        : undefined;

    const rows = await this.db.searchFactSnapshot.findMany({
      where: {
        projectId: filter.projectId,
        status: 'COMPLETED',
        completedAt: { not: null },
        ...(filter.provider ? { provider: filter.provider } : {}),
        ...(filter.marketCode ? { marketCode: filter.marketCode } : {}),
        ...(filter.locale !== undefined ? { locale: filter.locale } : {}),
        ...(filter.propertyRef !== undefined ? { propertyRef: filter.propertyRef } : {}),
        ...(sourceCutoffAt ? { sourceCutoffAt } : {})
      },
      orderBy: [
        { provider: 'asc' },
        { marketCode: 'asc' },
        { locale: 'asc' },
        { propertyRef: 'asc' },
        { sourceCutoffAt: 'desc' },
        { id: 'asc' }
      ]
    });

    return rows.map((row) => ({
      snapshotId: row.id,
      projectId: row.projectId,
      provider: row.provider,
      marketCode: row.marketCode,
      locale: row.locale,
      propertyRef: row.propertyRef,
      propertyType: row.propertyType,
      sourceKind: row.sourceKind,
      sourceRef: row.sourceRef,
      sourceCutoffAt: row.sourceCutoffAt,
      sourceCompleteness: row.sourceCompleteness,
      normalizationVersion: row.normalizationVersion,
      factCount: row.factCount,
      completedAt: row.completedAt!
    }));
  }

  async listCompletedFacts(filter: SearchFactReadFilter): Promise<SearchFactView[]> {
    assertReadFilter(filter);

    const sourceDate =
      filter.sourceDateFrom || filter.sourceDateTo
        ? {
            ...(filter.sourceDateFrom ? { gte: filter.sourceDateFrom } : {}),
            ...(filter.sourceDateTo ? { lte: filter.sourceDateTo } : {})
          }
        : undefined;

    const where: Prisma.SearchFactWhereInput = {
      projectId: filter.projectId,
      ...(filter.factKind ? { factKind: filter.factKind } : {}),
      ...(filter.metricSemantic
        ? { metrics: { some: { metricSemantic: filter.metricSemantic } } }
        : {}),
      ...(filter.canonicalPage !== undefined
        ? { canonicalPage: filter.canonicalPage }
        : {}),
      ...(filter.normalizedQuery !== undefined
        ? { normalizedQuery: filter.normalizedQuery }
        : {}),
      ...(sourceDate ? { sourceDate } : {}),
      snapshot: {
        projectId: filter.projectId,
        status: 'COMPLETED',
        completedAt: { not: null },
        ...(filter.provider ? { provider: filter.provider } : {}),
        ...(filter.marketCode ? { marketCode: filter.marketCode } : {}),
        ...(filter.locale !== undefined ? { locale: filter.locale } : {}),
        ...(filter.propertyRef !== undefined ? { propertyRef: filter.propertyRef } : {})
      }
    };

    const rows = await this.db.searchFact.findMany({
      where,
      include: {
        snapshot: true,
        metrics: true
      },
      orderBy: [{ sourceDate: 'asc' }, { factKey: 'asc' }]
    });

    return rows.map((row) => ({
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
        sourceField: metric.sourceField
      }))
    }));
  }
}