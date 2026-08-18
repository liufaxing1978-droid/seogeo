export const SUPPORTED_CRAWL_PROTOCOLS = ['http:', 'https:'] as const;

export type CrawlProtocol = (typeof SUPPORTED_CRAWL_PROTOCOLS)[number];

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface RedirectHop {
  from: string;
  to: string;
  statusCode: number;
}

export interface FetchResult {
  requestUrl: string;
  finalUrl: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string | null;
  contentType: string | null;
  bytes: number;
  responseTimeMs: number;
  redirectChain: RedirectHop[];
  errorCode: string | null;
}

export interface FetchOptions {
  requestTimeoutMs?: number;
  maxRedirects?: number;
  maxResponseBytes?: number;
  userAgent?: string;
  publicTargetGuard?: (url: URL) => Promise<void>;
}
