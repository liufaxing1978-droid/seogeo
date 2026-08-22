import { describe, expect, it } from 'vitest';
import {
  getSearchProviderManifest,
  listSearchProviderManifests,
  requireSearchProviderCapability
} from '../../src/modules/search-providers/search-provider.registry.js';

describe('search provider capability registry', () => {
  it('does not claim Bing query+page daily equivalence', () => {
    const manifest = getSearchProviderManifest('BING_WEBMASTER');
    expect(manifest.capabilities.QUERY_PAGE_DAILY.state).toBe('NOT_SUPPORTED');
    expect(manifest.capabilities.QUERY_STATS).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'WEEKLY',
      readOnly: true
    });
    expect(manifest.capabilities.PAGE_STATS).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'WEEKLY',
      readOnly: true
    });
    expect(manifest.capabilities.SITE_TRAFFIC_DAILY).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'DAILY',
      readOnly: true
    });
  });

  it('preserves Google daily query+page capability', () => {
    const manifest = getSearchProviderManifest('GOOGLE_SEARCH_CONSOLE');
    expect(manifest.capabilities.QUERY_PAGE_DAILY).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'DAILY',
      readOnly: true
    });
    expect(manifest.capabilities.LIST_PROPERTIES).toMatchObject({
      state: 'SUPPORTED',
      cadence: 'ON_DEMAND',
      readOnly: true
    });
  });

  it('fails closed for unsupported and unimplemented capabilities', () => {
    expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'QUERY_PAGE_DAILY'))
      .toThrow(/not supported/i);
    expect(() => requireSearchProviderCapability('BING_WEBMASTER', 'CRAWL_STATS'))
      .toThrow(/not implemented/i);
    expect(() => requireSearchProviderCapability('GOOGLE_SEARCH_CONSOLE', 'URL_SUBMISSION'))
      .toThrow(/not supported/i);
  });

  it('lists each registered provider exactly once', () => {
    expect(listSearchProviderManifests().map((item) => item.provider)).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER'
    ]);
  });
});
