import { z } from 'zod';

export const SEARCH_CONSOLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GOOGLE_AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEARCH_CONSOLE_API_BASE = 'https://www.googleapis.com/webmasters/v3';

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

const GoogleTokenPayloadSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().optional(),
  token_type: z.string().min(1).optional(),
  scope: z.string().optional()
}).passthrough();

export type GoogleTokenPayload = z.infer<typeof GoogleTokenPayloadSchema>;

const SiteEntrySchema = z.object({
  siteUrl: z.string().min(1),
  permissionLevel: z.string().min(1)
});

const SiteListSchema = z.object({
  siteEntry: z.array(SiteEntrySchema).optional()
});

export type GoogleSiteEntry = z.infer<typeof SiteEntrySchema>;

export type SearchAnalyticsRequest = {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  dataState?: string;
};

const SearchAnalyticsRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number()
});

const SearchAnalyticsResponseSchema = z.object({
  rows: z.array(SearchAnalyticsRowSchema).optional()
}).passthrough();

export type SearchAnalyticsResponse = z.infer<typeof SearchAnalyticsResponseSchema>;

export interface GoogleSearchConsoleTransport {
  exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokenPayload>;
  refreshToken(refreshToken: string): Promise<GoogleTokenPayload>;
  listSites(accessToken: string): Promise<GoogleSiteEntry[]>;
  querySearchAnalytics(
    accessToken: string,
    siteUrl: string,
    request: SearchAnalyticsRequest
  ): Promise<SearchAnalyticsResponse>;
}

export class GoogleSearchConsoleTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'GoogleSearchConsoleTransportError';
  }
}

export function buildGoogleAuthorizationUrl(config: GoogleOAuthConfig, state: string): URL {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SEARCH_CONSOLE_READONLY_SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url;
}

type FetchLike = typeof fetch;

async function parseJsonResponse(response: Response, code: string): Promise<unknown> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GoogleSearchConsoleTransportError('Google returned an invalid JSON response', code, response.status);
  }
  if (!response.ok) {
    throw new GoogleSearchConsoleTransportError('Google Search Console request failed', code, response.status);
  }
  return body;
}

export class GoogleSearchConsoleClient implements GoogleSearchConsoleTransport {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<GoogleTokenPayload> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code'
    });
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const payload = await parseJsonResponse(response, 'GOOGLE_OAUTH_TOKEN_EXCHANGE_FAILED');
    const parsed = GoogleTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GoogleSearchConsoleTransportError('Google token response is invalid', 'GOOGLE_OAUTH_INVALID_TOKEN_RESPONSE', response.status);
    }
    return parsed.data;
  }

  async refreshToken(refreshToken: string): Promise<GoogleTokenPayload> {
    const body = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    const response = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    const payload = await parseJsonResponse(response, 'GOOGLE_OAUTH_REFRESH_FAILED');
    const parsed = GoogleTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GoogleSearchConsoleTransportError('Google refresh response is invalid', 'GOOGLE_OAUTH_INVALID_REFRESH_RESPONSE', response.status);
    }
    return parsed.data;
  }

  async listSites(accessToken: string): Promise<GoogleSiteEntry[]> {
    const response = await this.fetchImpl(`${SEARCH_CONSOLE_API_BASE}/sites`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
    });
    const payload = await parseJsonResponse(response, 'SEARCH_CONSOLE_SITE_LIST_FAILED');
    const parsed = SiteListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GoogleSearchConsoleTransportError('Google site list response is invalid', 'SEARCH_CONSOLE_INVALID_SITE_LIST', response.status);
    }
    return parsed.data.siteEntry ?? [];
  }

  async querySearchAnalytics(
    accessToken: string,
    siteUrl: string,
    request: SearchAnalyticsRequest
  ): Promise<SearchAnalyticsResponse> {
    const encodedSite = encodeURIComponent(siteUrl);
    const response = await this.fetchImpl(`${SEARCH_CONSOLE_API_BASE}/sites/${encodedSite}/searchAnalytics/query`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(request)
    });
    const payload = await parseJsonResponse(response, 'SEARCH_CONSOLE_ANALYTICS_FAILED');
    const parsed = SearchAnalyticsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GoogleSearchConsoleTransportError('Google Search Analytics response is invalid', 'SEARCH_CONSOLE_INVALID_ANALYTICS_RESPONSE', response.status);
    }
    return { ...parsed.data, rows: parsed.data.rows ?? [] };
  }
}
