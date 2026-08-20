import { createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import { env } from '../../config/env.js';
import {
  GoogleSearchConsoleClient,
  GoogleSearchConsoleTransportError,
  type GoogleOAuthConfig,
  type GoogleSearchConsoleTransport,
  type SearchAnalyticsResponse
} from './google-search-console.client.js';
import {
  createOAuthCredentialVault,
  parseOAuthCredentialKey
} from './oauth-credential-vault.js';
import {
  SearchConsoleRepository,
  searchConsoleRepository
} from './search-console.repository.js';
import {
  SearchConsoleService,
  SearchConsoleServiceError
} from './search-console.service.js';
import {
  GSC_QUERY_NORMALIZATION_VERSION,
  type GscDailyFactInput
} from './search-console.types.js';
import {
  SearchConsoleObservability,
  searchConsoleObservability
} from './search-console.observability.js';

export const SEARCH_CONSOLE_SYNC_QUEUE_NAME = 'search-console-sync';
export const SEARCH_CONSOLE_SYNC_WORKER_CONCURRENCY = 2;
const GSC_DAILY_ROW_LIMIT = 25_000;
const GSC_DAILY_SYNC_VERSION = 'GSC_DAILY_SYNC_V1';

export type SearchConsoleSyncReason =
  | 'TOKEN_REVOKED'
  | 'PERMISSION_DENIED'
  | 'PROPERTY_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'PERSISTENCE_FAILED'
  | 'SYNC_NOT_CONFIGURED';

export class SearchConsoleSyncError extends Error {
  constructor(
    message: string,
    readonly reason: SearchConsoleSyncReason,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'SearchConsoleSyncError';
  }
}

export type SearchConsoleSyncInput = {
  projectId: string;
  propertyId: string;
  date: string;
};

export type SearchConsoleSyncJobData = SearchConsoleSyncInput;

export interface SearchConsoleSyncRepository {
  findPropertyForSync(projectId: string, propertyId: string): Promise<{
    id: string;
    projectId: string;
    connectionId: string;
    propertyUri: string;
    isActive: boolean;
  } | null>;
  findAuthoritativeDailySnapshot(projectId: string, propertyId: string, date: Date): Promise<{
    id: string;
    syncVersion: number;
    status: string;
  } | null>;
  nextDailySyncVersion(projectId: string, propertyId: string, date: Date): Promise<number>;
  createDailySnapshot(input: {
    projectId: string;
    propertyId: string;
    date: Date;
    syncVersion: number;
    status?: 'RUNNING';
    inputHash?: string | null;
    startedAt?: Date | null;
  }): Promise<{ id: string; syncVersion: number; status: string }>;
  replaceDailyFacts(snapshotId: string, facts: readonly GscDailyFactInput[]): Promise<void>;
  completeDailySnapshot(snapshotId: string, input: {
    rowCount: number;
    sourceCompletenessState: 'TOP_ROWS_ONLY';
    sourceFreshness?: Date | null;
    inputHash?: string | null;
    completedAt?: Date;
  }): Promise<{ id: string; syncVersion: number; status: string }>;
  failDailySnapshot(snapshotId: string, errorCode: string): Promise<{ id: string; syncVersion: number; status: string }>;
  updatePropertyLastSyncAt(propertyId: string, lastSyncAt: Date): Promise<void>;
}

export interface SearchConsoleAccessTokenProvider {
  getAccessToken(projectId: string): Promise<string>;
}

export type SearchConsoleSyncDependencies = {
  repository: SearchConsoleSyncRepository;
  transport: GoogleSearchConsoleTransport;
  accessTokenProvider: SearchConsoleAccessTokenProvider;
  observability: SearchConsoleObservability;
  now?: () => Date;
};

export type SearchConsoleSyncResult =
  | { state: 'COMPLETED'; snapshotId: string; syncVersion: number; rowCount: number }
  | { state: 'ALREADY_COMPLETED'; snapshotId: string; syncVersion: number; rowCount: 0 };

function parseSourceDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SearchConsoleSyncError('Search Console source date must use YYYY-MM-DD', 'INVALID_RESPONSE');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new SearchConsoleSyncError('Search Console source date is invalid', 'INVALID_RESPONSE');
  }
  return parsed;
}

function normalizeQuery(query: string): string {
  return query
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015]/g, '-')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function normalizePage(page: string): string {
  let url: URL;
  try {
    url = new URL(page);
  } catch {
    throw new SearchConsoleSyncError('Google Search Console returned an invalid page URL', 'INVALID_RESPONSE');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SearchConsoleSyncError('Google Search Console returned an unsupported page URL', 'INVALID_RESPONSE');
  }
  if (url.username || url.password) {
    throw new SearchConsoleSyncError('Google Search Console returned a credential-bearing page URL', 'INVALID_RESPONSE');
  }
  url.hash = '';
  return url.toString();
}

