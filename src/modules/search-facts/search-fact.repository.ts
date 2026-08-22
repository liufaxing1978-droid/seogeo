import type { PrismaClient, SearchFactSnapshot } from '@prisma/client';
import type {
  NormalizedSearchFactDraft,
  SearchFactMaterializeIdentity
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
}
