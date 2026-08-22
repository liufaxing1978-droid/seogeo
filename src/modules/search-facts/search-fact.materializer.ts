import { createHash } from 'node:crypto';
import type { MarketCode, PrismaClient, SearchFactSnapshot } from '@prisma/client';
import { normalizeBingSearchObservation } from './normalizers/bing-search-fact.normalizer.js';
import { normalizeGoogleSearchFact } from './normalizers/google-search-fact.normalizer.js';
import { SearchFactRepository } from './search-fact.repository.js';
import type {
  NormalizedSearchFactDraft,
  SearchFactMaterializeIdentity
} from './search-fact.types.js';

export type MaterializeGoogleSearchSnapshotInput = {
  snapshotId: string;
  marketCode: MarketCode;
  locale: string;
  normalizationVersion: string;
};

export type MaterializeBingSearchBatchInput = {
  batchId: string;
  normalizationVersion: string;
};

const assertVersion = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('SEARCH_FACT_INVALID_NORMALIZATION_VERSION');
  }
  return normalized;
};

const assertLocale = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error('SEARCH_FACT_INVALID_LOCALE');
  }
  return normalized;
};

const stableHash = (
  identity: SearchFactMaterializeIdentity,
  drafts: readonly NormalizedSearchFactDraft[]
): string => {
  const stableDrafts = [...drafts]
    .sort((left, right) => left.factKey.localeCompare(right.factKey))
    .map((draft) => ({
      factKey: draft.factKey,
      factKind: draft.factKind,
      sourceObservationRef: draft.sourceObservationRef,
      sourceDate: draft.sourceDate.toISOString(),
      query: draft.query,
      normalizedQuery: draft.normalizedQuery,
      queryNormalizationVersion: draft.queryNormalizationVersion,
      page: draft.page,
      canonicalPage: draft.canonicalPage,
      canonicalizationVersion: draft.canonicalizationVersion,
      metrics: [...draft.metrics]
        .sort((left, right) => left.metricSemantic.localeCompare(right.metricSemantic))
        .map((metric) => ({
          metricSemantic: metric.metricSemantic,
          numericValue: metric.numericValue,
          evidenceState: metric.evidenceState,
          sourceField: metric.sourceField
        }))
    }));

  const stableIdentity = {
    projectId: identity.projectId,
    provider: identity.provider,
    marketCode: identity.marketCode,
    locale: identity.locale,
    propertyRef: identity.propertyRef,
    propertyType: identity.propertyType,
    sourceKind: identity.sourceKind,
    sourceRef: identity.sourceRef,
    sourceCutoffAt: identity.sourceCutoffAt.toISOString(),
    sourceCompleteness: identity.sourceCompleteness,
    normalizationVersion: identity.normalizationVersion
  };

  return createHash('sha256')
    .update(JSON.stringify({ identity: stableIdentity, drafts: stableDrafts }), 'utf8')
    .digest('hex');
};

const sameUtcDay = (left: Date, right: Date): boolean =>
  left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);

export class SearchFactMaterializer {
  private readonly repository: SearchFactRepository;

  constructor(private readonly db: PrismaClient) {
    this.repository = new SearchFactRepository(db);
  }

  async materializeGoogleSnapshot(
    input: MaterializeGoogleSearchSnapshotInput
  ): Promise<SearchFactSnapshot> {
    const locale = assertLocale(input.locale);
    const normalizationVersion = assertVersion(input.normalizationVersion);
    const source = await this.db.gscDailySnapshot.findUnique({
      where: { id: input.snapshotId },
      include: {
        property: true,
        facts: { orderBy: { factKey: 'asc' } }
      }
    });

    if (!source) {
      throw new Error('SEARCH_FACT_SOURCE_NOT_FOUND');
    }
    if (source.status !== 'COMPLETED' || source.completedAt === null) {
      throw new Error('SEARCH_FACT_SOURCE_NOT_COMPLETED');
    }
    if (source.sourceFreshness === null || Number.isNaN(source.sourceFreshness.getTime())) {
      throw new Error('SEARCH_FACT_SOURCE_INVALID');
    }
    if (
      source.property.projectId !== source.projectId ||
      source.rowCount !== source.facts.length ||
      source.facts.some(
        (fact) => fact.projectId !== source.projectId || !sameUtcDay(fact.date, source.date)
      )
    ) {
      throw new Error('SEARCH_FACT_SOURCE_IDENTITY_MISMATCH');
    }

    const sourceCompleteness =
      source.sourceCompletenessState === 'TOP_ROWS_ONLY' ? 'TOP_ROWS_ONLY' : 'UNKNOWN';
    const identity: SearchFactMaterializeIdentity = {
      projectId: source.projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: input.marketCode,
      locale,
      propertyRef: source.property.propertyUri,
      propertyType: source.property.propertyType,
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: source.id,
      sourceCutoffAt: source.sourceFreshness,
      sourceCompleteness,
      normalizationVersion
    };
    const drafts = source.facts.map((fact) => normalizeGoogleSearchFact(fact));
    const inputHash = stableHash(identity, drafts);

    return this.repository.persistCompletedSnapshot(identity, drafts, inputHash);
  }

  async materializeBingBatch(
    input: MaterializeBingSearchBatchInput
  ): Promise<SearchFactSnapshot> {
    const normalizationVersion = assertVersion(input.normalizationVersion);
    const source = await this.db.searchProviderObservationBatch.findUnique({
      where: { id: input.batchId },
      include: {
        observations: {
          orderBy: [{ observationKind: 'asc' }, { observationKey: 'asc' }]
        }
      }
    });

    if (!source) {
      throw new Error('SEARCH_FACT_SOURCE_NOT_FOUND');
    }
    if (
      source.provider !== 'BING_WEBMASTER' ||
      source.sourceCompleteness !== 'PROVIDER_UNSPECIFIED' ||
      source.observationCount !== source.observations.length ||
      source.locale.trim().length === 0 ||
      source.propertyRef.trim().length === 0 ||
      source.propertyType.trim().length === 0 ||
      Number.isNaN(source.sourceCutoffAt.getTime()) ||
      source.observations.some(
        (observation) =>
          observation.batchId !== source.id ||
          observation.projectId !== source.projectId ||
          observation.completeness !== source.sourceCompleteness ||
          observation.sourceDate.getTime() > source.sourceCutoffAt.getTime()
      )
    ) {
      throw new Error('SEARCH_FACT_SOURCE_IDENTITY_MISMATCH');
    }

    const identity: SearchFactMaterializeIdentity = {
      projectId: source.projectId,
      provider: 'BING_WEBMASTER',
      marketCode: source.marketCode,
      locale: source.locale,
      propertyRef: source.propertyRef,
      propertyType: source.propertyType,
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: source.id,
      sourceCutoffAt: source.sourceCutoffAt,
      sourceCompleteness: source.sourceCompleteness,
      normalizationVersion
    };
    const drafts = source.observations.map((observation) =>
      normalizeBingSearchObservation(observation)
    );
    const inputHash = stableHash(identity, drafts);

    return this.repository.persistCompletedSnapshot(identity, drafts, inputHash);
  }
}
