import { describe, expect, it } from 'vitest';
import {
  scoreKeywordOpportunity,
  type KeywordOpportunityScoreInput,
} from '../../src/modules/keywords/keyword-opportunity-score.js';

const unknown = { state: 'UNKNOWN' as const, score: null, provenance: [] };

function input(
  overrides: Partial<KeywordOpportunityScoreInput['components']>,
): KeywordOpportunityScoreInput {
  return {
    components: {
      relevance: unknown,
      demand: unknown,
      rankingOpportunity: unknown,
      difficulty: unknown,
      contentGap: unknown,
      authorityFit: unknown,
      strategicValue: unknown,
      geoValue: unknown,
      ...overrides,
    },
  };
}

describe('scoreKeywordOpportunity', () => {
  it.each([
    {
      name: 'normalizes a complete evidence set across all configured weight',
      given: input({
        relevance: { state: 'KNOWN', score: 80, provenance: ['PROJECT_RELEVANCE'] },
        demand: { state: 'KNOWN', score: 70, provenance: ['GSC_IMPRESSIONS'] },
        rankingOpportunity: { state: 'KNOWN', score: 90, provenance: ['GSC_POSITION'] },
        difficulty: { state: 'KNOWN', score: 60, provenance: ['PROVIDER_DIFFICULTY'] },
        contentGap: { state: 'KNOWN', score: 100, provenance: ['PAGE_COVERAGE'] },
        authorityFit: { state: 'KNOWN', score: 75, provenance: ['PAGE_COVERAGE'] },
        strategicValue: { state: 'KNOWN', score: 100, provenance: ['KEYWORD_PRIORITY'] },
        geoValue: { state: 'KNOWN', score: 90, provenance: ['KEYWORD_INTENT'] },
      }),
      wantScore: 82,
      wantConfidence: 1,
    },
    {
      name: 'renormalizes partial evidence without filling unknown dimensions',
      given: input({
        demand: { state: 'KNOWN', score: 80, provenance: ['GSC_IMPRESSIONS'] },
        contentGap: { state: 'KNOWN', score: 100, provenance: ['PAGE_COVERAGE'] },
        strategicValue: { state: 'KNOWN', score: 100, provenance: ['KEYWORD_PRIORITY'] },
        geoValue: { state: 'KNOWN', score: 80, provenance: ['KEYWORD_INTENT'] },
      }),
      wantScore: 90,
      wantConfidence: 0.4,
    },
    {
      name: 'withholds the score below the minimum evidence threshold',
      given: input({
        strategicValue: { state: 'KNOWN', score: 100, provenance: ['KEYWORD_PRIORITY'] },
        geoValue: { state: 'KNOWN', score: 80, provenance: ['KEYWORD_INTENT'] },
      }),
      wantScore: null,
      wantConfidence: 0.15,
    },
    {
      name: 'keeps a completely unknown evidence set unknown',
      given: input({}),
      wantScore: null,
      wantConfidence: 0,
    },
  ])('$name', ({ given, wantScore, wantConfidence }) => {
    const result = scoreKeywordOpportunity(given);

    expect(result.score).toBe(wantScore);
    expect(result.dataConfidence).toBe(wantConfidence);
    expect(result.formulaVersion).toBe('keyword-opportunity-v1');
    expect(result.breakdown.relevance.state).toBe(given.components.relevance.state);
    expect(result.breakdown.relevance.score).toBe(given.components.relevance.score);
  });

  it('rejects out-of-range component scores instead of silently clamping them', () => {
    expect(() => scoreKeywordOpportunity(input({
      demand: { state: 'KNOWN', score: 101, provenance: ['BAD_PROVIDER_VALUE'] },
    }))).toThrow('Opportunity component score must be between 0 and 100');
  });
});
