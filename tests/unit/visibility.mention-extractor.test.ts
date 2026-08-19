import { describe, expect, it } from 'vitest';
import { extractMentions } from '../../src/modules/visibility/visibility-mention.extractor.js';
import type { VisibilitySubjectSnapshot } from '../../src/modules/visibility/visibility-subject.service.js';

function snapshot(overrides: Partial<VisibilitySubjectSnapshot> = {}): VisibilitySubjectSnapshot {
  return {
    subjects: [
      {
        id: 'subject-brand',
        subjectType: 'OWNED_BRAND',
        canonicalValue: '兴善堂',
        normalizedValue: '兴善堂',
        sourceType: 'PROJECT_CONFIG',
        entityId: null,
        competitorId: null,
        aliases: ['xst']
      },
      {
        id: 'subject-domain',
        subjectType: 'OWNED_DOMAIN',
        canonicalValue: 'xingshantang.org',
        normalizedValue: 'xingshantang.org',
        sourceType: 'PRIMARY_DOMAIN',
        entityId: null,
        competitorId: null,
        aliases: []
      }
    ],
    ambiguousAliases: [],
    subjectSetHash: 'fixture-hash',
    ...overrides
  };
}

describe('P6-B deterministic mention extractor', () => {
  it('extracts repeated exact CJK canonical mentions with count and first position', () => {
    expect(extractMentions('兴善堂与六壬伏英馆，兴善堂。', snapshot())).toEqual({
      status: 'EXTRACTED',
      mentions: [
        {
          subjectId: 'subject-brand',
          subjectType: 'OWNED_BRAND',
          subjectValue: '兴善堂',
          matchedValue: '兴善堂',
          mentionType: 'EXACT',
          occurrenceCount: 2,
          firstPosition: 0
        }
      ]
    });
  });

  it('extracts configured aliases with safe Latin boundaries', () => {
    const result = extractMentions('XST is referenced, but xstation is unrelated. XST again.', snapshot());
    expect(result).toEqual({
      status: 'EXTRACTED',
      mentions: [
        {
          subjectId: 'subject-brand',
          subjectType: 'OWNED_BRAND',
          subjectValue: '兴善堂',
          matchedValue: 'xst',
          mentionType: 'NORMALIZED_ALIAS',
          occurrenceCount: 2,
          firstPosition: 0
        }
      ]
    });
  });

  it('extracts normalized domain prose mentions including the www alias', () => {
    const result = extractMentions('Sources include https://www.XingShanTang.org and other references.', snapshot());
    expect(result).toEqual({
      status: 'EXTRACTED',
      mentions: [
        {
          subjectId: 'subject-domain',
          subjectType: 'OWNED_DOMAIN',
          subjectValue: 'xingshantang.org',
          matchedValue: 'xingshantang.org',
          mentionType: 'DOMAIN',
          occurrenceCount: 1,
          firstPosition: expect.any(Number)
        }
      ]
    });
  });

  it('does not create Latin substring false positives', () => {
    const latinOnly = snapshot({
      subjects: [{
        id: 'subject-latin',
        subjectType: 'OWNED_BRAND',
        canonicalValue: 'XST',
        normalizedValue: 'xst',
        sourceType: 'PROJECT_CONFIG',
        entityId: null,
        competitorId: null,
        aliases: []
      }]
    });
    expect(extractMentions('xstation and prexst are not standalone brand mentions', latinOnly)).toEqual({
      status: 'KNOWN_EMPTY',
      mentions: []
    });
  });

  it('defensively excludes aliases marked ambiguous by the authoritative snapshot', () => {
    const ambiguous = snapshot({ ambiguousAliases: ['xst'] });
    expect(extractMentions('XST appears here.', ambiguous)).toEqual({
      status: 'KNOWN_EMPTY',
      mentions: []
    });
  });

  it('returns KNOWN_EMPTY only for an eligible answer with no deterministic matches', () => {
    expect(extractMentions('No monitored subject appears in this answer.', snapshot())).toEqual({
      status: 'KNOWN_EMPTY',
      mentions: []
    });
  });

  it.each([null, undefined, '', '   ', 42, { text: '兴善堂' }])(
    'returns UNKNOWN for missing or corrupt answer input: %o',
    (answerText) => {
      expect(extractMentions(answerText, snapshot())).toEqual({
        status: 'UNKNOWN',
        mentions: []
      });
    }
  );

  it('orders derived mention rows deterministically by first position then subject identity', () => {
    const result = extractMentions('xingshantang.org later mentions 兴善堂', snapshot());
    expect(result.status).toBe('EXTRACTED');
    expect(result.mentions.map((mention) => mention.subjectId)).toEqual(['subject-domain', 'subject-brand']);
  });
});