function factKey(query: string, page: string): string {
  return createHash('sha256').update(`${query}\u0000${page}`).digest('hex');
}

function inputHash(input: SearchConsoleSyncInput): string {
  return createHash('sha256')
    .update(`${GSC_DAILY_SYNC_VERSION}\u0000${input.projectId}\u0000${input.propertyId}\u0000${input.date}\u0000query,page\u0000${GSC_DAILY_ROW_LIMIT}`)
    .digest('hex');
}

function assertMetric(value: number, name: string, options: { integer?: boolean; max?: number } = {}): void {
  if (!Number.isFinite(value) || value < 0 || (options.integer && !Number.isInteger(value)) || (options.max !== undefined && value > options.max)) {
    throw new SearchConsoleSyncError(`Google Search Console returned invalid ${name}`, 'INVALID_RESPONSE');
  }
}

function normalizeRows(response: SearchAnalyticsResponse, projectId: string, date: Date): GscDailyFactInput[] {
  const rows = response.rows ?? [];
  if (rows.length > GSC_DAILY_ROW_LIMIT) {
    throw new SearchConsoleSyncError('Google Search Console exceeded the daily Query+Page row bound', 'INVALID_RESPONSE');
  }

  const seen = new Set<string>();
  return rows.map((row) => {
    if (row.keys.length !== 2 || typeof row.keys[0] !== 'string' || typeof row.keys[1] !== 'string') {
      throw new SearchConsoleSyncError('Google Search Console Query+Page row keys are invalid', 'INVALID_RESPONSE');
    }
    const [query, page] = row.keys;
    if (!query || !page) {
      throw new SearchConsoleSyncError('Google Search Console Query+Page row keys are empty', 'INVALID_RESPONSE');
    }
    assertMetric(row.clicks, 'clicks', { integer: true });
    assertMetric(row.impressions, 'impressions', { integer: true });
    assertMetric(row.ctr, 'ctr', { max: 1 });
    assertMetric(row.position, 'position');

    const key = factKey(query, page);
    if (seen.has(key)) {
      throw new SearchConsoleSyncError('Google Search Console returned duplicate Query+Page rows', 'INVALID_RESPONSE');
    }
    seen.add(key);

    return {
      projectId,
      date,
      factKey: key,
      query,
      normalizedQuery: normalizeQuery(query),
      normalizationVersion: GSC_QUERY_NORMALIZATION_VERSION,
      page,
      canonicalPage: normalizePage(page),
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    };
  });
}

function providerReason(error: GoogleSearchConsoleTransportError): SearchConsoleSyncReason {
  if (error.httpStatus === 401) return 'TOKEN_REVOKED';
  if (error.httpStatus === 403) return 'PERMISSION_DENIED';
  if (error.httpStatus === 404) return 'PROPERTY_UNAVAILABLE';
  if (error.httpStatus === 429) return 'RATE_LIMITED';
  if (error.httpStatus !== null && error.httpStatus >= 500) return 'TRANSIENT_PROVIDER_ERROR';
  if (/INVALID/i.test(error.code)) return 'INVALID_RESPONSE';
  return 'TRANSIENT_PROVIDER_ERROR';
}

function classifyError(error: unknown, persistenceStage: boolean): SearchConsoleSyncReason {
  if (error instanceof SearchConsoleSyncError) return error.reason;
  if (persistenceStage) return 'PERSISTENCE_FAILED';
  if (error instanceof GoogleSearchConsoleTransportError) return providerReason(error);
  if (error instanceof SearchConsoleServiceError) {
    if (error.code === 'SEARCH_CONSOLE_NOT_CONNECTED' || error.code === 'OAUTH_CREDENTIAL_INVALID') return 'TOKEN_REVOKED';
    if (error.code === 'PROJECT_NOT_FOUND') return 'PROPERTY_UNAVAILABLE';
  }
  return 'TRANSIENT_PROVIDER_ERROR';
}

function elapsedMs(startedAt: Date, endedAt: Date): number {
  return Math.max(0, endedAt.getTime() - startedAt.getTime());
}

