import { Prisma, PrismaClient, type CrawlRunType } from '@prisma/client';
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

export interface CrawlRunCreateInput {
  projectId: string;
  runType: CrawlRunType;
  seedUrl: string;
  maxPages: number;
  crawlerVersion?: string;
}

export interface PaginationInput {
  limit: number;
  offset: number;
}

function safeErrorMessage(message: string): string {
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 2000);
}

function safeDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class CrawlRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async findProject(id: string) {
    return this.client.project.findUnique({ where: { id } });
  }

  async findPage(id: string) {
    return this.client.page.findUnique({ where: { id }, include: { project: true } });
  }

  async getRun(id: string) {
    return this.client.crawlRun.findUnique({ where: { id }, include: { project: true } });
  }

  async createRun(input: CrawlRunCreateInput) {
    return this.client.crawlRun.create({
      data: {
        projectId: input.projectId,
        runType: input.runType,
        status: 'QUEUED',
        seedUrl: input.seedUrl,
        maxPages: input.maxPages,
        crawlerVersion: input.crawlerVersion ?? '0.1.0'
      }
    });
  }

  async findActiveProjectRun(projectId: string) {
    return this.client.crawlRun.findFirst({
      where: {
        projectId,
        status: { in: ['QUEUED', 'RUNNING'] },
        runType: { in: ['FULL', 'MANUAL'] }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async listRuns(projectId: string, pagination: PaginationInput) {
    const [data, total] = await Promise.all([
      this.client.crawlRun.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        skip: pagination.offset,
        take: pagination.limit
      }),
      this.client.crawlRun.count({ where: { projectId } })
    ]);
    return { data, total };
  }

  async getRunDetail(id: string) {
    return this.client.crawlRun.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, primaryDomain: true } },
        robotsResults: { orderBy: { fetchedAt: 'desc' }, take: 1 },
        sitemapSources: {
          orderBy: { fetchedAt: 'asc' },
          include: { _count: { select: { urls: true } } }
        }
      }
    });
  }

  async listRunPages(crawlRunId: string, pagination: PaginationInput) {
    const where = { crawlRunId };
    const [snapshots, total] = await Promise.all([
      this.client.pageSnapshot.findMany({
        where,
        orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
        skip: pagination.offset,
        take: pagination.limit,
        select: {
          id: true,
          pageId: true,
          finalUrl: true,
          statusCode: true,
          contentType: true,
          title: true,
          canonicalUrl: true,
          h1: true,
          indexable: true,
          rendered: true,
          responseTimeMs: true,
          capturedAt: true,
          page: { select: { url: true, normalizedUrl: true, path: true } },
          httpResult: { select: { fetchError: true } }
        }
      }),
      this.client.pageSnapshot.count({ where })
    ]);

    return {
      data: snapshots.map((snapshot) => ({
        snapshotId: snapshot.id,
        pageId: snapshot.pageId,
        url: snapshot.page.normalizedUrl,
        observedUrl: snapshot.page.url,
        path: snapshot.page.path,
        finalUrl: snapshot.finalUrl,
        statusCode: snapshot.statusCode,
        contentType: snapshot.contentType,
        title: snapshot.title,
        canonicalUrl: snapshot.canonicalUrl,
        h1: snapshot.h1,
        indexable: snapshot.indexable,
        rendered: snapshot.rendered,
        responseTimeMs: snapshot.responseTimeMs,
        fetchError: snapshot.httpResult?.fetchError ?? null,
        capturedAt: snapshot.capturedAt
      })),
      total
    };
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
        lastmod: safeDate(url.lastmod),
        changefreq: url.changefreq,
        priority: url.priority
      })),
      skipDuplicates: true
    });
  }
}

export const crawlRepository = new CrawlRepository();
