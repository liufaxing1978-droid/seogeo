import { describe, expect, it } from 'vitest';
import type { FetchResult } from '../../src/modules/crawler/crawl.types.js';
import type { ParsedPageSignals } from '../../src/modules/crawler/html-parser.js';
import { renderPage, shouldRenderFallback } from '../../src/modules/crawler/browser-renderer.js';

function fetchResult(overrides: Partial<FetchResult> = {}): FetchResult {
  return {
    requestUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    statusCode: 200,
    headers: { 'content-type': 'text/html' },
    body: '<html><head><title>Page</title></head><body>Enough content for normal parsing.</body></html>',
    contentType: 'text/html',
    bytes: 96,
    responseTimeMs: 10,
    redirectChain: [],
    errorCode: null,
    ...overrides
  };
}

function signals(overrides: Partial<ParsedPageSignals> = {}): ParsedPageSignals {
  return {
    title: 'Page',
    metaDescription: null,
    canonicalUrl: null,
    metaRobots: null,
    xRobotsTag: null,
    h1: 'Heading',
    h1Count: 1,
    h2Count: 0,
    h3Count: 0,
    wordCount: 30,
    visibleText: 'word '.repeat(30).trim(),
    language: 'en',
    internalLinks: [],
    externalLinks: [],
    internalLinksCount: 0,
    externalLinksCount: 0,
    imagesCount: 0,
    imagesWithoutAlt: 0,
    schemaCount: 0,
    htmlHash: 'a'.repeat(64),
    contentHash: 'b'.repeat(64),
    indexable: true,
    ...overrides
  };
}

describe('shouldRenderFallback', () => {
  it('never renders when the browser feature is disabled', () => {
    expect(
      shouldRenderFallback(fetchResult({ body: '<html><script src="app.js"></script></html>' }), signals({ wordCount: 0 }), {
        enabled: false,
        robotsAllowed: true
      })
    ).toBe(false);
  });

  it('never renders a robots-disallowed URL', () => {
    expect(
      shouldRenderFallback(fetchResult({ body: '<html><script src="app.js"></script></html>' }), signals({ wordCount: 0 }), {
        enabled: true,
        robotsAllowed: false
      })
    ).toBe(false);
  });

  it.each([
    fetchResult({ statusCode: 404 }),
    fetchResult({ statusCode: 500 }),
    fetchResult({ contentType: 'application/pdf', body: null }),
    fetchResult({ contentType: 'image/png', body: null }),
    fetchResult({ errorCode: 'TIMEOUT', statusCode: 0, body: null })
  ])('does not render non-2xx/non-HTML/error responses', (result) => {
    expect(shouldRenderFallback(result, signals(), { enabled: true, robotsAllowed: true })).toBe(false);
  });

  it('renders a very small 2xx HTML shell', () => {
    expect(
      shouldRenderFallback(fetchResult({ body: '<html><body><div id="app"></div></body></html>' }), signals({ wordCount: 0 }), {
        enabled: true,
        robotsAllowed: true
      })
    ).toBe(true);
  });

  it('renders when visible content is sparse and scripts are present', () => {
    const body = `<html><body>${'<div>x</div>'.repeat(100)}<script src="app.js"></script></body></html>`;
    expect(
      shouldRenderFallback(fetchResult({ body }), signals({ wordCount: 5 }), {
        enabled: true,
        robotsAllowed: true
      })
    ).toBe(true);
  });

  it('renders a script-heavy page with no title and no H1', () => {
    const body = `<html><body>${'<script src="x.js"></script>'.repeat(4)}${' '.repeat(600)}</body></html>`;
    expect(
      shouldRenderFallback(fetchResult({ body }), signals({ title: null, h1: null, wordCount: 25 }), {
        enabled: true,
        robotsAllowed: true
      })
    ).toBe(true);
  });

  it('keeps a sufficiently parsed HTML response on the HTTP path', () => {
    const body = `<html><body><h1>Heading</h1><p>${'useful content '.repeat(80)}</p><script src="app.js"></script></body></html>`;
    expect(
      shouldRenderFallback(fetchResult({ body }), signals({ wordCount: 160 }), {
        enabled: true,
        robotsAllowed: true
      })
    ).toBe(false);
  });
});

describe('renderPage', () => {
  it('returns a disabled result without launching Chromium when the feature is off', async () => {
    const result = await renderPage('https://example.com/', {
      enabled: false,
      primaryDomain: 'example.com'
    });

    expect(result.succeeded).toBe(false);
    expect(result.errorCode).toBe('BROWSER_DISABLED');
    expect(result.html).toBeNull();
  });
});
