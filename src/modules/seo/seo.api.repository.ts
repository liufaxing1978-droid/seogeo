import { prisma } from '../../db/prisma.js';
import type { SeoCompareQuery, SeoIssueManualStatus, SeoIssueQuery } from './seo.schema.js';

export interface SeoApiRepository {
  findProject(projectId: string): Promise<{ id: string } | null>;
  findCrawl(crawlRunId: string): Promise<{ id: string; projectId: string; status: string } | null>;
  findLatestCompletedCrawl(projectId: string): Promise<{ id: string; projectId: string; status: string } | null>;
  findAuditByProjectCrawl(projectId: string, crawlRunId: string): Promise<any | null>;
  createAudit(projectId: string, crawlRunId: string): Promise<any>;
  markAuditFailed(auditRunId: string, message: string): Promise<void>;
  listAudits(projectId: string): Promise<any[]>;
  getSummary(projectId: string): Promise<any | null>;
  getAuditDetail(auditRunId: string): Promise<any | null>;
  listIssues(projectId: string, query: SeoIssueQuery): Promise<{ data: any[]; total: number }>;
  getIssueDetail(issueId: string): Promise<any | null>;
  updateIssueStatus(issueId: string, status: SeoIssueManualStatus): Promise<any | null>;
  compareAudits(projectId: string, query: SeoCompareQuery): Promise<any>;
}

