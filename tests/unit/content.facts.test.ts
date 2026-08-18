import { describe, expect, it } from 'vitest';
import { buildContentFacts } from '../../src/modules/content/content-facts.js';

describe('buildContentFacts', () => {
  it('maps persisted snapshot facts without inventing unknown values', () => {
    const facts = buildContentFacts({
      projectId: 'project-1',
      pageId: 'page-1',
      normalizedUrl: 'https://example.com/guide',
      snapshotId: 'snapshot-1',
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
});