export async function syncSearchConsoleDay(
  input: SearchConsoleSyncInput,
  dependencies: SearchConsoleSyncDependencies
): Promise<SearchConsoleSyncResult> {
  const now = dependencies.now ?? (() => new Date());
  const operationStartedAt = now();
  const sourceDate = parseSourceDate(input.date);

  const property = await dependencies.repository.findPropertyForSync(input.projectId, input.propertyId);
  if (!property) {
    const error = new SearchConsoleSyncError('Search Console property is unavailable for synchronization', 'PROPERTY_UNAVAILABLE');
    dependencies.observability.emit({
      event: 'gsc.sync.failed',
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: input.date,
      state: 'FAILED',
      reason: error.reason,
      durationMs: elapsedMs(operationStartedAt, now())
    });
    throw error;
  }

  const existing = await dependencies.repository.findAuthoritativeDailySnapshot(
    input.projectId,
    input.propertyId,
    sourceDate
  );
  if (existing) {
    return {
      state: 'ALREADY_COMPLETED',
      snapshotId: existing.id,
      syncVersion: existing.syncVersion,
      rowCount: 0
    };
  }

  let snapshot: { id: string; syncVersion: number; status: string };
  const hash = inputHash(input);
  try {
    const syncVersion = await dependencies.repository.nextDailySyncVersion(input.projectId, input.propertyId, sourceDate);
    snapshot = await dependencies.repository.createDailySnapshot({
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: sourceDate,
      syncVersion,
      status: 'RUNNING',
      inputHash: hash,
      startedAt: operationStartedAt
    });
  } catch (error) {
    const wrapped = new SearchConsoleSyncError('Failed to create Search Console daily snapshot', 'PERSISTENCE_FAILED', { cause: error });
    dependencies.observability.emit({
      event: 'gsc.sync.failed',
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: input.date,
      state: 'FAILED',
      reason: wrapped.reason,
      durationMs: elapsedMs(operationStartedAt, now())
    });
    throw wrapped;
  }

  dependencies.observability.emit({
    event: 'gsc.sync.started',
    projectId: input.projectId,
    propertyId: input.propertyId,
    date: input.date,
    state: 'RUNNING'
  });

  let persistenceStage = false;
  try {
    const accessToken = await dependencies.accessTokenProvider.getAccessToken(input.projectId);
    const response = await dependencies.transport.querySearchAnalytics(
      accessToken,
      property.propertyUri,
      {
        startDate: input.date,
        endDate: input.date,
        dimensions: ['query', 'page'],
        rowLimit: GSC_DAILY_ROW_LIMIT,
        startRow: 0
      }
    );
    const facts = normalizeRows(response, input.projectId, sourceDate);

    persistenceStage = true;
    await dependencies.repository.replaceDailyFacts(snapshot.id, facts);
    const completedAt = now();
    await dependencies.repository.completeDailySnapshot(snapshot.id, {
      rowCount: facts.length,
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      sourceFreshness: sourceDate,
      inputHash: hash,
      completedAt
    });
    await dependencies.repository.updatePropertyLastSyncAt(input.propertyId, completedAt).catch(() => undefined);

    dependencies.observability.emit({
      event: 'gsc.sync.completed',
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: input.date,
      rowCount: facts.length,
      state: 'COMPLETED',
      durationMs: elapsedMs(operationStartedAt, completedAt)
    });
    return {
      state: 'COMPLETED',
      snapshotId: snapshot.id,
      syncVersion: snapshot.syncVersion,
      rowCount: facts.length
    };
  } catch (error) {
    const reason = classifyError(error, persistenceStage);
    await dependencies.repository.failDailySnapshot(snapshot.id, reason).catch(() => undefined);
    const endedAt = now();
    dependencies.observability.emit({
      event: 'gsc.sync.failed',
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: input.date,
      state: 'FAILED',
      reason,
      durationMs: elapsedMs(operationStartedAt, endedAt)
    });
    if (error instanceof SearchConsoleSyncError && error.reason === reason) throw error;
    throw new SearchConsoleSyncError(`Search Console daily synchronization failed: ${reason}`, reason, { cause: error });
  }
}

let configuredDependencies: SearchConsoleSyncDependencies | null = null;

function defaultDependencies(): SearchConsoleSyncDependencies {
  if (configuredDependencies) return configuredDependencies;
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = env.GOOGLE_OAUTH_REDIRECT_URI;
  const encryptionKey = env.OAUTH_CREDENTIAL_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    throw new SearchConsoleSyncError('Google Search Console synchronization is not configured', 'SYNC_NOT_CONFIGURED');
  }

  const repository: SearchConsoleRepository = searchConsoleRepository;
  const oauthConfig: GoogleOAuthConfig = { clientId, clientSecret, redirectUri };
  const transport = new GoogleSearchConsoleClient(oauthConfig);
  const vault = createOAuthCredentialVault({
    key: parseOAuthCredentialKey(encryptionKey),
    keyVersion: env.OAUTH_CREDENTIAL_KEY_VERSION,
    store: repository
  });
  const service = new SearchConsoleService({ repository, vault, transport, oauthConfig });
  configuredDependencies = {
    repository,
    transport,
    accessTokenProvider: {
      getAccessToken: (projectId) => service.getAccessTokenForSync(projectId)
    },
    observability: searchConsoleObservability
  };
  return configuredDependencies;
}

export async function processSearchConsoleSyncJob(job: Job<SearchConsoleSyncJobData>): Promise<void> {
  const data = job.data;
  if (!data?.projectId || !data.propertyId || !data.date) {
    throw new SearchConsoleSyncError('Search Console sync job data is invalid', 'INVALID_RESPONSE');
  }
  await syncSearchConsoleDay(data, defaultDependencies());
}
