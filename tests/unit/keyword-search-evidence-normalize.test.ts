import { describe, expect, it } from 'vitest';
import * as moduleUnderTest from '../../src/modules/keywords/keyword-search-evidence-normalize.js';

const subject = moduleUnderTest as unknown as {
  normalizeSearchEvidenceQuery(text: string): string;
};

describe('P11-02A search evidence normalization', () => {
  it('normalizes width, punctuation and whitespace', () => {
    expect(subject.normalizeSearchEvidenceQuery('  ＦＯＯ　“符紙” — bar  '))
      .toBe('foo "符紙" - bar');
    expect(subject.normalizeSearchEvidenceQuery(' user’s   guide '))
      .toBe("user's guide");
  });

  it('does not collapse Traditional/Simplified Chinese', () => {
    expect(subject.normalizeSearchEvidenceQuery('符紙'))
      .not.toBe(subject.normalizeSearchEvidenceQuery('符纸'));
  });
});
