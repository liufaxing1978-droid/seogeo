import { describe, expect, it } from 'vitest';
import { parseSitemap } from '../../src/modules/crawler/sitemap.service.js';

describe('parseSitemap', () => {
  it('parses a urlset with metadata, normalization, scope filtering, and deduplication', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url>
          <loc>HTTPS://Example.COM:443/a?b=2&amp;a=1#frag</loc>
          <lastmod>2026-08-17</lastmod>
          <changefreq>daily</changefreq>
          <priority>0.8</priority>
        </url>
        <url><loc>https://example.com/a?a=1&amp;b=2</loc></url>
        <url><loc>https://evil.example.net/out</loc></url>
      </urlset>`;

    const result = parseSitemap(xml, 'https://example.com/sitemap.xml');

    expect(result.type).toBe('URLSET');
    expect(result.parseError).toBeNull();
    expect(result.urls).toEqual([
      {
        url: 'https://example.com/a?a=1&b=2',
        lastmod: '2026-08-17',
        changefreq: 'daily',
        priority: 0.8
      }
    ]);
    expect(result.sitemapUrls).toEqual([]);
  });

  it('parses namespace-qualified sitemap indexes and deduplicates child sitemaps', () => {
    const xml = `<?xml version="1.0"?>
      <s:sitemapindex xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9">
        <s:sitemap><s:loc>https://example.com/sitemap-posts.xml</s:loc><s:lastmod>2026-08-18</s:lastmod></s:sitemap>
        <s:sitemap><s:loc>https://example.com/sitemap-posts.xml</s:loc></s:sitemap>
        <s:sitemap><s:loc>https://www.example.com/sitemap-pages.xml</s:loc></s:sitemap>
        <s:sitemap><s:loc>https://evil.example.net/sitemap.xml</s:loc></s:sitemap>
      </s:sitemapindex>`;

    const result = parseSitemap(xml, 'https://example.com/sitemap.xml');

    expect(result.type).toBe('INDEX');
    expect(result.urls).toEqual([]);
    expect(result.sitemapUrls).toEqual([
      'https://example.com/sitemap-posts.xml',
      'https://www.example.com/sitemap-pages.xml'
    ]);
  });

  it('reports malformed XML instead of returning fabricated entries', () => {
    const result = parseSitemap('<urlset><url><loc>https://example.com/a</urlset>', 'https://example.com/sitemap.xml');

    expect(result.type).toBeNull();
    expect(result.urls).toEqual([]);
    expect(result.sitemapUrls).toEqual([]);
    expect(result.parseError).toBeTruthy();
  });

  it('rejects a valid XML document that is not a sitemap root', () => {
    const result = parseSitemap('<feed><item>hello</item></feed>', 'https://example.com/sitemap.xml');

    expect(result.type).toBeNull();
    expect(result.parseError).toMatch(/root/i);
  });
});
