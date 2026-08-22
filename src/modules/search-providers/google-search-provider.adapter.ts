import type {
  GoogleSearchConsoleTransport,
  GoogleSiteEntry
} from '../search-console/google-search-console.client.js';
import type {
  GoogleQueryPageDailyObservation,
  SearchProviderProperty
} from './search-provider.types.js';

export interface GoogleSearchProviderAccess {
  getAccessToken(projectId: string): Promise<string>;
  listReadableProperties(projectId: string): Promise<GoogleSiteEntry[]>;
}

type SearchAnalyticsTransport = Pick<GoogleSearchConsoleTransport, 'querySearchAnalytics'>;

const DEFAULT_ROW_LIMIT = 25_000;
const MAX_ROW_LIMIT = 25_000;

function assertSourceDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Source date must use YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw new Error('Source date must be a real calendar date');
  }
}

function assertRowLimit(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ROW_LIMIT) {
    throw new Error(`Row limit must be an integer between 1 and ${MAX_ROW_LIMIT}`);
  }
}

function assertPageUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Google page URL is invalid');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Google page URL must be credential-free HTTP(S)');
  }
}

function assertIntegerMetric(value: number, name: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a finite nonnegative integer`);
  }
}

function assertFiniteNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and nonnegative`);
  }
}

export class GoogleSearchProviderAdapter {
  readonly provider = 'GOOGLE_SEARCH_CONSOLE' as const;

  constructor(
    private readonly access: GoogleSearchProviderAccess,
    private readonly transport: SearchAnalyticsTransport
  ) {}

  async listProperties(projectId: string): Promise<SearchProviderProperty[]> {
    const sites = await this.access.listReadableProperties(projectId);
    return sites.map((site) => ({
      provider: this.provider,
      propertyRef: site.siteUrl,
      propertyType: site.siteUrl.startsWith('sc-domain:') ? 'DOMAIN' : 'URL_PREFIX',
      permissionState: site.permissionLevel,
      verified: true
    }));
  }

  async fetchQueryPageDaily(input: {
    projectId: string;
    propertyRef: string;
    sourceDate: string;
    rowLimit?: number;
  }): Promise<GoogleQueryPageDailyObservation[]> {
    assertSourceDate(input.sourceDate);
    const rowLimit = input.rowLimit ?? DEFAULT_ROW_LIMIT;
    assertRowLimit(rowLimit);

    const accessToken = await this.access.getAccessToken(input.projectId);
    const response = await this.transport.querySearchAnalytics(
      accessToken,
      input.propertyRef,
      {
        startDate: input.sourceDate,
        endDate: input.sourceDate,
        dimensions: ['query', 'page'],
        rowLimit
      }
    );

    return (response.rows ?? []).map((row) => {
      if (row.keys.length !== 2 || !row.keys[0]?.trim() || !row.keys[1]?.trim()) {
        throw new Error('Google Search Analytics row must contain exactly query and page keys');
      }
      const [query, page] = row.keys;
      assertPageUrl(page!);
      assertIntegerMetric(row.clicks, 'clicks');
      assertIntegerMetric(row.impressions, 'impressions');
      if (!Number.isFinite(row.ctr) || row.ctr < 0 || row.ctr > 1) {
        throw new Error('ctr must be finite and between 0 and 1');
      }
      assertFiniteNonnegative(row.position, 'position');

      return {
        kind: 'QUERY_PAGE_DAILY',
        provider: this.provider,
        sourceDate: input.sourceDate,
        query: query!,
        page: page!,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        completeness: 'TOP_ROWS_ONLY'
      };
    });
  }
}
