import { describe, expect, it } from 'vitest';
import { normalizeKeywordText } from '../../src/modules/keywords/keyword-normalize.js';

describe('normalizeKeywordText', () => {
  it('normalizes Unicode width, spaces, and Latin case', () => {
    expect(normalizeKeywordText('  Ｆｏｏ   符紙  ')).toBe('foo 符紙');
  });

  it('does not merge Traditional and Simplified Chinese terms', () => {
    expect(normalizeKeywordText('符紙')).not.toBe(normalizeKeywordText('符纸'));
  });
});
