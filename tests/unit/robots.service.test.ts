import { describe, expect, it } from 'vitest';
import type { FetchResult } from '../../src/modules/crawler/crawl.types.js';
import { discoverSitemaps, loadRobotsPolicy } from '../../src/modules/crawler/robots.service.js';

function result(statusCode: number, body: string | null): FetchResult {
  return {
    requestUrl: 'https://example.com/robots.txt',
    finalUrl: 'https://example.com/robots.txt',
    statusCode,
    headers: { 'content-type': 'text/plain' },
    body,
    contentType: 'text/plain',
    bytes: body ? Buffer.byteLength(body) : 0,
    responseTimeMs: 1,
    redirectChain: [],
    errorCode: null
  };
}

describe('loadRobotsPolicy', () => {
  it('treats a factual 404 as robots absent and allows crawling', async () => {
    const policy = await loadRobotsPolicy('https://example.com', 'SEOGEO-Bot', async () => result(404, 'not found'));

    expect(policy.fetched).toBe(true);
    expect(policy.statusCode).toBe(404);
    expect(policy.isAllowed('https://example.com/private')).toBe(true);
    expect(policy.parseError).toBeNull();
  });

  it('honors Disallow and more specific Allow rules', async () => {
    const text = [
      'User-agent: *',
      'Disallow: /private/',
      'Allow: /private/public.html'
    ].join('\n');
    const policy = await loadRobotsPolicy('https://example.com', 'SEOGEO-Bot', async () => result(200, text));

    expect(policy.isAllowed('https://example.com/private/a')).toBe(false);
    expect(policy.isAllowed('https://example.com/private/public.html')).toBe(true);
  });

  it('extracts and deduplicates Sitemap directives while retaining the conventional sitemap probe', async () => {
    const text = [
      'User-agent: *',
      'Allow: /',
      'Sitemap: https://example.com/news-sitemap.xml',
      'Sitemap: https://example.com/news-sitemap.xml',
      'Sitemap: /relative-sitemap.xml'
    ].join('\n');
    const policy = await loadRobotsPolicy('https://example.com', 'SEOGEO-Bot', async () => result(200, text));

    expect(policy.sitemapUrls).toEqual([
      'https://example.com/sitemap.xml',
      'https://example.com/news-sitemap.xml',
      'https://example.com/relative-sitemap.xml'
    ]);
  });

  it('reports malformed robots content instead of inventing rules', async () => {
    const policy = await loadRobotsPolicy('https://example.com', 'SEOGEO-Bot', async () => result(200, 'User-agent: *\nDisallow: /bad\u0000path'));

    expect(policy.parseError).toMatch(/malformed/i);
    expect(policy.isAllowed('https://example.com/anything')).toBeNull();
  });

  it('records 5xx as unavailable and does not fabricate allow/disallow', async () => {
    const policy = await loadRobotsPolicy('https://example.com', 'SEOGEO-Bot', async () => result(503, 'temporary failure'));

    expect(policy.fetched).toBe(true);
    expect(policy.statusCode).toBe(503);
    expect(policy.parseError).toMatch(/unavailable/i);
    expect(policy.isAllowed('https://example.com/a')).toBeNull();
  });
});

describe('discoverSitemaps', () => {
  it('rejects off-scope and non-http Sitemap directives', () => {
    const text = [
      'Sitemap: https://www.example.com/ok.xml',
      'Sitemap: https://evil.example.net/bad.xml',
      'Sitemap: file:///tmp/bad.xml'
    ].join('\n');

    expect(discoverSitemaps(text, 'https://example.com')).toEqual([
      'https://example.com/sitemap.xml',
      'https://www.example.com/ok.xml'
    ]);
  });
});
