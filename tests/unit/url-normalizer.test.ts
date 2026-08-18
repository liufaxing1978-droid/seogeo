import { describe, expect, it } from 'vitest';
import { isInProjectScope, normalizeCrawlUrl } from '../../src/modules/crawler/url-normalizer.js';

describe('normalizeCrawlUrl', () => {
  it('normalizes host, default port, fragment, and query ordering', () => {
    expect(normalizeCrawlUrl('HTTPS://Example.COM:443/a?b=2&a=1#x')).toBe(
      'https://example.com/a?a=1&b=2'
    );
  });

  it('uses a root slash when the input has no explicit path', () => {
    expect(normalizeCrawlUrl('https://Example.COM')).toBe('https://example.com/');
  });

  it('preserves a trailing slash on non-root paths', () => {
    expect(normalizeCrawlUrl('https://example.com/docs/')).toBe('https://example.com/docs/');
  });

  it('sorts query parameters by key and value without dropping duplicates', () => {
    expect(normalizeCrawlUrl('https://example.com/?z=1&a=2&a=1')).toBe(
      'https://example.com/?a=1&a=2&z=1'
    );
  });

  it.each([
    'https://user:pass@example.com/',
    'http://user@example.com/'
  ])('rejects credential-bearing URLs: %s', (input) => {
    expect(() => normalizeCrawlUrl(input)).toThrow(/credentials/i);
  });

  it.each([
    'mailto:test@example.com',
    'javascript:alert(1)',
    'data:text/plain,hello',
    'file:///etc/passwd'
  ])('rejects non-http protocols: %s', (input) => {
    expect(() => normalizeCrawlUrl(input)).toThrow(/http/i);
  });
});

describe('isInProjectScope', () => {
  it('allows the exact project host and direct www alias', () => {
    expect(isInProjectScope(new URL('https://example.com/a'), 'example.com')).toBe(true);
    expect(isInProjectScope(new URL('https://www.example.com/a'), 'example.com')).toBe(true);
  });

  it('treats a stored www domain and its bare host as the same project scope', () => {
    expect(isInProjectScope(new URL('https://example.com/a'), 'www.example.com')).toBe(true);
    expect(isInProjectScope(new URL('https://www.example.com/a'), 'www.example.com')).toBe(true);
  });

  it.each([
    'https://blog.example.com/',
    'https://example.com.attacker.test/',
    'https://attackerexample.com/',
    'https://example.org/'
  ])('rejects external, unrelated subdomain, and look-alike hosts: %s', (input) => {
    expect(isInProjectScope(new URL(input), 'example.com')).toBe(false);
  });
});
