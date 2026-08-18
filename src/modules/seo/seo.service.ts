import { Prisma, type SeoAuditRun } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import type { SeoAuditJobData } from './seo.worker.js';
import {
  createSeoAuditSchema,
  seoCompareQuerySchema,
  seoIssueQuerySchema,
  updateSeoIssueStatusSchema
} from './seo.schema.js';
import { seoApiRepository, type SeoApiRepository } from './seo.api.repository.js';

export interface SeoAuditJobQueue {
  add(
    name: string,
    data: SeoAuditJobData,
    options: { jobId: string }
  ): Promise<unknown>;
}

class LazyBullSeoAuditQueue implements SeoAuditJobQueue {
  private queue: Queue<SeoAuditJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<SeoAuditJobData>('seo-audit', { connection: createRedisConnection() });
    }
    return this.queue;
  }

  add(name: string, data: SeoAuditJobData, options: { jobId: string }) {
    return this.getQueue().add(name, data, options);
  }
}

function safeEnqueueError(): string {
  return 'Failed to enqueue SEO audit job';
}

export class SeoService {
  constructor(
    private readonly repository: SeoApiRepository,
    private readonly queue: SeoAuditJobQueue
  ) {}

  private async enqueue(auditRunId: string) {
    try {
      await this.queue.add(
        'seo-audit',
        { auditRunId },
        { jobId: `seo-audit-${auditRunId}` }
      );
    } catch (error) {
      await this.repository.markAuditFailed(auditRunId, safeEnqueueError());
      throw error;
    }
  }

  private async chooseCrawl(projectId: string, crawlRunId?: string) {
    const crawl = crawlRunId
      ? await this.repository.findCrawl(crawlRunId)
      : await this.repository.findLatestCompletedCrawl(projectId);

    if (!crawl || crawl.projectId !== projectId) {
      if (!crawlRunId) {
        throw new AppError(
          'No completed crawl is available for this project',
          409,
          'SEO_NO_COMPLETED_CRAWL'
        );
      }
      throw new NotFoundError('Crawl not found', 'CRAWL_NOT_FOUND');
    }

    if (crawl.status !== 'COMPLETED') {
      throw new AppError(
        'SEO audit requires a completed crawl run',
        409,
        'SEO_CRAWL_NOT_COMPLETED',
        { crawlRunId: crawl.id }
      );
    }

    return crawl;
  }

  async createProjectAudit(projectId: string, rawInput: unknown) {
    const project = await this.repository.findProject(projectId);
    if (!project) throw new NotFoundError();

    const input = createSeoAuditSchema.parse(rawInput);
    const crawl = await this.chooseCrawl(projectId, input.crawlRunId);

    const existing = await this.repository.findAuditByProjectCrawl(projectId, crawl.id);
    if (existing) return { audit: existing, existing: true };

    let audit: SeoAuditRun;
    try {
      audit = await this.repository.createAudit(projectId, crawl.id) as SeoAuditRun;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.repository.findAuditByProjectCrawl(projectId, crawl.id);
        if (raced) return { audit: raced, existing: true };
      }
      throw error;
    }

    await this.enqueue(audit.id);
    return { audit, existing: false };
  }

  async listProjectAudits(projectId: string) {
    if (!(await this.repository.findProject(projectId))) throw new NotFoundError();
    return this.repository.listAudits(projectId);
  }

  async getProjectSummary(projectId: string) {
    if (!(await this.repository.findProject(projectId))) throw new NotFoundError();
    return this.repository.getSummary(projectId);
  }

  async getAudit(auditRunId: string) {
    const audit = await this.repository.getAuditDetail(auditRunId);
    if (!audit) throw new NotFoundError('SEO audit not found', 'SEO_AUDIT_NOT_FOUND');
    return audit;
  }

  async listProjectIssues(projectId: string, rawQuery: unknown) {
    if (!(await this.repository.findProject(projectId))) throw new NotFoundError();
    const query = seoIssueQuerySchema.parse(rawQuery);
    return { ...(await this.repository.listIssues(projectId, query)), pagination: query };
  }

  async getIssue(issueId: string) {
    const issue = await this.repository.getIssueDetail(issueId);
    if (!issue) throw new NotFoundError('SEO issue not found', 'SEO_ISSUE_NOT_FOUND');
    return issue;
  }

  async updateIssueStatus(issueId: string, rawInput: unknown) {
    const input = updateSeoIssueStatusSchema.parse(rawInput);
    const issue = await this.repository.updateIssueStatus(issueId, input.status);
    if (!issue) throw new NotFoundError('SEO issue not found', 'SEO_ISSUE_NOT_FOUND');
    return issue;
  }

  async compareProjectAudits(projectId: string, rawQuery: unknown) {
    if (!(await this.repository.findProject(projectId))) throw new NotFoundError();
    const query = seoCompareQuerySchema.parse(rawQuery);
    const comparison = await this.repository.compareAudits(projectId, query);
    if (!comparison) {
      throw new NotFoundError('SEO audit comparison not found', 'SEO_COMPARE_NOT_FOUND');
    }
    return comparison;
  }
}

export const seoService = new SeoService(seoApiRepository, new LazyBullSeoAuditQueue());
