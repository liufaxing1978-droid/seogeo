import { describe, expect, it } from 'vitest';
import { evaluateKeywordCannibalization } from '../../src/modules/keywords/keyword-cannibalization.js';

describe('P4 cannibalization policy', () => {
  it('makes Growth-detected search competition HIGH and never emits a redirect mutation', () => {
    const result = evaluateKeywordCannibalization({ growthDetected: true, mappingConflict: false, coverageUrls: [] });
    expect(result).toMatchObject({ risk: 'HIGH', recommendedAction: 'REVIEW' });
    expect(result.recommendedAction).not.toBe('REDIRECT');
  });

  it('uses MEDIUM/REPOSITION for mapping conflict', () => {
    expect(evaluateKeywordCannibalization({ growthDetected: false, mappingConflict: true, coverageUrls: [] }))
      .toMatchObject({ risk: 'MEDIUM', recommendedAction: 'REPOSITION' });
  });
});
