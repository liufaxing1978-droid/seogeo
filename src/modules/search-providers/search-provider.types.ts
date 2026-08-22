export const SEARCH_PROVIDER_CODES = Object.freeze([
  'GOOGLE_SEARCH_CONSOLE',
  'BING_WEBMASTER'
] as const);

export type SearchProviderCode = (typeof SEARCH_PROVIDER_CODES)[number];

export const SEARCH_PROVIDER_CAPABILITIES = Object.freeze([
  'LIST_PROPERTIES',
  'QUERY_PAGE_DAILY',
  'QUERY_STATS',
  'PAGE_STATS',
  'SITE_TRAFFIC_DAILY',
  'CRAWL_STATS',
  'URL_INSPECTION',
  'URL_SUBMISSION',
  'SITEMAP_SUBMISSION'
] as const);

export type SearchProviderCapability = (typeof SEARCH_PROVIDER_CAPABILITIES)[number];
export type CapabilityState = 'SUPPORTED' | 'NOT_SUPPORTED' | 'NOT_IMPLEMENTED';
export type SourceCadence = 'DAILY' | 'WEEKLY' | 'ON_DEMAND' | 'UNKNOWN';
export type CompletenessState = 'COMPLETE' | 'TOP_ROWS_ONLY' | 'PROVIDER_UNSPECIFIED';

export interface SearchProviderCapabilityDescriptor {
  state: CapabilityState;
  cadence: SourceCadence;
  readOnly: boolean;
  notes?: string;
}

export interface SearchProviderManifest {
  provider: SearchProviderCode;
  displayName: string;
  capabilities: Readonly<Record<SearchProviderCapability, SearchProviderCapabilityDescriptor>>;
}

export interface SearchProviderProperty {
  provider: SearchProviderCode;
  propertyRef: string;
  propertyType: 'DOMAIN' | 'URL_PREFIX' | 'SITE';
  permissionState: string;
  verified: boolean | null;
}

export interface GoogleQueryPageDailyObservation {
  kind: 'QUERY_PAGE_DAILY';
  provider: 'GOOGLE_SEARCH_CONSOLE';
  sourceDate: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  completeness: 'TOP_ROWS_ONLY';
}

export interface BingQueryObservation {
  kind: 'QUERY_STATS';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  query: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export interface BingPageObservation {
  kind: 'PAGE_STATS';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  page: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export interface BingSiteTrafficObservation {
  kind: 'SITE_TRAFFIC_DAILY';
  provider: 'BING_WEBMASTER';
  sourceDate: string;
  clicks: number;
  impressions: number;
  completeness: 'PROVIDER_UNSPECIFIED';
}

export type SearchProviderObservation =
  | GoogleQueryPageDailyObservation
  | BingQueryObservation
  | BingPageObservation
  | BingSiteTrafficObservation;
