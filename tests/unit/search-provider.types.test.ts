import { describe, expect, it } from 'vitest';
import {
  SEARCH_PROVIDER_CAPABILITIES,
  SEARCH_PROVIDER_CODES
} from '../../src/modules/search-providers/search-provider.types.js';

describe('search provider contracts', () => {
  it('locks the initial global provider set', () => {
    expect(SEARCH_PROVIDER_CODES).toEqual([
      'GOOGLE_SEARCH_CONSOLE',
      'BING_WEBMASTER'
    ]);
  });

  it('locks capability names without generic OTHER buckets', () => {
    expect(SEARCH_PROVIDER_CAPABILITIES).toEqual([
      'LIST_PROPERTIES',
      'QUERY_PAGE_DAILY',
      'QUERY_STATS',
      'PAGE_STATS',
      'SITE_TRAFFIC_DAILY',
      'CRAWL_STATS',
      'URL_INSPECTION',
      'URL_SUBMISSION',
      'SITEMAP_SUBMISSION'
    ]);
  });
});
