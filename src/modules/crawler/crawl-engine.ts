import { createHash } from 'node:crypto';
import type { FetchOptions, FetchResult } from './crawl.types.js';
import { fetchPage } from './http-fetcher.js';
import { parseHtml, type ParsedPageSignals } from './html-parser.js';
import { loadRobotsPolicy } from './robots.service.js';
import { limitSitemapDocuments, parseSitemap } from './sitemap.service.js';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';
import { assertPublicHttpTarget } from './network-policy.js';
import {
  renderPage,
  shouldRenderFallback,
  type BrowserRenderOptions,
  type RenderedPageResult
} from './browser-renderer.js';
import { crawlRepository, type CrawlRepository, type CrawlRunStats } from './crawl.repository.js';
import { mapSnapshotPersistence } from './crawl.mapper.js';

const CRAWLER_USER_AGENT = 'SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)';
const DEFAULT_CONCURRENCY = 4;
const MAX_SITEMAP_DOCUMENTS = 50;

export interface CrawlEngineDependencies {
  fetcher?: (url: string, options?: FetchOptions) => Promise<FetchResult>;
  publicTargetGuard?: (url: URL) => Promise<void>;
  browserEnabled?: boolean;
  concurrency?: number;
  renderer?: (url: string, options: BrowserRenderOptions) => Promise<RenderedPageResult>;
  repository?: CrawlRepository;
}

function factualStatus(statusCode: number): number | null {
  return statusCode > 0 ? statusCode : null;
}

function hashText(value: string | null): string | null {
  return value === null ? null : createHash('sha256').update(value, 'utf8').digest('hex');
}

