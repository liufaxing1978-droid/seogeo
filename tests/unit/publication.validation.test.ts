import { describe, expect, it } from 'vitest';
import {
  validatePublicationDraft,
  type PublicationValidationInput
} from '../../src/modules/publication/publication-validation.js';

function validInput(overrides: Partial<PublicationValidationInput> = {}): PublicationValidationInput {
  return {
    draft: {
      title: '六壬文化：从可核资料出发的介绍',
      body: '# 六壬文化\n\n这是一篇基于已提供资料整理的文章。',
      slugCandidate: 'liuren-culture',
      canonicalCandidate: 'https://xingshantang.org/culture/liuren-culture',
      schemaJson: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: '六壬文化：从可核资料出发的介绍'
      },
      language: 'zh-CN'
    },
    target: {
      publicUrl: 'https://xingshantang.org/culture/liuren-culture',
      primaryHost: 'xingshantang.org',
      channelPathPrefix: '/culture',
      repositoryPath: 'content/culture/liuren-culture.md',
      allowedRepositoryPaths: ['content/news/', 'content/culture/', 'content/archives/']
    },
    resolvedFacts: {
      urlConflict: false,
      sourceGaps: []
    },
    confirmedWarningCodes: [],
    ...overrides
  };
}

function codes(input: PublicationValidationInput, severity?: 'BLOCKING' | 'WARNING' | 'INFO') {
  return validatePublicationDraft(input).findings
    .filter((finding) => !severity || finding.severity === severity)
    .map((finding) => finding.code);
}

