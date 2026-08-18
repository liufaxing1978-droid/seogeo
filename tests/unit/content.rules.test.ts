import { describe, expect, it } from 'vitest';
import { evaluateContentDocument } from '../../src/modules/content/content-rules.js';
import type { ContentFacts } from '../../src/modules/content/content.types.js';

const base: ContentFacts = {
  projectId: 'p1',
  pageId: 'page1',
  latestPageSnapshotId: 's1',
  canonicalUrl: 'https://example.com/a',
  title: 'A useful guide',
  metaDescription: 'A useful description',
  h1: 'A useful guide',
  language: 'en',
  wordCount: 900,
  paragraphCount: null,
  headingCount: 4,
  listCount: null,
  tableCount: null,
  imageCount: 2,
  internalLinkCount: 5,
  externalLinkCount: 1,
  schemaTypes: ['Article'],
  contentHash: 'hash',
  extractedAt: new Date('2026-08-19T00:00:00Z')
};

describe('CONTENT_RULESET_V1', () => {
  it('passes healthy deterministic content facts', () => {
    const results = evaluateContentDocument(base, { entityCount: 2, citabilityStatus: 'PASS' });
    expect(results).toHaveLength(9);
    expect(results.every((result) => result.status === 'PASS')).toBe(true);
  });

  it('preserves UNKNOWN instead of turning missing inputs into FAIL', () => {
    const results = evaluateContentDocument(
      {
        ...base,
        title: null,
        h1: null,
        metaDescription: null,
        wordCount: null,
        headingCount: null,
        internalLinkCount: null,
        schemaTypes: []
      },
      { entityCount: null, citabilityStatus: 'UNKNOWN', schemaTypesKnown: false }
    );

    expect(results.find((x) => x.ruleKey === 'CONTENT_BODY_SUBSTANTIVE')?.status).toBe('UNKNOWN');
    expect(results.find((x) => x.ruleKey === 'CONTENT_ENTITY_SUPPORT')?.status).toBe('UNKNOWN');
    expect(results.find((x) => x.ruleKey === 'CONTENT_CITABILITY_SUPPORT')?.status).toBe('UNKNOWN');
    expect(results.find((x) => x.ruleKey === 'CONTENT_STRUCTURED_DATA_SUPPORT')?.status).toBe('UNKNOWN');
  });

  it('fails deterministic deficiencies with stable opportunity metadata', () => {
    const results = evaluateContentDocument(
      { ...base, title: '', h1: '', metaDescription: '', wordCount: 100, headingCount: 1, internalLinkCount: 0, schemaTypes: [] },
      { entityCount: 0, citabilityStatus: 'FAIL', schemaTypesKnown: true }
    );
    const failures = results.filter((result) => result.status === 'FAIL');
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every((result) => result.opportunityKey === `${result.ruleKey}:v${result.ruleVersion}`)).toBe(true);
  });
});