function isHtmlContent(fetchResult: FetchResult): boolean {
  return (
    fetchResult.body !== null &&
    (fetchResult.contentType === 'text/html' || fetchResult.contentType === 'application/xhtml+xml')
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown crawl failure';
}

function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

export async function executeCrawlRun(
  crawlRunId: string,
  dependencies: CrawlEngineDependencies = {}
): Promise<void> {
  const repository = dependencies.repository ?? crawlRepository;
  const fetcher = dependencies.fetcher ?? fetchPage;
  const publicTargetGuard = dependencies.publicTargetGuard ?? assertPublicHttpTarget;
  const renderer = dependencies.renderer ?? renderPage;
  const browserEnabled = dependencies.browserEnabled ?? false;
  const concurrency = Math.max(1, Math.min(16, dependencies.concurrency ?? DEFAULT_CONCURRENCY));

  const run = await repository.getRun(crawlRunId);
  if (!run) throw new Error(`CrawlRun not found: ${crawlRunId}`);

  await repository.markRunRunning(crawlRunId);

  const stats: CrawlRunStats = {
    pagesDiscovered: 0,
    pagesCrawled: 0,
    pagesSucceeded: 0,
    pagesFailed: 0
  };

  try {
    const primaryDomain = run.project.primaryDomain;
    const seedUrl = normalizeCrawlUrl(run.seedUrl);
    if (!isInProjectScope(new URL(seedUrl), primaryDomain)) {
      throw new Error('Crawl seed is outside project scope');
    }

    const guardedFetcher = (url: string, options: FetchOptions = {}) =>
      fetcher(url, { ...options, publicTargetGuard });

    const origin = originOf(seedUrl);
    const robotsPolicy = await loadRobotsPolicy(origin, CRAWLER_USER_AGENT, guardedFetcher);
    await repository.saveRobotsResult({
      crawlRunId,
      url: new URL('/robots.txt', origin).toString(),
      statusCode: factualStatus(robotsPolicy.statusCode),
      contentHash: hashText(robotsPolicy.rawText),
      rawText: robotsPolicy.rawText,
      parseError: robotsPolicy.parseError
    });

    const sitemapPageUrls: string[] = [];
    const sitemapQueue = [...robotsPolicy.sitemapUrls];
    const seenSitemaps = new Set<string>();

    while (sitemapQueue.length > 0 && seenSitemaps.size < MAX_SITEMAP_DOCUMENTS) {
      const rawSitemapUrl = sitemapQueue.shift()!;
      let sitemapUrl: string;
      try {
        sitemapUrl = normalizeCrawlUrl(rawSitemapUrl);
      } catch {
        continue;
      }
      if (seenSitemaps.has(sitemapUrl)) continue;
      if (!isInProjectScope(new URL(sitemapUrl), primaryDomain)) continue;
      seenSitemaps.add(sitemapUrl);

      const sitemapFetch = await guardedFetcher(sitemapUrl, { userAgent: CRAWLER_USER_AGENT });
      let parsedType: 'INDEX' | 'URLSET' | null = null;
      let parseError: string | null = null;
      let parsedUrls: ReturnType<typeof parseSitemap>['urls'] = [];
      let childSitemaps: string[] = [];

      if (sitemapFetch.errorCode) {
        parseError = sitemapFetch.errorCode;
      } else if (
        sitemapFetch.statusCode < 200 ||
        sitemapFetch.statusCode > 299 ||
        sitemapFetch.body === null
      ) {
        parseError = `HTTP ${sitemapFetch.statusCode}`;
      } else {
        const parsed = parseSitemap(sitemapFetch.body, sitemapUrl);
        parsedType = parsed.type;
        parseError = parsed.parseError;
        parsedUrls = parsed.urls;
        childSitemaps = parsed.sitemapUrls;
      }

      const source = await repository.saveSitemapSource({
        crawlRunId,
        url: sitemapUrl,
        statusCode: factualStatus(sitemapFetch.statusCode),
        type: parsedType,
        parseError,
        discoveredUrlCount: parsedType === 'URLSET' ? parsedUrls.length : childSitemaps.length
      });

      if (parsedUrls.length > 0) {
        await repository.saveSitemapUrls(
          source.id,
          parsedUrls.map((entry) => ({
            normalizedUrl: entry.url,
            lastmod: entry.lastmod,
            changefreq: entry.changefreq,
            priority: entry.priority
          }))
        );
        sitemapPageUrls.push(...parsedUrls.map((entry) => entry.url));
      }

      for (const child of limitSitemapDocuments(childSitemaps, MAX_SITEMAP_DOCUMENTS)) {
        if (seenSitemaps.size + sitemapQueue.length >= MAX_SITEMAP_DOCUMENTS) break;
        if (!seenSitemaps.has(child)) sitemapQueue.push(child);
      }
    }

    const frontier: string[] = [];
    const queued = new Set<string>();
    const visited = new Set<string>();

    const enqueue = (candidate: string) => {
      if (queued.size >= run.maxPages) return;
      let normalized: string;
      try {
        normalized = normalizeCrawlUrl(candidate);
      } catch {
        return;
      }
      if (!isInProjectScope(new URL(normalized), primaryDomain)) return;
      if (queued.has(normalized)) return;
      queued.add(normalized);
      frontier.push(normalized);
    };

    enqueue(seedUrl);
    for (const sitemapUrl of sitemapPageUrls) enqueue(sitemapUrl);

    const processUrl = async (url: string) => {
      if (visited.has(url)) return;
      visited.add(url);

      const isSeed = url === seedUrl;
      const robotsAllowed = robotsPolicy.isAllowed(url);
      if (!isSeed && robotsAllowed !== true) return;

      const page = await repository.upsertPage(run.projectId, url, url);
      const fetchResult = await guardedFetcher(url, { userAgent: CRAWLER_USER_AGENT });
      stats.pagesCrawled += 1;
      if (fetchResult.errorCode === null) stats.pagesSucceeded += 1;
      else stats.pagesFailed += 1;

      let parsedSignals: ParsedPageSignals | null = null;
      let renderedResult: RenderedPageResult | null = null;
      let renderedSignals: ParsedPageSignals | null = null;

      if (isHtmlContent(fetchResult)) {
        parsedSignals = parseHtml(
          fetchResult.body!,
          fetchResult.finalUrl,
          fetchResult.headers,
          fetchResult.statusCode
        );

        if (
          shouldRenderFallback(fetchResult, parsedSignals, {
            enabled: browserEnabled,
            robotsAllowed: isSeed ? robotsAllowed !== false : robotsAllowed
          })
        ) {
          renderedResult = await renderer(url, {
            enabled: browserEnabled,
            primaryDomain,
            userAgent: CRAWLER_USER_AGENT,
            publicTargetGuard
          });
          if (renderedResult.succeeded && renderedResult.html !== null) {
            renderedSignals = parseHtml(
              renderedResult.html,
              renderedResult.finalUrl,
              fetchResult.headers,
              fetchResult.statusCode
            );
          }
        }
      }

      await repository.createSnapshot(
        mapSnapshotPersistence({
          pageId: page.id,
          crawlRunId,
          fetchResult,
          parsedSignals,
          renderedResult,
          renderedSignals,
          parserVersion: '0.1.0'
        })
      );

      const signals = renderedSignals ?? parsedSignals;
      if (signals) {
        for (const internalLink of signals.internalLinks) enqueue(internalLink);
      }
    };

    let cursor = 0;
    while (cursor < frontier.length) {
      const batch = frontier.slice(cursor, cursor + concurrency);
      cursor += batch.length;
      await Promise.all(batch.map(processUrl));
    }

    stats.pagesDiscovered = queued.size;
    await repository.markRunCompleted(crawlRunId, stats);
  } catch (error) {
    await repository.markRunFailed(crawlRunId, safeError(error));
    throw error;
  }
}
