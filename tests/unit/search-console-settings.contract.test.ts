import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const clientPath = new URL('../../src/public/js/search-console-settings.js', import.meta.url);

describe('Search Console settings client', () => {
  test('loads the latest readable properties without using a cached API response', async () => {
    const source = await readFile(clientPath, 'utf8');

    expect(source).toContain("fetch(`${apiBase}/properties`, { headers: { Accept: 'application/json' }, cache: 'no-store' })");
  });
});
