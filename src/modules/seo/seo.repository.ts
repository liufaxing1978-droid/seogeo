import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { SeoPageFact, SeoRuleOutcome } from './seo.types.js';

export interface SeoRobotsFact {
  statusCode: number | null;
  parseError: string | null;
}

export interface SeoSitemapFact {
  statusCode: number | null;
  type: string | null;
  parseError: string | null;
  discoveredUrlCount: number;
}

export interface AuditInput {
  auditRunId: string;
  projectId: string;
  crawlRunId: string;
  pages: SeoPageFact[];
  robots: SeoRobotsFact[];
  sitemaps: SeoSitemapFact[];
}

export interface SeoAuditContext {
  id: string;
  projectId: string;
  crawlRunId: string;
  status: string;
  crawlStatus: string;
}

export interface PersistedRuleResult {
  pageId: string | null;
  ruleVersionId: string;
  resultKey: string;
  outcome: SeoRuleOutcome;
  evidence: Record<string, unknown>;
}

function redirectCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export interface SeoRepository {
  getAuditContext(auditRunId: string): Promise<SeoAuditContext>;
  getAuditInput(auditRunId: string): Promise<AuditInput>;
  markAuditRunning(auditRunId: string, engineVersion: string): Promise<void>;
  replaceRuleResults(auditRunId: string, rows: PersistedRuleResult[]): Promise<void>;
  markAuditCompleted(
    auditRunId: string,
    input: { eligiblePages: number; rulesEvaluated: number; engineVersion: string }
  ): Promise<void>;
  markAuditFailed(auditRunId: string, errorMessage: string): Promise<void>;
}

export const seoRepository: SeoRepository = {
  async getAuditContext(auditRunId) {
    const audit = await prisma.seoAuditRun.findUniqueOrThrow({
      where: { id: auditRunId },
      select: {
        id: true,
        projectId: true,
        crawlRunId: true,
        status: true,
        crawlRun: { select: { status: true } }
      }
    });

    return {
      id: audit.id,
      projectId: audit.projectId,
      crawlRunId: audit.crawlRunId,
      status: audit.status,
      crawlStatus: audit.crawlRun.status
    };
  },

  async getAuditInput(auditRunId) {
    const audit = await prisma.seoAuditRun.findUniqueOrThrow({
      where: { id: auditRunId },
      select: {
        id: true,
        projectId: true,
        crawlRunId: true
      }
    });

    const [snapshots, robots, sitemaps] = await Promise.all([
      prisma.pageSnapshot.findMany({
        where: { crawlRunId: audit.crawlRunId },
        include: {
          page: { select: { id: true, normalizedUrl: true } },
          httpResult: { select: { redirectChain: true } }
        },
        orderBy: [{ pageId: 'asc' }, { capturedAt: 'asc' }]
      }),
      prisma.robotsResult.findMany({
        where: { crawlRunId: audit.crawlRunId },
        select: { statusCode: true, parseError: true },
        orderBy: { fetchedAt: 'asc' }
      }),
      prisma.sitemapSource.findMany({
        where: { crawlRunId: audit.crawlRunId },
        select: {
          statusCode: true,
          type: true,
          parseError: true,
          discoveredUrlCount: true
        },
        orderBy: { fetchedAt: 'asc' }
      })
    ]);

    const latestSnapshotByPage = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) latestSnapshotByPage.set(snapshot.pageId, snapshot);

    const pages: SeoPageFact[] = [...latestSnapshotByPage.values()].map((snapshot) => ({
      pageId: snapshot.page.id,
      normalizedUrl: snapshot.page.normalizedUrl,
      statusCode: snapshot.statusCode,
      contentType: snapshot.contentType,
      title: snapshot.title,
      metaDescription: snapshot.metaDescription,
      canonicalUrl: snapshot.canonicalUrl,
      metaRobots: snapshot.metaRobots,
      h1: snapshot.h1,
      h1Count: snapshot.h1Count,
      wordCount: snapshot.wordCount,
      imagesCount: snapshot.imagesCount,
      imagesWithoutAlt: snapshot.imagesWithoutAlt,
      responseTimeMs: snapshot.responseTimeMs,
      htmlSizeBytes: snapshot.htmlSizeBytes,
      indexable: snapshot.indexable,
      redirectCount: redirectCount(snapshot.httpResult?.redirectChain)
    }));

    return {
      auditRunId: audit.id,
      projectId: audit.projectId,
      crawlRunId: audit.crawlRunId,
      pages,
      robots: robots.map((item) => ({
        statusCode: item.statusCode,
        parseError: item.parseError
      })),
      sitemaps: sitemaps.map((item) => ({
        statusCode: item.statusCode,
        type: item.type,
        parseError: item.parseError,
        discoveredUrlCount: item.discoveredUrlCount
      }))
    };
  },

  async markAuditRunning(auditRunId, engineVersion) {
    await prisma.seoAuditRun.update({
      where: { id: auditRunId },
      data: {
        status: 'RUNNING',
        engineVersion,
        startedAt: new Date(),
        finishedAt: null,
        errorMessage: null
      }
    });
  },

  async replaceRuleResults(auditRunId, rows) {
    await prisma.$transaction(async (tx) => {
      await tx.seoRuleResult.deleteMany({ where: { auditRunId } });
      if (rows.length === 0) return;
      await tx.seoRuleResult.createMany({
        data: rows.map((row) => ({
          auditRunId,
          pageId: row.pageId,
          ruleVersionId: row.ruleVersionId,
          resultKey: row.resultKey,
          outcome: row.outcome,
          evidence: row.evidence as Prisma.InputJsonValue
        }))
      });
    });
  },

  async markAuditCompleted(auditRunId, input) {
    await prisma.seoAuditRun.update({
      where: { id: auditRunId },
      data: {
        status: 'COMPLETED',
        eligiblePages: input.eligiblePages,
        rulesEvaluated: input.rulesEvaluated,
        engineVersion: input.engineVersion,
        finishedAt: new Date(),
        errorMessage: null
      }
    });
  },

  async markAuditFailed(auditRunId, errorMessage) {
    await prisma.seoAuditRun.update({
      where: { id: auditRunId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        errorMessage
      }
    });
  }
};
