import { describe, expect, it, vi } from 'vitest';
import { GoogleSearchProviderAdapter } from '../../src/modules/search-providers/google-search-provider.adapter.js';
import type { GoogleSearchConsoleTransport } from '../../src/modules/search-console/google-search-console.client.js';

function createAccess() {
  return {
    getAccessToken: vi.fn().mockResolvedValue('access-token'),
    listReadableProperties: vi.fn().mockResolvedValue([
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' }
    ])
  };
}

function createTransport(rows: Array<{
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}> = []) {
  return {
    querySearchAnalytics: vi.fn().mockResolvedValue({ rows })
  } as unknown as Pick<GoogleSearchConsoleTransport, 'querySearchAnalytics'>;
}

describe('GoogleSearchProviderAdapter', () => {
  it('maps readable GSC properties without changing permission semantics', async () => {
    const adapter = new GoogleSearchProviderAdapter(createAccess(), createTransport());

    await expect(adapter.listProperties('p1')).resolves.toEqual([
      {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        propertyRef: 'sc-domain:example.com',
        propertyType: 'DOMAIN',
        permissionState: 'siteOwner',
        verified: true
      },
      {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        propertyRef: 'https://example.com/',
        propertyType: 'URL_PREFIX',
        permissionState: 'siteFullUser',
        verified: true
      }
    ]);
  });

  it('maps Search Analytics query+page rows as TOP_ROWS_ONLY observations', async () => {
    const access = createAccess();
    const transport = createTransport([{
      keys: ['六壬', 'https://example.com/liuren'],
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 5.5
    }]);
    const adapter = new GoogleSearchProviderAdapter(access, transport);

    await expect(adapter.fetchQueryPageDaily({
      projectId: 'p1',
      propertyRef: 'sc-domain:example.com',
      sourceDate: '2026-08-20'
    })).resolves.toEqual([{
      kind: 'QUERY_PAGE_DAILY',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceDate: '2026-08-20',
      query: '六壬',
      page: 'https://example.com/liuren',
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 5.5,
      completeness: 'TOP_ROWS_ONLY'
    }]);

    expect(access.getAccessToken).toHaveBeenCalledWith('p1');
    expect(transport.querySearchAnalytics).toHaveBeenCalledWith(
      'access-token',
      'sc-domain:example.com',
      {
        startDate: '2026-08-20',
        endDate: '2026-08-20',
        dimensions: ['query', 'page'],
        rowLimit: 25_000
      }
    );
  });

  it('accepts a bounded custom row limit', async () => {
    const access = createAccess();
    const transport = createTransport();
    const adapter = new GoogleSearchProviderAdapter(access, transport);

    await adapter.fetchQueryPageDaily({
      projectId: 'p1',
      propertyRef: 'sc-domain:example.com',
      sourceDate: '2026-08-20',
      rowLimit: 500
    });

    expect(transport.querySearchAnalytics).toHaveBeenCalledWith(
      'access-token',
      'sc-domain:example.com',
      expect.objectContaining({ rowLimit: 500 })
    );
  });

  it.each([0, 25_001, 1.5])('rejects invalid rowLimit %s before transport access', async (rowLimit) => {
    const access = createAccess();
    const transport = createTransport();
    const adapter = new GoogleSearchProviderAdapter(access, transport);

    await expect(adapter.fetchQueryPageDaily({
      projectId: 'p1',
      propertyRef: 'sc-domain:example.com',
      sourceDate: '2026-08-20',
      rowLimit
    })).rejects.toThrow(/row limit/i);
    expect(access.getAccessToken).not.toHaveBeenCalled();
    expect(transport.querySearchAnalytics).not.toHaveBeenCalled();
  });

  it.each(['2026-8-20', 'not-a-date', '2026-02-30'])('rejects invalid source date %s', async (sourceDate) => {
    const access = createAccess();
    const adapter = new GoogleSearchProviderAdapter(access, createTransport());

    await expect(adapter.fetchQueryPageDaily({
      projectId: 'p1',
      propertyRef: 'sc-domain:example.com',
      sourceDate
    })).rejects.toThrow(/source date/i);
    expect(access.getAccessToken).not.toHaveBeenCalled();
  });

  it('rejects rows that do not have exactly query and page keys', async () => {
    const adapter = new GoogleSearchProviderAdapter(
      createAccess(),
      createTransport([{ keys: ['query-only'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 }])
    );

    await expect(adapter.fetchQueryPageDaily({
      projectId: 'p1', propertyRef: 'sc-domain:example.com', sourceDate: '2026-08-20'
    })).rejects.toThrow(/keys/i);
  });

  it.each([
    { keys: ['q', 'https://user:pass@example.com/x'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
    { keys: ['q', 'ftp://example.com/x'], clicks: 1, impressions: 2, ctr: 0.5, position: 1 },
    { keys: ['q', 'https://example.com/x'], clicks: -1, impressions: 2, ctr: 0.5, position: 1 },
    { keys: ['q', 'https://example.com/x'], clicks: 1.5, impressions: 2, ctr: 0.5, position: 1 },
    { keys: ['q', 'https://example.com/x'], clicks: 1, impressions: 2, ctr: 1.1, position: 1 },
    { keys: ['q', 'https://example.com/x'], clicks: 1, impressions: 2, ctr: 0.5, position: -1 }
  ])('rejects invalid provider row %#', async (row) => {
    const adapter = new GoogleSearchProviderAdapter(createAccess(), createTransport([row]));
    await expect(adapter.fetchQueryPageDaily({
      projectId: 'p1', propertyRef: 'sc-domain:example.com', sourceDate: '2026-08-20'
    })).rejects.toThrow();
  });
});
