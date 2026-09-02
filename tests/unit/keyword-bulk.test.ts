import { describe, expect, it } from 'vitest';
import { planKeywordBulkCreate } from '../../src/modules/keywords/keyword-bulk.js';

describe('planKeywordBulkCreate', () => {
  it('keeps the first spelling and reports later normalized duplicates', () => {
    expect(planKeywordBulkCreate({
      text: '符纸\n  符纸  \n六壬法教\n符纸',
      existingNormalized: new Set(),
    })).toEqual({
      candidates: [
        { line: 1, text: '符纸', normalizedText: '符纸' },
        { line: 3, text: '六壬法教', normalizedText: '六壬法教' },
      ],
      duplicates: [
        { line: 2, text: '符纸', normalizedText: '符纸', reason: 'DUPLICATE_IN_REQUEST' },
        { line: 4, text: '符纸', normalizedText: '符纸', reason: 'DUPLICATE_IN_REQUEST' },
      ],
    });
  });

  it('reports project-existing identities without creating candidates', () => {
    expect(planKeywordBulkCreate({
      text: '符纸\n六壬法教',
      existingNormalized: new Set(['符纸']),
    })).toEqual({
      candidates: [{ line: 2, text: '六壬法教', normalizedText: '六壬法教' }],
      duplicates: [
        { line: 1, text: '符纸', normalizedText: '符纸', reason: 'ALREADY_EXISTS' },
      ],
    });
  });
});
