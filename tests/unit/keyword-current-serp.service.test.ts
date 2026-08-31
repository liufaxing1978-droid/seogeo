import { describe, expect, it, vi } from 'vitest';

const modulePath = '../../src/modules/keywords/keyword-current-serp.service.js';

type KeywordRecord = {
  id: string;
  projectId: string;
  text: string;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
};

type Lane = {
  provider: 'DATAFORSEO';
  searchEngine: 'GOOGLE' | 'BING';
  marketCode: string;
  locale: string;
  device: 'DESKTOP' | 'MOBILE';
  searchDepth: number;
};

type ServiceDeps = {
  keywords: {
    findKeyword(projectId: string, keywordId: string): Promise<KeywordRecord | null>;
  };
  lanes: {
    findActiveLane(input: {
      projectId: string;
      searchEngine: 'GOOGLE' | 'BING';
      marketCode: string;
      locale: string;
      device: 'DESKTOP' | 'MOBILE';
    }): Promise<Lane | null>;
  };
  secrets: {
    resolve(provider: 'DATAFORSEO'): Promise<Record<string, string> | null>;
  };
  providers: {
    get(provider: 'DATAFORSEO'): {
      observe(input: Record<string, unknown>): Promise<{
        observationRef: string;
        observedAt: Date;
        results: Array<{ position: number; url: string }>;
      }>;
    } | null;
  };
  searchFacts: {
    persistCompletedSnapshot(
      identity: Record<string, unknown>,
      drafts: readonly Record<string, unknown>[],
      inputHash: string,
    ): Promise<{ id: string }>;
  };
};

type CurrentSerpService = {
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
  createKeywordCurrentSerpService(deps: ServiceDeps): CurrentSerpService;
};

async function loadSubject(): Promise<SubjectModule> {
  return await import(modulePath) as SubjectModule;
}

const activeKeyword: KeywordRecord = {
  id: '00000000-0000-0000-0000-000000000002',
  projectId: '00000000-0000-0000-0000-000000000001',
  text: '符纸',
  status: 'ACTIVE',
};

const lane: Lane = {
  provider: 'DATAFORSEO',
  searchEngine: 'GOOGLE',
  marketCode: 'GLOBAL',
  locale: 'zh-CN',
  device: 'MOBILE',
  searchDepth: 100,
};

const observeInput = {
  projectId: activeKeyword.projectId,
  keywordId: activeKeyword.id,
  searchEngine: 'GOOGLE' as const,
  marketCode: 'GLOBAL',
  locale: 'zh-CN',
  device: 'MOBILE' as const,
  targetUrl: 'https://example.com/fuzhi',
};

function deps(overrides: Partial<ServiceDeps> = {}) {
  const providerObserve = vi.fn().mockResolvedValue({
    observationRef: 'dataforseo-task-001',
    observedAt: new Date('2026-08-31T13:00:00.000Z'),
    results: [
      { position: 1, url: 'https://other.example/a' },
      { position: 7, url: 'https://example.com/fuzhi' },
    ],
  });
  const persistCompletedSnapshot = vi.fn().mockResolvedValue({ id: 'snapshot-001' });

  const value: ServiceDeps = {
    keywords: {
      findKeyword: vi.fn().mockResolvedValue(activeKeyword),
    },
    lanes: {
      findActiveLane: vi.fn().mockResolvedValue(lane),
    },
    secrets: {
      resolve: vi.fn().mockResolvedValue({ username: 'runtime-only', password: 'runtime-only' }),
    },
    providers: {
      get: vi.fn().mockReturnValue({ observe: providerObserve }),
    },
    searchFacts: {
      persistCompletedSnapshot,
    },
    ...overrides,
  };

  return { value, providerObserve, persistCompletedSnapshot };
}

