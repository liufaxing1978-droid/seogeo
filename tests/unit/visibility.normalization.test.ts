import { describe, expect, it } from 'vitest';
import {
  findDeterministicOccurrences,
  isCjkText,
  normalizeVisibilityDomain,
  normalizeVisibilityName,
  normalizeVisibilityText
} from '../../src/modules/visibility/visibility-normalization.js';

describe('P6-B deterministic visibility normalization', () => {
  it('normalizes Unicode width, whitespace, punctuation and Latin case deterministically', () => {
    expect(normalizeVisibilityText('  ＡＢＣ\u3000，\u00a0兴善堂—六壬  ')).toBe('abc, 兴善堂-六壬');
    expect(normalizeVisibilityText('“XST”\t／\n六壬')).toBe('"xst" / 六壬');
  });

  it('normalizes monitored names with NFKC, whitespace folding and Latin case folding', () => {
    expect(normalizeVisibilityName('  ＸＳＴ\u3000Studio  ')).toBe('xst studio');
    expect(normalizeVisibilityName('  兴善堂  ')).toBe('兴善堂');
  });

  it('normalizes domain identities without accepting URL paths as domain subjects', () => {
    expect(normalizeVisibilityDomain('WWW.Example.COM')).toBe('example.com');
    expect(normalizeVisibilityDomain('https://WWW.Example.COM:443')).toBe('example.com');
    expect(normalizeVisibilityDomain('http://www.example.com:80/')).toBe('example.com');
    expect(normalizeVisibilityDomain('example.com.')).toBe('example.com');

    expect(normalizeVisibilityDomain('https://example.com/path')).toBeNull();
    expect(normalizeVisibilityDomain('example.com/path')).toBeNull();
    expect(normalizeVisibilityDomain('https://example.com/?q=1')).toBeNull();
    expect(normalizeVisibilityDomain('https://example.com/#section')).toBeNull();
  });

  it('detects CJK text explicitly', () => {
    expect(isCjkText('兴善堂')).toBe(true);
    expect(isCjkText('六壬 XST')).toBe(true);
    expect(isCjkText('XST Studio')).toBe(false);
  });

  it('uses safe Latin boundaries instead of substring matching', () => {
    expect(findDeterministicOccurrences('XST xstation XST', 'xst', 'LATIN_BOUNDARY')).toEqual([0, 13]);
    expect(findDeterministicOccurrences('prexst xst2 (XST)', 'xst', 'LATIN_BOUNDARY')).toEqual([13]);
  });

  it('supports deterministic CJK substring matching without requiring spaces', () => {
    expect(findDeterministicOccurrences('兴善堂与六壬伏英馆，兴善堂。', '兴善堂', 'CJK_SUBSTRING')).toEqual([0, 10]);
  });

  it('matches domains only at deterministic token boundaries', () => {
    const matches = findDeterministicOccurrences(
      'visit xingshantang.org and notxingshantang.org.cn then XINGSHANTANG.ORG.',
      'xingshantang.org',
      'DOMAIN'
    );
    expect(matches).toHaveLength(2);
  });

  it('AUTO mode chooses CJK substring matching only for CJK needles', () => {
    expect(findDeterministicOccurrences('兴善堂兴善堂', '兴善堂', 'AUTO')).toEqual([0, 3]);
    expect(findDeterministicOccurrences('xstation XST', 'XST', 'AUTO')).toEqual([9]);
  });
});
