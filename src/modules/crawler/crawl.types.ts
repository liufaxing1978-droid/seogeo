export const SUPPORTED_CRAWL_PROTOCOLS = ['http:', 'https:'] as const;

export type CrawlProtocol = (typeof SUPPORTED_CRAWL_PROTOCOLS)[number];

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
