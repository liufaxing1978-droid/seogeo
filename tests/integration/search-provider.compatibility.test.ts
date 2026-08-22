import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { GSC_QUERY_NORMALIZATION_VERSION } from '../../src/modules/search-console/search-console.types.js';
import {
  getSearchProviderManifest,
  listSearchProviderManifests
} from '../../src/modules/search-providers/search-provider.registry.js';

const PROVIDER_SOURCE_FILES = [
  'src/modules/search-providers/search-provider.types.ts',
  'src/modules/search-providers/search-provider.registry.ts',
  'src/modules/search-providers/google-search-provider.adapter.ts',
  'src/modules/search-providers/bing-webmaster.client.ts',
  'src/modules/search-providers/bing-search-provider.adapter.ts'
] as const;

function providerSource(): string {
  return PROVIDER_SOURCE_FILES
    .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
    .join('\n');
}

describe('P9-0B search provider compatibility', () => {
  it('keeps the existing GSC query normalization version unchanged', () => {
    expect(GSC_QUERY_NORMALIZATION_VERSION).toBe('GSC_QUERY_NORMALIZATION_V1');
  });

  it('keeps existing GSC Prisma persistence delegates available', () => {
    expect(typeof prisma.gscDailySnapshot.findMany).toBe('function');
    expect(typeof prisma.gscQueryPageFact.findMany).toBe('function');
  });

  it('keeps provider manifests independent from project legacy market fields', () => {
    expect(listSearchProviderManifests().map((manifest) => manifest.provider)).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER'
    ]);
    expect(getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE').provider).toBe('GOOGLE_SEARCH_CONSOLE');
    expect(getSearchProviderManifest('BING_WEBMASTER').provider).toBe('BING_WEBMASTER');

    const source = providerSource();
    expect(source).not.toContain('targetCountry');
    expect(source).not.toContain('defaultLanguage');
  });

  it('does not add Bing write operations or retired SOAP/POX protocols', () => {
    const source = providerSource();
    expect(source).not.toMatch(/\bSubmitUrl\b/);
    expect(source).not.toMatch(/\bSubmitUrlBatch\b/);
    expect(source).not.toMatch(/\bSubmitFeed\b/);
    expect(source).not.toMatch(/\bSOAP\b/);
    expect(source).not.toMatch(/\bPOX\b/);
  });

  it('does not claim Bing daily query+page equivalence', () => {
    const manifest = getSearchProviderManifest('BING_WEBMASTER');
    expect(manifest.capabilities.QUERY_PAGE_DAILY.state).toBe('NOT_SUPPORTED');
    expect(manifest.capabilities.QUERY_STATS.cadence).toBe('WEEKLY');
    expect(manifest.capabilities.PAGE_STATS.cadence).toBe('WEEKLY');
    expect(manifest.capabilities.SITE_TRAFFIC_DAILY.cadence).toBe('DAILY');
  });
});
