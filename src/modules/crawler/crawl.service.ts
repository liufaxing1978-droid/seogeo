import { Queue } from 'bullmq';
import { AppError, NotFoundError, ValidationError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import type { CrawlJobData } from './crawl.worker.js';
import { createCrawlSchema, paginationSchema } from './crawl.schema.js';
import { CrawlRepository, crawlRepository } from './crawl.repository.js';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';

export interface CrawlJobQueue {
  add(
    name: string,
    data: CrawlJobData,
    options: { jobId: string }
  ): Promise<unknown>;
}

class LazyBullCrawlQueue implements CrawlJobQueue {
  private queue: Queue<CrawlJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<CrawlJobData>('crawl', { connection: createRedisConnection() });
    }
    return this.queue;
  }

  add(name: string, data: CrawlJobData, options: { jobId: string }) {
    return this.getQueue().add(name, data, options);
  }
}

export class CrawlService {
  constructor(
    private readonly repository: CrawlRepository,
    private readonly queue: CrawlJobQueue
  ) {}

  private async enqueue(crawlRunId: string) {
    try {
      await this.queue.add('crawl', { crawlRunId }, { jobId: `crawl-${crawlRunId}` });
    } catch (error) {
      await this.repository.markRunFailed(crawlRunId, 'Failed to enqueue crawl job');
      throw error;
    }
  }

  async createProjectCrawl(projectId: string, rawInput: unknown) {
    const project = await this.repository.findProject(projectId);
    if (!project) throw new NotFoundError();

    const input = createCrawlSchema.parse(rawInput);
    const seedUrl = normalizeCrawlUrl(input.seedUrl ?? `https://${project.primaryDomain}/`);
    if (!isInProjectScope(new URL(seedUrl), project.primaryDomain)) {
      throw new ValidationError('Crawl seed URL is outside project scope');
    }

    if (input.runType === 'FULL' || input.runType === 'MANUAL') {
      const active = await this.repository.findActiveProjectRun(projectId);
      if (active) {
        throw new AppError(
          'A full or manual crawl is already queued or running for this project',
          409,
          'CRAWL_ALREADY_ACTIVE',
          { crawlRunId: active.id }
        );
      }
    }

    const run = await this.repository.createRun({
      projectId,
      runType: input.runType,
      seedUrl,
      maxPages: input.maxPages
    });
    await this.enqueue(run.id);
    return run;
  }

  async createSinglePageCrawl(pageId: string) {
    const page = await this.repository.findPage(pageId);
    if (!page) throw new NotFoundError('Page not found', 'PAGE_NOT_FOUND');

    const run = await this.repository.createRun({
      projectId: page.projectId,
      runType: 'SINGLE_PAGE',
      seedUrl: page.normalizedUrl,
      maxPages: 1
    });
    await this.enqueue(run.id);
    return run;
  }

  async listProjectCrawls(projectId: string, rawQuery: unknown) {
    const project = await this.repository.findProject(projectId);
    if (!project) throw new NotFoundError();
    const pagination = paginationSchema.parse(rawQuery);
    const result = await this.repository.listRuns(projectId, pagination);
    return { ...result, pagination };
  }

  async getCrawl(crawlRunId: string) {
    const crawl = await this.repository.getRunDetail(crawlRunId);
    if (!crawl) throw new NotFoundError('Crawl not found', 'CRAWL_NOT_FOUND');
    return crawl;
  }

  async listCrawlPages(crawlRunId: string, rawQuery: unknown) {
    const crawl = await this.repository.getRun(crawlRunId);
    if (!crawl) throw new NotFoundError('Crawl not found', 'CRAWL_NOT_FOUND');
    const pagination = paginationSchema.parse(rawQuery);
    const result = await this.repository.listRunPages(crawlRunId, pagination);
    return { ...result, pagination };
  }
}

export const crawlService = new CrawlService(crawlRepository, new LazyBullCrawlQueue());
