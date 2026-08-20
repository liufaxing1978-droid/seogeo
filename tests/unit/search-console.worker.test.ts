import { describe, expect, it } from 'vitest';
import {
  GoogleSearchConsoleTransportError,
  type GoogleSearchConsoleTransport,
  type GoogleTokenPayload,
  type SearchAnalyticsRequest,
  type SearchAnalyticsResponse
} from '../../src/modules/search-console/google-search-console.client.js';
import {
  SearchConsoleSyncError,
  syncSearchConsoleDay,
  type SearchConsoleSyncDependencies,
  type SearchConsoleSyncInput,
  type SearchConsoleSyncRepository
} from '../../src/modules/search-console/search-console.worker.js';
import {
  SearchConsoleObservability,
  type SearchConsoleObservabilityEvent
} from '../../src/modules/search-console/search-console.observability.js';

const PROJECT_ID = '00000000-0000-0000-0000-000000000101';
const PROPERTY_ID = '00000000-0000-0000-0000-000000000102';
const CONNECTION_ID = '00000000-0000-0000-0000-000000000103';
const DATE = '2026-08-10';

class MemorySyncRepository implements SearchConsoleSyncRepository {
  snapshots: Array<{
    id: string;
    projectId: string;
    propertyId: string;
    date: Date;
    syncVersion: number;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    errorCode: string | null;
  }> = [];
  facts = new Map<string, Array<Record<string, unknown>>>();
  lastSyncAt: Date | null = null;
  failReplace = false;
  sequence = 0;

  async findPropertyForSync(projectId: string, propertyId: string) {
    if (projectId !== PROJECT_ID || propertyId !== PROPERTY_ID) return null;
    return {
      id: PROPERTY_ID,
      projectId: PROJECT_ID,
      connectionId: CONNECTION_ID,
      propertyUri: 'sc-domain:example.com',
      isActive: true
    };
  }

  async findAuthoritativeDailySnapshot(projectId: string, propertyId: string, date: Date) {
    return this.snapshots
      .filter((row) => row.projectId === projectId && row.propertyId === propertyId && sameDate(row.date, date) && row.status === 'COMPLETED')
      .sort((a, b) => b.syncVersion - a.syncVersion)[0] ?? null;
  }

  async nextDailySyncVersion(projectId: string, propertyId: string, date: Date) {
    const versions = this.snapshots
      .filter((row) => row.projectId === projectId && row.propertyId === propertyId && sameDate(row.date, date))
      .map((row) => row.syncVersion);
    return (versions.length ? Math.max(...versions) : 0) + 1;
  }

  async createDailySnapshot(input: { projectId: string; propertyId: string; date: Date; syncVersion: number; status?: 'RUNNING'; inputHash?: string | null; startedAt?: Date | null }) {
    const row = {
      id: `snapshot-${++this.sequence}`,
      projectId: input.projectId,
      propertyId: input.propertyId,
      date: input.date,
      syncVersion: input.syncVersion,
      status: 'RUNNING' as const,
      errorCode: null
    };
    this.snapshots.push(row);
    return row as never;
  }

  async replaceDailyFacts(snapshotId: string, facts: readonly Record<string, unknown>[]) {
    if (this.failReplace) throw new Error('fixture persistence failure');
    this.facts.set(snapshotId, facts.map((row) => ({ ...row })));
  }

  async completeDailySnapshot(snapshotId: string, input: { rowCount: number; sourceCompletenessState: 'TOP_ROWS_ONLY'; sourceFreshness?: Date | null; inputHash?: string | null; completedAt?: Date }) {
    const row = this.snapshots.find((item) => item.id === snapshotId)!;
    row.status = 'COMPLETED';
    row.errorCode = null;
    return row as never;
  }

  async failDailySnapshot(snapshotId: string, errorCode: string) {
    const row = this.snapshots.find((item) => item.id === snapshotId)!;
    row.status = 'FAILED';
    row.errorCode = errorCode;
    return row as never;
  }

  async updatePropertyLastSyncAt(_propertyId: string, lastSyncAt: Date) {
    this.lastSyncAt = lastSyncAt;
  }
}

