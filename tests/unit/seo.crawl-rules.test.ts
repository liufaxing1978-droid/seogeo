import { describe, expect, it } from 'vitest';
import { getCrawlRuleEvaluator } from '../../src/modules/seo/rule-registry.js';
import type { SeoCrawlFact } from '../../src/modules/seo/seo.types.js';

const clean: SeoCrawlFact = {
  robots: [{ statusCode: 200, parseError: null }],
  sitemaps: [{ statusCode: 200, type: 'URLSET', parseError: null, discoveredUrlCount: 12 }]
};

describe('deterministic crawl-level SEO rules', () => {
  it('does not treat a missing robots.txt (404) as an SEO error', () => {
    const fact: SeoCrawlFact = {
      ...clean,
      robots: [{ statusCode: 404, parseError: null }]
    };

    expect(getCrawlRuleEvaluator('ROBOTS_FETCH_FAILED')(fact).outcome).toBe('PASS');
    expect(getCrawlRuleEvaluator('ROBOTS_SERVER_ERROR')(fact).outcome).toBe('PASS');
  });

  it('flags a transport failure only when robots has no factual HTTP status', () => {
    const result = getCrawlRuleEvaluator('ROBOTS_FETCH_FAILED')({
      ...clean,
      robots: [{ statusCode: null, parseError: 'robots unavailable: TIMEOUT' }]
    });

    expect(result).toEqual({
      outcome: 'FAIL',
      evidence: { parseError: 'robots unavailable: TIMEOUT' }
    });
  });

  it('flags factual robots server errors separately', () => {
    expect(
      getCrawlRuleEvaluator('ROBOTS_SERVER_ERROR')({
        ...clean,
        robots: [{ statusCode: 503, parseError: 'robots unavailable: HTTP 503' }]
      })
    ).toEqual({ outcome: 'FAIL', evidence: { statusCode: 503 } });
  });

  it('flags an unavailable sitemap when no usable 2xx parsed source exists', () => {
    expect(
      getCrawlRuleEvaluator('SITEMAP_UNAVAILABLE')({
        ...clean,
        sitemaps: [{ statusCode: 404, type: null, parseError: 'HTTP 404', discoveredUrlCount: 0 }]
      }).outcome
    ).toBe('FAIL');
  });

  it('flags sitemap parse errors only on fetched 2xx sources', () => {
    expect(
      getCrawlRuleEvaluator('SITEMAP_PARSE_ERROR')({
        ...clean,
        sitemaps: [{ statusCode: 200, type: null, parseError: 'Invalid XML', discoveredUrlCount: 0 }]
      })
    ).toEqual({
      outcome: 'FAIL',
      evidence: { parseErrors: [{ statusCode: 200, parseError: 'Invalid XML' }] }
    });

    expect(
      getCrawlRuleEvaluator('SITEMAP_PARSE_ERROR')({
        ...clean,
        sitemaps: [{ statusCode: 404, type: null, parseError: 'HTTP 404', discoveredUrlCount: 0 }]
      }).outcome
    ).toBe('NOT_APPLICABLE');
  });

  it('flags an empty usable URLSET without inventing affected page URLs', () => {
    expect(
      getCrawlRuleEvaluator('SITEMAP_EMPTY')({
        ...clean,
        sitemaps: [{ statusCode: 200, type: 'URLSET', parseError: null, discoveredUrlCount: 0 }]
      })
    ).toEqual({
      outcome: 'FAIL',
      evidence: { emptySources: 1 }
    });
  });
});
