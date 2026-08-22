import { describe, expect, it } from 'vitest';
import {
  SEARCH_PROVIDER_CAPABILITIES,
  SEARCH_PROVIDER_CODES,
  type SearchProviderAccessMode
} from '../../src/modules/search-providers/search-provider.types.js';

function acceptsAccessMode(value: SearchProviderAccessMode): SearchProviderAccessMode {
  return value;
}

describe('search provider contracts', () => {
  it('locks the global and China provider set', () => {
    expect(SEARCH_PROVIDER_CODES).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER',
      'BAIDU_SEARCH_RESOURCE',
      'QIHOO_360_WEBMASTER',
      'SOGOU_WEBMASTER',
      'SHENMA_WEBMASTER'
    ]);
  });

  it('locks capability names without generic OTHER buckets', () => {
    expect(SEARCH_PROVIDER_CAPABILITIES).toEqual([
      'LIST_PROPERTIES',
      'QUERY_PAGE_DAILY',
      'QUERY_STATS',
      'PAGE_STATS',
      'SITE_TRAFFIC_DAILY',
      'INDEX_COVERAGE',
      'CRAWL_STATS',
      'ROBOTS_OBSERVATION',
      'PROVIDER_DIAGNOSTICS',
      'URL_INSPECTION',
      'URL_SUBMISSION',
      'SITEMAP_SUBMISSION'
    ]);
  });

  it('defines explicit API, platform-only, and none access modes', () => {
    expect([
      acceptsAccessMode('API'),
      acceptsAccessMode('PLATFORM_ONLY'),
      acceptsAccessMode('NONE')
    ]).toEqual(['API', 'PLATFORM_ONLY', 'NONE']);
  });

  it('freezes provider and capability constants at runtime', () => {
    expect(Object.isFrozen(SEARCH_PROVIDER_CODES)).toBe(true);
    expect(Object.isFrozen(SEARCH_PROVIDER_CAPABILITIES)).toBe(true);
  });
});
