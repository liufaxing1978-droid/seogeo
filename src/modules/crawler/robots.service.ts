import { createRequire } from 'node:module';
import { fetchPage } from './http-fetcher.js';
import type { FetchOptions, FetchResult } from './crawl.types.js';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';

interface RobotParserInstance {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
}

type RobotParserFactory = (url: string, contents: string) => RobotParserInstance;

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as RobotParserFactory;

export type RobotsAllowed = boolean | null;

export interface RobotsPolicy {
  fetched: boolean;
  statusCode: number;
  rawText: string | null;
  isAllowed: (url: string) => RobotsAllowed;
  sitemapUrls: string[];
  parseError: string | null;
}

type RobotsFetcher = (url: string, options?: FetchOptions) => Promise<FetchResult>;

function originUrl(input: string): URL {
  const url = new URL(input);
  return new URL(`${url.protocol}//${url.host}`);
}

export function discoverSitemaps(robotsText: string, origin: string): string[] {
  const base = originUrl(origin);
  const primaryDomain = base.hostname;
  const candidates = [new URL('/sitemap.xml', base).toString()];

  for (const line of robotsText.split(/\r?\n/)) {
    const match = line.match(/^\s*sitemap\s*:\s*(.+?)\s*$/i);
    if (!match?.[1]) continue;
    try {
      candidates.push(new URL(match[1], base).toString());
    } catch {
      continue;
    }
  }

  const seen = new Set<string>();
  const sitemapUrls: string[] = [];

  for (const candidate of candidates) {
    try {
      const normalized = normalizeCrawlUrl(candidate);
      const url = new URL(normalized);
      if (!isInProjectScope(url, primaryDomain) || seen.has(normalized)) continue;
      seen.add(normalized);
      sitemapUrls.push(normalized);
    } catch {
      continue;
    }
  }

  return sitemapUrls;
}

function unavailablePolicy(
  fetched: boolean,
  statusCode: number,
  rawText: string | null,
  sitemapUrls: string[],
  parseError: string
): RobotsPolicy {
  return {
    fetched,
    statusCode,
    rawText,
    sitemapUrls,
    parseError,
    isAllowed: () => null
  };
}

export async function loadRobotsPolicy(
  origin: string,
  userAgent: string,
  fetcher: RobotsFetcher = fetchPage
): Promise<RobotsPolicy> {
  const base = originUrl(origin);
  const robotsUrl = new URL('/robots.txt', base).toString();
  const response = await fetcher(robotsUrl, { userAgent });
  const sitemapUrls = discoverSitemaps(response.body ?? '', base.toString());

  if (response.errorCode) {
    return unavailablePolicy(
      false,
      response.statusCode,
      response.body,
      sitemapUrls,
      `robots unavailable: ${response.errorCode}`
    );
  }

  if (response.statusCode === 404 || response.statusCode === 410) {
    return {
      fetched: true,
      statusCode: response.statusCode,
      rawText: response.body,
      sitemapUrls,
      parseError: null,
      isAllowed: () => true
    };
  }

  if (response.statusCode >= 500 || response.statusCode === 429) {
    return unavailablePolicy(
      true,
      response.statusCode,
      response.body,
      sitemapUrls,
      `robots unavailable: HTTP ${response.statusCode}`
    );
  }

  if (response.statusCode < 200 || response.statusCode >= 300 || response.body === null) {
    return unavailablePolicy(
      true,
      response.statusCode,
      response.body,
      sitemapUrls,
      `robots unavailable: HTTP ${response.statusCode}`
    );
  }

  if (response.body.includes('\u0000')) {
    return unavailablePolicy(
      true,
      response.statusCode,
      response.body,
      sitemapUrls,
      'robots malformed: contains NUL byte'
    );
  }

  try {
    const parser = robotsParser(robotsUrl, response.body);
    return {
      fetched: true,
      statusCode: response.statusCode,
      rawText: response.body,
      sitemapUrls,
      parseError: null,
      isAllowed: (url: string) => {
        try {
          const normalized = normalizeCrawlUrl(url);
          const allowed = parser.isAllowed(normalized, userAgent);
          return allowed ?? true;
        } catch {
          return false;
        }
      }
    };
  } catch (error) {
    return unavailablePolicy(
      true,
      response.statusCode,
      response.body,
      sitemapUrls,
      `robots malformed: ${error instanceof Error ? error.message : 'parse failure'}`
    );
  }
}
