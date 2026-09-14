import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

describe('Search Console immediate sync entry', () => {
  test('protects the sync request and renders a CSRF-protected form for a selected property', async () => {
    const [routes, template] = await Promise.all([
      readFile(new URL('../../src/modules/search-console/search-console.web.routes.ts', import.meta.url), 'utf8'),
      readFile(new URL('../../src/views/search-console/settings.ejs', import.meta.url), 'utf8')
    ]);

    expect(routes).toContain("'/projects/:id/search-console/sync'");
    expect(routes).toContain("requireProjectCapability('SEO_RUN')");
    expect(routes).toContain('requireCsrf()');
    expect(template).toContain('立即同步最近 56 天数据');
    expect(template).toContain('name="_csrf"');
  });
});
