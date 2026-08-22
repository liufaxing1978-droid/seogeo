import type { SearchProviderCode } from './search-provider.types.js';

export type ChinaSearchProviderCode = Extract<
  SearchProviderCode,
  | 'BAIDU_SEARCH_RESOURCE'
  | 'QIHOO_360_WEBMASTER'
  | 'SOGOU_WEBMASTER'
  | 'SHENMA_WEBMASTER'
>;

export interface ChinaSearchProviderPolicy {
  provider: ChinaSearchProviderCode;
  market: 'CN';
  credentialPersistenceAllowed: false;
  authenticatedDashboardScrapingAllowed: false;
  undocumentedEndpointAccessAllowed: false;
  runtimeWriteEnabled: false;
  reasons: readonly string[];
}

function policy(
  provider: ChinaSearchProviderCode,
  reasons: readonly string[]
): ChinaSearchProviderPolicy {
  return Object.freeze({
    provider,
    market: 'CN' as const,
    credentialPersistenceAllowed: false as const,
    authenticatedDashboardScrapingAllowed: false as const,
    undocumentedEndpointAccessAllowed: false as const,
    runtimeWriteEnabled: false as const,
    reasons: Object.freeze([...reasons])
  });
}

const BAIDU_POLICY = policy('BAIDU_SEARCH_RESOURCE', [
  'Official webmaster capabilities are represented through explicit manifest states.',
  'Runtime URL submission remains disabled until a secure authoritative transport is verified.',
  'Authenticated dashboard scraping and undocumented endpoints are prohibited.'
]);

const QIHOO_360_POLICY = policy('QIHOO_360_WEBMASTER', [
  'Publicly verified webmaster capabilities are platform-only in P9-0C.',
  'No stable public statistics API is treated as callable by the runtime.',
  'Authenticated dashboard scraping and undocumented endpoints are prohibited.'
]);

const SOGOU_POLICY = policy('SOGOU_WEBMASTER', [
  'Publicly verified resource-submission and webmaster capabilities are platform-only in P9-0C.',
  'No stable public statistics API is treated as callable by the runtime.',
  'Authenticated dashboard scraping and undocumented endpoints are prohibited.'
]);

const SHENMA_POLICY = policy('SHENMA_WEBMASTER', [
  'Publicly verified sitemap, data-open, and webmaster capabilities are platform-only in P9-0C.',
  'No stable public statistics API is treated as callable by the runtime.',
  'Authenticated dashboard scraping and undocumented endpoints are prohibited.'
]);

const POLICIES = Object.freeze([
  BAIDU_POLICY,
  QIHOO_360_POLICY,
  SOGOU_POLICY,
  SHENMA_POLICY
] as const);

const POLICY_BY_PROVIDER: Readonly<Record<ChinaSearchProviderCode, ChinaSearchProviderPolicy>> =
  Object.freeze({
    BAIDU_SEARCH_RESOURCE: BAIDU_POLICY,
    QIHOO_360_WEBMASTER: QIHOO_360_POLICY,
    SOGOU_WEBMASTER: SOGOU_POLICY,
    SHENMA_WEBMASTER: SHENMA_POLICY
  });

export function getChinaSearchProviderPolicy(
  provider: ChinaSearchProviderCode
): ChinaSearchProviderPolicy {
  return POLICY_BY_PROVIDER[provider];
}

export function listChinaSearchProviderPolicies(): readonly ChinaSearchProviderPolicy[] {
  return POLICIES;
}
