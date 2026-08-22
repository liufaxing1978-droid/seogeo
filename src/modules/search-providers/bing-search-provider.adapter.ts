import type {
  BingWebmasterAuth,
  BingWebmasterTransport
} from './bing-webmaster.client.js';
import type {
  BingPageObservation,
  BingQueryObservation,
  BingSiteTrafficObservation,
  SearchProviderProperty
} from './search-provider.types.js';

function assertPageUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Bing page URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Bing page URL must be credential-free HTTP(S)');
  }
}

export class BingSearchProviderAdapter {
  readonly provider = 'BING_WEBMASTER' as const;

  constructor(
    private readonly transport: BingWebmasterTransport,
    private readonly auth: BingWebmasterAuth
  ) {}

  async listProperties(): Promise<SearchProviderProperty[]> {
    const sites = await this.transport.listSites(this.auth);
    return sites
      .filter((site) => site.isVerified)
      .map((site) => ({
        provider: this.provider,
        propertyRef: site.url,
        propertyType: 'SITE',
        permissionState: 'VERIFIED',
        verified: true
      }));
  }

  async fetchQueryStats(siteUrl: string): Promise<BingQueryObservation[]> {
    const rows = await this.transport.getQueryStats(this.auth, siteUrl);
    return rows
      .map((row) => ({
        kind: 'QUERY_STATS' as const,
        provider: this.provider,
        sourceDate: row.date,
        query: row.value,
        clicks: row.clicks,
        impressions: row.impressions,
        avgClickPosition: row.avgClickPosition,
        avgImpressionPosition: row.avgImpressionPosition,
        completeness: 'PROVIDER_UNSPECIFIED' as const
      }))
      .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate) || a.query.localeCompare(b.query));
  }

  async fetchPageStats(siteUrl: string): Promise<BingPageObservation[]> {
    const rows = await this.transport.getPageStats(this.auth, siteUrl);
    return rows
      .map((row) => {
        assertPageUrl(row.value);
        return {
          kind: 'PAGE_STATS' as const,
          provider: this.provider,
          sourceDate: row.date,
          page: row.value,
          clicks: row.clicks,
          impressions: row.impressions,
          avgClickPosition: row.avgClickPosition,
          avgImpressionPosition: row.avgImpressionPosition,
          completeness: 'PROVIDER_UNSPECIFIED' as const
        };
      })
      .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate) || a.page.localeCompare(b.page));
  }

  async fetchSiteTrafficDaily(siteUrl: string): Promise<BingSiteTrafficObservation[]> {
    const rows = await this.transport.getRankAndTrafficStats(this.auth, siteUrl);
    return rows
      .map((row) => ({
        kind: 'SITE_TRAFFIC_DAILY' as const,
        provider: this.provider,
        sourceDate: row.date,
        clicks: row.clicks,
        impressions: row.impressions,
        completeness: 'PROVIDER_UNSPECIFIED' as const
      }))
      .sort((a, b) => a.sourceDate.localeCompare(b.sourceDate));
  }
}
