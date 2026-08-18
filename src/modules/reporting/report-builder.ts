import { Prisma } from '@prisma/client';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { reportObservability, type ReportObservability } from './report-observability.js';

export const PROJECT_REPORT_VERSION = 'PROJECT_REPORT_V1';

const ADVISORY_TASK_TYPES = [
  'SEO_AUDIT_ANALYSIS',
  'GEO_READINESS_ANALYSIS',
  'ENTITY_ENRICHMENT',
  'CONTENT_BRIEF',
  'CONTENT_OPTIMIZATION_ANALYSIS',
  'COMPETITOR_GAP_ANALYSIS'
] as const;

function stateCounts(comparisons: Array<{ gaps: Prisma.JsonValue }>) {
  const counts = { AHEAD: 0, BEHIND: 0, EVEN: 0, UNKNOWN: 0 };
  for (const comparison of comparisons) {
    if (!Array.isArray(comparison.gaps)) continue;
    for (const value of comparison.gaps) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const state = (value as Record<string, unknown>).state;
      if (state === 'AHEAD' || state === 'BEHIND' || state === 'EVEN' || state === 'UNKNOWN') counts[state] += 1;
    }
  }
  return counts;
}

export async function generateProjectReport(projectId: string, observability: ReportObservability = reportObservability) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, primaryDomain: true, industry: true, defaultLanguage: true, targetCountry: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

  const [
    seoScore,
    seoOpenTotal,
    seoCritical,
    seoHigh,
    seoMedium,
    seoLow,
    recentSeoIssues,
    geoAudit,
    documentCount,
    openOpportunityCount,
    highOpportunityCount,
    mediumOpportunityCount,
    lowOpportunityCount,
    recentOpportunities,
    competitorCount,
    competitors,
    aiTasks
  ] = await Promise.all([
    prisma.seoScore.findFirst({ where: { projectId }, orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }] }),
    prisma.seoIssue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] } } }),
    prisma.seoIssue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] }, currentSeverity: 'CRITICAL' } }),
    prisma.seoIssue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] }, currentSeverity: 'HIGH' } }),
    prisma.seoIssue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] }, currentSeverity: 'MEDIUM' } }),
    prisma.seoIssue.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] }, currentSeverity: 'LOW' } }),
    prisma.seoIssue.findMany({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'REGRESSED'] } }, orderBy: [{ currentSeverity: 'asc' }, { lastSeenAt: 'desc' }], select: { id: true }, take: 50 }),
    prisma.geoAuditRun.findFirst({ where: { projectId, status: 'COMPLETED' }, orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], include: { geoScore: true } }),
    prisma.contentDocument.count({ where: { projectId } }),
    prisma.contentOpportunity.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.contentOpportunity.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'HIGH' } }),
    prisma.contentOpportunity.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'MEDIUM' } }),
    prisma.contentOpportunity.count({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'LOW' } }),
    prisma.contentOpportunity.findMany({ where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: [{ lastDetectedAt: 'desc' }, { id: 'desc' }], select: { id: true }, take: 50 }),
    prisma.competitor.count({ where: { projectId, status: 'ACTIVE' } }),
    prisma.competitor.findMany({ where: { projectId, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, take: 20, include: { comparisons: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
    prisma.aiTask.findMany({
      where: { projectId, status: 'COMPLETED', taskType: { in: [...ADVISORY_TASK_TYPES] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      include: { runs: { where: { status: 'COMPLETED' }, orderBy: { attemptNo: 'desc' }, take: 1, include: { result: true } } }
    })
  ]);

  const latestComparisons = competitors.flatMap((competitor) => competitor.comparisons);
  const advisoryAi = aiTasks.flatMap((task) => {
    const result = task.runs[0]?.result;
    if (!result) return [];
    return [{ taskId: task.id, taskType: task.taskType, resultId: result.id, summary: result.summary, sourceReferences: result.sourceReferences }];
  });

  const factSnapshot = {
    project,
    seo: {
      score: seoScore ? { id: seoScore.id, value: seoScore.score, previous: seoScore.previousScore, change: seoScore.change, engineVersion: seoScore.engineVersion, calculatedAt: seoScore.calculatedAt } : null,
      openIssues: { total: seoOpenTotal, bySeverity: { CRITICAL: seoCritical, HIGH: seoHigh, MEDIUM: seoMedium, LOW: seoLow } }
    },
    geo: {
      auditId: geoAudit?.id ?? null,
      score: geoAudit?.geoScore ? { id: geoAudit.geoScore.id, value: geoAudit.geoScore.score, previous: geoAudit.geoScore.previousScore, change: geoAudit.geoScore.change, scoreType: geoAudit.geoScore.scoreType, formulaVersion: geoAudit.geoScore.formulaVersion, calculatedAt: geoAudit.geoScore.calculatedAt } : null
    },
    content: {
      documentCount,
      openOpportunityCount,
      byPriority: { HIGH: highOpportunityCount, MEDIUM: mediumOpportunityCount, LOW: lowOpportunityCount }
    },
    competitors: {
      count: competitorCount,
      comparedCount: latestComparisons.length,
      gapStates: stateCounts(latestComparisons)
    }
  };

  const sourceReferences = [
    { type: 'PROJECT', id: project.id },
    ...(seoScore ? [{ type: 'SEO_SCORE', id: seoScore.id }] : []),
    ...recentSeoIssues.map((row) => ({ type: 'SEO_ISSUE', id: row.id })),
    ...(geoAudit?.geoScore ? [{ type: 'GEO_SCORE', id: geoAudit.geoScore.id }] : []),
    ...recentOpportunities.map((row) => ({ type: 'CONTENT_OPPORTUNITY', id: row.id })),
    ...latestComparisons.map((row) => ({ type: 'COMPETITOR_COMPARISON', id: row.id })),
    ...advisoryAi.map((row) => ({ type: 'AI_TASK', id: row.taskId }))
  ];

  const report = await prisma.reportSnapshot.create({
    data: {
      projectId,
      reportType: 'PROJECT_SUMMARY',
      reportVersion: PROJECT_REPORT_VERSION,
      factSnapshot: factSnapshot as unknown as Prisma.InputJsonValue,
      advisorySnapshot: { ai: advisoryAi } as unknown as Prisma.InputJsonValue,
      sourceReferences: sourceReferences as unknown as Prisma.InputJsonValue
    }
  });
  observability.emit({ event: 'report.generated', projectId, reportId: report.id, reportVersion: report.reportVersion, sourceCount: sourceReferences.length });
  return report;
}
