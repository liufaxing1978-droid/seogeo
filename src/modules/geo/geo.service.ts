import { Prisma, type GeoAuditRun } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import type { GeoAuditJobData } from './geo.worker.js';
import { createGeoAuditSchema } from './geo.schema.js';
import { geoApiRepository, type GeoApiRepository } from './geo.api.repository.js';

export interface GeoAuditJobQueue {
  add(
    name: string,
    data: GeoAuditJobData,
    options: { jobId: string }
  ): Promise<unknown>;
}

class LazyBullGeoAuditQueue implements GeoAuditJobQueue {
  private queue: Queue<GeoAuditJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<GeoAuditJobData>('geo-audit', { connection: createRedisConnection() });
    }
    return this.queue;
  }

  add(name: string, data: GeoAuditJobData, options: { jobId: string }) {
    return this.getQueue().add(name, data, options);
  }
}

function safeEnqueueError(): string {
  return 'Failed to enqueue GEO audit job';
}

export class GeoService {
  constructor(
    private readonly repository: GeoApiRepository,
    private readonly queue: GeoAuditJobQueue
  ) {}

  private async enqueue(auditRunId: string) {
    try {
      await this.queue.add(
        'geo-audit',
        { auditRunId },
        { jobId: `geo-audit-${auditRunId}` }
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
          'GEO_NO_COMPLETED_CRAWL'
        );
      }
      throw new NotFoundError('Crawl not found', 'CRAWL_NOT_FOUND');
    }

    if (crawl.status !== 'COMPLETED') {
      throw new AppError(
        'GEO audit requires a completed crawl run',
        409,
        'GEO_CRAWL_NOT_COMPLETED',
        { crawlRunId: crawl.id }
      );
    }

    return crawl;
  }

  async createProjectAudit(projectId: string, rawInput: unknown) {
    const project = await this.repository.findProject(projectId);
    if (!project) throw new NotFoundError();

    const input = createGeoAuditSchema.parse(rawInput);
    const crawl = await this.chooseCrawl(projectId, input.crawlRunId);
    const existing = await this.repository.findAuditByProjectCrawl(projectId, crawl.id);
    if (existing) return { audit: existing, existing: true };

    let audit: GeoAuditRun;
    try {
      audit = await this.repository.createAudit(projectId, crawl.id) as GeoAuditRun;
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

  private async requireProject(projectId: string) {
    if (!(await this.repository.findProject(projectId))) throw new NotFoundError();
  }

  async listProjectAudits(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.listAudits(projectId);
  }

  async getProjectSummary(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.getSummary(projectId);
  }

  async getAudit(auditRunId: string) {
    const audit = await this.repository.getAuditDetail(auditRunId);
    if (!audit) throw new NotFoundError('GEO audit not found', 'GEO_AUDIT_NOT_FOUND');
    return audit;
  }

  async listCitability(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.listCitability(projectId);
  }

  async listEntities(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.listEntities(projectId);
  }

  async listAiCrawlers(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.listAiCrawlers(projectId);
  }

  async listOpportunities(projectId: string) {
    await this.requireProject(projectId);
    return this.repository.listOpportunities(projectId);
  }
}

export const geoService = new GeoService(geoApiRepository, new LazyBullGeoAuditQueue());
