import { describe, expect, it, vi } from 'vitest';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { OfficialSearchSyncService } from '../../src/modules/search-sync/official-search-sync.service.js';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const BINDING_ID = '22222222-2222-4222-8222-222222222222';
const BING_PROPERTY_REF = 'https://xingshantang.org/';
const NOW = new Date('2026-08-30T12:00:00.000Z');

function harness(overrides: {
  discoveryRefresh?: ReturnType<typeof vi.fn>;
} = {}) {
  const discoveryRefresh = overrides.discoveryRefresh ?? vi.fn().mockResolvedValue({
    created: 1,
    updated: 0,
    preserved: 0,
  });
  const materializeBingBatch = vi.fn().mockResolvedValue({ id: 'search-fact-bing-1' });
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
    bingProvider: {
      listProperties: vi.fn().mockResolvedValue([{
        provider: 'BING_WEBMASTER' as const,
        propertyRef: BING_PROPERTY_REF,
        propertyType: 'SITE' as const,
        permissionState: 'VERIFIED',
        verified: true,
      }]),
      fetchQueryStats: vi.fn().mockResolvedValue([{
        kind: 'QUERY_STATS' as const,
        provider: 'BING_WEBMASTER' as const,
        sourceDate: '2026-08-29',
        query: '六壬符纸',
        clicks: 2,
        impressions: 20,
        avgClickPosition: 3,
        avgImpressionPosition: 5,
        completeness: 'PROVIDER_UNSPECIFIED' as const,
      }]),
    },
    bingSourcePersistence: {
      persistBingBatch: vi.fn().mockResolvedValue({ id: 'bing-batch-1' }),
    },
    materializer: {
      materializeGoogleSnapshot: vi.fn(),
      materializeBingBatch,
    },
    discoveryService: { refresh: discoveryRefresh },
    observability,
    now: () => NOW,
  } as never);

  return { service, discoveryRefresh, materializeBingBatch, observability };
}

const command = {
  projectId: PROJECT_ID,
  bindingId: BINDING_ID,
  dateFrom: '2026-08-29',
  dateTo: '2026-08-29',
};

describe('OfficialSearchSyncService discovery refresh follow-up', () => {
  it('refreshes keyword discoveries once after successful SearchFact materialization', async () => {
    const h = harness();

    await expect(h.service.sync(command)).resolves.toMatchObject({
      state: 'COMPLETED',
      discoveryState: 'REFRESHED',
      reason: null,
      searchFactSnapshotIds: ['search-fact-bing-1'],
    });

    expect(h.discoveryRefresh).toHaveBeenCalledTimes(1);
    expect(h.discoveryRefresh).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
    });
    expect(h.materializeBingBatch).toHaveBeenCalledWith({
      batchId: 'bing-batch-1',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    });
  });

  it('keeps committed SearchFact evidence when discovery refresh fails and emits a safe refresh-failed event', async () => {
    const h = harness({
      discoveryRefresh: vi.fn().mockRejectedValue(new Error('discovery raw failure must not leak')),
    });

    await expect(h.service.sync(command)).resolves.toMatchObject({
      state: 'COMPLETED',
      discoveryState: 'DISCOVERY_REFRESH_FAILED',
      reason: 'DISCOVERY_REFRESH_FAILED',
      sourceRefs: ['bing-batch-1'],
      searchFactSnapshotIds: ['search-fact-bing-1'],
    });

    expect(h.materializeBingBatch).toHaveBeenCalledTimes(1);
    expect(h.observability.emit).toHaveBeenCalledWith(expect.objectContaining({
      event: 'keyword_discovery.refresh.failed',
      projectId: PROJECT_ID,
      bindingId: BINDING_ID,
      provider: 'BING_WEBMASTER',
      dateFrom: '2026-08-29',
      dateTo: '2026-08-29',
      reason: 'DISCOVERY_REFRESH_FAILED',
    }));
    expect(JSON.stringify(h.observability.emit.mock.calls)).not.toContain('discovery raw failure must not leak');
  });
});
