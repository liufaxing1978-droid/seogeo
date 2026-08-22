import { createHash } from 'node:crypto';
import type {
  MarketCode,
  Prisma,
  PrismaClient,
  SearchProviderObservationBatch,
  SearchProviderObservationRecord
} from '@prisma/client';
import type {
  BingPageObservation,
  BingQueryObservation,
  BingSiteTrafficObservation
} from '../search-providers/search-provider.types.js';

export const BING_SOURCE_SCHEMA_VERSION = 'BING_SEARCH_SOURCE_V1' as const;

type BingObservation =
  | BingQueryObservation
  | BingPageObservation
  | BingSiteTrafficObservation;

export type PersistBingObservationBatchInput = {
  projectId: string;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  propertyType: 'SITE';
  sourceCutoffAt: Date;
  observations: readonly BingObservation[];
};

export type PersistedProviderObservation = SearchProviderObservationRecord;

type PreparedObservation = {
  observation: BingObservation;
  sourceDate: Date;
  observationKey: string;
  inputHash: string;
  payloadJson: Prisma.InputJsonObject;
};

const hashUtf8 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const parseSourceDate = (value: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_DATE');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_DATE');
  }
  return parsed;
};

const assertSafeHttpUrl = (value: string, errorCode: string): void => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(errorCode);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error(errorCode);
  }
};

const assertFiniteNonNegative = (value: number, errorCode: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(errorCode);
  }
};

const assertObservation = (observation: BingObservation): void => {
  if (observation.provider !== 'BING_WEBMASTER') {
    throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_PROVIDER');
  }
  if (observation.completeness !== 'PROVIDER_UNSPECIFIED') {
    throw new Error('SEARCH_PROVIDER_SOURCE_MIXED_COMPLETENESS');
  }

  assertFiniteNonNegative(observation.clicks, 'SEARCH_PROVIDER_SOURCE_INVALID_METRIC');
  assertFiniteNonNegative(observation.impressions, 'SEARCH_PROVIDER_SOURCE_INVALID_METRIC');

  if (observation.kind === 'QUERY_STATS') {
    if (observation.query.trim().length === 0) {
      throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_OBSERVATION');
    }
    if (observation.avgClickPosition !== null) {
      assertFiniteNonNegative(
        observation.avgClickPosition,
        'SEARCH_PROVIDER_SOURCE_INVALID_METRIC'
      );
    }
    if (observation.avgImpressionPosition !== null) {
      assertFiniteNonNegative(
        observation.avgImpressionPosition,
        'SEARCH_PROVIDER_SOURCE_INVALID_METRIC'
      );
    }
    return;
  }

  if (observation.kind === 'PAGE_STATS') {
    assertSafeHttpUrl(observation.page, 'SEARCH_PROVIDER_SOURCE_INVALID_OBSERVATION');
    if (observation.avgClickPosition !== null) {
      assertFiniteNonNegative(
        observation.avgClickPosition,
        'SEARCH_PROVIDER_SOURCE_INVALID_METRIC'
      );
    }
    if (observation.avgImpressionPosition !== null) {
      assertFiniteNonNegative(
        observation.avgImpressionPosition,
        'SEARCH_PROVIDER_SOURCE_INVALID_METRIC'
      );
    }
  }
};

const serializeBingObservation = (
  observation: BingObservation
): Prisma.InputJsonObject => {
  switch (observation.kind) {
    case 'QUERY_STATS':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        query: observation.query,
        clicks: observation.clicks,
        impressions: observation.impressions,
        avgClickPosition: observation.avgClickPosition,
        avgImpressionPosition: observation.avgImpressionPosition,
        completeness: observation.completeness
      };
    case 'PAGE_STATS':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        page: observation.page,
        clicks: observation.clicks,
        impressions: observation.impressions,
        avgClickPosition: observation.avgClickPosition,
        avgImpressionPosition: observation.avgImpressionPosition,
        completeness: observation.completeness
      };
    case 'SITE_TRAFFIC_DAILY':
      return {
        kind: observation.kind,
        provider: observation.provider,
        sourceDate: observation.sourceDate,
        clicks: observation.clicks,
        impressions: observation.impressions,
        completeness: observation.completeness
      };
  }
};

