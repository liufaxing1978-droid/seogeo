import { describe, expect, it } from 'vitest';
import { resolveKeywordCoverage } from '../../src/modules/keywords/keyword-coverage.js';

const base = {
  pageId: '00000000-0000-0000-0000-000000000001',
  url: 'https://example.com/culture/fuzhi',
  path: '/culture/fuzhi',
  title: null,
  h1: null,
  metaDescription: null,
};

describe('keyword coverage scoring', () => {
  it('returns STRONG for title or H1 evidence', () => {
    expect(
      resolveKeywordCoverage('符纸', [{ ...base, title: '符纸：传统用途与文化' }]).status,
    ).toBe('STRONG');
    expect(
      resolveKeywordCoverage('符纸', [{ ...base, h1: '六壬符纸文化' }]).status,
    ).toBe('STRONG');
  });

  it('returns PARTIAL for weaker meta evidence', () => {
    expect(
      resolveKeywordCoverage('符纸', [{ ...base, metaDescription: '介绍符纸的历史来源' }]).status,
    ).toBe('PARTIAL');
  });

  it('returns NONE only when usable evidence exists but has no match', () => {
    const result = resolveKeywordCoverage('符纸', [
      { ...base, title: '六壬文化', h1: '民间信仰' },
    ]);

    expect(result).toEqual({ status: 'NONE', reason: 'NO_MATCH', matches: [] });
  });

  it('returns UNKNOWN when usable crawl evidence is absent', () => {
    expect(resolveKeywordCoverage('符纸', [], 'NO_USABLE_SNAPSHOT_EVIDENCE')).toEqual({
      status: 'UNKNOWN',
      reason: 'NO_USABLE_SNAPSHOT_EVIDENCE',
      matches: [],
    });
  });
});
