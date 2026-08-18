import { prisma } from '../../db/prisma.js';

export interface GeoApiRepository {
  findProject(projectId: string): Promise<{ id: string } | null>;
  findCrawl(crawlRunId: string): Promise<{ id: string; projectId: string; status: string } | null>;
  findLatestCompletedCrawl(projectId: string): Promise<{ id: string; projectId: string; status: string } | null>;
  findAuditByProjectCrawl(projectId: string, crawlRunId: string): Promise<any | null>;
  createAudit(projectId: string, crawlRunId: string): Promise<any>;
  markAuditFailed(auditRunId: string, message: string): Promise<void>;
  listAudits(projectId: string): Promise<any[]>;
  getSummary(projectId: string): Promise<any | null>;
  getAuditDetail(auditRunId: string): Promise<any | null>;
  listCitability(projectId: string): Promise<any[]>;
  listEntities(projectId: string): Promise<any[]>;
  listAiCrawlers(projectId: string): Promise<any[]>;
  listOpportunities(projectId: string): Promise<any[]>;
}

async function latestCompletedAudit(projectId: string) {
  return prisma.geoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }]
  });
}

export const geoApiRepository: GeoApiRepository = {
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
    return prisma.geoAuditRun.findUnique({
      where: { projectId_crawlRunId: { projectId, crawlRunId } }
    });
  },

  createAudit(projectId, crawlRunId) {
    return prisma.geoAuditRun.create({
      data: {
        projectId,
        crawlRunId,
        status: 'QUEUED',
        engineVersion: 'geo-readiness-1'
      }
    });
  },

  async markAuditFailed(auditRunId, message) {
    await prisma.geoAuditRun.update({
      where: { id: auditRunId },
      data: {
        status: 'FAILED',
        errorMessage: message.slice(0, 1000),
        finishedAt: new Date()
      }
    });
  },

  listAudits(projectId) {
    return prisma.geoAuditRun.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        geoScore: { select: { scoreType: true, score: true, previousScore: true, change: true } },
        crawlRun: { select: { id: true, runType: true, finishedAt: true } }
      }
    });
  },

  async getSummary(projectId) {
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return null;
    const score = await prisma.geoScore.findUnique({
      where: { geoAuditRunId: audit.id },
      include: { components: { orderBy: { componentCode: 'asc' } } }
    });
    const failedRules = await prisma.geoRuleResult.count({
      where: { geoAuditRunId: audit.id, outcome: 'FAIL' }
    });

    return {
      auditId: audit.id,
      status: audit.status,
      crawlRunId: audit.crawlRunId,
      scoreType: score?.scoreType ?? null,
      score: score?.score ?? null,
      previousScore: score?.previousScore ?? null,
      change: score?.change ?? null,
      components: score?.components ?? [],
      eligiblePages: audit.eligiblePages,
      rulesEvaluated: audit.rulesEvaluated,
      failedRules,
      aiVisibility: null,
      finishedAt: audit.finishedAt
    };
  },

  async getAuditDetail(auditRunId) {
    const audit = await prisma.geoAuditRun.findUnique({
      where: { id: auditRunId },
      include: {
        crawlRun: { select: { id: true, runType: true, seedUrl: true, finishedAt: true } },
        geoScore: { include: { components: { orderBy: { componentCode: 'asc' } } } },
        brandAuthorityResult: true,
        aiCrawlerResults: { orderBy: { crawlerCode: 'asc' } }
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
      scoreType: audit.geoScore?.scoreType ?? null,
      score: audit.geoScore?.score ?? null,
      previousScore: audit.geoScore?.previousScore ?? null,
      change: audit.geoScore?.change ?? null,
      components: audit.geoScore?.components ?? [],
      brandReadiness: audit.brandAuthorityResult,
      aiCrawlers: audit.aiCrawlerResults,
      aiVisibility: null,
      crawl: audit.crawlRun
    };
  },

  async listCitability(projectId) {
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return [];
    return prisma.citabilityResult.findMany({
      where: { geoAuditRunId: audit.id },
      orderBy: { overallScore: 'asc' },
      include: { page: { select: { id: true, normalizedUrl: true } } }
    });
  },

  async listEntities(projectId) {
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return [];
    const observed = await prisma.entityObservation.findMany({
      where: { geoAuditRunId: audit.id },
      select: { entityId: true }
    });
    const ids = [...new Set(observed.map((row) => row.entityId))];
    if (ids.length === 0) return [];
    return prisma.entity.findMany({
      where: { id: { in: ids }, projectId },
      orderBy: [{ entityType: 'asc' }, { canonicalName: 'asc' }],
      include: {
        aliases: { orderBy: { alias: 'asc' } },
        observations: { where: { geoAuditRunId: audit.id }, orderBy: { createdAt: 'asc' } }
      }
    });
  },

  async listAiCrawlers(projectId) {
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return [];
    return prisma.aiCrawlerResult.findMany({
      where: { geoAuditRunId: audit.id },
      orderBy: { crawlerCode: 'asc' }
    });
  },

  async listOpportunities(projectId) {
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return [];
    const rows = await prisma.geoRuleResult.findMany({
      where: { geoAuditRunId: audit.id, outcome: 'FAIL' },
      orderBy: { createdAt: 'asc' },
      include: {
        page: { select: { id: true, normalizedUrl: true } },
        entity: { select: { id: true, canonicalName: true, entityType: true } },
        ruleVersion: {
          include: {
            geoRule: { select: { ruleCode: true, name: true, category: true } }
          }
        }
      }
    });

    return rows.map((row) => ({
      id: row.id,
      resultKey: row.resultKey,
      outcome: row.outcome,
      ruleCode: row.ruleVersion.geoRule.ruleCode,
      ruleName: row.ruleVersion.geoRule.name,
      category: row.ruleVersion.geoRule.category,
      dimension: row.ruleVersion.dimension,
      severity: row.ruleVersion.severity,
      weight: row.ruleVersion.weight,
      geoImpact: row.ruleVersion.geoImpact,
      fixGuide: row.ruleVersion.fixGuide,
      pageId: row.pageId,
      pageUrl: row.page?.normalizedUrl ?? null,
      entityId: row.entityId,
      entityName: row.entity?.canonicalName ?? null,
      evidence: row.evidence
    }));
  }
};
