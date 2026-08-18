import { SUPPORTED_CRAWL_PROTOCOLS } from './crawl.types.js';

function assertSupportedProtocol(url: URL) {
  if (!SUPPORTED_CRAWL_PROTOCOLS.includes(url.protocol as (typeof SUPPORTED_CRAWL_PROTOCOLS)[number])) {
    throw new Error('Crawler only supports HTTP and HTTPS URLs');
  }
}

function sortSearchParams(url: URL) {
  const entries = [...url.searchParams.entries()].sort(([keyA, valueA], [keyB, valueB]) => {
    const keyOrder = keyA.localeCompare(keyB);
    return keyOrder !== 0 ? keyOrder : valueA.localeCompare(valueB);
  });

  url.search = '';
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}

export function normalizeCrawlUrl(input: string): string {
  const url = new URL(input);
  assertSupportedProtocol(url);

  if (url.username || url.password) {
    throw new Error('Crawler URLs must not contain credentials');
  }

  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  sortSearchParams(url);

  return url.toString();
}

export function isInProjectScope(url: URL, primaryDomain: string): boolean {
  if (!SUPPORTED_CRAWL_PROTOCOLS.includes(url.protocol as (typeof SUPPORTED_CRAWL_PROTOCOLS)[number])) {
    return false;
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const configured = primaryDomain.toLowerCase().replace(/\.$/, '');
  const bare = configured.startsWith('www.') ? configured.slice(4) : configured;

  return host === bare || host === `www.${bare}`;
}
