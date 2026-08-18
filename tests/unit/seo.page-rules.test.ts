import { describe, expect, it } from 'vitest';
import { BUILTIN_PAGE_RULES } from '../../src/modules/seo/rule-catalog.js';
import { getPageRuleEvaluator } from '../../src/modules/seo/rule-registry.js';
import type { SeoPageFact } from '../../src/modules/seo/seo.types.js';

const baseFact: SeoPageFact = {
  pageId: '00000000-0000-0000-0000-000000000001',
  normalizedUrl: 'https://example.com/',
  statusCode: 200,
  contentType: 'text/html',
  title: 'A useful page title',
  metaDescription: 'A useful meta description for the page.',
  canonicalUrl: 'https://example.com/',
  metaRobots: null,
  h1: 'Page heading',
  h1Count: 1,
  wordCount: 500,
  imagesCount: 2,
  imagesWithoutAlt: 0,
  responseTimeMs: 250,
  htmlSizeBytes: 50000,
  indexable: true,
  redirectCount: 0
};

describe('SEO page rule registry', () => {
  it('has one evaluator for every built-in page rule', () => {
    for (const rule of BUILTIN_PAGE_RULES) {
      expect(getPageRuleEvaluator(rule.ruleCode)).toBeTypeOf('function');
    }
  });

  it('throws for an unknown configured rule instead of silently skipping it', () => {
    expect(() => getPageRuleEvaluator('UNKNOWN_RULE')).toThrow(/unknown seo rule/i);
  });
});

describe('deterministic SEO page rules', () => {
  it('marks a missing title as FAIL only for an eligible 2xx HTML page', () => {
    const evaluate = getPageRuleEvaluator('TITLE_MISSING');

    expect(evaluate({ ...baseFact, title: null })).toEqual({
      outcome: 'FAIL',
      evidence: { title: null }
    });
    expect(evaluate({ ...baseFact, statusCode: 404, title: null }).outcome).toBe('NOT_APPLICABLE');
    expect(evaluate({ ...baseFact, statusCode: null, title: null }).outcome).toBe('UNKNOWN');
    expect(evaluate({ ...baseFact, contentType: 'application/pdf', title: null }).outcome).toBe('NOT_APPLICABLE');
  });

  it('uses the persisted redirect chain rather than final response status to detect redirects', () => {
    const evaluate = getPageRuleEvaluator('HTTP_REDIRECT');

    expect(evaluate({ ...baseFact, statusCode: 200, redirectCount: 2 })).toEqual({
      outcome: 'FAIL',
      evidence: { redirectCount: 2 }
    });
    expect(evaluate({ ...baseFact, statusCode: 200, redirectCount: 0 }).outcome).toBe('PASS');
    expect(evaluate({ ...baseFact, statusCode: null, redirectCount: 0 }).outcome).toBe('UNKNOWN');
  });

  it('does not penalize missing canonical on a factually non-indexable page', () => {
    const evaluate = getPageRuleEvaluator('CANONICAL_MISSING');

    expect(evaluate({ ...baseFact, canonicalUrl: null, indexable: false }).outcome).toBe('NOT_APPLICABLE');
    expect(evaluate({ ...baseFact, canonicalUrl: null, indexable: null }).outcome).toBe('UNKNOWN');
    expect(evaluate({ ...baseFact, canonicalUrl: null, indexable: true })).toEqual({
      outcome: 'FAIL',
      evidence: { canonicalUrl: null }
    });
  });

  it('records exact evidence for a slow factual HTTP response', () => {
    const evaluate = getPageRuleEvaluator('SLOW_RESPONSE');

    expect(evaluate({ ...baseFact, responseTimeMs: 4200 })).toEqual({
      outcome: 'FAIL',
      evidence: { responseTimeMs: 4200, thresholdMs: 3000 }
    });
    expect(evaluate({ ...baseFact, responseTimeMs: 500 }).outcome).toBe('PASS');
    expect(evaluate({ ...baseFact, statusCode: null, responseTimeMs: 15000 }).outcome).toBe('UNKNOWN');
  });

  it('reports missing image alt text with factual counts', () => {
    const evaluate = getPageRuleEvaluator('IMAGE_ALT_MISSING');

    expect(evaluate({ ...baseFact, imagesCount: 5, imagesWithoutAlt: 2 })).toEqual({
      outcome: 'FAIL',
      evidence: { imagesCount: 5, imagesWithoutAlt: 2 }
    });
  });

  it('distinguishes unknown HTTP facts from a clean HTTP status', () => {
    expect(getPageRuleEvaluator('HTTP_5XX')({ ...baseFact, statusCode: null }).outcome).toBe('UNKNOWN');
    expect(getPageRuleEvaluator('HTTP_5XX')({ ...baseFact, statusCode: 503 }).outcome).toBe('FAIL');
    expect(getPageRuleEvaluator('HTTP_4XX')({ ...baseFact, statusCode: 404 }).outcome).toBe('FAIL');
  });

  it('keeps non-HTML documents out of HTML-only rules', () => {
    const pdf = { ...baseFact, contentType: 'application/pdf', title: null, h1Count: 0, wordCount: 0 };

    expect(getPageRuleEvaluator('TITLE_MISSING')(pdf).outcome).toBe('NOT_APPLICABLE');
    expect(getPageRuleEvaluator('H1_MISSING')(pdf).outcome).toBe('NOT_APPLICABLE');
    expect(getPageRuleEvaluator('THIN_CONTENT')(pdf).outcome).toBe('NOT_APPLICABLE');
  });
});
