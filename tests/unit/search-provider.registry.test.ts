import { describe, expect, it } from 'vitest';
import {
  getSearchProviderManifest,
  listSearchProviderManifests,
  requireSearchProviderCapability
} from '../../src/modules/search-providers/search-provider.registry.js';
import { SEARCH_PROVIDER_CAPABILITIES } from '../../src/modules/search-providers/search-provider.types.js';

describe('search provider capability registry', () => {
  it('preserves Google daily query+page API capability', () => {
    const manifest = getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE');
    expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'DAILY',
      readOnly: true,
      accessMode: 'API'
    });
    expect(manifest.capabilities.LIST_PROPERTIES).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'ON_DEMAND',
      readOnly: true,
      accessMode: 'API'
    });
  });

  it('preserves Bing API reads without claiming query+page daily equivalence', () => {
    const manifest = getSearchProviderManifest('BING_WEBMASTER');
    expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
      state: 'NOT_SUPPORTED',
      accessMode: 'NONE'
    });
    expect(manifest.capabilities.QUERY_STATS).toMatchObject({
      state: 'SUPPORTED', cadence: 'WEEKLY', readOnly: true, accessMode: 'API'
    });
    expect(manifest.capabilities.PAGE_STATS).toMatchObject({
      state: 'SUPPORTED', cadence: 'WEEKLY', readOnly: true, accessMode: 'API'
    });
    expect(manifest.capabilities.SITE_TRAFFIC_DAILY).toMatchObject({
      state: 'SUPPORTED', cadence: 'DAILY', readOnly: true, accessMode: 'API'
    });
  });

  it('requires every provider capability to declare an access mode', () => {
    for (const manifest of listSearchProviderManifests()) {
      for (const capability of SEARCH_PROVIDER_CAPABILITIES) {
        expect(manifest.capabilities[capability], `${manifest.provider}.${capability}`).toBeDefined();
        expect(['API', 'PLATFORM_ONLY', 'NONE']).toContain(
          manifest.capabilities[capability].accessMode
        );
      }
    }
  });

  it('records Baidu official URL submission API but keeps runtime execution fail-closed', () => {
    const manifest = getSearchProviderManifest('BAIDU_SEARCH_RESOURCE');
    expect(manifest.capabilities.URL_SUBMISSION).toMatchObject({
      state: 'NOT_IMPLEMENTED',
      cadence: 'ON_DEMAND',
      readOnly: false,
      accessMode: 'API'
    });
    expect(manifest.capabilities.URL_SUBMISSION.notes).toMatch(/secure transport/i);
    expect(() => requireSearchProviderCapability('BAIDU_SEARCH_RESOURCE', 'URL_SUBMISSION'))
      .toThrow(/not implemented/i);
  });

  it('keeps Baidu webmaster observations platform-only instead of fabricating API metrics', () => {
    const manifest = getSearchProviderManifest('BAIDU_SEARCH_RESOURCE');
    for (const capability of [
      'QUERY_STATS',
      'PAGE_STATS',
      'SITE_TRAFFIC_DAILY',
      'INDEX_COVERAGE',
      'CRAWL_STATS',
      'ROBOTS_OBSERVATION',
      'PROVIDER_DIAGNOSTICS'
    ] as const) {
      expect(manifest.capabilities[capability]).toMatchObject({
        state: 'NOT_IMPLEMENTED',
        accessMode: 'PLATFORM_ONLY'
      });
    }
    expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
      state: 'NOT_SUPPORTED',
      accessMode: 'NONE'
    });
  });

  it.each([
    'QIHOO_360_WEBMASTER',
    'SOGOU_WEBMASTER',
    'SHENMA_WEBMASTER'
  ] as const)('keeps %s fail-closed with no fabricated query+page API', (provider) => {
    const manifest = getSearchProviderManifest(provider);
    expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
      state: 'NOT_SUPPORTED',
      accessMode: 'NONE'
    });
    expect(manifest.capabilities.URL_SUBMISSION.state).not.toBe('SUPPORTED');
    expect(manifest.capabilities.SITEMAP_SUBMISSION.state).not.toBe('SUPPORTED');
    expect(() => requireSearchProviderCapability(provider, 'QUERY_PAGE_DAILY'))
      .toThrow(/not supported/i);
  });

  it('fails closed for existing unsupported and unimplemented capabilities', () => {
    expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'QUERY_PAGE_DAILY'))
      .toThrow(/not supported/i);
    expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'CRAWL_STATS'))
      .toThrow(/not implemented/i);
    expect(() => requireSearchProviderCapability('GOOGLE_SEARCH_CONSOLE', 'URL_SUBMISSION'))
      .toThrow(/not supported/i);
  });

  it('lists all six registered providers exactly once in stable order', () => {
    expect(listSearchProviderManifests().map((item) => item.provider)).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER',
      'BAIDU_SEARCH_RESOURCE',
      'QIHOO_360_WEBMASTER',
      'SOGOU_WEBMASTER',
      'SHENMA_WEBMASTER'
    ]);
  });
});
