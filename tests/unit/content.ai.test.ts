import { describe, expect, it } from 'vitest';
import { parseContentBriefOutput, parseContentOptimizationOutput } from '../../src/modules/ai/content-intelligence.js';

describe('P5-A content AI structured output', () => {
  const supplied = [{ type: 'CONTENT_DOCUMENT', id: 'doc-1' }, { type: 'CONTENT_OPPORTUNITY', id: 'opp-1' }];

  it('accepts a bounded content brief with supplied source refs', () => {
    const output = parseContentBriefOutput(JSON.stringify({
      objective: 'Improve topic coverage', audience: 'Readers', primaryTopic: 'Topic', supportingTopics: ['Support'],
      recommendedOutline: ['Intro', 'Details'], entitiesToCover: ['Entity'], questionsToAnswer: ['Question?'],
      internalLinkSuggestions: ['Link to guide'], evidenceNotes: ['Based on deterministic document facts'],
      sourceReferences: ['CONTENT_DOCUMENT:doc-1']
    }), supplied);
    expect(output.primaryTopic).toBe('Topic');
  });

  it('rejects hallucinated source references', () => {
    expect(() => parseContentOptimizationOutput(JSON.stringify({
      summary: 'Summary', priorities: [{ priority: 'HIGH', action: 'Action', sourceRefs: ['SEO_RANKING:fake'] }],
      sectionRecommendations: [], entityRecommendations: [], internalLinkRecommendations: [], citabilityRecommendations: [], doNotChange: [],
      sourceReferences: ['CONTENT_DOCUMENT:doc-1']
    }), supplied)).toThrow(/source reference/i);
  });
});