describe('P11-02C realtime rank service authority and fail-closed contracts', () => {
  it.each(['DISABLED', 'ARCHIVED'] as const)(
    'rejects a persisted %s keyword before resolving a lane or calling a provider',
    async (status) => {
      const subject = await loadSubject();
      const findActiveLane = vi.fn();
      const providerGet = vi.fn();
      const fixture = deps({
        keywords: {
          findKeyword: vi.fn().mockResolvedValue({ ...activeKeyword, status }),
        },
        lanes: { findActiveLane },
        providers: { get: providerGet },
      });
      const service = subject.createKeywordCurrentSerpService(fixture.value);

      await expect(service.observe(observeInput)).rejects.toThrow('CURRENT_SERP_KEYWORD_NOT_ACTIVE');
      expect(findActiveLane).not.toHaveBeenCalled();
      expect(providerGet).not.toHaveBeenCalled();
      expect(fixture.persistCompletedSnapshot).not.toHaveBeenCalled();
    },
  );

  it('fails closed when no active realtime provider lane is configured', async () => {
    const subject = await loadSubject();
    const providerGet = vi.fn();
    const fixture = deps({
      lanes: { findActiveLane: vi.fn().mockResolvedValue(null) },
      providers: { get: providerGet },
    });
    const service = subject.createKeywordCurrentSerpService(fixture.value);

    await expect(service.observe(observeInput)).rejects.toThrow('CURRENT_SERP_LANE_NOT_CONFIGURED');
    expect(providerGet).not.toHaveBeenCalled();
    expect(fixture.persistCompletedSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed when the lane secret is unavailable and never calls the provider', async () => {
    const subject = await loadSubject();
    const fixture = deps({
      secrets: { resolve: vi.fn().mockResolvedValue(null) },
    });
    const service = subject.createKeywordCurrentSerpService(fixture.value);

    await expect(service.observe(observeInput)).rejects.toThrow('CURRENT_SERP_SECRET_NOT_CONFIGURED');
    expect(fixture.providerObserve).not.toHaveBeenCalled();
    expect(fixture.persistCompletedSnapshot).not.toHaveBeenCalled();
  });

  it('fails closed when the configured provider is not registered', async () => {
    const subject = await loadSubject();
    const fixture = deps({
      providers: { get: vi.fn().mockReturnValue(null) },
    });
    const service = subject.createKeywordCurrentSerpService(fixture.value);

    await expect(service.observe(observeInput)).rejects.toThrow('CURRENT_SERP_PROVIDER_NOT_REGISTERED');
    expect(fixture.persistCompletedSnapshot).not.toHaveBeenCalled();
  });

  it('persists realtime SearchFact semantics and keeps retry identity stable for the same provider observationRef', async () => {
    const subject = await loadSubject();
    const fixture = deps();
    const service = subject.createKeywordCurrentSerpService(fixture.value);

    const first = await service.observe(observeInput);
    const retry = await service.observe(observeInput);

    expect(first).toEqual({
      snapshotId: 'snapshot-001',
      position: 7,
      observationRef: 'dataforseo-task-001',
    });
    expect(retry).toEqual(first);
    expect(fixture.providerObserve).toHaveBeenCalledTimes(2);
    expect(fixture.persistCompletedSnapshot).toHaveBeenCalledTimes(2);

    const [firstIdentity, firstDrafts, firstHash] = fixture.persistCompletedSnapshot.mock.calls[0]!;
    const [retryIdentity, retryDrafts, retryHash] = fixture.persistCompletedSnapshot.mock.calls[1]!;

    expect(firstIdentity).toMatchObject({
      provider: 'GOOGLE_SERP',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceCompleteness: 'TOP_ROWS_ONLY',
    });
    expect(firstDrafts).toEqual([
      expect.objectContaining({
        factKind: 'QUERY_PAGE_RANK',
        metrics: [
          expect.objectContaining({
            metricSemantic: 'CURRENT_SERP_POSITION',
            numericValue: 7,
          }),
        ],
      }),
    ]);
    expect(retryIdentity).toEqual(firstIdentity);
    expect(retryDrafts).toEqual(firstDrafts);
    expect(retryHash).toBe(firstHash);
  });
});
