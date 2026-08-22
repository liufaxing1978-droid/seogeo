import type {
  CapabilityState,
  SearchProviderCapability,
  SearchProviderCapabilityDescriptor,
  SearchProviderCode,
  SearchProviderManifest
} from './search-provider.types.js';

function descriptor(
  state: CapabilityState,
  cadence: SearchProviderCapabilityDescriptor['cadence'],
  readOnly: boolean,
  notes?: string
): SearchProviderCapabilityDescriptor {
  return Object.freeze({ state, cadence, readOnly, ...(notes ? { notes } : {}) });
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
    LIST_PROPERTIES: descriptor('SUPPORTED', 'ON_DEMAND', true),
    QUERY_PAGE_DAILY: descriptor('SUPPORTED', 'DAILY', true),
    QUERY_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true),
    PAGE_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true),
    SITE_TRAFFIC_DAILY: descriptor('NOT_IMPLEMENTED', 'DAILY', true),
    CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'UNKNOWN', true),
    URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true),
    URL_SUBMISSION: descriptor('NOT_SUPPORTED', 'ON_DEMAND', false),
    SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false)
  }
});

export const BING_SEARCH_PROVIDER_MANIFEST = freezeManifest({
  provider: 'BING_WEBMASTER',
  displayName: 'Bing Webmaster Tools',
  capabilities: {
    LIST_PROPERTIES: descriptor('SUPPORTED', 'ON_DEMAND', true),
    QUERY_PAGE_DAILY: descriptor('NOT_SUPPORTED', 'UNKNOWN', true),
    QUERY_STATS: descriptor('SUPPORTED', 'WEEKLY', true),
    PAGE_STATS: descriptor('SUPPORTED', 'WEEKLY', true),
    SITE_TRAFFIC_DAILY: descriptor('SUPPORTED', 'DAILY', true),
    CRAWL_STATS: descriptor('NOT_IMPLEMENTED', 'DAILY', true),
    URL_INSPECTION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', true),
    URL_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false),
    SITEMAP_SUBMISSION: descriptor('NOT_IMPLEMENTED', 'ON_DEMAND', false)
  }
});

const MANIFESTS: Readonly<Record<SearchProviderCode, SearchProviderManifest>> = Object.freeze({
  GOOGLE_SEARCH_CONSOLE: GOOGLE_SEARCH_PROVIDER_MANIFEST,
  BING_WEBMASTER: BING_SEARCH_PROVIDER_MANIFEST
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
  return [GOOGLE_SEARCH_PROVIDER_MANIFEST, BING_SEARCH_PROVIDER_MANIFEST];
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
