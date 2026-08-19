import { describe, expect, it } from 'vitest';
import { extractCitations } from '../../src/modules/visibility/visibility-citation.extractor.js';
import type { VisibilitySubjectSnapshot } from '../../src/modules/visibility/visibility-subject.service.js';

function snapshot(overrides: Partial<VisibilitySubjectSnapshot> = {}): VisibilitySubjectSnapshot {
  return {
    subjects: [
      {
        id: 'owned-domain',
        subjectType: 'OWNED_DOMAIN',
        canonicalValue: 'xingshantang.org',
        normalizedValue: 'xingshantang.org',
        sourceType: 'PRIMARY_DOMAIN',
        entityId: null,
        competitorId: null,
        aliases: []
      },
      {
        id: 'competitor-domain',
        subjectType: 'COMPETITOR',
        canonicalValue: 'reference.example.com',
        normalizedValue: 'reference.example.com',
        sourceType: 'P5_COMPETITOR',
        entityId: null,
        competitorId: 'competitor-1',
        aliases: []
      }
    ],
    ambiguousAliases: [],
    subjectSetHash: 'fixture-hash',
    ...overrides
  };
}

function observation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'observation-1',
    status: 'COMPLETED',
    citationEvidenceState: 'KNOWN_PRESENT',
    answerText: 'Body may mention https://prose-only.example.com but that is not a native citation.',
    citationsJson: [
      {
        url: 'HTTPS://www.XingShanTang.org:443/article#section',
        title: 'Xingshantang Article',
        position: 2,
        sourceType: 'url_citation'
      },
      {
        url: 'https://reference.example.com/guide?b=2&a=1',
        title: 'Reference Guide',
        position: 3,
        sourceType: 'citation'
      }
    ],
    ...overrides
  };
}

describe('P6-B deterministic citation extractor', () => {
  it('normalizes KNOWN_PRESENT native citations and maps unique owned/competitor domains', () => {
    const result = extractCitations(observation(), snapshot());

    expect(result.status).toBe('EXTRACTED');
    expect(result.citations).toHaveLength(2);
    expect(result.citations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'HTTPS://www.XingShanTang.org:443/article#section',
        normalizedUrl: 'https://www.xingshantang.org/article',
        domain: 'xingshantang.org',
        position: 2,
        title: 'Xingshantang Article',
        sourceType: 'url_citation',
        occurrenceCount: 1,
        isOwnedDomain: true,
        ownedSubjectId: 'owned-domain',
        competitorId: null,
        competitorSubjectId: null
      }),
      expect.objectContaining({
        normalizedUrl: 'https://reference.example.com/guide?a=1&b=2',
        domain: 'reference.example.com',
        isOwnedDomain: false,
        ownedSubjectId: null,
        competitorId: 'competitor-1',
        competitorSubjectId: 'competitor-domain'
      })
    ]));
    for (const citation of result.citations) {
      expect(citation.citationKey).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('folds duplicate normalized native URLs into one deterministic fact', () => {
    const result = extractCitations(observation({
      citationsJson: [
        { url: 'https://example.org/a#one', title: 'First', position: 4, sourceType: 'citation' },
        { url: 'HTTPS://EXAMPLE.ORG:443/a#two', title: 'Second', position: 2, sourceType: 'citation' },
        { url: 'https://example.org/a', title: null, position: null, sourceType: 'citation' }
      ]
    }), snapshot());

    expect(result).toEqual({
      status: 'EXTRACTED',
      citations: [expect.objectContaining({
        normalizedUrl: 'https://example.org/a',
        domain: 'example.org',
        position: 2,
        title: 'Second',
        occurrenceCount: 3
      })]
    });
  });

  it('returns KNOWN_EMPTY only when the provider positively reported empty citation evidence', () => {
    expect(extractCitations(observation({
      citationEvidenceState: 'KNOWN_EMPTY',
      citationsJson: []
    }), snapshot())).toEqual({
      status: 'KNOWN_EMPTY',
      citations: []
    });
  });

  it('keeps UNKNOWN as UNKNOWN even when citationsJson is an empty array', () => {
    expect(extractCitations(observation({
      citationEvidenceState: 'UNKNOWN',
      citationsJson: []
    }), snapshot())).toEqual({
      status: 'UNKNOWN',
      citations: []
    });
  });

  it.each([
    ['UNSUPPORTED', 'NOT_APPLICABLE'],
    ['REFUSED', 'UNKNOWN'],
    ['FAILED', 'UNKNOWN'],
    ['BUDGET_SKIPPED', 'UNKNOWN']
  ])('returns NOT_ELIGIBLE for observation status %s', (status, citationEvidenceState) => {
    expect(extractCitations(observation({ status, citationEvidenceState, citationsJson: [] }), snapshot())).toEqual({
      status: 'NOT_ELIGIBLE',
      citations: []
    });
  });

  it('never promotes prose URLs into citations when native citation evidence is empty', () => {
    expect(extractCitations(observation({
      citationEvidenceState: 'KNOWN_EMPTY',
      citationsJson: [],
      answerText: 'See https://xingshantang.org/article and https://reference.example.com.'
    }), snapshot())).toEqual({
      status: 'KNOWN_EMPTY',
      citations: []
    });
  });

  it('does not map a domain identity when multiple active monitored subjects claim the same normalized domain', () => {
    const ambiguous = snapshot({
      subjects: [
        ...snapshot().subjects,
        {
          id: 'owned-domain-duplicate',
          subjectType: 'OWNED_DOMAIN',
          canonicalValue: 'xingshantang.org',
          normalizedValue: 'xingshantang.org',
          sourceType: 'PROJECT_CONFIG',
          entityId: null,
          competitorId: null,
          aliases: []
        }
      ]
    });
    const result = extractCitations(observation({
      citationsJson: [{ url: 'https://xingshantang.org/article', title: null, position: 1, sourceType: 'citation' }]
    }), ambiguous);

    expect(result).toEqual({
      status: 'EXTRACTED',
      citations: [expect.objectContaining({
        domain: 'xingshantang.org',
        isOwnedDomain: false,
        ownedSubjectId: null,
        competitorId: null,
        competitorSubjectId: null
      })]
    });
  });

  it('fails closed to UNKNOWN when KNOWN_PRESENT evidence is malformed or has no usable native URLs', () => {
    expect(extractCitations(observation({ citationsJson: [{ title: 'missing URL' }, null, 42] }), snapshot())).toEqual({
      status: 'UNKNOWN',
      citations: []
    });
  });
});