export const seoApiRepository: SeoApiRepository = {
  findProject(projectId) {
    return prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
  },

  findCrawl(crawlRunId) {
    return prisma.crawlRun.findUnique({
      where: { id: crawlRunId },
      select: { id: true, projectId: true, status: true }
    });
  },

  findLatestCompletedCrawl(projectId) {
    return prisma.crawlRun.findFirst({
      where: { projectId, status: 'COMPLETED' },
      orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, projectId: true, status: true }
    });
  },

  findAuditByProjectCrawl(projectId, crawlRunId) {
    return prisma.seoAuditRun.findUnique({
      where: { projectId_crawlRunId: { projectId, crawlRunId } }
    });
  },

  createAudit(projectId, crawlRunId) {
    return prisma.seoAuditRun.create({
      data: {
        projectId,
        crawlRunId,
        status: 'QUEUED',
        engineVersion: '0.1.0'
      }
    });
  },

  async markAuditFailed(auditRunId, message) {
    await prisma.seoAuditRun.update({
      where: { id: auditRunId },
      data: {
        status: 'FAILED',
        errorMessage: message.slice(0, 1000),
        finishedAt: new Date()
      }
    });
  },

  listAudits(projectId) {
    return prisma.seoAuditRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        seoScore: { select: { score: true, previousScore: true, change: true } },
        crawlRun: { select: { id: true, runType: true, finishedAt: true } }
      }
    });
  },

  async getSummary(projectId) {
    const audit = await prisma.seoAuditRun.findFirst({
      where: { projectId, status: 'COMPLETED' },
      orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        seoScore: { select: { score: true, previousScore: true, change: true } },
        issueOccurrences: {
          select: { severity: true }
        }
      }
    });
    if (!audit) return null;

    const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const occurrence of audit.issueOccurrences) severityCounts[occurrence.severity] += 1;

    return {
      auditId: audit.id,
      status: audit.status,
      crawlRunId: audit.crawlRunId,
      score: audit.seoScore?.score ?? null,
      previousScore: audit.seoScore?.previousScore ?? null,
      change: audit.seoScore?.change ?? null,
      eligiblePages: audit.eligiblePages,
      rulesEvaluated: audit.rulesEvaluated,
      finishedAt: audit.finishedAt,
      severityCounts
    };
  },

  async getAuditDetail(auditRunId) {
    const audit = await prisma.seoAuditRun.findUnique({
      where: { id: auditRunId },
      include: {
        crawlRun: { select: { id: true, runType: true, seedUrl: true, finishedAt: true } },
        seoScore: {
          include: {
            components: {
              orderBy: { penalty: 'desc' },
              include: {
                ruleVersion: {
                  select: {
                    version: true,
                    severity: true,
                    detectionType: true,
                    seoRule: { select: { ruleCode: true, name: true, category: true } }
                  }
                }
              }
            }
          }
        },
        issueOccurrences: {
          include: {
            seoIssue: { select: { id: true, issueKey: true, title: true, status: true } }
          },
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    if (!audit) return null;

    return {
      id: audit.id,
      projectId: audit.projectId,
      crawlRunId: audit.crawlRunId,
      status: audit.status,
      startedAt: audit.startedAt,
      finishedAt: audit.finishedAt,
      eligiblePages: audit.eligiblePages,
      rulesEvaluated: audit.rulesEvaluated,
      engineVersion: audit.engineVersion,
      errorMessage: audit.errorMessage,
      score: audit.seoScore?.score ?? null,
      previousScore: audit.seoScore?.previousScore ?? null,
      change: audit.seoScore?.change ?? null,
      components: audit.seoScore?.components ?? [],
      issues: audit.issueOccurrences,
      crawl: audit.crawlRun
    };
  },

  async listIssues(projectId, query) {
    const where = {
      projectId,
      ...(query.severity ? { currentSeverity: query.severity } : {}),
      ...(query.status ? { status: query.status } : {})
    } as const;

    const [data, total] = await Promise.all([
      prisma.seoIssue.findMany({
        where,
        orderBy: [{ currentSeverity: 'asc' }, { lastSeenAt: 'desc' }],
        take: query.limit,
        skip: query.offset,
        include: {
          rule: { select: { ruleCode: true, name: true, category: true } },
          occurrences: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { affectedPagesCount: true, comparison: true, auditRunId: true }
          }
        }
      }),
      prisma.seoIssue.count({ where })
    ]);

    return { data, total };
  },

  getIssueDetail(issueId) {
    return prisma.seoIssue.findUnique({
      where: { id: issueId },
      include: {
        rule: {
          include: {
            versions: { orderBy: { version: 'desc' } }
          }
        },
        occurrences: {
          orderBy: { createdAt: 'desc' },
          include: {
            ruleVersion: true,
            pages: {
              include: {
                page: { select: { id: true, normalizedUrl: true } },
                ruleResult: { select: { evidence: true, outcome: true } }
              }
            }
          }
        }
      }
    });
  },

  async updateIssueStatus(issueId, status) {
    const existing = await prisma.seoIssue.findUnique({ where: { id: issueId } });
    if (!existing) return null;
    return prisma.seoIssue.update({
      where: { id: issueId },
      data: {
        status,
        ignoredAt: status === 'IGNORED' ? new Date() : status === 'OPEN' ? null : existing.ignoredAt
      }
    });
  },

  async compareAudits(projectId, query) {
    const [current, previous] = await Promise.all([
      prisma.seoAuditRun.findFirst({
        where: { id: query.currentAuditId, projectId },
        include: {
          issueOccurrences: {
            include: { seoIssue: true }
          }
        }
      }),
      prisma.seoAuditRun.findFirst({
        where: { id: query.previousAuditId, projectId },
        include: {
          issueOccurrences: {
            include: { seoIssue: true }
          }
        }
      })
    ]);

    if (!current || !previous) return null;

    const currentByIssue = new Map(current.issueOccurrences.map((item) => [item.seoIssueId, item]));
    const previousByIssue = new Map(previous.issueOccurrences.map((item) => [item.seoIssueId, item]));

    return {
      currentAuditId: current.id,
      previousAuditId: previous.id,
      new: current.issueOccurrences.filter((item) => item.comparison === 'NEW').map((item) => item.seoIssue),
      persistent: current.issueOccurrences.filter((item) => item.comparison === 'PERSISTENT').map((item) => item.seoIssue),
      regressed: current.issueOccurrences.filter((item) => item.comparison === 'REGRESSED').map((item) => item.seoIssue),
      fixed: [...previousByIssue.entries()]
        .filter(([issueId]) => !currentByIssue.has(issueId))
        .map(([, item]) => item.seoIssue)
    };
  }
};
