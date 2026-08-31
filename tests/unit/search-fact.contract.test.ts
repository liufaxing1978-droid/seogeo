import { describe, expect, it } from 'vitest';
import * as searchFactTypes from '../../src/modules/search-facts/search-fact.types.js';
import {
  SEARCH_FACT_EVIDENCE_STATES,
  SEARCH_FACT_KINDS,
  SEARCH_FACT_METRIC_SEMANTICS,
  SEARCH_FACT_NORMALIZATION_VERSION,
  SEARCH_FACT_SOURCE_KINDS
} from '../../src/modules/search-facts/search-fact.types.js';

describe('P9-0F/P11-02C search fact contract', () => {
  it('keeps source and metric semantics explicit', () => {
    expect(SEARCH_FACT_NORMALIZATION_VERSION).toBe('SEARCH_FACT_NORMALIZATION_V1');
    expect(SEARCH_FACT_KINDS).toEqual([
      'QUERY_PAGE',
      'QUERY',
      'PAGE',
      'SITE',
      'QUERY_PAGE_RANK'
    ]);
    expect(SEARCH_FACT_SOURCE_KINDS).toEqual([
      'GSC_DAILY_SNAPSHOT',
      'PROVIDER_OBSERVATION_BATCH',
      'REALTIME_SERP_OBSERVATION'
    ]);
    expect(SEARCH_FACT_METRIC_SEMANTICS).toEqual([
      'CLICKS',
      'IMPRESSIONS',
      'CTR',
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'BING_AVG_CLICK_POSITION',
      'BING_AVG_IMPRESSION_POSITION',
      'CURRENT_SERP_POSITION'
    ]);
    expect(SEARCH_FACT_EVIDENCE_STATES).toEqual([
      'KNOWN_PRESENT',
      'KNOWN_EMPTY',
      'UNKNOWN',
      'NOT_SUPPORTED'
    ]);
    expect(SEARCH_FACT_METRIC_SEMANTICS).not.toContain('POSITION');
  });

  it('keeps realtime SERP fact providers separate from official webmaster provider manifests', () => {
    const realtimeProviders = (
      searchFactTypes as typeof searchFactTypes & {
        REALTIME_SERP_SEARCH_FACT_PROVIDERS?: readonly string[];
      }
    ).REALTIME_SERP_SEARCH_FACT_PROVIDERS;

    expect(realtimeProviders).toEqual(['GOOGLE_SERP', 'BING_SERP']);
  });
});
