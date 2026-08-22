import { describe, expect, it, vi } from 'vitest';
import { BingSearchProviderAdapter } from '../../src/modules/search-providers/bing-search-provider.adapter.js';
import type {
  BingWebmasterAuth,
  BingWebmasterTransport
} from '../../src/modules/search-providers/bing-webmaster.client.js';

const auth: BingWebmasterAuth = { kind: 'API_KEY', apiKey: 'key' };

function createTransport(overrides: Partial<BingWebmasterTransport> = {}): BingWebmasterTransport {
  return {
    listSites: vi.fn().mockResolvedValue([
      { url: 'https://verified.example/', isVerified: true },
      { url: 'https://unverified.example/', isVerified: false }
    ]),
    getQueryStats: vi.fn().mockResolvedValue([
      {
        date: '2026-08-15',
        value: 'b query',
        clicks: 2,
        impressions: 20,
        avgClickPosition: null,
        avgImpressionPosition: 8
      },
      {
        date: '2026-08-08',
        value: 'a query',
        clicks: 1,
        impressions: 10,
        avgClickPosition: 4,
        avgImpressionPosition: 5
      }
    ]),
    getPageStats: vi.fn().mockResolvedValue([
      {
        date: '2026-08-15',
        value: 'https://example.com/b',
        clicks: 2,
        impressions: 20,
        avgClickPosition: 6,
        avgImpressionPosition: null
      },
      {
        date: '2026-08-15',
        value: 'https://example.com/a',
        clicks: 1,
        impressions: 10,
        avgClickPosition: null,
        avgImpressionPosition: 7
      }
    ]),
    getRankAndTrafficStats: vi.fn().mockResolvedValue([
      { date: '2026-08-16', clicks: 3, impressions: 30 },
      { date: '2026-08-15', clicks: 2, impressions: 20 }
    ]),
    ...overrides
  };
}

describe('BingSearchProviderAdapter', () => {
  it('returns only verified Bing properties', async () => {
    const transport = createTransport();
    const adapter = new BingSearchProviderAdapter(transport, auth);

    await expect(adapter.listProperties()).resolves.toEqual([
      {
        provider: 'BING_WEBMASTER',
        propertyRef: 'https://verified.example/',
        propertyType: 'SITE',
        permissionState: 'VERIFIED',
        verified: true
      }
    ]);
    expect(transport.listSites).toHaveBeenCalledWith(auth);
  });

  it('maps query stats without fabricating page, ctr, or a single position metric', async () => {
    const adapter = new BingSearchProviderAdapter(createTransport(), auth);
    const rows = await adapter.fetchQueryStats('https://example.com/');

    expect(rows).toEqual([
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-08',
        query: 'a query',
        clicks: 1,
        impressions: 10,
        avgClickPosition: 4,
        avgImpressionPosition: 5,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-15',
        query: 'b query',
        clicks: 2,
        impressions: 20,
        avgClickPosition: null,
        avgImpressionPosition: 8,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ]);
    expect(rows[0]).not.toHaveProperty('page');
    expect(rows[0]).not.toHaveProperty('ctr');
    expect(rows[0]).not.toHaveProperty('position');
  });

  it('maps page stats as page-only observations and sorts deterministically', async () => {
    const adapter = new BingSearchProviderAdapter(createTransport(), auth);

    await expect(adapter.fetchPageStats('https://example.com/')).resolves.toEqual([
      {
        kind: 'PAGE_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-15',
        page: 'https://example.com/a',
        clicks: 1,
        impressions: 10,
        avgClickPosition: null,
        avgImpressionPosition: 7,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'PAGE_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-15',
        page: 'https://example.com/b',
        clicks: 2,
        impressions: 20,
        avgClickPosition: 6,
        avgImpressionPosition: null,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ]);
  });

  it('rejects invalid page values even when a custom transport returns them', async () => {
    const transport = createTransport({
      getPageStats: vi.fn().mockResolvedValue([
        {
          date: '2026-08-15',
          value: 'https://user:pass@example.com/secret',
          clicks: 1,
          impressions: 2,
          avgClickPosition: 1,
          avgImpressionPosition: 2
        }
      ])
    });
    const adapter = new BingSearchProviderAdapter(transport, auth);

    await expect(adapter.fetchPageStats('https://example.com/')).rejects.toThrow(/page url/i);
  });

  it('maps site traffic as daily site-level observations only', async () => {
    const adapter = new BingSearchProviderAdapter(createTransport(), auth);

    const rows = await adapter.fetchSiteTrafficDaily('https://example.com/');
    expect(rows).toEqual([
      {
        kind: 'SITE_TRAFFIC_DAILY',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-15',
        clicks: 2,
        impressions: 20,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'SITE_TRAFFIC_DAILY',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-16',
        clicks: 3,
        impressions: 30,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ]);
    expect(rows[0]).not.toHaveProperty('query');
    expect(rows[0]).not.toHaveProperty('page');
    expect(rows[0]).not.toHaveProperty('ctr');
    expect(rows[0]).not.toHaveProperty('position');
  });

  it('passes the injected auth to every read operation', async () => {
    const transport = createTransport();
    const adapter = new BingSearchProviderAdapter(transport, auth);

    await adapter.fetchQueryStats('https://example.com/');
    await adapter.fetchPageStats('https://example.com/');
    await adapter.fetchSiteTrafficDaily('https://example.com/');

    expect(transport.getQueryStats).toHaveBeenCalledWith(auth, 'https://example.com/');
    expect(transport.getPageStats).toHaveBeenCalledWith(auth, 'https://example.com/');
    expect(transport.getRankAndTrafficStats).toHaveBeenCalledWith(auth, 'https://example.com/');
  });
});