const prepareObservations = (
  observations: readonly BingObservation[],
  sourceCutoffAt: Date
): PreparedObservation[] => {
  if (observations.length === 0) {
    throw new Error('SEARCH_PROVIDER_SOURCE_EMPTY_BATCH');
  }

  const prepared = observations.map((observation) => {
    assertObservation(observation);
    const sourceDate = parseSourceDate(observation.sourceDate);
    if (sourceDate.getTime() > sourceCutoffAt.getTime()) {
      throw new Error('SEARCH_PROVIDER_SOURCE_DATE_AFTER_CUTOFF');
    }
    const payloadJson = serializeBingObservation(observation);
    const stablePayload = JSON.stringify(payloadJson);
    const observationKey = hashUtf8(stablePayload);
    return {
      observation,
      sourceDate,
      observationKey,
      inputHash: observationKey,
      payloadJson
    };
  });

  prepared.sort((left, right) => {
    const kindOrder = left.observation.kind.localeCompare(right.observation.kind);
    return kindOrder !== 0 ? kindOrder : left.observationKey.localeCompare(right.observationKey);
  });

  const keys = new Set(prepared.map((item) => item.observationKey));
  if (keys.size !== prepared.length) {
    throw new Error('SEARCH_PROVIDER_SOURCE_DUPLICATE_OBSERVATION');
  }

  return prepared;
};

const buildBatchHash = (prepared: readonly PreparedObservation[]): string =>
  hashUtf8(
    JSON.stringify(
      prepared.map((item) => ({
        observationKind: item.observation.kind,
        observationKey: item.observationKey,
        inputHash: item.inputHash
      }))
    )
  );

export class SearchProviderSourceRepository {
  constructor(private readonly db: PrismaClient) {}

  async persistBingBatch(
    input: PersistBingObservationBatchInput
  ): Promise<SearchProviderObservationBatch> {
    if (input.projectId.trim().length === 0 || input.locale.trim().length === 0) {
      throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_IDENTITY');
    }
    if (Number.isNaN(input.sourceCutoffAt.getTime())) {
      throw new Error('SEARCH_PROVIDER_SOURCE_INVALID_CUTOFF');
    }
    assertSafeHttpUrl(input.propertyRef, 'SEARCH_PROVIDER_SOURCE_INVALID_PROPERTY');

    const prepared = prepareObservations(input.observations, input.sourceCutoffAt);
    const inputHash = buildBatchHash(prepared);

    return this.db.$transaction(async (tx) => {
      const existing = await tx.searchProviderObservationBatch.findFirst({
        where: {
          projectId: input.projectId,
          provider: 'BING_WEBMASTER',
          marketCode: input.marketCode,
          locale: input.locale,
          propertyRef: input.propertyRef,
          sourceCutoffAt: input.sourceCutoffAt,
          schemaVersion: BING_SOURCE_SCHEMA_VERSION,
          inputHash
        }
      });

      if (existing) {
        const storedCount = await tx.searchProviderObservationRecord.count({
          where: { batchId: existing.id }
        });
        if (
          existing.observationCount !== prepared.length ||
          storedCount !== existing.observationCount
        ) {
          throw new Error('SEARCH_PROVIDER_SOURCE_PERSISTENCE_CONFLICT');
        }
        return existing;
      }

      return tx.searchProviderObservationBatch.create({
        data: {
          projectId: input.projectId,
          provider: 'BING_WEBMASTER',
          marketCode: input.marketCode,
          locale: input.locale,
          propertyRef: input.propertyRef,
          propertyType: input.propertyType,
          sourceCutoffAt: input.sourceCutoffAt,
          sourceCompleteness: 'PROVIDER_UNSPECIFIED',
          schemaVersion: BING_SOURCE_SCHEMA_VERSION,
          inputHash,
          observationCount: prepared.length,
          observations: {
            create: prepared.map((item) => ({
              projectId: input.projectId,
              sourceDate: item.sourceDate,
              observationKind: item.observation.kind,
              observationKey: item.observationKey,
              completeness: 'PROVIDER_UNSPECIFIED',
              inputHash: item.inputHash,
              payloadJson: item.payloadJson
            }))
          }
        }
      });
    });
  }

  getBatch(batchId: string): Promise<SearchProviderObservationBatch | null> {
    return this.db.searchProviderObservationBatch.findUnique({ where: { id: batchId } });
  }

  listBatchObservations(batchId: string): Promise<PersistedProviderObservation[]> {
    return this.db.searchProviderObservationRecord.findMany({
      where: { batchId },
      orderBy: [{ observationKind: 'asc' }, { observationKey: 'asc' }]
    });
  }
}
