import { describe, expect, it } from 'vitest';
import { parseHtml } from '../../src/modules/crawler/html-parser.js';

describe('structured entity signal parsing', () => {
  it('extracts bounded JSON-LD and Open Graph identity facts without semantic NER', () => {
    const html = `
      <html>
        <head>
          <title>Example Service</title>
          <meta property="og:site_name" content="Example Site">
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  "@id": "https://example.com/#org",
                  "name": "Example Organization",
                  "alternateName": ["Example Org", "Example"],
                  "url": "https://example.com/",
                  "sameAs": ["https://social.example/example"]
                },
                {
                  "@type": "Service",
                  "@id": "https://example.com/#service",
                  "name": "Example Service",
                  "url": "https://example.com/service",
                  "provider": {
                    "@type": "Organization",
                    "@id": "https://example.com/#org",
                    "name": "Example Organization",
                    "url": "https://example.com/"
                  }
                }
              ]
            }
          </script>
        </head>
        <body>
          <h1>Example Service</h1>
          <p>Unstructured Person Name appears here but must not become an entity signal.</p>
        </body>
      </html>`;

    const parsed = parseHtml(html, 'https://example.com/service', {}, 200);

    expect(parsed.openGraphSiteName).toBe('Example Site');
    expect(parsed.entitySignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaTypes: ['Organization'],
          id: 'https://example.com/#org',
          name: 'Example Organization',
          alternateNames: ['Example Org', 'Example'],
          url: 'https://example.com/',
          sameAs: ['https://social.example/example'],
          role: 'ROOT'
        }),
        expect.objectContaining({
          schemaTypes: ['Service'],
          id: 'https://example.com/#service',
          name: 'Example Service',
          role: 'ROOT'
        }),
        expect.objectContaining({
          schemaTypes: ['Organization'],
          id: 'https://example.com/#org',
          name: 'Example Organization',
          role: 'PROVIDER'
        })
      ])
    );

    expect(JSON.stringify(parsed.entitySignals)).not.toContain('Unstructured Person Name');
  });

  it('ignores malformed JSON-LD instead of inventing entity facts', () => {
    const parsed = parseHtml(
      '<html><head><script type="application/ld+json">{not-json</script></head><body><h1>X</h1></body></html>',
      'https://example.com/',
      {},
      200
    );

    expect(parsed.entitySignals).toEqual([]);
  });
});
