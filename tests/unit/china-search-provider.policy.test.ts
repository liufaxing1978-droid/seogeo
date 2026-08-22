import { describe, expect, it } from 'vitest';
import {
  getChinaSearchProviderPolicy,
  listChinaSearchProviderPolicies
} from '../../src/modules/search-providers/china-search-provider.policy.js';

const CHINA_PROVIDERS = [
  'BAIDU_SEARCH_RESOURCE',
  'QIHOO_360_WEBMASTER',
  'SOGOU_WEBMASTER',
  'SHENMA_WEBMASTER'
] as const;

describe('China search provider policy', () => {
  it('lists all four China providers exactly once in stable order', () => {
    expect(listChinaSearchProviderPolicies().map((policy) => policy.provider)).toEqual(CHINA_PROVIDERS);
  });

  it.each(CHINA_PROVIDERS)('locks %s to the CN market policy layer', (provider) => {
    expect(getChinaSearchProviderPolicy(provider).market).toBe('CN');
  });

  it.each(CHINA_PROVIDERS)('disallows credential persistence for %s', (provider) => {
    expect(getChinaSearchProviderPolicy(provider).credentialPersistenceAllowed).toBe(false);
  });

  it.each(CHINA_PROVIDERS)('disallows authenticated dashboard scraping for %s', (provider) => {
    expect(getChinaSearchProviderPolicy(provider).authenticatedDashboardScrapingAllowed).toBe(false);
  });

  it.each(CHINA_PROVIDERS)('disallows undocumented endpoints for %s', (provider) => {
    expect(getChinaSearchProviderPolicy(provider).undocumentedEndpointAccessAllowed).toBe(false);
  });

  it.each(CHINA_PROVIDERS)('keeps runtime writes disabled for %s', (provider) => {
    expect(getChinaSearchProviderPolicy(provider).runtimeWriteEnabled).toBe(false);
  });

  it('returns frozen policy objects and a frozen policy list', () => {
    const policies = listChinaSearchProviderPolicies();
    expect(Object.isFrozen(policies)).toBe(true);
    for (const policy of policies) {
      expect(Object.isFrozen(policy)).toBe(true);
      expect(Object.isFrozen(policy.reasons)).toBe(true);
      expect(policy.reasons.length).toBeGreaterThan(0);
    }
  });
});
