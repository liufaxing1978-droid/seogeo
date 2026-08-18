import type { RenderedPageResult } from './browser-renderer.js';
import type { FetchResult } from './crawl.types.js';
import type { ParsedPageSignals } from './html-parser.js';
import type { SnapshotPersistenceInput } from './crawl.repository.js';

export interface SnapshotMapInput {
  pageId: string;
  crawlRunId: string;
  fetchResult: FetchResult;
  parsedSignals: ParsedPageSignals | null;
  renderedResult?: RenderedPageResult | null;
  renderedSignals?: ParsedPageSignals | null;
  parserVersion?: string;
}

export function mapSnapshotPersistence(input: SnapshotMapInput): SnapshotPersistenceInput {
  const signals = input.renderedSignals ?? input.parsedSignals;
  const renderedSucceeded = input.renderedResult?.succeeded === true && input.renderedSignals !== null;
  const finalUrl = renderedSucceeded ? input.renderedResult!.finalUrl : input.fetchResult.finalUrl;
  const factualStatus = input.fetchResult.statusCode > 0 ? input.fetchResult.statusCode : null;
  const html = renderedSucceeded ? input.renderedResult!.html : input.fetchResult.body;

  return {
    pageId: input.pageId,
    crawlRunId: input.crawlRunId,
    finalUrl,
    statusCode: factualStatus,
    contentType: input.fetchResult.contentType,
    title: signals?.title ?? null,
    metaDescription: signals?.metaDescription ?? null,
    canonicalUrl: signals?.canonicalUrl ?? null,
    metaRobots: signals?.metaRobots ?? null,
    h1: signals?.h1 ?? null,
    h1Count: signals?.h1Count ?? 0,
    h2Count: signals?.h2Count ?? 0,
    h3Count: signals?.h3Count ?? 0,
    wordCount: signals?.wordCount ?? 0,
    language: signals?.language ?? null,
    internalLinksCount: signals?.internalLinksCount ?? 0,
    externalLinksCount: signals?.externalLinksCount ?? 0,
    imagesCount: signals?.imagesCount ?? 0,
    imagesWithoutAlt: signals?.imagesWithoutAlt ?? 0,
    schemaCount: signals?.schemaCount ?? 0,
    structuredSignals: signals
      ? {
          openGraphSiteName: signals.openGraphSiteName ?? null,
          entitySignals: signals.entitySignals ?? []
        }
      : null,
    htmlHash: signals?.htmlHash ?? null,
    contentHash: signals?.contentHash ?? null,
    responseTimeMs: input.fetchResult.responseTimeMs,
    htmlSizeBytes: html === null ? null : Buffer.byteLength(html),
    rendered: renderedSucceeded,
    indexable: signals?.indexable ?? null,
    parserVersion: input.parserVersion ?? '0.1.0',
    http: {
      requestUrl: input.fetchResult.requestUrl,
      finalUrl: input.fetchResult.finalUrl,
      statusCode: factualStatus,
      redirectChain: input.fetchResult.redirectChain,
      headers: input.fetchResult.headers,
      responseBytes: input.fetchResult.bytes,
      latencyMs: input.fetchResult.responseTimeMs,
      fetchError: input.fetchResult.errorCode
    },
    render: input.renderedResult
      ? {
          attempted: true,
          succeeded: input.renderedResult.succeeded,
          reason: input.renderedResult.succeeded
            ? 'HTTP_FALLBACK'
            : input.renderedResult.errorCode ?? input.renderedResult.errorMessage,
          renderTimeMs: input.renderedResult.renderTimeMs,
          browserVersion: input.renderedResult.browserVersion
        }
      : null
  };
}
