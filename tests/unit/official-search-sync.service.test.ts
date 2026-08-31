import { describe, expect, it, vi } from 'vitest';
import { SearchConsoleSyncError } from '../../src/modules/search-console/search-console.worker.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import type {
  BingQueryObservation,
  SearchProviderProperty,
} from '../../src/modules/search-providers/search-provider.types.js';
import { OfficialSearchSyncService } from '../../src/modules/search-sync/official-search-sync.service.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const PROPERTY_REF = 'sc-domain:xingshantang.org';
const BING_PROPERTY_REF = 'https://xingshantang.org/';
const NOW = new Date('2026-08-30T12:00:00.000Z');

function googleBinding(overrides: Record<string, unknown> = {}) {
  return {
    id: BINDING_ID,
    projectId: PROJECT_ID,
    provider: 'GOOGLE_SEARCH_CONSOLE' as const,
    propertyRef: PROPERTY_REF,
    marketCode: 'HK' as const,
    locale: 'zh-Hant',
    isActive: true,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    ...overrides,
  };
}

function googleProperty(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPERTY_ID,
    projectId: PROJECT_ID,
    connectionId: CONNECTION_ID,
    propertyUri: PROPERTY_REF,
    propertyType: 'DOMAIN',
    permissionState: 'siteOwner',
    isActive: true,
    lastSyncAt: null,
    createdAt: new Date('2026-08-30T00:00:00.000Z'),
    updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness(overrides: {
  binding?: ReturnType<typeof googleBinding> | null;
  properties?: ReturnType<typeof googleProperty>[];
  googleDailySync?: ReturnType<typeof vi.fn>;
  materializeGoogleSnapshot?: ReturnType<typeof vi.fn>;
  bingProperties?: SearchProviderProperty[];
  bingQueryStats?: BingQueryObservation[];
  persistBingBatch?: ReturnType<typeof vi.fn>;
  materializeBingBatch?: ReturnType<typeof vi.fn>;
} = {}) {
  const bindingRepository = {
    findBinding: vi.fn().mockResolvedValue(
      overrides.binding === undefined ? googleBinding() : overrides.binding,
    ),
  };
  const googlePropertyRepository = {
    findActiveConnection: vi.fn().mockResolvedValue({
      id: CONNECTION_ID,
      projectId: PROJECT_ID,
      credentialRef: 'vault-ref-is-not-a-lane-binding-field',
      googleAccountRef: null,
      status: 'CONNECTED',
      connectedAt: new Date('2026-08-30T00:00:00.000Z'),
      revokedAt: null,
      lastVerifiedAt: null,
      createdAt: new Date('2026-08-30T00:00:00.000Z'),
      updatedAt: new Date('2026-08-30T00:00:00.000Z'),
    }),
    listProperties: vi.fn().mockResolvedValue(
      overrides.properties ?? [googleProperty()],
    ),
  };
  const googleDailySync = overrides.googleDailySync ?? vi.fn(async ({ date }: { date: string }) => ({
    state: 'COMPLETED' as const,
    snapshotId: `gsc-${date}`,
    syncVersion: 1,
    rowCount: 1,
  }));
  const materializeGoogleSnapshot = overrides.materializeGoogleSnapshot ?? vi.fn(async ({ snapshotId }: { snapshotId: string }) => ({
    id: `search-fact-${snapshotId}`,
  }));
  const bingProvider = {
    listProperties: vi.fn().mockResolvedValue(
      overrides.bingProperties ?? [{
        provider: 'BING_WEBMASTER' as const,
        propertyRef: BING_PROPERTY_REF,
        propertyType: 'SITE' as const,
        permissionState: 'VERIFIED',
        verified: true,
      }],
    ),
    fetchQueryStats: vi.fn().mockResolvedValue(overrides.bingQueryStats ?? []),
  };
  const persistBingBatch = overrides.persistBingBatch ?? vi.fn(async () => ({
    id: 'bing-batch-1',
  } as never));
  const bingSourcePersistence = { persistBingBatch };
  const materializeBingBatch = overrides.materializeBingBatch ?? vi.fn(async () => ({
    id: 'search-fact-bing-batch-1',
  } as never));
  const materializer = {
    materializeGoogleSnapshot,
    materializeBingBatch,
  };
  const observability = { emit: vi.fn() };
  const googleDependencies = { opaque: true } as never;

  const dependencies = {
    bindingRepository,
    googlePropertyRepository,
    googleDailySync,
    googleDependencies,
    bingProvider,
    bingSourcePersistence,
    materializer,
    observability,
    now: () => NOW,
  };
  const service = new OfficialSearchSyncService(dependencies);

  return {
    service,
    bindingRepository,
    googlePropertyRepository,
    googleDailySync,
    materializeGoogleSnapshot,
    bingProvider,
    persistBingBatch,
    bingSourcePersistence,
    materializeBingBatch,
    materializer,
    observability,
    googleDependencies,
  };
}

describe('OfficialSearchSyncService Google orchestration', () => {
  it.each([
    ['bad format', { dateFrom: '2026-8-01', dateTo: '2026-08-01' }],
    ['impossible date', { dateFrom: '2026-02-30', dateTo: '2026-03-01' }],
    ['reversed range', { dateFrom: '2026-08-20', dateTo: '2026-08-19' }],
    ['over 31 days', { dateFrom: '2026-07-01', dateTo: '2026-08-01' }],
    ['future date', { dateFrom: '2026-08-30', dateTo: '2026-08-31' }],
  ])('rejects %s before binding/provider work', async (_label, dates) => {
    const harness = createHarness();

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      ...dates,
    })).rejects.toMatchObject({
      code: 'OFFICIAL_SEARCH_SYNC_RANGE_INVALID',
    });

    expect(harness.bindingRepository.findBinding).not.toHaveBeenCalled();
    expect(harness.googleDailySync).not.toHaveBeenCalled();
  });

  it('fails closed when binding is missing or inactive', async () => {
    const missing = createHarness({ binding: null });
    await expect(missing.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'BINDING_NOT_FOUND',
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });

    const inactive = createHarness({ binding: googleBinding({ isActive: false }) });
    await expect(inactive.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      state: 'UNAVAILABLE',
      reason: 'BINDING_INACTIVE',
    });

    expect(missing.googleDailySync).not.toHaveBeenCalled();
    expect(inactive.googleDailySync).not.toHaveBeenCalled();
  });

  it('orchestrates one bounded Bing query batch through existing source persistence and SearchFact materialization', async () => {
    const bingQueryStats: BingQueryObservation[] = [
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-29',
        query: 'zeta',
        clicks: 2,
        impressions: 20,
        avgClickPosition: 3,
        avgImpressionPosition: 5,
        completeness: 'PROVIDER_UNSPECIFIED',
      },
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-27',
        query: 'outside',
        clicks: 99,
        impressions: 999,
        avgClickPosition: 1,
        avgImpressionPosition: 1,
        completeness: 'PROVIDER_UNSPECIFIED',
      },
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-28',
        query: 'beta',
        clicks: 1,
        impressions: 10,
        avgClickPosition: null,
        avgImpressionPosition: 8,
        completeness: 'PROVIDER_UNSPECIFIED',
      },
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-28',
        query: 'alpha',
        clicks: 0,
        impressions: 4,
        avgClickPosition: null,
        avgImpressionPosition: 10,
        completeness: 'PROVIDER_UNSPECIFIED',
      },
    ];
    const harness = createHarness({
      binding: googleBinding({
        provider: 'BING_WEBMASTER',
        propertyRef: BING_PROPERTY_REF,
      }),
      bingQueryStats,
    });

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({
      provider: 'BING_WEBMASTER',
      state: 'COMPLETED',
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
      sourceRefs: ['bing-batch-1'],
      searchFactSnapshotIds: ['search-fact-bing-batch-1'],
      discoveryState: 'NOT_RUN',
      reason: null,
    });

    expect(harness.bingProvider.listProperties).toHaveBeenCalledTimes(1);
    expect(harness.bingProvider.fetchQueryStats).toHaveBeenCalledTimes(1);
    expect(harness.bingProvider.fetchQueryStats).toHaveBeenCalledWith(BING_PROPERTY_REF);
    expect(harness.persistBingBatch).toHaveBeenCalledTimes(1);
    const persistInput = harness.persistBingBatch.mock.calls[0]?.[0];
    expect(persistInput).toMatchObject({
      projectId: PROJECT_ID,
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: BING_PROPERTY_REF,
      propertyType: 'SITE',
      sourceCutoffAt: new Date('2026-08-29T00:00:00.000Z'),
    });
    expect(persistInput?.observations).toEqual([
      bingQueryStats[3],
      bingQueryStats[2],
      bingQueryStats[0],
    ]);
    expect(harness.materializeBingBatch).toHaveBeenCalledOnce();
    expect(harness.materializeBingBatch).toHaveBeenCalledWith({
      batchId: 'bing-batch-1',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    });
    expect(harness.googlePropertyRepository.findActiveConnection).not.toHaveBeenCalled();
    expect(harness.googleDailySync).not.toHaveBeenCalled();
  });

  it('requires binding propertyRef to resolve to an active project-owned Search Console property', async () => {
    const harness = createHarness({
      properties: [googleProperty({ propertyUri: 'sc-domain:other.example' })],
    });

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'UNAVAILABLE',
      reason: 'PROPERTY_UNAVAILABLE',
    });

    expect(harness.googlePropertyRepository.findActiveConnection).toHaveBeenCalledWith(PROJECT_ID);
    expect(harness.googlePropertyRepository.listProperties).toHaveBeenCalledWith(PROJECT_ID, CONNECTION_ID);
    expect(harness.googleDailySync).not.toHaveBeenCalled();
  });

  it('syncs each UTC day and materializes SearchFact using binding market/locale', async () => {
    const harness = createHarness();

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toEqual({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'COMPLETED',
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
      sourceRefs: ['gsc-2026-08-28', 'gsc-2026-08-29'],
      searchFactSnapshotIds: [
        'search-fact-gsc-2026-08-28',
        'search-fact-gsc-2026-08-29',
      ],
      discoveryState: 'NOT_RUN',
      reason: null,
    });

    expect(harness.googleDailySync).toHaveBeenCalledTimes(2);
    expect(harness.googleDailySync).toHaveBeenNthCalledWith(1, {
      projectId: PROJECT_ID,
      propertyId: PROPERTY_ID,
      date: '2026-08-28',
    }, harness.googleDependencies);
    expect(harness.googleDailySync).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT_ID,
      propertyId: PROPERTY_ID,
      date: '2026-08-29',
    }, harness.googleDependencies);
    expect(harness.materializeGoogleSnapshot).toHaveBeenNthCalledWith(1, {
      snapshotId: 'gsc-2026-08-28',
      marketCode: 'HK',
      locale: 'zh-Hant',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    });
    expect(harness.materializeGoogleSnapshot).toHaveBeenNthCalledWith(2, {
      snapshotId: 'gsc-2026-08-29',
      marketCode: 'HK',
      locale: 'zh-Hant',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    });
  });

  it('reports ALREADY_COMPLETED when every authoritative Google day is reused', async () => {
    const googleDailySync = vi.fn(async ({ date }: { date: string }) => ({
      state: 'ALREADY_COMPLETED' as const,
      snapshotId: `gsc-${date}`,
      syncVersion: 1,
      rowCount: 0 as const,
    }));
    const harness = createHarness({ googleDailySync });

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-28',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      state: 'ALREADY_COMPLETED',
      sourceRefs: ['gsc-2026-08-28', 'gsc-2026-08-29'],
      searchFactSnapshotIds: [
        'search-fact-gsc-2026-08-28',
        'search-fact-gsc-2026-08-29',
      ],
    });
    expect(harness.materializeGoogleSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each([
    'TOKEN_REVOKED',
    'PERMISSION_DENIED',
    'PROPERTY_UNAVAILABLE',
    'RATE_LIMITED',
    'TRANSIENT_PROVIDER_ERROR',
    'INVALID_RESPONSE',
    'PERSISTENCE_FAILED',
  ] as const)('normalizes Google worker failure %s without materializing fabricated evidence', async (reason) => {
    const googleDailySync = vi.fn().mockRejectedValue(
      new SearchConsoleSyncError(`safe ${reason}`, reason),
    );
    const harness = createHarness({ googleDailySync });

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      state: 'FAILED',
      reason,
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });
    expect(harness.materializeGoogleSnapshot).not.toHaveBeenCalled();
  });

  it('maps SearchFact materialization failure without deleting valid source evidence', async () => {
    const harness = createHarness({
      materializeGoogleSnapshot: vi.fn().mockRejectedValue(new Error('materializer failed')),
    });

    await expect(harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    })).resolves.toMatchObject({
      state: 'FAILED',
      reason: 'MATERIALIZATION_FAILED',
      sourceRefs: ['gsc-2026-08-29'],
      searchFactSnapshotIds: [],
    });
  });

  it('does not claim completion in the started lifecycle event or emit provider secrets', async () => {
    const harness = createHarness();

    await harness.service.sync({
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    });

    const events = harness.observability.emit.mock.calls.map(([event]) => event);
    const started = events.find((event) => event.event === 'official_search.sync.started');
    expect(started).toEqual({
      event: 'official_search.sync.started',
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    });
    expect(JSON.stringify(events)).not.toMatch(
      /credentialRef|accessToken|refreshToken|apiKey|authorization|queryText/i,
    );
  });
});
