import { createHash } from 'node:crypto';
import { load } from 'cheerio';

export const PUBLICATION_VERIFIER_VERSION = 'PUBLICATION_VERIFIER_V1' as const;
export const PUBLICATION_FETCH_TIMEOUT_MS = 8_000;
export const PUBLICATION_MAX_RESPONSE_BYTES = 1_000_000;

export type PublicationVerificationReasonCode =
  | 'PAGE_NOT_FOUND'
  | 'DEPLOYED_CONTENT_MISMATCH'
  | 'EXPECTED_TITLE_NOT_FOUND'
  | 'EXPECTED_DESCRIPTION_NOT_FOUND'
  | 'CANONICAL_MISMATCH'
  | 'EXPECTED_H1_NOT_FOUND'
  | 'NOINDEX_DETECTED'
  | 'SCHEMA_INVALID';

export interface PublicationVerificationExpectation {
  url: string;
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  h1: string | null;
  indexable: boolean;
  schemaTypes: string[];
  contentFingerprint: string | null;
}

export interface PublicationHtmlResponse {
  status: number;
  url: string;
  body: string;
}

export interface PublicationVerificationResult {
  status: 'VERIFIED' | 'FAILED';
  reasonCode: PublicationVerificationReasonCode | null;
  observedUrl: string;
  httpStatus: number;
  titleMatches: boolean;
  descriptionMatches: boolean;
  canonicalMatches: boolean;
  h1Matches: boolean;
  indexable: boolean;
  schemaValid: boolean;
  contentFingerprintOk: boolean;
  regressionFindings: PublicationVerificationReasonCode[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function publicationContentFingerprintV1(value: string): string {
  return createHash('sha256')
    .update(`PUBLICATION_CONTENT_FINGERPRINT_V1\0${normalizeText(value)}`)
    .digest('hex');
}

function expectedStringMatches(expected: string | null, actual: string): boolean {
  return expected === null || normalizeText(actual) === normalizeText(expected);
}

function collectSchemaTypes(value: unknown, output: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaTypes(item, output);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const type = record['@type'];
  if (typeof type === 'string') output.add(type);
  if (Array.isArray(type)) {
    for (const item of type) {
      if (typeof item === 'string') output.add(item);
    }
  }
  if ('@graph' in record) collectSchemaTypes(record['@graph'], output);
}

function validateSchema(html: string, expectedTypes: readonly string[]): boolean {
  if (expectedTypes.length === 0) return true;
  const $ = load(html);
  const types = new Set<string>();
  let malformed = false;
  const scripts = $('script[type="application/ld+json"]');
  if (scripts.length === 0) return false;
  scripts.each((_index, element) => {
    const raw = $(element).text().trim();
    if (!raw) {
      malformed = true;
      return;
    }
    try {
      collectSchemaTypes(JSON.parse(raw), types);
    } catch {
      malformed = true;
    }
  });
  return !malformed && expectedTypes.every((type) => types.has(type));
}

function publishedContentText(html: string): string {
  const $ = load(html);
  const paragraphs = $('main p');
  if (paragraphs.length > 0) {
    return normalizeText(paragraphs.map((_index, element) => $(element).text()).get().join(' '));
  }
  const article = $('article').first();
  if (article.length > 0) return normalizeText(article.text());
  const main = $('main').first();
  if (main.length > 0) return normalizeText(main.text());
  $('script,style,noscript').remove();
  return normalizeText($('body').text());
}

function emptyFailure(response: PublicationHtmlResponse): PublicationVerificationResult {
  return {
    status: 'FAILED',
    reasonCode: 'PAGE_NOT_FOUND',
    observedUrl: response.url,
    httpStatus: response.status,
    titleMatches: false,
    descriptionMatches: false,
    canonicalMatches: false,
    h1Matches: false,
    indexable: false,
    schemaValid: false,
    contentFingerprintOk: false,
    regressionFindings: ['PAGE_NOT_FOUND']
  };
}

export function verifyPublishedTarget(
  expectation: PublicationVerificationExpectation,
  response: PublicationHtmlResponse
): PublicationVerificationResult {
  if (response.status < 200 || response.status >= 400) return emptyFailure(response);

  const $ = load(response.body);
  const titleMatches = expectedStringMatches(expectation.title, $('title').first().text());
  const descriptionMatches = expectedStringMatches(
    expectation.metaDescription,
    $('meta[name="description"]').first().attr('content') ?? ''
  );
  const canonicalMatches = expectedStringMatches(
    expectation.canonical,
    $('link[rel="canonical"]').first().attr('href') ?? ''
  );
  const h1Matches = expectedStringMatches(expectation.h1, $('h1').first().text());
  const robots = ($('meta[name="robots"]').first().attr('content') ?? '').toLowerCase();
  const actualIndexable = !robots.split(/[\s,]+/).includes('noindex');
  const schemaValid = validateSchema(response.body, expectation.schemaTypes);
  const actualFingerprint = publicationContentFingerprintV1(publishedContentText(response.body));
  const contentFingerprintOk = expectation.contentFingerprint === null
    || actualFingerprint === expectation.contentFingerprint;

  const findings: PublicationVerificationReasonCode[] = [];
  if (response.url !== expectation.url) findings.push('DEPLOYED_CONTENT_MISMATCH');
  if (!contentFingerprintOk) findings.push('DEPLOYED_CONTENT_MISMATCH');
  if (!titleMatches) findings.push('EXPECTED_TITLE_NOT_FOUND');
  if (!descriptionMatches) findings.push('EXPECTED_DESCRIPTION_NOT_FOUND');
  if (!canonicalMatches) findings.push('CANONICAL_MISMATCH');
  if (!h1Matches) findings.push('EXPECTED_H1_NOT_FOUND');
  if (expectation.indexable && !actualIndexable) findings.push('NOINDEX_DETECTED');
  if (!schemaValid) findings.push('SCHEMA_INVALID');

  const regressionFindings = [...new Set(findings)];
  if (regressionFindings.length > 0) {
    return {
      status: 'FAILED',
      reasonCode: regressionFindings[0] ?? 'DEPLOYED_CONTENT_MISMATCH',
      observedUrl: response.url,
      httpStatus: response.status,
      titleMatches,
      descriptionMatches,
      canonicalMatches,
      h1Matches,
      indexable: actualIndexable,
      schemaValid,
      contentFingerprintOk,
      regressionFindings
    };
  }

  return {
    status: 'VERIFIED',
    reasonCode: null,
    observedUrl: response.url,
    httpStatus: response.status,
    titleMatches,
    descriptionMatches,
    canonicalMatches,
    h1Matches,
    indexable: actualIndexable,
    schemaValid,
    contentFingerprintOk,
    regressionFindings: []
  };
}

export async function fetchPublicationHtml(url: string): Promise<PublicationHtmlResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLICATION_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml'
      }
    });
    const reader = response.body?.getReader();
    if (!reader) {
      return { status: response.status, url: response.url || url, body: '' };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > PUBLICATION_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Publication verification response exceeds byte limit');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      status: response.status,
      url: response.url || url,
      body: new TextDecoder().decode(bytes)
    };
  } finally {
    clearTimeout(timeout);
  }
}
