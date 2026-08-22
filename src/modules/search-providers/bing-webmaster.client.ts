import { z } from 'zod';

export type BingWebmasterAuth =
  | { kind: 'OAUTH_BEARER'; accessToken: string }
  | { kind: 'API_KEY'; apiKey: string };

export interface BingSiteEntry {
  url: string;
  isVerified: boolean;
}

export interface BingQueryStat {
  date: string;
  value: string;
  clicks: number;
  impressions: number;
  avgClickPosition: number | null;
  avgImpressionPosition: number | null;
}

export interface BingTrafficStat {
  date: string;
  clicks: number;
  impressions: number;
}

export interface BingWebmasterTransport {
  listSites(auth: BingWebmasterAuth): Promise<BingSiteEntry[]>;
  getQueryStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]>;
  getPageStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]>;
  getRankAndTrafficStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingTrafficStat[]>;
}

export class BingWebmasterTransportError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number | null = null
  ) {
    super(message);
    this.name = 'BingWebmasterTransportError';
  }
}

type FetchLike = typeof fetch;

const API_KEY_BASE = 'https://ssl.bing.com/webmaster/api.svc/json';
const OAUTH_BASE = 'https://www.bing.com/webmaster/api.svc/json';

const SiteWrapperSchema = z.object({
  d: z.array(z.object({
    IsVerified: z.boolean(),
    Url: z.string().min(1)
  }).passthrough())
}).passthrough();

const QueryStatsWrapperSchema = z.object({
  d: z.array(z.object({
    AvgClickPosition: z.number().finite().nonnegative().nullable(),
    AvgImpressionPosition: z.number().finite().nonnegative().nullable(),
    Clicks: z.number().int().nonnegative(),
    Date: z.string().min(1),
    Impressions: z.number().int().nonnegative(),
    Query: z.string().min(1)
  }).passthrough())
}).passthrough();

const TrafficStatsWrapperSchema = z.object({
  d: z.array(z.object({
    Clicks: z.number().int().nonnegative(),
    Date: z.string().min(1),
    Impressions: z.number().int().nonnegative()
  }).passthrough())
}).passthrough();

function validateCredentialFreeHttpUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BingWebmasterTransportError(
      `${label} must be a valid HTTP(S) URL`,
      'BING_WEBMASTER_INVALID_URL'
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new BingWebmasterTransportError(
      `${label} must be a credential-free HTTP(S) URL`,
      'BING_WEBMASTER_INVALID_URL'
    );
  }
  return value;
}

function parseBingDate(value: string, httpStatus: number): string {
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (!match) {
    throw new BingWebmasterTransportError(
      'Bing Webmaster returned an invalid date',
      'BING_WEBMASTER_INVALID_RESPONSE',
      httpStatus
    );
  }
  const milliseconds = Number(match[1]);
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    throw new BingWebmasterTransportError(
      'Bing Webmaster returned an invalid date',
      'BING_WEBMASTER_INVALID_RESPONSE',
      httpStatus
    );
  }
  return date.toISOString().slice(0, 10);
}

function buildRequest(auth: BingWebmasterAuth, method: string, siteUrl?: string): {
  url: URL;
  init: RequestInit;
} {
  const base = auth.kind === 'API_KEY' ? API_KEY_BASE : OAUTH_BASE;
  const url = new URL(`${base}/${method}`);
  if (siteUrl !== undefined) {
    url.searchParams.set('siteUrl', siteUrl);
  }

  const headers = new Headers({ accept: 'application/json' });
  if (auth.kind === 'API_KEY') {
    if (!auth.apiKey) {
      throw new BingWebmasterTransportError(
        'Bing Webmaster API key is required',
        'BING_WEBMASTER_AUTH_INVALID'
      );
    }
    url.searchParams.set('apikey', auth.apiKey);
  } else {
    if (!auth.accessToken) {
      throw new BingWebmasterTransportError(
        'Bing Webmaster access token is required',
        'BING_WEBMASTER_AUTH_INVALID'
      );
    }
    headers.set('authorization', `Bearer ${auth.accessToken}`);
  }

  return { url, init: { headers } };
}

async function executeRequest(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    throw new BingWebmasterTransportError(
      'Bing Webmaster network request failed',
      'BING_WEBMASTER_NETWORK_ERROR',
      null
    );
  }
}

async function parseOkJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new BingWebmasterTransportError(
      'Bing Webmaster request failed',
      'BING_WEBMASTER_REQUEST_FAILED',
      response.status
    );
  }
  try {
    return await response.json();
  } catch {
    throw new BingWebmasterTransportError(
      'Bing Webmaster returned invalid JSON',
      'BING_WEBMASTER_INVALID_RESPONSE',
      response.status
    );
  }
}

export class BingWebmasterClient implements BingWebmasterTransport {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async listSites(auth: BingWebmasterAuth): Promise<BingSiteEntry[]> {
    const { url, init } = buildRequest(auth, 'GetUserSites');
    const response = await executeRequest(this.fetchImpl, url, init);
    const payload = await parseOkJson(response);
    const parsed = SiteWrapperSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BingWebmasterTransportError(
        'Bing Webmaster returned an invalid site-list response',
        'BING_WEBMASTER_INVALID_RESPONSE',
        response.status
      );
    }
    return parsed.data.d.map((site) => ({
      url: validateCredentialFreeHttpUrl(site.Url, 'Bing site URL'),
      isVerified: site.IsVerified
    }));
  }

  async getQueryStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]> {
    return this.getStats(auth, siteUrl, 'GetQueryStats', false);
  }

  async getPageStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingQueryStat[]> {
    return this.getStats(auth, siteUrl, 'GetPageStats', true);
  }

  async getRankAndTrafficStats(auth: BingWebmasterAuth, siteUrl: string): Promise<BingTrafficStat[]> {
    validateCredentialFreeHttpUrl(siteUrl, 'Bing site URL');
    const { url, init } = buildRequest(auth, 'GetRankAndTrafficStats', siteUrl);
    const response = await executeRequest(this.fetchImpl, url, init);
    const payload = await parseOkJson(response);
    const parsed = TrafficStatsWrapperSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BingWebmasterTransportError(
        'Bing Webmaster returned an invalid traffic response',
        'BING_WEBMASTER_INVALID_RESPONSE',
        response.status
      );
    }
    return parsed.data.d.map((row) => ({
      date: parseBingDate(row.Date, response.status),
      clicks: row.Clicks,
      impressions: row.Impressions
    }));
  }

  private async getStats(
    auth: BingWebmasterAuth,
    siteUrl: string,
    method: 'GetQueryStats' | 'GetPageStats',
    valueMustBePageUrl: boolean
  ): Promise<BingQueryStat[]> {
    validateCredentialFreeHttpUrl(siteUrl, 'Bing site URL');
    const { url, init } = buildRequest(auth, method, siteUrl);
    const response = await executeRequest(this.fetchImpl, url, init);
    const payload = await parseOkJson(response);
    const parsed = QueryStatsWrapperSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BingWebmasterTransportError(
        'Bing Webmaster returned an invalid statistics response',
        'BING_WEBMASTER_INVALID_RESPONSE',
        response.status
      );
    }

    return parsed.data.d.map((row) => ({
      date: parseBingDate(row.Date, response.status),
      value: valueMustBePageUrl
        ? validateCredentialFreeHttpUrl(row.Query, 'Bing page URL')
        : row.Query,
      clicks: row.Clicks,
      impressions: row.Impressions,
      avgClickPosition: row.AvgClickPosition,
      avgImpressionPosition: row.AvgImpressionPosition
    }));
  }
}
