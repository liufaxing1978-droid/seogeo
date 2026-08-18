import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export interface CrawlRunStats {
  pagesDiscovered: number;
  pagesCrawled: number;
  pagesSucceeded: number;
  pagesFailed: number;
}

export interface SnapshotPersistenceInput {
  pageId: string;
  crawlRunId: string;
  finalUrl: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  metaRobots: string | null;
  h1: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  wordCount: number;
  language: string | null;
  internalLinksCount: number;
  externalLinksCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  schemaCount: number;
  htmlHash: string | null;
  contentHash: string | null;
  responseTimeMs: number | null;
  htmlSizeBytes: number | null;
  rendered: boolean;
  indexable: boolean | null;
  parserVersion: string;
  http: {
    requestUrl: string;
    finalUrl: string;
    statusCode: number | null;
    redirectChain: unknown[];
    headers: Record<string, string>;
    responseBytes: number | null;
    latencyMs: number | null;
    fetchError: string | null;
  };
  render?: {
    attempted: boolean;
    succeeded: boolean;
    reason: string | null;
    renderTimeMs: number | null;
    browserVersion: string | null;
  } | null;
}

export interface RobotsPersistenceInput {
  crawlRunId: string;
  url: string;
  statusCode: number | null;
  contentHash: string | null;
  rawText: string | null;
  parseError: string | null;
}

export interface SitemapSourcePersistenceInput {
  crawlRunId: string;
  url: string;
  statusCode: number | null;
  type: 'INDEX' | 'URLSET' | null;
  parseError: string | null;
  discoveredUrlCount: number;
}

export interface SitemapUrlPersistenceInput {
  normalizedUrl: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
}

function safeErrorMessage(message: string): string {
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
}

export class CrawlRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async getRun(id: string) {
    return this.client.crawlRun.findUnique({ where: { id }, include: { project: true } });
  }

  async markRunRunning(id: string) {
    return this.client.crawlRun.update({
      where: { id },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null
      }
    });
  }

  async markRunCompleted(id: string, stats: CrawlRunStats) {
    return this.client.crawlRun.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        ...stats,
        finishedAt: new Date(),
        errorMessage: null
      }
    });
  }

  async markRunFailed(id: string, message: string) {
    return this.client.crawlRun.update({
      where: { id },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage: safeErrorMessage(message)
      }
    });
  }

  async upsertPage(projectId: string, normalizedUrl: string, observedUrl: string) {
    const url = new URL(normalizedUrl);
    return this.client.page.upsert({
      where: { projectId_normalizedUrl: { projectId, normalizedUrl } },
      create: {
        projectId,
        url: observedUrl,
        normalizedUrl,
        host: url.hostname,
        path: `${url.pathname}${url.search}`,
        isActive: true
      },
      update: {
        url: observedUrl,
        host: url.hostname,
        path: `${url.pathname}${url.search}`,
        lastSeenAt: new Date(),
        isActive: true
      }
    });
  }

  async createSnapshot(input: SnapshotPersistenceInput) {
    const httpCreate: Prisma.HttpResultUncheckedCreateWithoutPageSnapshotInput = {
      requestUrl: input.http.requestUrl,
      finalUrl: input.http.finalUrl,
      statusCode: input.http.statusCode,
      redirectChain: input.http.redirectChain as Prisma.InputJsonValue,
      headers: input.http.headers as Prisma.InputJsonValue,
      responseBytes: input.http.responseBytes,
      latencyMs: input.http.latencyMs,
      fetchError: input.http.fetchError
    };

    const renderCreate: Prisma.RenderResultUncheckedCreateWithoutPageSnapshotInput | undefined = input.render
      ? {
          attempted: input.render.attempted,
          succeeded: input.render.succeeded,
          reason: input.render.reason,
          renderTimeMs: input.render.renderTimeMs,
          browserVersion: input.render.browserVersion
        }
      : undefined;

    return this.client.pageSnapshot.create({
      data: {
        pageId: input.pageId,
        crawlRunId: input.crawlRunId,
        finalUrl: input.finalUrl,
        statusCode: input.statusCode,
        contentType: input.contentType,
        title: input.title,
        metaDescription: input.metaDescription,
        canonicalUrl: input.canonicalUrl,
        metaRobots: input.metaRobots,
        h1: input.h1,
        h1Count: input.h1Count,
        h2Count: input.h2Count,
        h3Count: input.h3Count,
        wordCount: input.wordCount,
        language: input.language,
        internalLinksCount: input.internalLinksCount,
        externalLinksCount: input.externalLinksCount,
        imagesCount: input.imagesCount,
        imagesWithoutAlt: input.imagesWithoutAlt,
        schemaCount: input.schemaCount,
        htmlHash: input.htmlHash,
        contentHash: input.contentHash,
        responseTimeMs: input.responseTimeMs,
        htmlSizeBytes: input.htmlSizeBytes,
        rendered: input.rendered,
        indexable: input.indexable,
        parserVersion: input.parserVersion,
        httpResult: { create: httpCreate },
        ...(renderCreate ? { renderResult: { create: renderCreate } } : {})
      }
    });
  }

  async saveRobotsResult(input: RobotsPersistenceInput) {
    return this.client.robotsResult.create({ data: input });
  }

  async saveSitemapSource(input: SitemapSourcePersistenceInput) {
    return this.client.sitemapSource.create({ data: input });
  }

  async saveSitemapUrls(sourceId: string, urls: SitemapUrlPersistenceInput[]) {
    if (urls.length === 0) return { count: 0 };
    return this.client.sitemapUrl.createMany({
      data: urls.map((url) => ({
        sitemapSourceId: sourceId,
        normalizedUrl: url.normalizedUrl,
        lastmod: url.lastmod ? new Date(url.lastmod) : null,
        changefreq: url.changefreq,
        priority: url.priority
      })),
      skipDuplicates: true
    });
  }
}

export const crawlRepository = new CrawlRepository();
