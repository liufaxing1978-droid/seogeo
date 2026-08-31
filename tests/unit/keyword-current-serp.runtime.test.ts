import { describe, expect, it, vi } from 'vitest';

const modulePath = '../../src/modules/keywords/keyword-current-serp.runtime.js';

type LanePort = {
  findActiveLane(input: {
    projectId: string;
    searchEngine: 'GOOGLE' | 'BING';
    marketCode: string;
    locale: string;
    device: 'DESKTOP' | 'MOBILE';
  }): Promise<{
    provider: 'DATAFORSEO';
    searchEngine: 'GOOGLE' | 'BING';
    marketCode: string;
    locale: string;
    device: 'DESKTOP' | 'MOBILE';
    searchDepth: number;
  } | null>;
};

type RuntimeFactoryOptions = {
  lanes: LanePort;
  runtimeEnv?: {
    DATAFORSEO_LOGIN?: string;
    DATAFORSEO_PASSWORD?: string;
    DATAFORSEO_BASE_URL: string;
    DATAFORSEO_TIMEOUT_MS: number;
  };
  keywords?: {
    findKeyword(projectId: string, keywordId: string): Promise<{
      id: string;
      projectId: string;
      text: string;
      status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
    } | null>;
  };
  searchFacts?: {
    persistCompletedSnapshot(
      identity: Record<string, unknown>,
      drafts: readonly Record<string, unknown>[],
      inputHash: string,
    ): Promise<{ id: string }>;
  };
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

type RuntimeService = {
  observe(input: {
    projectId: string;
    keywordId: string;
    searchEngine: 'GOOGLE' | 'BING';
    marketCode: string;
    locale: string;
    device: 'DESKTOP' | 'MOBILE';
    targetUrl: string;
  }): Promise<{
    snapshotId: string;
    position: number | null;
    observationRef: string;
  }>;
};

type SubjectModule = {
  createKeywordCurrentSerpRuntimeService(options: RuntimeFactoryOptions): RuntimeService;
};

async function loadSubject(): Promise<SubjectModule> {
  return await import(modulePath) as SubjectModule;
}

const projectId = '00000000-0000-0000-0000-000000000001';
const keywordId = '00000000-0000-0000-0000-000000000002';
const targetUrl = 'https://xingshantang.org/fuzhi';

function lanePort(): LanePort {
  return {
    findActiveLane: vi.fn().mockResolvedValue({
      provider: 'DATAFORSEO',
      searchEngine: 'GOOGLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      device: 'MOBILE',
      searchDepth: 100,
    }),
  };
}

function keywordPort() {
  return {
    findKeyword: vi.fn().mockResolvedValue({
      id: keywordId,
      projectId,
      text: '符纸',
      status: 'ACTIVE' as const,
    }),
  };
}

const observeInput = {
  projectId,
  keywordId,
  searchEngine: 'GOOGLE' as const,
  marketCode: 'HK',
  locale: 'zh-Hant',
  device: 'MOBILE' as const,
  targetUrl,
};

describe('P11-02C current SERP production runtime composition', () => {
  it('wires runtime credentials, DataForSEO transport, keyword authority, and SearchFact persistence', async () => {
    const subject = await loadSubject();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status_code: 20000,
      tasks: [{
        id: 'dfs-runtime-001',
        status_code: 20000,
        result: [{
          items: [
            { type: 'organic', rank_group: 1, rank_absolute: 4, url: 'https://other.example/' },
            { type: 'organic', rank_group: 9, rank_absolute: 22, url: targetUrl },
          ],
        }],
      }],
    }), { status: 200 }));
    const persistCompletedSnapshot = vi.fn().mockResolvedValue({ id: 'snapshot-runtime-001' });

    const service = subject.createKeywordCurrentSerpRuntimeService({
      lanes: lanePort(),
      runtimeEnv: {
        DATAFORSEO_LOGIN: 'runtime-user',
        DATAFORSEO_PASSWORD: 'runtime-pass',
        DATAFORSEO_BASE_URL: 'https://dataforseo.example',
        DATAFORSEO_TIMEOUT_MS: 5000,
      },
      keywords: keywordPort(),
      searchFacts: { persistCompletedSnapshot },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-08-31T14:00:00.000Z'),
    });

    await expect(service.observe(observeInput)).resolves.toEqual({
      snapshotId: 'snapshot-runtime-001',
      position: 9,
      observationRef: 'dfs-runtime-001',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://dataforseo.example/v3/serp/google/organic/live/advanced');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Basic ${Buffer.from('runtime-user:runtime-pass').toString('base64')}`,
    });
    expect(persistCompletedSnapshot).toHaveBeenCalledTimes(1);
    expect(persistCompletedSnapshot.mock.calls[0]![0]).toMatchObject({
      provider: 'GOOGLE_SERP',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
    });
  });

  it('fails closed before provider transport when runtime credentials are incomplete', async () => {
    const subject = await loadSubject();
    const fetchImpl = vi.fn();
    const persistCompletedSnapshot = vi.fn();
    const service = subject.createKeywordCurrentSerpRuntimeService({
      lanes: lanePort(),
      runtimeEnv: {
        DATAFORSEO_LOGIN: 'runtime-user',
        DATAFORSEO_BASE_URL: 'https://api.dataforseo.com',
        DATAFORSEO_TIMEOUT_MS: 30000,
      },
      keywords: keywordPort(),
      searchFacts: { persistCompletedSnapshot },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(service.observe(observeInput)).rejects.toThrow(
      'CURRENT_SERP_SECRET_NOT_CONFIGURED',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(persistCompletedSnapshot).not.toHaveBeenCalled();
  });
});
