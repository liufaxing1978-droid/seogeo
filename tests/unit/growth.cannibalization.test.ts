import { describe, expect, it } from 'vitest';
import { detectKeywordCannibalization } from '../../src/modules/growth/cannibalization.js';

function page(canonicalPage: string, impressions: number, position: number | null, ctr = 0.05) {
  return { canonicalPage, impressions, position, ctr };
}

describe('P7-A keyword cannibalization detector', () => {
  it('detects balanced material pages when demand, share and ranking competition are satisfied', () => {
    const result = detectKeywordCannibalization({
      normalizedQuery: '六壬',
      demandScore: 65,
      pages: [
        page('https://example.com/a', 55, 8, 0.08),
        page('https://example.com/b', 45, 12, 0.06)
      ]
    }, { pageEvidenceStrength: { 'https://example.com/a': 80, 'https://example.com/b': 60 } });

    expect(result.state).toBe('DETECTED');
    expect(result.competingPages).toHaveLength(2);
    expect(result.primaryPageCandidate).toEqual({ state: 'KNOWN', canonicalPage: 'https://example.com/a' });
  });

  it('requires Demand Score >=40 and two pages each >=20% while no page reaches 80%', () => {
    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 39,
      pages: [page('https://e.com/a', 50, 8), page('https://e.com/b', 50, 9)]
    }).state).toBe('NOT_DETECTED');

    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 80, 8), page('https://e.com/b', 20, 9)]
    }).state).toBe('NOT_DETECTED');

    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 81, 8), page('https://e.com/b', 19, 9)]
    }).state).toBe('NOT_DETECTED');
  });

  it('requires ranking competition: both material pages top 30 or position distance <=10', () => {
    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 55, 25), page('https://e.com/b', 45, 30)]
    }).state).toBe('DETECTED');

    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 55, 35), page('https://e.com/b', 45, 44)]
    }).state).toBe('DETECTED');

    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 55, 35), page('https://e.com/b', 45, 46)]
    }).state).toBe('NOT_DETECTED');
  });

  it('collapses canonical-equivalent URL variants before share checks', () => {
    const result = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [
        page('https://EXAMPLE.com/a/', 40, 8),
        page('https://example.com/a#section', 20, 9),
        page('https://example.com/b', 40, 10)
      ]
    });
    expect(result.state).toBe('DETECTED');
    expect(result.competingPages).toHaveLength(2);
  });

  it('uses share, position, CTR, then evidence strength for the primary-page candidate', () => {
    const share = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 55, 20, 0.02), page('https://e.com/b', 45, 5, 0.20)]
    });
    expect(share.primaryPageCandidate).toEqual({ state: 'KNOWN', canonicalPage: 'https://e.com/a' });

    const position = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 50, 8, 0.02), page('https://e.com/b', 50, 10, 0.20)]
    });
    expect(position.primaryPageCandidate).toEqual({ state: 'KNOWN', canonicalPage: 'https://e.com/a' });

    const ctr = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 50, 8, 0.10), page('https://e.com/b', 50, 8, 0.08)]
    });
    expect(ctr.primaryPageCandidate).toEqual({ state: 'KNOWN', canonicalPage: 'https://e.com/a' });

    const evidence = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 50, 8, 0.10), page('https://e.com/b', 50, 8, 0.10)]
    }, { pageEvidenceStrength: { 'https://e.com/a': 90, 'https://e.com/b': 70 } });
    expect(evidence.primaryPageCandidate).toEqual({ state: 'KNOWN', canonicalPage: 'https://e.com/a' });
  });

  it('returns UNKNOWN candidate when all deterministic candidate tie-breaks remain tied', () => {
    const result = detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 50, 8, 0.10), page('https://e.com/b', 50, 8, 0.10)]
    }, { pageEvidenceStrength: { 'https://e.com/a': 80, 'https://e.com/b': 80 } });
    expect(result.state).toBe('DETECTED');
    expect(result.primaryPageCandidate).toEqual({ state: 'UNKNOWN', canonicalPage: null });
  });

  it('fails closed on missing demand/ranking evidence and enforces the 20-page bound', () => {
    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: null,
      pages: [page('https://e.com/a', 50, 8), page('https://e.com/b', 50, 9)]
    }).state).toBe('UNKNOWN');

    expect(detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: [page('https://e.com/a', 50, null), page('https://e.com/b', 50, 9)]
    }).state).toBe('UNKNOWN');

    expect(() => detectKeywordCannibalization({
      normalizedQuery: 'q', demandScore: 65,
      pages: Array.from({ length: 21 }, (_, index) => page(`https://e.com/${index}`, 10, 10))
    })).toThrow(/20/);
  });
});
