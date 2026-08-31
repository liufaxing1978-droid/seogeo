import { describe, expect, it, vi } from 'vitest';

const modulePath = '../../src/modules/keywords/dataforseo-current-serp.provider.js';

type SubjectModule = {
  createDataForSeoCurrentSerpProvider(options?: {
    fetchImpl?: typeof fetch;
    now?: () => Date;
    baseUrl?: string;
    timeoutMs?: number;
  }): {
    observe(input: Record<string, unknown>): Promise<{
      observationRef: string;
      observedAt: Date;
      results: Array<{ position: number; url: string }>;
    }>;
  };
  resolveDataForSeoCurrentSerpCredentials(input: {
    DATAFORSEO_LOGIN?: string;
    DATAFORSEO_PASSWORD?: string;
  }): Promise<Record<string, string> | null> | Record<string, string> | null;
};

async function loadSubject(): Promise<SubjectModule> {
  return await import(modulePath) as SubjectModule;
}

function okPayload(searchEngine: 'google' | 'bing' = 'google') {
  return {
    version: '0.1.20260831',
    status_code: 20000,
    status_message: 'Ok.',
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      id: '08311330-0000-0000-0000-000000000001',
      status_code: 20000,
      status_message: 'Ok.',
      path: ['v3', 'serp', searchEngine, 'organic', 'live', 'advanced'],
      result: [{
        items: [
          { type: 'paid', rank_group: 1, rank_absolute: 1, url: 'https://ads.example/' },
          { type: 'organic', rank_group: 1, rank_absolute: 2, url: 'https://other.example/a' },
          { type: 'people_also_ask', rank_group: 1, rank_absolute: 3 },
          { type: 'organic', rank_group: 7, rank_absolute: 12, url: 'https://example.com/fuzhi' },
        ],
      }],
    }],
  };
}

const baseInput = {
  projectId: '00000000-0000-0000-0000-000000000001',
  keywordId: '00000000-0000-0000-0000-000000000002',
  keyword: '符纸',
  searchEngine: 'GOOGLE',
  marketCode: 'HK',
  locale: 'zh-Hant',
  device: 'MOBILE',
  searchDepth: 100,
  targetUrl: 'https://example.com/fuzhi',
  credentials: { username: 'api-login', password: 'api-password' },
};

describe('P11-02C DataForSEO realtime SERP provider', () => {
  it('resolves runtime credentials only when login and password are both present', async () => {
    const subject = await loadSubject();

    await expect(subject.resolveDataForSeoCurrentSerpCredentials({
      DATAFORSEO_LOGIN: 'api-login',
      DATAFORSEO_PASSWORD: 'api-password',
    })).resolves.toEqual({ username: 'api-login', password: 'api-password' });

    await expect(subject.resolveDataForSeoCurrentSerpCredentials({
      DATAFORSEO_LOGIN: 'api-login',
    })).resolves.toBeNull();
  });

  it('calls Google live advanced with Basic auth and maps only organic rank_group positions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(okPayload('google')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const observedAt = new Date('2026-08-31T13:45:00.000Z');
    const subject = await loadSubject();
    const provider = subject.createDataForSeoCurrentSerpProvider({
      fetchImpl: fetchImpl as typeof fetch,
      now: () => observedAt,
    });

    const result = await provider.observe(baseInput);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [request, init] = fetchImpl.mock.calls[0]!;
    expect(String(request)).toBe('https://api.dataforseo.com/v3/serp/google/organic/live/advanced');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe(`Basic ${Buffer.from('api-login:api-password').toString('base64')}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual([{
      keyword: '符纸',
      location_name: 'Hong Kong',
      language_code: 'zh-TW',
      device: 'mobile',
      depth: 100,
    }]);
    expect(result).toEqual({
      observationRef: '08311330-0000-0000-0000-000000000001',
      observedAt,
      results: [
        { position: 1, url: 'https://other.example/a' },
        { position: 7, url: 'https://example.com/fuzhi' },
      ],
    });
  });

  it('dispatches Bing to the Bing organic live advanced endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(okPayload('bing')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const subject = await loadSubject();
    const provider = subject.createDataForSeoCurrentSerpProvider({ fetchImpl: fetchImpl as typeof fetch });

    await provider.observe({ ...baseInput, searchEngine: 'BING', locale: 'zh-TW' });

    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://api.dataforseo.com/v3/serp/bing/organic/live/advanced',
    );
  });

  it('fails closed for GLOBAL because realtime rank requires an explicit provider location', async () => {
    const fetchImpl = vi.fn();
    const subject = await loadSubject();
    const provider = subject.createDataForSeoCurrentSerpProvider({ fetchImpl: fetchImpl as typeof fetch });

    await expect(provider.observe({ ...baseInput, marketCode: 'GLOBAL' }))
      .rejects.toThrow('DATAFORSEO_CURRENT_SERP_MARKET_UNSUPPORTED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed on missing credentials and malformed provider responses', async () => {
    const subject = await loadSubject();
    const authFetch = vi.fn();
    const provider = subject.createDataForSeoCurrentSerpProvider({ fetchImpl: authFetch as typeof fetch });

    await expect(provider.observe({ ...baseInput, credentials: { username: 'api-login' } }))
      .rejects.toThrow('DATAFORSEO_CURRENT_SERP_AUTH_INVALID');
    expect(authFetch).not.toHaveBeenCalled();

    const invalidFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status_code: 20000,
      tasks: [],
    }), { status: 200 }));
    const invalidProvider = subject.createDataForSeoCurrentSerpProvider({
      fetchImpl: invalidFetch as typeof fetch,
    });
    await expect(invalidProvider.observe(baseInput))
      .rejects.toThrow('DATAFORSEO_CURRENT_SERP_INVALID_RESPONSE');
  });
});
