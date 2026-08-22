import { describe, expect, it, vi } from 'vitest';
import {
  BingWebmasterClient,
  BingWebmasterTransportError
} from '../../src/modules/search-providers/bing-webmaster.client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('BingWebmasterClient', () => {
  it('uses the API-key JSON host and URLSearchParams encoding without leaking key elsewhere', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ d: [] }));
    const client = new BingWebmasterClient(fetchImpl);

    await client.getQueryStats(
      { kind: 'API_KEY', apiKey: 'secret key&value' },
      'https://example.com/?a=1&b=2'
    );

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin).toBe('https://ssl.bing.com');
    expect(url.pathname).toBe('/webmaster/api.svc/json/GetQueryStats');
    expect(url.searchParams.get('apikey')).toBe('secret key&value');
    expect(url.searchParams.get('siteUrl')).toBe('https://example.com/?a=1&b=2');
    expect(JSON.stringify(init ?? {})).not.toContain('secret key&value');
  });

  it('uses OAuth bearer on www.bing.com without putting the token in the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ d: [] }));
    const client = new BingWebmasterClient(fetchImpl);

    await client.listSites({ kind: 'OAUTH_BEARER', accessToken: 'secret-token' });

    const [rawUrl, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(rawUrl));
    expect(url.origin).toBe('https://www.bing.com');
    expect(url.pathname).toBe('/webmaster/api.svc/json/GetUserSites');
    expect(url.toString()).not.toContain('secret-token');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer secret-token');
  });

  it('parses GetUserSites and retains only the site identity and verified state', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      d: [
        {
          __type: 'Site:#Microsoft.Bing.Webmaster.Api',
          AuthenticationCode: 'ignored',
          DnsVerificationCode: 'ignored.example.com',
          IsVerified: true,
          Url: 'https://example.com/'
        }
      ]
    }));
    const client = new BingWebmasterClient(fetchImpl);

    await expect(client.listSites({ kind: 'API_KEY', apiKey: 'key' })).resolves.toEqual([
      { url: 'https://example.com/', isVerified: true }
    ]);
  });

  it('parses query stats, Bing date wrappers, nullable average positions, and integer metrics', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      d: [
        {
          __type: 'QueryStats:#Microsoft.Bing.Webmaster.Api',
          AvgClickPosition: 18,
          AvgImpressionPosition: null,
          Clicks: 15,
          Date: '/Date(1316156400000-0700)/',
          Impressions: 100,
          Query: '六壬'
        }
      ]
    }));
    const client = new BingWebmasterClient(fetchImpl);

    await expect(client.getQueryStats(
      { kind: 'API_KEY', apiKey: 'key' },
      'https://example.com/'
    )).resolves.toEqual([
      {
        date: '2011-09-16',
        value: '六壬',
        clicks: 15,
        impressions: 100,
        avgClickPosition: 18,
        avgImpressionPosition: null
      }
    ]);
  });

  it('parses page stats through the same QueryStats shape and validates page URLs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      d: [
        {
          AvgClickPosition: 4,
          AvgImpressionPosition: 5,
          Clicks: 2,
          Date: '/Date(1316156400000+0000)/',
          Impressions: 25,
          Query: 'https://example.com/page'
        }
      ]
    }));
    const client = new BingWebmasterClient(fetchImpl);

    await expect(client.getPageStats(
      { kind: 'OAUTH_BEARER', accessToken: 'token' },
      'https://example.com/'
    )).resolves.toEqual([
      {
        date: '2011-09-16',
        value: 'https://example.com/page',
        clicks: 2,
        impressions: 25,
        avgClickPosition: 4,
        avgImpressionPosition: 5
      }
    ]);
  });

  it('parses daily rank and traffic stats without synthesizing rankings', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      d: [{ Clicks: 15, Date: '/Date(1316156400000-0700)/', Impressions: 100 }]
    }));
    const client = new BingWebmasterClient(fetchImpl);

    await expect(client.getRankAndTrafficStats(
      { kind: 'API_KEY', apiKey: 'key' },
      'https://example.com/'
    )).resolves.toEqual([
      { date: '2011-09-16', clicks: 15, impressions: 100 }
    ]);
  });

  it.each([
    ['invalid JSON', new Response('not-json', { status: 200 })],
    ['invalid wrapper', jsonResponse({ rows: [] })],
    ['invalid date', jsonResponse({ d: [{ AvgClickPosition: 1, AvgImpressionPosition: 1, Clicks: 1, Date: '2011-09-16', Impressions: 2, Query: 'q' }] })],
    ['negative metric', jsonResponse({ d: [{ AvgClickPosition: 1, AvgImpressionPosition: 1, Clicks: -1, Date: '/Date(1316156400000-0700)/', Impressions: 2, Query: 'q' }] })],
    ['fractional clicks', jsonResponse({ d: [{ AvgClickPosition: 1, AvgImpressionPosition: 1, Clicks: 1.5, Date: '/Date(1316156400000-0700)/', Impressions: 2, Query: 'q' }] })],
    ['negative position', jsonResponse({ d: [{ AvgClickPosition: -1, AvgImpressionPosition: 1, Clicks: 1, Date: '/Date(1316156400000-0700)/', Impressions: 2, Query: 'q' }] })]
  ])('rejects %s provider responses', async (_label, response) => {
    const client = new BingWebmasterClient(vi.fn().mockResolvedValue(response));
    await expect(client.getQueryStats(
      { kind: 'API_KEY', apiKey: 'key' },
      'https://example.com/'
    )).rejects.toBeInstanceOf(BingWebmasterTransportError);
  });

  it('rejects credential-bearing site inputs before a request is made', async () => {
    const fetchImpl = vi.fn();
    const client = new BingWebmasterClient(fetchImpl);

    await expect(client.getPageStats(
      { kind: 'API_KEY', apiKey: 'key' },
      'https://user:pass@example.com/'
    )).rejects.toThrow(/site url/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects credential-bearing page values returned by GetPageStats', async () => {
    const client = new BingWebmasterClient(vi.fn().mockResolvedValue(jsonResponse({
      d: [{
        AvgClickPosition: 1,
        AvgImpressionPosition: 1,
        Clicks: 1,
        Date: '/Date(1316156400000-0700)/',
        Impressions: 2,
        Query: 'https://user:pass@example.com/page'
      }]
    })));

    await expect(client.getPageStats(
      { kind: 'API_KEY', apiKey: 'key' },
      'https://example.com/'
    )).rejects.toBeInstanceOf(BingWebmasterTransportError);
  });

  it.each([401, 403, 429, 500])('returns bounded transport error for HTTP %s without secrets or body', async (status) => {
    const secret = 'very-secret-api-key';
    const bodySecret = 'provider-secret-body';
    const client = new BingWebmasterClient(vi.fn().mockResolvedValue(
      new Response(bodySecret, { status })
    ));

    let error: unknown;
    try {
      await client.listSites({ kind: 'API_KEY', apiKey: secret });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BingWebmasterTransportError);
    const transportError = error as BingWebmasterTransportError;
    expect(transportError.httpStatus).toBe(status);
    expect(transportError.code).toBe('BING_WEBMASTER_REQUEST_FAILED');
    expect(transportError.message).not.toContain(secret);
    expect(transportError.message).not.toContain(bodySecret);
  });

  it.each([
    [{ kind: 'API_KEY', apiKey: 'network-secret-api-key' } as const, 'network-secret-api-key'],
    [{ kind: 'OAUTH_BEARER', accessToken: 'network-secret-token' } as const, 'network-secret-token']
  ])('bounds rejected fetch errors for %o without leaking credentials', async (networkAuth, secret) => {
    const fetchImpl = vi.fn().mockRejectedValue(
      new Error(`network failed for request carrying ${secret}`)
    );
    const client = new BingWebmasterClient(fetchImpl);

    let error: unknown;
    try {
      await client.listSites(networkAuth);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(BingWebmasterTransportError);
    const transportError = error as BingWebmasterTransportError;
    expect(transportError.httpStatus).toBeNull();
    expect(transportError.code).toBe('BING_WEBMASTER_NETWORK_ERROR');
    expect(transportError.message).not.toContain(secret);
    expect(transportError.message).not.toContain('network failed for request carrying');
  });
});
