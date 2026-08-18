import { describe, expect, it } from 'vitest';
import { parseHtml } from '../../src/modules/crawler/html-parser.js';

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <title> Example Page </title>
  <meta name="description" content="  A useful description.  ">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="/canonical?b=2&a=1#section">
  <script type="application/ld+json">{"@type":"Article"}</script>
  <script>window.app = true;</script>
  <style>.hidden { display: none }</style>
</head>
<body>
  <h1> Main heading </h1>
  <h2>Section A</h2><h2>Section B</h2>
  <h3>Detail</h3>
  <p>Visible English words and 中文内容。</p>
  <div hidden>This must not count</div>
  <div aria-hidden="true">Nor this hidden text</div>
  <noscript>noscript words</noscript>
  <template>template words</template>
  <svg><text>svg words</text></svg>
  <a href="/about">About</a>
  <a href="/about#team">About team</a>
  <a href="https://www.example.com/contact?b=2&a=1">Contact</a>
  <a href="https://external.test/path">External</a>
  <a href="mailto:test@example.com">Email</a>
  <img src="a.jpg" alt="A">
  <img src="b.jpg">
  <img src="c.jpg" alt="   ">
</body>
</html>`;

describe('parseHtml', () => {
  it('extracts deterministic technical page signals', () => {
    const result = parseHtml(html, 'https://example.com/page', { 'x-robots-tag': 'all' }, 200);

    expect(result.title).toBe('Example Page');
    expect(result.metaDescription).toBe('A useful description.');
    expect(result.canonicalUrl).toBe('https://example.com/canonical?a=1&b=2');
    expect(result.metaRobots).toBe('index, follow');
    expect(result.xRobotsTag).toBe('all');
    expect(result.h1).toBe('Main heading');
    expect(result.h1Count).toBe(1);
    expect(result.h2Count).toBe(2);
    expect(result.h3Count).toBe(1);
    expect(result.language).toBe('zh-CN');
    expect(result.imagesCount).toBe(3);
    expect(result.imagesWithoutAlt).toBe(2);
    expect(result.schemaCount).toBe(1);
    expect(result.indexable).toBe(true);
    expect(result.wordCount).toBeGreaterThanOrEqual(8);
    expect(result.visibleText).toContain('Visible English words');
    expect(result.visibleText).not.toContain('must not count');
    expect(result.visibleText).not.toContain('noscript words');
    expect(result.htmlHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('resolves and classifies valid links while preserving factual occurrence counts', () => {
    const result = parseHtml(html, 'https://example.com/page', {}, 200);

    expect(result.internalLinks).toEqual([
      'https://example.com/about',
      'https://www.example.com/contact?a=1&b=2'
    ]);
    expect(result.externalLinks).toEqual(['https://external.test/path']);
    expect(result.internalLinksCount).toBe(3);
    expect(result.externalLinksCount).toBe(1);
  });

  it.each([
    [404, {}, '<meta name="robots" content="index,follow">'],
    [200, {}, '<meta name="robots" content="noindex,follow">'],
    [200, { 'x-robots-tag': 'NOINDEX' }, '<meta name="robots" content="index,follow">']
  ])('sets indexable false only from factual noindex/status signals', (statusCode, headers, head) => {
    const result = parseHtml(`<html><head>${head}</head><body>Page content</body></html>`, 'https://example.com/', headers, statusCode);
    expect(result.indexable).toBe(false);
  });

  it('does not infer non-indexability from a different canonical or thin content', () => {
    const result = parseHtml(
      '<html><head><link rel="canonical" href="https://example.com/other"></head><body>Hi</body></html>',
      'https://example.com/page',
      {},
      200
    );

    expect(result.canonicalUrl).toBe('https://example.com/other');
    expect(result.indexable).toBe(true);
  });

  it('uses the first non-empty H1 text but counts every H1', () => {
    const result = parseHtml('<html><body><h1> </h1><h1>Second</h1><h1>Third</h1></body></html>', 'https://example.com/', {}, 200);
    expect(result.h1).toBe('Second');
    expect(result.h1Count).toBe(3);
  });

  it('produces stable hashes for semantically identical surrounding whitespace', () => {
    const a = parseHtml('<html><body><p>Hello   world</p></body></html>', 'https://example.com/', {}, 200);
    const b = parseHtml('<html>\n<body>\n<p>Hello   world</p>\n</body>\n</html>', 'https://example.com/', {}, 200);

    expect(a.contentHash).toBe(b.contentHash);
    expect(a.visibleText).toBe('Hello world');
    expect(b.visibleText).toBe('Hello world');
  });
});
