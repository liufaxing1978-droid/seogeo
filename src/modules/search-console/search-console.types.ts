import type {
  GscDailySnapshotStatus,
  GscSourceCompletenessState,
  OAuthCredentialProvider,
  SearchConsoleConnectionStatus
} from '@prisma/client';

export const SEARCH_CONSOLE_OAUTH_PROVIDER = 'GOOGLE_SEARCH_CONSOLE' as const satisfies OAuthCredentialProvider;
export const GSC_QUERY_NORMALIZATION_VERSION = 'GSC_QUERY_NORMALIZATION_V1';

export type CreateCredentialRecordInput = {
  projectId: string;
  provider: OAuthCredentialProvider;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: string;
};

export type CreateSearchConsoleConnectionInput = {
  projectId: string;
  credentialRef: string;
  googleAccountRef?: string | null;
  status?: SearchConsoleConnectionStatus;
};

export type CreateSearchConsolePropertyInput = {
  projectId: string;
  connectionId: string;
  propertyUri: string;
  propertyType: string;
  permissionState: string;
  isActive?: boolean;
};

export type CreateGscDailySnapshotInput = {
  projectId: string;
  propertyId: string;
  date: Date;
  syncVersion: number;
  status?: GscDailySnapshotStatus;
  inputHash?: string | null;
  startedAt?: Date | null;
};

export type CompleteGscDailySnapshotInput = {
  rowCount: number;
  sourceCompletenessState: GscSourceCompletenessState;
  sourceFreshness?: Date | null;
  inputHash?: string | null;
  completedAt?: Date;
};

export type GscDailyFactInput = {
  projectId: string;
  date: Date;
  factKey: string;
  query: string;
  normalizedQuery: string;
  normalizationVersion: string;
  page: string;
  canonicalPage: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
