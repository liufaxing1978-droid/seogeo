import type {
  CapabilityState,
  SearchProviderAccessMode,
  SearchProviderCapability,
  SearchProviderCapabilityDescriptor,
  SearchProviderCode,
  SearchProviderManifest
} from './search-provider.types.js';

function descriptor(
  state: CapabilityState,
  cadence: SearchProviderCapabilityDescriptor['cadence'],
  readOnly: boolean,
  accessMode: SearchProviderAccessMode,
  notes?: string
): SearchProviderCapabilityDescriptor {
  return Object.freeze({
    state,
    cadence,
    readOnly,
    accessMode,
    ...(notes ? { notes } : {})
  });
}

function freezeManifest(manifest: SearchProviderManifest): SearchProviderManifest {
  return Object.freeze({
    ...manifest,
    capabilities: Object.freeze({ ...manifest.capabilities })
  });
}

export const GOOGLE_SEARCH_PROVIDER_MANIFEST = freezeManifest({
  provider: 'GOOGLE_SEARCH_CONSOLE',
  displayName: 'Google Search Console',
  capabilities: {
    LIST_PROPERTIES: descriptor('SUPPORTED', 'ON_DEMAND', true, 'API'),
    QUERY_PAGE_DAILY: descriptor('SUPPORTED', 'DAILY', true, 'API'),
    QUERY_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true, 'API'),
    PAGE_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true, 'API'),
    SITE_TRAFFIC_DAILY: descriptor('NOT_IMPLEMENTED', 'DAILY', true, 'API'),
    INDEX_COVERAGE: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'NONE'),
    CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'NONE'),
    ROBOTS_OBSERVATION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'API'),
    PROVIDER_DIAGNOSTICS: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'API'),
    URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'API'),
    URL_SUBMISSION: descriptor('NOT_SUPPORTED', 'ON_DEMAND', false, 'NONE'),
    SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'API')
  }
});

export const BING_SEARCH_PROVIDER_MANIFEST = freezeManifest({
  provider: 'BING_WEBMASTER',
  displayName: 'Bing Webmaster Tools',
  capabilities: {
    LIST_PROPERTIES: descriptor('SUPPORTED', 'ON_DEMAND', true, 'API'),
    QUERY_PAGE_DAILY: descriptor('NOT_SUPPORTED', 'UNKNOWN', true, 'NONE'),
    QUERY_STATS: descriptor('SUPPORTED', 'WEEKLY', true, 'API'),
    PAGE_STATS: descriptor('SUPPORTED', 'WEEKLY', true, 'API'),
    SITE_TRAFFIC_DAILY: descriptor('SUPPORTED', 'DAILY', true, 'API'),
    INDEX_COVERAGE: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'NONE'),
    CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true, 'API'),
    ROBOTS_OBSERVATION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'NONE'),
    PROVIDER_DIAGNOSTICS: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'API'),
    URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'API'),
    URL_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'API'),
    SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'API')
  }
});

export const BAIDU_SEARCH_PROVIDER_MANIFEST = freezeManifest({
  provider: 'BAIDU_SEARCH_RESOURCE',
  displayName: 'Baidu Search Resource Platform',
  capabilities: {
    LIST_PROPERTIES: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
    QUERY_PAGE_DAILY: descriptor('NOT_SUPPORTED', 'UNKNOWN', true, 'NONE'),
    QUERY_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
    PAGE_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
    SITE_TRAFFIC_DAILY: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
    INDEX_COVERAGE: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
    CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
    ROBOTS_OBSERVATION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
    PROVIDER_DIAGNOSTICS: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
    URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
    URL_SUBMISSION: descriptor(
      'NOT_IMPLEMENTED',
      'ON_DEMAND',
      false,
      'API',
      'Official API exists, but runtime submission is disabled pending secure transport verification.'
    ),
    SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'PLATFORM_ONLY')
  }
});

function platformOnlyChinaManifest(
  provider: Extract<SearchProviderCode, 'QIHOO_360_WEBMASTER' | 'SOGOU_WEBMASTER' | 'SHENMA_WEBMASTER'>,
  displayName: string
): SearchProviderManifest {
  return freezeManifest({
    provider,
    displayName,
    capabilities: {
      LIST_PROPERTIES: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
      QUERY_PAGE_DAILY: descriptor('NOT_SUPPORTED', 'UNKNOWN', true, 'NONE'),
      QUERY_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
      PAGE_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
      SITE_TRAFFIC_DAILY: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
      INDEX_COVERAGE: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
      CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true, 'PLATFORM_ONLY'),
      ROBOTS_OBSERVATION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
      PROVIDER_DIAGNOSTICS: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
      URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true, 'PLATFORM_ONLY'),
      URL_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'PLATFORM_ONLY'),
      SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false, 'PLATFORM_ONLY')
    }
  });
}

export const QIHOO_360_SEARCH_PROVIDER_MANIFEST = platformOnlyChinaManifest(
  'QIHOO_360_WEBMASTER',
  '360 Search Webmaster Platform'
);

export const SOGOU_SEARCH_PROVIDER_MANIFEST = platformOnlyChinaManifest(
  'SOGOU_WEBMASTER',
  'Sogou Webmaster Platform'
);

export const SHENMA_SEARCH_PROVIDER_MANIFEST = platformOnlyChinaManifest(
  'SHENMA_WEBMASTER',
  'Shenma Webmaster Platform'
);

const MANIFESTS: Readonly<Record<SearchProviderCode, SearchProviderManifest>> = Object.freeze({
  GOOGLE_SEARCH_CONSOLE: GOOGLE_SEARCH_PROVIDER_MANIFEST,
  BING_WEBMASTER: BING_SEARCH_PROVIDER_MANIFEST,
  BAIDU_SEARCH_RESOURCE: BAIDU_SEARCH_PROVIDER_MANIFEST,
  QIHOO_360_WEBMASTER: QIHOO_360_SEARCH_PROVIDER_MANIFEST,
  SOGOU_WEBMASTER: SOGOU_SEARCH_PROVIDER_MANIFEST,
  SHENMA_WEBMASTER: SHENMA_SEARCH_PROVIDER_MANIFEST
});

export class SearchProviderCapabilityError extends Error {
  constructor(
    readonly provider: SearchProviderCode,
    readonly capability: SearchProviderCapability,
    readonly state: Exclude<CapabilityState, 'SUPPORTED'>
  ) {
    super(
      `Search provider ${provider} capability ${capability} is ${
        state === 'NOT_SUPPORTED' ? 'not supported' : 'not implemented'
      }`
    );
    this.name = 'SearchProviderCapabilityError';
  }
}

export function getSearchProviderManifest(provider: SearchProviderCode): SearchProviderManifest {
  return MANIFESTS[provider];
}

export function listSearchProviderManifests(): readonly SearchProviderManifest[] {
  return [
    GOOGLE_SEARCH_PROVIDER_MANIFEST,
    BING_SEARCH_PROVIDER_MANIFEST,
    BAIDU_SEARCH_PROVIDER_MANIFEST,
    QIHOO_360_SEARCH_PROVIDER_MANIFEST,
    SOGOU_SEARCH_PROVIDER_MANIFEST,
    SHENMA_SEARCH_PROVIDER_MANIFEST
  ];
}

export function requireSearchProviderCapability(
  provider: SearchProviderCode,
  capability: SearchProviderCapability
): SearchProviderCapabilityDescriptor {
  const value = getSearchProviderManifest(provider).capabilities[capability];
  if (value.state !== 'SUPPORTED') {
    throw new SearchProviderCapabilityError(provider, capability, value.state);
  }
  return value;
}
