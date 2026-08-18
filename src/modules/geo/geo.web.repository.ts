import { prisma } from '../../db/prisma.js';

const PRIORITY_ORDER = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
} as const;

async function latestCompletedAudit(projectId: string) {
  return prisma.geoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }]
  });
}

export const geoWebRepository = {
  async getOverview(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const [audit, latestCompletedCrawl] = await Promise.all([
      prisma.geoAuditRun.findFirst({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          crawlRun: {
            select: { id: true, runType: true, seedUrl: true, finishedAt: true }
          },
          geoScore: {
            include: { components: { orderBy: { componentCode: 'asc' } } }
          },
          brandAuthorityResult: true,
          aiCrawlerResults: { orderBy: { crawlerCode: 'asc' } }
        }
      }),
      prisma.crawlRun.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, runType: true, finishedAt: true }
      })
    ]);

    if (!audit) {
      return {
        project,
        audit: null,
        score: null,
        components: [],
        componentByCode: new Map<string, never>(),
        brand: null,
        aiCrawlers: [],
        crawlerCounts: { PASS: 0, FAIL: 0, UNKNOWN: 0 },
        opportunities: [],
        latestCompletedCrawl,
        aiVisibility: { value: null, status: 'UNAVAILABLE', label: '尚未采样' } as const
      };
    }

    const opportunityRows = await prisma.geoRuleResult.findMany({
      where: { geoAuditRunId: audit.id, outcome: 'FAIL' },
      include: {
        page: { select: { id: true, normalizedUrl: true } },
        entity: { select: { id: true, canonicalName: true } },
        ruleVersion: {
          include: {
            geoRule: { select: { ruleCode: true, name: true, category: true } }
          }
        }
      }
    });

    const opportunities = opportunityRows
      .map((row) => ({
        id: row.id,
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
        entityName: row.entity?.canonicalName ?? null
      }))
      .sort((a, b) => {
        const priority = PRIORITY_ORDER[a.severity] - PRIORITY_ORDER[b.severity];
        if (priority !== 0) return priority;
        return b.weight - a.weight;
      })
      .slice(0, 10);

    const components = audit.geoScore?.components ?? [];
    const componentByCode = new Map(components.map((component) => [component.componentCode, component]));
    const crawlerCounts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
    for (const crawler of audit.aiCrawlerResults) crawlerCounts[crawler.status] += 1;

    return {
      project,
      audit,
      score: audit.geoScore,
      components,
      componentByCode,
      brand: audit.brandAuthorityResult,
      aiCrawlers: audit.aiCrawlerResults,
      crawlerCounts,
      opportunities,
      latestCompletedCrawl,
      aiVisibility: { value: null, status: 'UNAVAILABLE', label: '尚未采样' } as const
    };
  },

  async getCitabilityPage(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return { project, audit: null, rows: [] };

    const rows = await prisma.citabilityResult.findMany({
      where: { geoAuditRunId: audit.id },
      orderBy: [{ overallScore: 'asc' }, { createdAt: 'asc' }],
      include: { page: { select: { id: true, normalizedUrl: true } } }
    });
    return { project, audit, rows };
  },

  async getEntitiesPage(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const audit = await latestCompletedAudit(projectId);
    if (!audit) return { project, audit: null, entities: [], relations: [] };

    const observed = await prisma.entityObservation.findMany({
      where: { geoAuditRunId: audit.id },
      select: { entityId: true }
    });
    const entityIds = [...new Set(observed.map((row) => row.entityId))];
    if (entityIds.length === 0) return { project, audit, entities: [], relations: [] };

    const [entities, relations] = await Promise.all([
      prisma.entity.findMany({
        where: { projectId, id: { in: entityIds } },
        orderBy: [{ entityType: 'asc' }, { canonicalName: 'asc' }],
        include: {
          aliases: { orderBy: { alias: 'asc' } },
          observations: {
            where: { geoAuditRunId: audit.id },
            orderBy: [{ createdAt: 'asc' }, { property: 'asc' }],
            include: { page: { select: { id: true, normalizedUrl: true } } }
          },
          pageEntities: {
            include: { page: { select: { id: true, normalizedUrl: true } } }
          }
        }
      }),
      prisma.entityRelation.findMany({
        where: {
          projectId,
          sourceEntityId: { in: entityIds },
          targetEntityId: { in: entityIds }
        },
        orderBy: { createdAt: 'asc' },
        include: {
          sourceEntity: { select: { id: true, canonicalName: true } },
          targetEntity: { select: { id: true, canonicalName: true } },
          sourcePage: { select: { id: true, normalizedUrl: true } }
        }
      })
    ]);

    return { project, audit, entities, relations };
  },

  async getAiCrawlerPage(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const audit = await latestCompletedAudit(projectId);
    if (!audit) {
      return {
        project,
        audit: null,
        rows: [],
        counts: { PASS: 0, FAIL: 0, UNKNOWN: 0 }
      };
    }

    const rows = await prisma.aiCrawlerResult.findMany({
      where: { geoAuditRunId: audit.id },
      orderBy: { crawlerCode: 'asc' }
    });
    const counts = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
    for (const row of rows) counts[row.status] += 1;

    return { project, audit, rows, counts };
  }
};