function sameDate(a: Date, b: Date) {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

class FakeTransport implements GoogleSearchConsoleTransport {
  queryCalls = 0;
  lastRequest: SearchAnalyticsRequest | null = null;
  lastSiteUrl: string | null = null;
  response: SearchAnalyticsResponse = {
    rows: [
      {
        keys: ['  六壬   SEO  ', 'https://EXAMPLE.com:443/liuren#section'],
        clicks: 4,
        impressions: 100,
        ctr: 0.04,
        position: 8.2
      }
    ]
  };
  error: Error | null = null;

  async exchangeCode(): Promise<GoogleTokenPayload> { throw new Error('not used'); }
  async refreshToken(): Promise<GoogleTokenPayload> { throw new Error('not used'); }
  async listSites() { return []; }
  async querySearchAnalytics(_accessToken: string, siteUrl: string, request: SearchAnalyticsRequest) {
    this.queryCalls += 1;
    this.lastSiteUrl = siteUrl;
    this.lastRequest = request;
    if (this.error) throw this.error;
    return this.response;
  }
}

function makeDependencies(overrides: Partial<SearchConsoleSyncDependencies> = {}) {
  const repository = new MemorySyncRepository();
  const transport = new FakeTransport();
  const events: SearchConsoleObservabilityEvent[] = [];
  const observability = new SearchConsoleObservability((event) => events.push(event));
  const deps: SearchConsoleSyncDependencies = {
    repository,
    transport,
    accessTokenProvider: { getAccessToken: async () => 'access-secret-never-log' },
    observability,
    now: () => new Date('2026-08-20T00:00:00.000Z'),
    ...overrides
  };
  return { deps, repository, transport, events };
}

const input: SearchConsoleSyncInput = { projectId: PROJECT_ID, propertyId: PROPERTY_ID, date: DATE };

describe('P7-A Search Console daily sync worker', () => {
  it('requests exactly one Query+Page source day and persists deterministic normalized facts', async () => {
    const { deps, repository, transport } = makeDependencies();

    const result = await syncSearchConsoleDay(input, deps);

    expect(transport.lastSiteUrl).toBe('sc-domain:example.com');
    expect(transport.lastRequest).toEqual({
      startDate: DATE,
      endDate: DATE,
      dimensions: ['query', 'page'],
      rowLimit: 25_000,
      startRow: 0
    });
    expect(result).toMatchObject({ state: 'COMPLETED', rowCount: 1, syncVersion: 1 });
    const snapshot = repository.snapshots[0];
    expect(snapshot.status).toBe('COMPLETED');
    const facts = repository.facts.get(snapshot.id)!;
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      query: '  六壬   SEO  ',
      normalizedQuery: '六壬 seo',
      normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://EXAMPLE.com:443/liuren#section',
      canonicalPage: 'https://example.com/liuren',
      clicks: 4,
      impressions: 100,
      ctr: 0.04,
      position: 8.2
    });
    expect(repository.lastSyncAt?.toISOString()).toBe('2026-08-20T00:00:00.000Z');
  });

  it('is idempotent once a COMPLETED version exists and does not call Google twice', async () => {
    const { deps, repository, transport } = makeDependencies();

    const first = await syncSearchConsoleDay(input, deps);
    const second = await syncSearchConsoleDay(input, deps);

    expect(first.state).toBe('COMPLETED');
    expect(second).toMatchObject({ state: 'ALREADY_COMPLETED', syncVersion: 1 });
    expect(transport.queryCalls).toBe(1);
    expect(repository.snapshots.filter((row) => row.status === 'COMPLETED')).toHaveLength(1);
  });

  it.each([
    [401, 'TOKEN_REVOKED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'PROPERTY_UNAVAILABLE'],
    [429, 'RATE_LIMITED'],
    [503, 'TRANSIENT_PROVIDER_ERROR']
  ] as const)('maps Google HTTP %s to %s and persists a FAILED source version', async (status, reason) => {
    const { deps, repository, transport } = makeDependencies();
    transport.error = new GoogleSearchConsoleTransportError('fixture provider failure', 'FIXTURE', status);

    await expect(syncSearchConsoleDay(input, deps)).rejects.toMatchObject({ reason });

    expect(repository.snapshots).toHaveLength(1);
    expect(repository.snapshots[0]).toMatchObject({ status: 'FAILED', errorCode: reason });
  });

  it('classifies invalid provider rows as INVALID_RESPONSE and never truncates above the hard bound', async () => {
    const { deps, repository, transport } = makeDependencies();
    transport.response = {
      rows: Array.from({ length: 25_001 }, (_, index) => ({
        keys: [`query-${index}`, `https://example.com/${index}`],
        clicks: 0,
        impressions: 1,
        ctr: 0,
        position: 50
      }))
    };

    await expect(syncSearchConsoleDay(input, deps)).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
    expect(repository.snapshots[0]).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_RESPONSE' });
    expect(repository.facts.size).toBe(0);
  });

  it('classifies durable-write failures as PERSISTENCE_FAILED and does not mark the day COMPLETED', async () => {
    const { deps, repository } = makeDependencies();
    repository.failReplace = true;

    await expect(syncSearchConsoleDay(input, deps)).rejects.toMatchObject({ reason: 'PERSISTENCE_FAILED' });
    expect(repository.snapshots[0]).toMatchObject({ status: 'FAILED', errorCode: 'PERSISTENCE_FAILED' });
  });

  it('emits only allowlisted safe sync observability metadata', async () => {
    const { deps, events } = makeDependencies();

    await syncSearchConsoleDay(input, deps);

    expect(events.map((event) => event.event)).toEqual(['gsc.sync.started', 'gsc.sync.completed']);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('access-secret-never-log');
    expect(serialized).not.toContain('六壬');
    expect(serialized).not.toContain('example.com/liuren');
    expect(events[1]).toMatchObject({
      projectId: PROJECT_ID,
      propertyId: PROPERTY_ID,
      date: DATE,
      rowCount: 1,
      state: 'COMPLETED'
    });
  });

  it('uses a stable typed error for missing/inactive properties', async () => {
    const { deps } = makeDependencies({
      repository: {
        ...new MemorySyncRepository(),
        findPropertyForSync: async () => null
      } as SearchConsoleSyncRepository
    });

    await expect(syncSearchConsoleDay(input, deps)).rejects.toBeInstanceOf(SearchConsoleSyncError);
    await expect(syncSearchConsoleDay(input, deps)).rejects.toMatchObject({ reason: 'PROPERTY_UNAVAILABLE' });
  });
});
