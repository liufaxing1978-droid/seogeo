import { describe, expect, it } from 'vitest';

const modulePath = '../../src/modules/keywords/keyword-current-serp.js';

type SerpResult = {
  position: number;
  url: string;
};

type CurrentSerpModule = {
  resolveCurrentSerpPosition(input: {
    targetUrl: string;
    results: SerpResult[];
  }): number | null;
  buildCurrentSerpSearchFact(input: {
    projectId: string;
    keywordId: string;
    keywordText: string;
    searchEngine: 'GOOGLE' | 'BING';
    marketCode: string;
    locale: string;
    targetUrl: string;
    observedAt: Date;
    searchDepth: number;
    observationRef: string;
    position: number | null;
  }): {
    identity: {
      sourceKind: string;
      sourceRef: string;
      sourceCompleteness: string;
    };
    draft: {
      factKind: string;
      query: string | null;
      page: string | null;
      metrics: Array<{
        metricSemantic: string;
        numericValue: number | null;
        evidenceState: string;
      }>;
    };
  };
};

async function loadSubject(): Promise<CurrentSerpModule> {
  return await import(modulePath) as CurrentSerpModule;
}

describe('P11-02C current SERP rank semantics', () => {
  it('uses the provider-reported organic result position for the target URL', async () => {
    const subject = await loadSubject();

    expect(subject.resolveCurrentSerpPosition({
      targetUrl: 'https://example.com/fuzhi',
      results: [
        { position: 1, url: 'https://other.example/a' },
        { position: 3, url: 'https://example.com/fuzhi' },
        { position: 5, url: 'https://other.example/b' },
      ],
    })).toBe(3);
  });

  it('returns null rather than a sentinel rank when the target is absent within search depth', async () => {
    const subject = await loadSubject();

    expect(subject.resolveCurrentSerpPosition({
      targetUrl: 'https://example.com/fuzhi',
      results: [
        { position: 1, url: 'https://other.example/a' },
        { position: 100, url: 'https://other.example/z' },
      ],
    })).toBeNull();
  });

  it('materializes realtime rank with a distinct metric semantic from official average position', async () => {
    const subject = await loadSubject();

    const fact = subject.buildCurrentSerpSearchFact({
      projectId: '00000000-0000-0000-0000-000000000001',
      keywordId: '00000000-0000-0000-0000-000000000002',
      keywordText: '符纸',
      searchEngine: 'GOOGLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      targetUrl: 'https://example.com/fuzhi',
      observedAt: new Date('2026-08-31T12:00:00.000Z'),
      searchDepth: 100,
      observationRef: 'rank-run-001',
      position: 7,
    });

    expect(fact.identity).toMatchObject({
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceCompleteness: 'TOP_ROWS_ONLY',
    });
    expect(fact.draft).toMatchObject({
      factKind: 'QUERY_PAGE_RANK',
      query: '符纸',
      page: 'https://example.com/fuzhi',
    });
    expect(fact.draft.metrics).toEqual([
      expect.objectContaining({
        metricSemantic: 'CURRENT_SERP_POSITION',
        numericValue: 7,
        evidenceState: 'KNOWN_PRESENT',
      }),
    ]);
    expect(fact.draft.metrics.map((metric) => metric.metricSemantic)).not.toContain(
      'GOOGLE_SEARCH_CONSOLE_POSITION',
    );
  });

  it('uses a stable observationRef-backed source identity and persists unknown rank as KNOWN_EMPTY', async () => {
    const subject = await loadSubject();
    const input = {
      projectId: '00000000-0000-0000-0000-000000000001',
      keywordId: '00000000-0000-0000-0000-000000000002',
      keywordText: '符纸',
      searchEngine: 'GOOGLE' as const,
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      targetUrl: 'https://example.com/fuzhi',
      observedAt: new Date('2026-08-31T12:00:00.000Z'),
      searchDepth: 100,
      observationRef: 'rank-run-retry-safe',
      position: null,
    };

    const first = subject.buildCurrentSerpSearchFact(input);
    const retry = subject.buildCurrentSerpSearchFact({ ...input });

    expect(retry.identity.sourceRef).toBe(first.identity.sourceRef);
    expect(first.identity.sourceRef).toContain('rank-run-retry-safe');
    expect(first.draft.metrics).toEqual([
      expect.objectContaining({
        metricSemantic: 'CURRENT_SERP_POSITION',
        numericValue: null,
        evidenceState: 'KNOWN_EMPTY',
      }),
    ]);
  });
});
