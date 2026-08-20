import { describe, expect, it } from 'vitest';
import { detectNewContentOpportunity } from '../../src/modules/growth/new-content.js';

function page(canonicalPage: string, impressions: number, position: number | null) {
  return { canonicalPage, impressions, position };
}

function valid(overrides: Record<string, unknown> = {}) {
  return {
    normalizedQuery: '六壬历史',
    demandScore: 65,
    queryImpressions: 100,
    projectP50Impressions: 80,
    pages: [page('https://example.com/general', 60, 24), page('https://example.com/other', 40, 30)],
    ...overrides
  };
}

const context = {
  hasCoverageGap: true,
  hasDeterministicDuplicateLandingPage: false,
  evidenceKnown: true,
  cannibalizationActive: false
};

describe('P7-A conservative new content opportunity detector', () => {
  it('detects only when all conservative V1 gates pass', () => {
    expect(detectNewContentOpportunity(valid(), context)).toMatchObject({
      state: 'DETECTED',
      type: 'NEW_CONTENT_OPPORTUNITY'
    });
  });

  it('requires Demand Score >=65 and query impressions >= project P50', () => {
    expect(detectNewContentOpportunity(valid({ demandScore: 64 }), context).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid({ queryImpressions: 79 }), context).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid({ queryImpressions: 80 }), context).state).toBe('DETECTED');
  });

  it('requires best existing page position strictly greater than 20', () => {
    expect(detectNewContentOpportunity(valid({
      pages: [page('https://e.com/a', 60, 20), page('https://e.com/b', 40, 30)]
    }), context).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid({
      pages: [page('https://e.com/a', 60, 20.1), page('https://e.com/b', 40, 30)]
    }), context).state).toBe('DETECTED');
  });

  it('rejects a dominant existing page with impression share >=70%', () => {
    expect(detectNewContentOpportunity(valid({
      pages: [page('https://e.com/a', 70, 25), page('https://e.com/b', 30, 30)]
    }), context).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid({
      pages: [page('https://e.com/a', 69, 25), page('https://e.com/b', 31, 30)]
    }), context).state).toBe('DETECTED');
  });

  it('requires a known P3/P5 coverage gap and no deterministic duplicate landing page', () => {
    expect(detectNewContentOpportunity(valid(), { ...context, hasCoverageGap: false }).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid(), { ...context, hasCoverageGap: null }).state).toBe('UNKNOWN');
    expect(detectNewContentOpportunity(valid(), { ...context, hasDeterministicDuplicateLandingPage: true }).state).toBe('NOT_DETECTED');
    expect(detectNewContentOpportunity(valid(), { ...context, hasDeterministicDuplicateLandingPage: null }).state).toBe('UNKNOWN');
  });

  it('does not create New Content while the same query/window has active cannibalization', () => {
    expect(detectNewContentOpportunity(valid(), { ...context, cannibalizationActive: true }).state).toBe('NOT_DETECTED');
  });

  it('fails closed when minimum evidence or ranking facts are unknown', () => {
    expect(detectNewContentOpportunity(valid(), { ...context, evidenceKnown: false }).state).toBe('UNKNOWN');
    expect(detectNewContentOpportunity(valid({ demandScore: null }), context).state).toBe('UNKNOWN');
    expect(detectNewContentOpportunity(valid({ projectP50Impressions: null }), context).state).toBe('UNKNOWN');
    expect(detectNewContentOpportunity(valid({
      pages: [page('https://e.com/a', 60, null), page('https://e.com/b', 40, 30)]
    }), context).state).toBe('UNKNOWN');
  });
});
