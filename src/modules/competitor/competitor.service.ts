import { Queue } from 'bullmq';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import { competitorObservability, type CompetitorObservability } from './competitor-observability.js';

export const COMPETITOR_CRAWLER_VERSION = 'COMPETITOR_CRAWLER_V1';
export const DEFAULT_COMPETITOR_MAX_PAGES = 25;
export const HARD_MAX_COMPETITOR_PAGES = 100;

export interface CompetitorCrawlJobData { competitorCrawlId: string; }

export interface CompetitorQueue {
  add(name: string, data: CompetitorCrawlJobData, options: { jobId: string; attempts: number }): Promise<unknown>;
}

class LazyCompetitorQueue implements CompetitorQueue {
  private queue: Queue<CompetitorCrawlJobData> | null = null;
  private getQueue() {
    if (!this.queue) this.queue = new Queue<CompetitorCrawlJobData>('competitor', { connection: createRedisConnection() });
    return this.queue;
  }
  add(name: string, data: CompetitorCrawlJobData, options: { jobId: string; attempts: number }) {
    return this.getQueue().add(name, data, options);
  }
}

function normalizeDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const host = trimmed.includes('://') ? new URL(trimmed).hostname : new URL(`https://${trimmed}`).hostname;
  return host.replace(/\.$/, '');
}

export class CompetitorService {
  constructor(
    private readonly queue: CompetitorQueue = new LazyCompetitorQueue(),
    private readonly observability: CompetitorObservability = competitorObservability
  ) {}

  async createCompetitor(projectId: string, input: { name: string; domain: string }) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, primaryDomain: true } });
    if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    const domain = normalizeDomain(input.domain);
    if (!input.name.trim() || !domain) throw new AppError('name and domain are required', 400, 'INVALID_COMPETITOR');
    if (normalizeDomain(project.primaryDomain) === domain) throw new AppError('Competitor domain must differ from project domain', 400, 'COMPETITOR_MATCHES_PROJECT');
    return prisma.competitor.create({ data: { projectId, name: input.name.trim(), domain } });
  }

  async createCrawl(projectId: string, competitorId: string, input: { maxPages?: number } = {}) {
    const competitor = await prisma.competitor.findFirst({ where: { id: competitorId, projectId, status: 'ACTIVE' } });
    if (!competitor) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
    const maxPages = input.maxPages ?? DEFAULT_COMPETITOR_MAX_PAGES;
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > HARD_MAX_COMPETITOR_PAGES) throw new AppError('maxPages must be between 1 and 100', 400, 'INVALID_COMPETITOR_MAX_PAGES');
    const crawl = await prisma.competitorCrawl.create({
      data: { competitorId, seedUrl: `https://${competitor.domain}/`, maxPages, crawlerVersion: COMPETITOR_CRAWLER_VERSION }
    });
    try {
      await this.queue.add('competitor-crawl', { competitorCrawlId: crawl.id }, { jobId: `competitor-crawl-${crawl.id}`, attempts: 1 });
      this.observability.emit({ event: 'competitor.crawl.queued', projectId, competitorId, crawlId: crawl.id });
    } catch (error) {
      await prisma.competitorCrawl.update({ where: { id: crawl.id }, data: { status: 'FAILED', finishedAt: new Date(), errorMessage: 'Failed to enqueue competitor crawl' } });
      this.observability.emit({ event: 'competitor.crawl.failed', projectId, competitorId, crawlId: crawl.id, errorCode: 'COMPETITOR_QUEUE_ENQUEUE_FAILED' });
      throw error;
    }
    return crawl;
  }
}

export const competitorService = new CompetitorService();
