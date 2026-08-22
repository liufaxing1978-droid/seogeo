import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GSC_QUERY_NORMALIZATION_VERSION } from '../../src/modules/search-console/search-console.types.js';
import {
  getSearchProviderManifest,
  requireSearchProviderCapability
} from '../../src/modules/search-providers/search-provider.registry.js';
import { listChinaSearchProviderPolicies } from '../../src/modules/search-providers/china-search-provider.policy.js';

const SEARCH_PROVIDER_ROOT = resolve(process.cwd(), 'src/modules/search-providers');
const CHINA_PROVIDER_CODES = [
  'BAIDU_SEARCH_RESOURCE',
  'QIHOO_360_WEBMASTER',
  'SOGOU_WEBMASTER',
  'SHENMA_WEBMASTER'
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = resolve(directory, entry.name);
      return entry.isDirectory()
        ? sourceFiles(absolute)
        : entry.isFile() && entry.name.endsWith('.ts')
          ? [absolute]
          : [];
    })
    .sort();
}

function searchProviderSource(): string {
  return sourceFiles(SEARCH_PROVIDER_ROOT)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
}

describe('P9-0C China search provider compatibility', () => {
  it('preserves existing Google and Bing runtime capabilities', () => {
    expect(getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE').capabilities.QUERY_PAGE_DAILY)
      .toMatchObject({ state: 'SUPPORTED', cadence: 'DAILY', accessMode: 'API' });
    expect(getSearchProviderManifest('BING_WEBMASTER').capabilities.QUERY_STATS)
      .toMatchObject({ state: 'SUPPORTED', cadence: 'WEEKLY', accessMode: 'API' });
    expect(getSearchProviderManifest('BING_WEBMASTER').capabilities.PAGE_STATS)
      .toMatchObject({ state: 'SUPPORTED', cadence: 'WEEKLY', accessMode: 'API' });
    expect(getSearchProviderManifest('BING_WEBMASTER').capabilities.SITE_TRAFFIC_DAILY)
      .toMatchObject({ state: 'SUPPORTED', cadence: 'DAILY', accessMode: 'API' });
  });

  it('keeps the existing GSC normalization authority unchanged', () => {
    expect(GSC_QUERY_NORMALIZATION_VERSION).toBe('GSC_QUERY_NORMALIZATION_V1');
  });

  it('does not import browser or HTML scraping libraries in provider production source', () => {
    const source = searchProviderSource();
    expect(source).not.toMatch(/from ['"](?:playwright|puppeteer|cheerio)['"]/i);
    expect(source).not.toMatch(/require\(['"](?:playwright|puppeteer|cheerio)['"]\)/i);
  });

  it('does not add China authenticated-dashboard runtime client modules', () => {
    const filenames = sourceFiles(SEARCH_PROVIDER_ROOT)
      .map((path) => relative(SEARCH_PROVIDER_ROOT, path).replaceAll('\\', '/'));

    expect(filenames).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/baidu.*client\.ts$/i),
      expect.stringMatching(/(?:360|qihoo).*client\.ts$/i),
      expect.stringMatching(/sogou.*client\.ts$/i),
      expect.stringMatching(/shenma.*client\.ts$/i)
    ]));
  });

  it('keeps provider production source independent from legacy project market fields', () => {
    const source = searchProviderSource();
    expect(source).not.toContain('targetCountry');
    expect(source).not.toContain('defaultLanguage');
  });

  it('keeps Baidu URL submission fail-closed despite recorded official API availability', () => {
    expect(getSearchProviderManifest('BAIDU_SEARCH_RESOURCE').capabilities.URL_SUBMISSION)
      .toMatchObject({ state: 'NOT_IMPLEMENTED', accessMode: 'API', readOnly: false });
    expect(() => requireSearchProviderCapability('BAIDU_SEARCH_RESOURCE', 'URL_SUBMISSION'))
      .toThrow(/not implemented/i);
  });

  it.each(CHINA_PROVIDER_CODES)('never fabricates QUERY_PAGE_DAILY support for %s', (provider) => {
    expect(getSearchProviderManifest(provider).capabilities.QUERY_PAGE_DAILY)
      .toMatchObject({ state: 'NOT_SUPPORTED', accessMode: 'NONE' });
  });

  it('keeps every China provider policy write- and scraping-disabled', () => {
    for (const policy of listChinaSearchProviderPolicies()) {
      expect(policy.runtimeWriteEnabled).toBe(false);
      expect(policy.credentialPersistenceAllowed).toBe(false);
      expect(policy.authenticatedDashboardScrapingAllowed).toBe(false);
      expect(policy.undocumentedEndpointAccessAllowed).toBe(false);
    }
  });

  it('scans a real provider source tree rather than an empty fixture', () => {
    const files = sourceFiles(SEARCH_PROVIDER_ROOT);
    expect(statSync(SEARCH_PROVIDER_ROOT).isDirectory()).toBe(true);
    expect(files.length).toBeGreaterThanOrEqual(6);
  });
});
