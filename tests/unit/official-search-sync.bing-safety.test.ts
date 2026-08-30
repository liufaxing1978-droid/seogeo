import { describe, expect, it, vi } from 'vitest';
import { BingWebmasterTransportError } from '../../src/modules/search-providers/bing-webmaster.client.js';
import type { BingQueryObservation } from '../../src/modules/search-providers/search-provider.types.js';
import { OfficialSearchSyncService } from '../../src/modules/search-sync/official-search-sync.service.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';
const BING_PROPERTY_REF = 'https://xingshantang.org/';
const NOW = new Date('2026-08-30T12:00:00.000Z');

const observation = (overrides: Partial<BingQueryObservation> = {}): BingQueryObservation => ({
  kind: 'QUERY_STATS',
  provider: 'BING_WEBMASTER',
  sourceDate: '2026-08-29',
  query: '六壬符纸',
  clicks: 2,
  impressions: 20,
  avgClickPosition: 3,
  avgImpressionPosition: 5,
  completeness: 'PROVIDER_UNSPECIFIED',
  ...overrides,
});

function createBingHarness(overrides: {
  listProperties?: ReturnType<typeof vi.fn>;
  fetchQueryStats?: ReturnType<typeof vi.fn>;
  persistBingBatch?: ReturnType<typeof vi.fn>;
  materializeBingBatch?: ReturnType<typeof vi.fn>;
} = {}) {
  const listProperties = overrides.listProperties ?? vi.fn().mockResolvedValue([{
    provider: 'BING_WEBMASTER' as const,
    propertyRef: BING_PROPERTY_REF,
    propertyType: 'SITE' as const,
    permissionState: 'VERIFIED',
    verified: true,
  }]);
  const fetchQueryStats = overrides.fetchQueryStats ?? vi.fn().mockResolvedValue([observation()]);
  const persistBingBatch = overrides.persistBingBatch ?? vi.fn().mockResolvedValue({ id: 'bing-batch-stable' });
  const materializeBingBatch = overrides.materializeBingBatch ?? vi.fn().mockResolvedValue({ id: 'search-fact-bing-stable' });
  const observability = { emit: vi.fn() };

  const service = new OfficialSearchSyncService({
    bindingRepository: {
      findBinding: vi.fn().mockResolvedValue({
        id: BINDING_ID,
        projectId: PROJECT_ID,
        provider: 'BING_WEBMASTER',
        propertyRef: BING_PROPERTY_REF,
        marketCode: 'HK',
        locale: 'zh-Hant',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    },
    googlePropertyRepository: {
      findActiveConnection: vi.fn(),
      listProperties: vi.fn(),
    },
    googleDailySync: vi.fn(),
    googleDependencies: {} as never,
    bingProvider: { listProperties, fetchQueryStats },
    bingSourcePersistence: { persistBingBatch },
    materializer: {
      materializeGoogleSnapshot: vi.fn(),
      materializeBingBatch,
    },
    observability,
    now: () => NOW,
  });

  return {
    service,
    listProperties,
    fetchQueryStats,
    persistBingBatch,
    materializeBingBatch,
    observability,
  };
}

const command = {
  projectId: PROJECT_ID,
  bindingId: BINDING_ID,
  dateFrom: '2026-08-28',
  dateTo: '2026-08-29',
};

describe('OfficialSearchSyncService Bing safety boundaries', () => {
  it('fails closed before fetch when the exact binding property is not verified', async () => {
    const harness = createBingHarness({
      listProperties: vi.fn().mockResolvedValue([{
        provider: 'BING_WEBMASTER',
        propertyRef: BING_PROPERTY_REF,
        propertyType: 'SITE',
        permissionState: 'UNVERIFIED',
        verified: false,
      }]),
    });

    await expect(harness.service.sync(command)).resolves.toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'UNAVAILABLE',
      reason: 'PROPERTY_UNAVAILABLE',
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });
    expect(harness.fetchQueryStats).not.toHaveBeenCalled();
    expect(harness.persistBingBatch).not.toHaveBeenCalled();
    expect(harness.materializeBingBatch).not.toHaveBeenCalled();
  });

  it('maps an empty in-window Bing result to INVALID_RESPONSE without persisting fabricated evidence', async () => {
    const harness = createBingHarness({
      fetchQueryStats: vi.fn().mockResolvedValue([
        observation({ sourceDate: '2026-08-27', query: 'outside-window' }),
      ]),
    });

    await expect(harness.service.sync(command)).resolves.toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'FAILED',
      reason: 'INVALID_RESPONSE',
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });
    expect(harness.persistBingBatch).not.toHaveBeenCalled();
    expect(harness.materializeBingBatch).not.toHaveBeenCalled();
  });

  it.each([
    [new BingWebmasterTransportError('secret 401 body', 'BING_WEBMASTER_REQUEST_FAILED', 401), 'TOKEN_REVOKED'],
    [new BingWebmasterTransportError('secret 403 body', 'BING_WEBMASTER_REQUEST_FAILED', 403), 'PERMISSION_DENIED'],
    [new BingWebmasterTransportError('secret 404 body', 'BING_WEBMASTER_REQUEST_FAILED', 404), 'PROPERTY_UNAVAILABLE'],
    [new BingWebmasterTransportError('secret 429 body', 'BING_WEBMASTER_REQUEST_FAILED', 429), 'RATE_LIMITED'],
    [new BingWebmasterTransportError('secret 503 body', 'BING_WEBMASTER_REQUEST_FAILED', 503), 'TRANSIENT_PROVIDER_ERROR'],
    [new BingWebmasterTransportError('secret invalid body', 'BING_WEBMASTER_INVALID_RESPONSE', 200), 'INVALID_RESPONSE'],
    [new BingWebmasterTransportError('secret network body', 'BING_WEBMASTER_NETWORK_ERROR', null), 'TRANSIENT_PROVIDER_ERROR'],
  ] as const)('normalizes Bing provider error to %s without leaking raw provider details', async (error, reason) => {
    const harness = createBingHarness({
      fetchQueryStats: vi.fn().mockRejectedValue(error),
    });

    await expect(harness.service.sync(command)).resolves.toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'FAILED',
      reason,
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });
    expect(harness.persistBingBatch).not.toHaveBeenCalled();
    expect(harness.materializeBingBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.observability.emit.mock.calls)).not.toContain(error.message);
  });

  it('maps Bing source persistence failure without materializing SearchFact', async () => {
    const harness = createBingHarness({
      persistBingBatch: vi.fn().mockRejectedValue(new Error('database secret detail')),
    });

    await expect(harness.service.sync(command)).resolves.toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'FAILED',
      reason: 'PERSISTENCE_FAILED',
      sourceRefs: [],
      searchFactSnapshotIds: [],
    });
    expect(harness.materializeBingBatch).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.observability.emit.mock.calls)).not.toContain('database secret detail');
  });

  it('preserves durable Bing source identity when SearchFact materialization fails', async () => {
    const harness = createBingHarness({
      materializeBingBatch: vi.fn().mockRejectedValue(new Error('materializer secret detail')),
    });

    await expect(harness.service.sync(command)).resolves.toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'FAILED',
      reason: 'MATERIALIZATION_FAILED',
      sourceRefs: ['bing-batch-stable'],
      searchFactSnapshotIds: [],
    });
    expect(JSON.stringify(harness.observability.emit.mock.calls)).not.toContain('materializer secret detail');
  });

  it('converges repeated identical commands to the same source and SearchFact identities', async () => {
    const harness = createBingHarness();

    const first = await harness.service.sync(command);
    const second = await harness.service.sync(command);

    expect(first.sourceRefs).toEqual(['bing-batch-stable']);
    expect(second.sourceRefs).toEqual(first.sourceRefs);
    expect(first.searchFactSnapshotIds).toEqual(['search-fact-bing-stable']);
    expect(second.searchFactSnapshotIds).toEqual(first.searchFactSnapshotIds);
  });
});
