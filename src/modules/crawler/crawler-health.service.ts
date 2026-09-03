import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

const CALCULATION_VERSION = 'P9_CRAWLER_HEALTH_V1';

export class CrawlerHealthService {
  async project(crawlRunId: string) {
    const run = await prisma.crawlRun.findUnique({
      where: { id: crawlRunId },
      include: { robotsResults: true, sitemapSources: true },
    });
    if (!run) throw new AppError('Crawl run not found', 404, 'CRAWL_RUN_NOT_FOUND');
    if (run.status !== 'COMPLETED') throw new AppError('Crawl run is not completed', 409, 'CRAWL_RUN_NOT_COMPLETED');

    const usableSitemap = run.sitemapSources.some((source) => source.statusCode !== null && source.statusCode >= 200 && source.statusCode < 300 && source.parseError === null);
    const robotsObserved = run.robotsResults.length > 0;
    const status = run.pagesFailed > 0 || !usableSitemap || !robotsObserved
      ? 'DEGRADED'
      : run.pagesSucceeded > 0 ? 'HEALTHY' : 'UNKNOWN';
    const factsSnapshot = {
      crawlStatus: run.status,
      pagesDiscovered: run.pagesDiscovered,
      pagesCrawled: run.pagesCrawled,
      pagesSucceeded: run.pagesSucceeded,
      pagesFailed: run.pagesFailed,
      robotsObserved,
      usableSitemap,
    };

    return prisma.crawlerHealthSnapshot.upsert({
      where: { crawlRunId_calculationVersion: { crawlRunId: run.id, calculationVersion: CALCULATION_VERSION } },
      create: { projectId: run.projectId, crawlRunId: run.id, status, calculationVersion: CALCULATION_VERSION, factsSnapshot },
      update: { status, factsSnapshot },
    });
  }
}

export const crawlerHealthService = new CrawlerHealthService();
