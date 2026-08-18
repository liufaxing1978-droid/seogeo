import { describe, expect, it } from 'vitest';
import { analyzeCitability } from '../../src/modules/geo/citability.js';

describe('deterministic Citability analyzer', () => {
  it('scores only factual structural signals and leaves unavailable semantic dimensions unknown', () => {
    const result = analyzeCitability({
      pageId: 'page-1',
      normalizedUrl: 'https://example.com/guide',
      statusCode: 200,
      contentType: 'text/html',
      title: 'A factual guide to the example topic',
      canonicalUrl: 'https://example.com/guide',
      h1: 'Example topic guide',
      h1Count: 1,
      h2Count: 4,
      h3Count: 2,
      wordCount: 900,
      internalLinksCount: 8,
      externalLinksCount: 3,
      schemaCount: 2,
      indexable: true
    });

    expect(result.answerFirstScore).toBeNull();
    expect(result.factualDensityScore).toBeNull();
    expect(result.definitionClarityScore).toBeNull();
    expect(result.headingStructureScore).toBe(100);
    expect(result.sourceSupportScore).toBe(100);
    expect(result.extractabilityScore).toBe(100);
    expect(result.overallScore).toBe(100);
    expect(result.evidence.availability).toEqual({
      answerFirst: false,
      headingStructure: true,
      factualDensity: false,
      sourceSupport: true,
      extractability: true,
      definitionClarity: false
    });
  });

  it('does not confuse external-link presence with source authority', () => {
    const result = analyzeCitability({
      pageId: 'page-2',
      normalizedUrl: 'https://example.com/basic',
      statusCode: 200,
      contentType: 'text/html',
      title: 'Basic page',
      canonicalUrl: null,
      h1: null,
      h1Count: 0,
      h2Count: 0,
      h3Count: 0,
      wordCount: 120,
      internalLinksCount: 1,
      externalLinksCount: 1,
      schemaCount: 0,
      indexable: null
    });

    expect(result.sourceSupportScore).toBe(60);
    expect(result.evidence.sourceSupport).toMatchObject({
      externalLinksCount: 1,
      authorityEvaluated: false
    });
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThan(60);
  });

  it('returns null overall readiness when no deterministic component can be evaluated', () => {
    const result = analyzeCitability({
      pageId: 'page-3',
      normalizedUrl: 'https://example.com/file.pdf',
      statusCode: 200,
      contentType: 'application/pdf',
      title: null,
      canonicalUrl: null,
      h1: null,
      h1Count: 0,
      h2Count: 0,
      h3Count: 0,
      wordCount: 0,
      internalLinksCount: 0,
      externalLinksCount: 0,
      schemaCount: 0,
      indexable: null
    });

    expect(result.eligible).toBe(false);
    expect(result.overallScore).toBeNull();
  });
});
