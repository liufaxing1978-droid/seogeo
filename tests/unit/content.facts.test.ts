import { describe, expect, it } from 'vitest';
import { buildContentFacts } from '../../src/modules/content/content-facts.js';

describe('buildContentFacts', () => {
  it('maps persisted snapshot facts without inventing unknown values', () => {
    const facts = buildContentFacts({
      projectId: 'project-1',
      pageId: 'page-1',
      normalizedUrl: 'https://example.com/guide',
      snapshotId: 'snapshot-1',
      statusCode: 200,
      contentType: 'text/html; charset=utf-8',
      canonicalUrl: null,
      title: ' Guide ',
      metaDescription: null,
      h1: 'Guide',
      language: 'zh-CN',
      wordCount: 1200,
      h1Count: 1,
      h2Count: 3,
      h3Count: 2,
      imagesCount: 4,
      internalLinksCount: 8,
      externalLinksCount: 1,
      schemaTypes: ['Article', 'BreadcrumbList'],
      contentHash: 'abc123',
      capturedAt: new Date('2026-08-19T00:00:00Z')
    });

    expect(facts.canonicalUrl).toBe('https://example.com/guide');
    expect(facts.title).toBe('Guide');
    expect(facts.headingCount).toBe(6);
    expect(facts.wordCount).toBe(1200);
    expect(facts.schemaTypes).toEqual(['Article', 'BreadcrumbList']);
    expect(facts.contentHash).toBe('abc123');
  });

  it('preserves unknown counts as null', () => {
    const facts = buildContentFacts({
      projectId: 'project-1',
      pageId: 'page-1',
      normalizedUrl: 'https://example.com/empty',
      snapshotId: 'snapshot-2',
      statusCode: null,
      contentType: null,
      canonicalUrl: null,
      title: null,
      metaDescription: null,
      h1: null,
      language: null,
      wordCount: null,
      h1Count: null,
      h2Count: null,
      h3Count: null,
      imagesCount: null,
      internalLinksCount: null,
      externalLinksCount: null,
      schemaTypes: [],
      contentHash: null,
      capturedAt: new Date('2026-08-19T00:00:00Z')
    });

    expect(facts.wordCount).toBeNull();
    expect(facts.headingCount).toBeNull();
    expect(facts.imageCount).toBeNull();
    expect(facts.internalLinkCount).toBeNull();
    expect(facts.contentHash).toMatch(/^missing:/);
  });

  it('turns parsed-looking fields into UNKNOWN for explicit failed or non-HTML snapshots', () => {
    for (const transport of [
      { statusCode: 500, contentType: 'text/html' },
      { statusCode: 200, contentType: 'application/pdf' }
    ]) {
      const facts = buildContentFacts({
        projectId: 'project-1',
        pageId: 'page-ineligible',
        normalizedUrl: 'https://example.com/ineligible',
        snapshotId: `snapshot-${transport.statusCode}-${transport.contentType}`,
        ...transport,
        canonicalUrl: null,
        title: 'Should not become a content fact',
        metaDescription: 'Should not become a content fact',
        h1: 'Should not become a content fact',
        language: 'en',
        wordCount: 0,
        h1Count: 0,
        h2Count: 0,
        h3Count: 0,
        imagesCount: 0,
        internalLinksCount: 0,
        externalLinksCount: 0,
        schemaTypes: [],
        contentHash: null,
        capturedAt: new Date('2026-08-19T00:00:00Z')
      });

      expect(facts.title).toBeNull();
      expect(facts.h1).toBeNull();
      expect(facts.wordCount).toBeNull();
      expect(facts.headingCount).toBeNull();
      expect(facts.imageCount).toBeNull();
      expect(facts.internalLinkCount).toBeNull();
      expect(facts.externalLinkCount).toBeNull();
    }
  });
});