describe('P8-A deterministic pre-publication validation', () => {
  it('blocks empty title and body with stable codes', () => {
    const result = validatePublicationDraft(validInput({
      draft: {
        ...validInput().draft,
        title: '   ',
        body: '\n\t '
      }
    }));

    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'BLOCKING', code: 'TITLE_REQUIRED' }),
      expect.objectContaining({ severity: 'BLOCKING', code: 'BODY_REQUIRED' })
    ]));
    expect(result.canCreatePlan).toBe(false);
  });

  it('blocks malformed target URLs and canonical candidates that are invalid, off-host or do not match the target URL', () => {
    expect(codes(validInput({
      target: { ...validInput().target, publicUrl: 'not a url' }
    }), 'BLOCKING')).toContain('TARGET_URL_INVALID');

    expect(codes(validInput({
      draft: { ...validInput().draft, canonicalCandidate: 'not a url' }
    }), 'BLOCKING')).toContain('CANONICAL_MISMATCH');

    expect(codes(validInput({
      draft: {
        ...validInput().draft,
        canonicalCandidate: 'https://example.com/culture/liuren-culture'
      }
    }), 'BLOCKING')).toContain('CANONICAL_MISMATCH');

    expect(codes(validInput({
      draft: {
        ...validInput().draft,
        canonicalCandidate: 'https://xingshantang.org/culture/another-slug'
      }
    }), 'BLOCKING')).toContain('CANONICAL_MISMATCH');
  });

  it('blocks script, iframe and inline event-handler HTML without trying to sanitize it', () => {
    for (const unsafeBody of [
      '# Title\n<script>alert(1)</script>',
      '# Title\n<iframe src="https://example.com"></iframe>',
      '# Title\n<img src="x" onerror="alert(1)">'
    ]) {
      const result = validatePublicationDraft(validInput({
        draft: { ...validInput().draft, body: unsafeBody }
      }));
      expect(result.findings).toContainEqual(expect.objectContaining({
        severity: 'BLOCKING',
        code: 'UNSAFE_HTML'
      }));
      expect(result.canCreatePlan).toBe(false);
    }
  });

  it('blocks invalid JSON-LD candidates and accepts a bounded Article candidate', () => {
    for (const schemaJson of [
      'not-json-ld',
      { '@type': 'Article' },
      { '@context': 'https://schema.org' },
      { '@context': 'https://schema.org', '@type': '' }
    ]) {
      expect(codes(validInput({
        draft: { ...validInput().draft, schemaJson }
      }), 'BLOCKING')).toContain('SCHEMA_INVALID');
    }

    expect(codes(validInput(), 'BLOCKING')).not.toContain('SCHEMA_INVALID');
  });

  it('blocks a separately resolved duplicate URL conflict and paths outside the configured channel/allowlist', () => {
    expect(codes(validInput({
      resolvedFacts: { urlConflict: true, sourceGaps: [] }
    }), 'BLOCKING')).toContain('DUPLICATE_SLUG');

    expect(codes(validInput({
      target: {
        ...validInput().target,
        publicUrl: 'https://xingshantang.org/member/liuren-culture',
        channelPathPrefix: '/culture'
      },
      draft: {
        ...validInput().draft,
        canonicalCandidate: 'https://xingshantang.org/member/liuren-culture'
      }
    }), 'BLOCKING')).toContain('PATH_NOT_ALLOWED');

    expect(codes(validInput({
      target: {
        ...validInput().target,
        repositoryPath: 'server/nginx.conf'
      }
    }), 'BLOCKING')).toContain('PATH_NOT_ALLOWED');
  });

  it('requires an H1-equivalent heading in the article body', () => {
    const result = validatePublicationDraft(validInput({
      draft: {
        ...validInput().draft,
        body: '这篇文章有正文，但没有一级标题。'
      }
    }));

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'BLOCKING',
      code: 'H1_REQUIRED'
    }));
    expect(result.canCreatePlan).toBe(false);
  });

  it('keeps unresolved source gaps as WARNING and never fabricates content or source truth', () => {
    const input = validInput({
      resolvedFacts: {
        urlConflict: false,
        sourceGaps: [
          '明代传承时间缺少可核来源',
          '某仪式细节缺少可核来源'
        ]
      }
    });
    const before = structuredClone(input);
    const result = validatePublicationDraft(input);

    expect(result.findings).toContainEqual(expect.objectContaining({
      severity: 'WARNING',
      code: 'SOURCE_GAP'
    }));
    expect(result.findings.some((finding) => finding.severity === 'BLOCKING')).toBe(false);
    expect(result.canCreatePlan).toBe(false);
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toContain('verified source');
    expect(JSON.stringify(result)).not.toContain('source supplied by validator');
  });

  it('allows WARNING-only content only when every warning code is explicitly confirmed by the human review payload', () => {
    const warningInput = validInput({
      resolvedFacts: {
        urlConflict: false,
        sourceGaps: ['历史日期尚无可核来源']
      }
    });

    const unconfirmed = validatePublicationDraft(warningInput);
    expect(unconfirmed.blockingCodes).toEqual([]);
    expect(unconfirmed.warningCodes).toEqual(['SOURCE_GAP']);
    expect(unconfirmed.unconfirmedWarningCodes).toEqual(['SOURCE_GAP']);
    expect(unconfirmed.canCreatePlan).toBe(false);

    const confirmed = validatePublicationDraft({
      ...warningInput,
      confirmedWarningCodes: ['SOURCE_GAP']
    });
    expect(confirmed.unconfirmedWarningCodes).toEqual([]);
    expect(confirmed.canCreatePlan).toBe(true);
  });

  it('never allows BLOCKING findings to be bypassed by confirmed warning codes', () => {
    const result = validatePublicationDraft(validInput({
      draft: { ...validInput().draft, title: '' },
      resolvedFacts: { urlConflict: false, sourceGaps: ['需要来源'] },
      confirmedWarningCodes: ['SOURCE_GAP', 'TITLE_REQUIRED']
    }));

    expect(result.blockingCodes).toContain('TITLE_REQUIRED');
    expect(result.canCreatePlan).toBe(false);
  });

  it('returns a stable clean result for safe, valid content', () => {
    const result = validatePublicationDraft(validInput());

    expect(result).toEqual({
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      findings: [],
      blockingCodes: [],
      warningCodes: [],
      infoCodes: [],
      unconfirmedWarningCodes: [],
      canCreatePlan: true
    });
  });
});
