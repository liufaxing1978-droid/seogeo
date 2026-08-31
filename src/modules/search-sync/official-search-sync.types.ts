import type {
  MarketCode,
  SearchFactSnapshot,
  SearchProviderLaneBinding,
  SearchProviderObservationBatch,
} from '@prisma/client';
import type {
  MaterializeBingSearchBatchInput,
  MaterializeGoogleSearchSnapshotInput,
} from '../search-facts/search-fact.materializer.js';
import type { PersistBingObservationBatchInput } from '../search-facts/search-provider-source.repository.js';
import type {
  SearchConsoleSyncDependencies,
  SearchConsoleSyncInput,
  SearchConsoleSyncResult,
} from '../search-console/search-console.worker.js';
import type {
  BingQueryObservation,
  SearchProviderProperty,
} from '../search-providers/search-provider.types.js';

export type OfficialSearchBindingProvider =
  | 'GOOGLE_SEARCH_CONSOLE'
  | 'BING_WEBMASTER';

export type CreateSearchProviderLaneBindingInput = {
  projectId: string;
  provider: OfficialSearchBindingProvider;
  propertyRef: string;
  marketCode: MarketCode;
  locale: string;
};

export type SearchProviderLaneBindingIdentity = CreateSearchProviderLaneBindingInput;

export type OfficialSearchBindingRepositoryPort = {
  listBindings(projectId: string): Promise<SearchProviderLaneBinding[]>;
  findBinding(projectId: string, bindingId: string): Promise<SearchProviderLaneBinding | null>;
  findBindingByIdentity(
    input: SearchProviderLaneBindingIdentity,
  ): Promise<SearchProviderLaneBinding | null>;
  createBinding(
    input: CreateSearchProviderLaneBindingInput,
  ): Promise<SearchProviderLaneBinding>;
  setBindingActive(
    projectId: string,
    bindingId: string,
    isActive: boolean,
  ): Promise<SearchProviderLaneBinding | null>;
};

export type OfficialSearchSyncCommand = {
  projectId: string;
  bindingId: string;
  dateFrom: string;
  dateTo: string;
};

export type OfficialSearchSyncState =
  | 'COMPLETED'
  | 'ALREADY_COMPLETED'
  | 'UNAVAILABLE'
  | 'FAILED';

export type OfficialSearchSyncDiscoveryState =
  | 'REFRESHED'
  | 'DISCOVERY_REFRESH_FAILED'
  | 'NOT_RUN';

export type OfficialSearchSyncFailureReason =
  | 'SYNC_NOT_CONFIGURED'
  | 'BINDING_NOT_FOUND'
  | 'BINDING_INACTIVE'
  | 'PROPERTY_UNAVAILABLE'
  | 'TOKEN_REVOKED'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'PERSISTENCE_FAILED'
  | 'MATERIALIZATION_FAILED'
  | 'DISCOVERY_REFRESH_FAILED';

export type OfficialSearchSyncOutcome = {
  provider: OfficialSearchBindingProvider | null;
  state: OfficialSearchSyncState;
  dateFrom: string;
  dateTo: string;
  sourceRefs: string[];
  searchFactSnapshotIds: string[];
  discoveryState: OfficialSearchSyncDiscoveryState;
  reason: OfficialSearchSyncFailureReason | null;
};

export type GoogleDailySyncPort = (
  input: SearchConsoleSyncInput,
  dependencies: SearchConsoleSyncDependencies,
) => Promise<SearchConsoleSyncResult>;

export interface BingSearchProviderPort {
  listProperties(): Promise<SearchProviderProperty[]>;
  fetchQueryStats(siteUrl: string): Promise<BingQueryObservation[]>;
}

export interface BingSourcePersistencePort {
  persistBingBatch(
    input: PersistBingObservationBatchInput,
  ): Promise<SearchProviderObservationBatch>;
}

export type SearchFactMaterializePort = {
  materializeGoogleSnapshot(
    input: MaterializeGoogleSearchSnapshotInput,
  ): Promise<SearchFactSnapshot>;
  materializeBingBatch(
    input: MaterializeBingSearchBatchInput,
  ): Promise<SearchFactSnapshot>;
};

export type GoogleSearchPropertyRepositoryPort = {
  findActiveConnection(projectId: string): Promise<{ id: string } | null>;
  listProperties(
    projectId: string,
    connectionId: string,
  ): Promise<Array<{
    id: string;
    projectId: string;
    propertyUri: string;
    isActive: boolean;
  }>>;
};
