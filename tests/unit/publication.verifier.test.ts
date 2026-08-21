import { describe, expect, it } from 'vitest';
import {
  PUBLICATION_VERIFICATION_MAX_ATTEMPTS,
  PUBLICATION_VERIFICATION_QUEUE_NAME,
  buildPublicationVerificationJobId,
  buildPublicationVerificationJobOptions
} from '../../src/modules/publication/publication-verification.queue.js';
import {
  publicationContentFingerprintV1,
  verifyPublishedTarget,
  type PublicationHtmlResponse,
  type PublicationVerificationExpectation
} from '../../src/modules/publication/publication-verifier.js';

const URL = 'https://xingshantang.org/culture/liuren-culture';
const MAIN_TEXT = '六壬文化是一种需要结合可核资料理解的传统文化主题。';

function expectation(
  overrides: Partial<PublicationVerificationExpectation> = {}
): PublicationVerificationExpectation {
  return {
    url: URL,
    title: '六壬文化｜兴善堂',
    metaDescription: '从可核资料出发介绍六壬文化。',
    canonical: URL,
    h1: '六壬文化',
    indexable: true,
    schemaTypes: ['Article'],
    contentFingerprint: publicationContentFingerprintV1(MAIN_TEXT),
    ...overrides
  };
}

function page(overrides: {
  status?: number;
  url?: string;
  title?: string;
  description?: string;
  canonical?: string;
  h1?: string;
  robots?: string;
  mainText?: string;
  schema?: string;
} = {}): PublicationHtmlResponse {
  const status = overrides.status ?? 200;
  const url = overrides.url ?? URL;
  const title = overrides.title ?? '六壬文化｜兴善堂';
  const description = overrides.description ?? '从可核资料出发介绍六壬文化。';
  const canonical = overrides.canonical ?? URL;
  const h1 = overrides.h1 ?? '六壬文化';
  const robots = overrides.robots ?? 'index,follow';
  const mainText = overrides.mainText ?? MAIN_TEXT;
  const schema = overrides.schema ?? JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: '六壬文化'
  });

  return {
    status,
    url,
    body: `<!doctype html>
<html lang="zh-CN">
<head>
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${canonical}">
  <script type="application/ld+json">${schema}</script>
</head>
<body>
  <main><h1>${h1}</h1><p>${mainText}</p></main>
</body>
</html>`
  };
}

describe('P8-A verification queue contract', () => {
  it('uses explicit single-attempt verification jobs so retries require re-enqueue', () => {
    expect(PUBLICATION_VERIFICATION_QUEUE_NAME).toBe('site-mutation-verification');
    expect(PUBLICATION_VERIFICATION_MAX_ATTEMPTS).toBe(1);
    expect(buildPublicationVerificationJobId('execution-1')).toBe(
      'site-mutation-verification-execution-1'
    );
    expect(buildPublicationVerificationJobOptions('execution-1')).toMatchObject({
      jobId: 'site-mutation-verification-execution-1',
      attempts: 1
    });
  });
});

describe('P8-A deterministic real-site verifier', () => {
  it('requires all deterministic public-page checks before VERIFIED', () => {
    const result = verifyPublishedTarget(expectation(), page());

    expect(result).toMatchObject({
      status: 'VERIFIED',
      reasonCode: null,
      observedUrl: URL,
      httpStatus: 200,
      titleMatches: true,
      descriptionMatches: true,
      canonicalMatches: true,
      h1Matches: true,
      indexable: true,
      schemaValid: true,
      contentFingerprintOk: true,
      regressionFindings: []
    });
  });

  it('never treats an HTTP-missing public page as deployment proof', () => {
    const result = verifyPublishedTarget(expectation(), page({ status: 404 }));
    expect(result).toMatchObject({
      status: 'FAILED',
      reasonCode: 'PAGE_NOT_FOUND',
      httpStatus: 404,
      contentFingerprintOk: false
    });
  });

  it('reports deployed content mismatch before metadata checks', () => {
    const result = verifyPublishedTarget(expectation(), page({ mainText: '旧版本内容' }));
    expect(result).toMatchObject({
      status: 'FAILED',
      reasonCode: 'DEPLOYED_CONTENT_MISMATCH',
      contentFingerprintOk: false
    });
    expect(result.regressionFindings).toContain('DEPLOYED_CONTENT_MISMATCH');
  });

  it.each([
    ['EXPECTED_TITLE_NOT_FOUND', { title: '旧标题' }],
    ['EXPECTED_DESCRIPTION_NOT_FOUND', { description: '旧描述' }],
    ['CANONICAL_MISMATCH', { canonical: 'https://xingshantang.org/culture/old' }],
    ['EXPECTED_H1_NOT_FOUND', { h1: '旧 H1' }],
    ['NOINDEX_DETECTED', { robots: 'noindex,follow' }]
  ] as const)('fails with %s when a required deterministic field regresses', (reasonCode, overrides) => {
    const result = verifyPublishedTarget(expectation(), page(overrides));
    expect(result.status).toBe('FAILED');
    expect(result.reasonCode).toBe(reasonCode);
    expect(result.regressionFindings).toContain(reasonCode);
  });

  it('rejects malformed or missing required JSON-LD schema types', () => {
    const malformed = verifyPublishedTarget(expectation(), page({ schema: '{broken' }));
    expect(malformed).toMatchObject({
      status: 'FAILED',
      reasonCode: 'SCHEMA_INVALID',
      schemaValid: false
    });

    const wrongType = verifyPublishedTarget(expectation(), page({
      schema: JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage' })
    }));
    expect(wrongType).toMatchObject({
      status: 'FAILED',
      reasonCode: 'SCHEMA_INVALID',
      schemaValid: false
    });
  });

  it('does not let a redirect to a different public target silently verify', () => {
    const result = verifyPublishedTarget(expectation(), page({
      url: 'https://xingshantang.org/culture/unexpected'
    }));
    expect(result).toMatchObject({
      status: 'FAILED',
      reasonCode: 'DEPLOYED_CONTENT_MISMATCH'
    });
  });
});
