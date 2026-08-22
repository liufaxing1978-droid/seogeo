import { describe, expect, it } from 'vitest';
import {
  SEARCH_FACT_EVIDENCE_STATES,
  SEARCH_FACT_KINDS,
  SEARCH_FACT_METRIC_SEMANTICS,
  SEARCH_FACT_NORMALIZATION_VERSION,
  SEARCH_FACT_SOURCE_KINDS
} from '../../src/modules/search-facts/search-fact.types.js';

describe('P9-0F search fact contract', () => {
  it('keeps source and metric semantics explicit', () => {
    expect(SEARCH_FACT_NORMALIZATION_VERSION).toBe('SEARCH_FACT_NORMALIZATION_V1');
    expect(SEARCH_FACT_KINDS).toEqual(['QUERY_PAGE', 'QUERY', 'PAGE', 'SITE']);
    expect(SEARCH_FACT_SOURCE_KINDS).toEqual(['GSC_DAILY_SNAPSHOT', 'PROVIDER_OBSERVATION_BATCH']);
    expect(SEARCH_FACT_METRIC_SEMANTICS).toEqual([
      'CLICKS',
      'IMPRESSIONS',
      'CTR',
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'BING_AVG_CLICK_POSITION',
      'BING_AVG_IMPRESSION_POSITION'
    ]);
    expect(SEARCH_FACT_EVIDENCE_STATES).toEqual([
      'KNOWN_PRESENT',
      'KNOWN_EMPTY',
      'UNKNOWN',
      'NOT_SUPPORTED'
    ]);
    expect(SEARCH_FACT_METRIC_SEMANTICS).not.toContain('POSITION');
  });
});
