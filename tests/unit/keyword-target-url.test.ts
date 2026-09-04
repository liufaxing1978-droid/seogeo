import { describe, expect, it } from 'vitest';
import { normalizeProjectTargetUrl, resolveEffectiveTargetUrl } from '../../src/modules/keywords/keyword-target-url.js';

describe('P4 target URL policy', () => {
  it('returns AMBIGUOUS instead of choosing distinct inherited Cluster URLs', () => {
    expect(resolveEffectiveTargetUrl({
      direct: null,
      inherited: ['https://example.com/guide', 'https://example.com/research'],
    })).toEqual({
      state: 'AMBIGUOUS',
      url: null,
      urls: ['https://example.com/guide', 'https://example.com/research'],
    });
  });

  it('normalizes in-scope URLs and rejects unsafe targets', () => {
    expect(normalizeProjectTargetUrl('https://WWW.example.com/guide?b=2&a=1#section', 'example.com'))
      .toBe('https://www.example.com/guide?a=1&b=2');
    expect(() => normalizeProjectTargetUrl('mailto:a@example.com', 'example.com')).toThrow();
    expect(() => normalizeProjectTargetUrl('https://other.example/path', 'example.com')).toThrow();
  });
});
