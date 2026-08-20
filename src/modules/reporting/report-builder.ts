import { Prisma } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { reportObservability, type ReportObservability } from './report-observability.js';

export const PROJECT_REPORT_VERSION = 'PROJECT_REPORT_V1';
export const PROJECT_REPORT_V2_VERSION = 'PROJECT_REPORT_V2';

const ADVISORY_TASK_TYPES = [
  'SEO_AUDIT_ANALYSIS',
  'GEO_READINESS_ANALYSIS',
  'ENTITY_ENRICHMENT',
  'CONTENT_BRIEF',
  'CONTENT_OPTIMIZATION_ANALYSIS',
  'COMPETITOR_GAP_ANALYSIS'
] as const;

export interface ReportSafeMetricValue {
  status: string;
  numerator: number | null;
  denominator: number | null;
  ratio: number | null;
}

export interface ReportVisibilityFacts {
  snapshot: {
    id: string;
    formulaVersion: string;
    extractorVersion: string;
    windowStart: Date;
    windowEnd: Date;
    inputCutoffAt: Date;
    completedAt: Date | null;
  };
  metrics: {
    mentionRate: ReportSafeMetricValue;
    citationRate: ReportSafeMetricValue;
    ownedSov: ReportSafeMetricValue;
  };
  competitorSov: Array<{
    actorKey: string;
    status: string;
    numerator: number;
    denominator: number;
    ratio: number | null;
  }>;
  evidenceCoverage: {
    completedExtractionCount: number;
    candidateObservationCount: number;
    ratio: number | null;
  };
  comparison: null | {
    id: string;
    previousSnapshotId: string;
    gapDurationMs: string;
    deltas: Array<{
      metricType: string;
      actorKey: string;
      previousMetricStatus: string;
      currentMetricStatus: string;
      deltaBasisPoints: number | null;
    }>;
  };
  alerts: {
    openTotal: number;
    bySeverity: { INFO: number; WARNING: number; CRITICAL: number };
  };
}

export interface ReportVisibilityBundle {
  facts: ReportVisibilityFacts;
  sourceReferences: Array<{ type: string; id: string }>;
}

export interface ReportVisibilityReader {
  load(projectId: string): Promise<ReportVisibilityBundle | null>;
}

function safeMetric(row: { metricStatus: string; numerator: number; denominator: number } | undefined): ReportSafeMetricValue {
  if (!row) return { status: 'NO_DATA', numerator: null, denominator: null, ratio: null };
  return {
    status: row.metricStatus,
    numerator: row.numerator,
    denominator: row.denominator,
    ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0 ? row.numerator / row.denominator : null
  };
}

class PrismaReportVisibilityReader implements ReportVisibilityReader {
  async load(projectId: string): Promise<ReportVisibilityBundle | null> {
    const snapshot = await prisma.visibilityMetricSnapshot.findFirst({
      where: { projectId, status: 'COMPLETED' },
      orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        formulaVersion: true,
        extractorVersion: true,
        windowStart: true,
        windowEnd: true,
        inputCutoffAt: true,
        completedAt: true,
        completedExtractionCount: true,
        candidateObservationCount: true
      }
    });
    if (!snapshot) return null;

    const [ownedRows, competitorRows, comparison, infoAlerts, warningAlerts, criticalAlerts] = await Promise.all([
      prisma.visibilityMetricRow.findMany({
        where: {
          projectId,
          visibilityMetricSnapshotId: snapshot.id,
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorKey: 'OWNED_ROLLUP',
          metricType: { in: ['MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE'] }
        },
        select: { metricType: true, metricStatus: true, numerator: true, denominator: true }
      }),
      prisma.visibilityMetricRow.findMany({
        where: {
          projectId,
          visibilityMetricSnapshotId: snapshot.id,
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'COMPETITOR',
          metricType: 'MENTION_SHARE_OF_VOICE'
        },
        orderBy: [{ actorKey: 'asc' }, { id: 'asc' }],
        take: 20,
        select: { actorKey: true, metricStatus: true, numerator: true, denominator: true }
      }),
      prisma.visibilityMetricComparison.findFirst({
        where: { projectId, currentSnapshotId: snapshot.id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          previousSnapshotId: true,
          gapDurationMs: true,
          rows: {
            where: { dimensionType: 'OVERALL', dimensionKey: 'OVERALL' },
            orderBy: [{ metricType: 'asc' }, { actorKey: 'asc' }, { id: 'asc' }],
            take: 100,
            select: {
              metricType: true,
              actorKey: true,
              previousMetricStatus: true,
              currentMetricStatus: true,
              deltaBasisPoints: true
            }
          }
        }
      }),
      prisma.visibilityAlertEvent.count({ where: { projectId, status: 'OPEN', severity: 'INFO' } }),
      prisma.visibilityAlertEvent.count({ where: { projectId, status: 'OPEN', severity: 'WARNING' } }),
      prisma.visibilityAlertEvent.count({ where: { projectId, status: 'OPEN', severity: 'CRITICAL' } })
    ]);

    const owned = (metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE') =>
      ownedRows.find((row) => row.metricType === metricType);

    const competitorSov = competitorRows.map((row) => ({
      actorKey: row.actorKey,
      status: row.metricStatus,
      numerator: row.numerator,
      denominator: row.denominator,
      ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0 ? row.numerator / row.denominator : null
    }));

    const facts: ReportVisibilityFacts = {
      snapshot: {
        id: snapshot.id,
        formulaVersion: snapshot.formulaVersion,
        extractorVersion: snapshot.extractorVersion,
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        inputCutoffAt: snapshot.inputCutoffAt,
        completedAt: snapshot.completedAt
      },
      metrics: {
        mentionRate: safeMetric(owned('MENTION_RATE')),
        citationRate: safeMetric(owned('CITATION_RATE')),
        ownedSov: safeMetric(owned('MENTION_SHARE_OF_VOICE'))
      },
      competitorSov,
      evidenceCoverage: {
        completedExtractionCount: snapshot.completedExtractionCount,
        candidateObservationCount: snapshot.candidateObservationCount,
        ratio: snapshot.candidateObservationCount > 0
          ? snapshot.completedExtractionCount / snapshot.candidateObservationCount
          : null
      },
      comparison: comparison ? {
        id: comparison.id,
        previousSnapshotId: comparison.previousSnapshotId,
        gapDurationMs: comparison.gapDurationMs.toString(),
        deltas: comparison.rows
      } : null,
      alerts: {
        openTotal: infoAlerts + warningAlerts + criticalAlerts,
        bySeverity: { INFO: infoAlerts, WARNING: warningAlerts, CRITICAL: criticalAlerts }
      }
    };

    return {
      facts,
      sourceReferences: [
        { type: 'VISIBILITY_METRIC_SNAPSHOT', id: snapshot.id },
        ...(comparison ? [{ type: 'VISIBILITY_METRIC_COMPARISON', id: comparison.id }] : [])
      ]
    };
  }
}

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

async function collectProjectReportBase(projectId: string) {
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

  return { project, factSnapshot, advisoryAi, sourceReferences };
}

async function persistProjectReport(input: {
  projectId: string;
  reportVersion: string;
  factSnapshot: unknown;
  advisoryAi: unknown[];
  sourceReferences: Array<{ type: string; id: string }>;
  observability: ReportObservability;
}) {
  const report = await prisma.reportSnapshot.create({
    data: {
      projectId: input.projectId,
      reportType: 'PROJECT_SUMMARY',
      reportVersion: input.reportVersion,
      factSnapshot: input.factSnapshot as Prisma.InputJsonValue,
      advisorySnapshot: { ai: input.advisoryAi } as unknown as Prisma.InputJsonValue,
      sourceReferences: input.sourceReferences as unknown as Prisma.InputJsonValue
    }
  });
  input.observability.emit({
    event: 'report.generated',
    projectId: input.projectId,
    reportId: report.id,
    reportVersion: report.reportVersion,
    sourceCount: input.sourceReferences.length
  });
  return report;
}

export async function generateProjectReport(projectId: string, observability: ReportObservability = reportObservability) {
  const base = await collectProjectReportBase(projectId);
  return persistProjectReport({
    projectId,
    reportVersion: PROJECT_REPORT_VERSION,
    factSnapshot: base.factSnapshot,
    advisoryAi: base.advisoryAi,
    sourceReferences: base.sourceReferences,
    observability
  });
}

export async function generateProjectReportV2(
  projectId: string,
  options: { visibilityReader?: ReportVisibilityReader; observability?: ReportObservability } = {}
) {
  const base = await collectProjectReportBase(projectId);
  const observability = options.observability ?? reportObservability;
  let visibility: ReportVisibilityBundle | null = null;

  if (hasFeature(base.project.planLevel, 'AI_VISIBILITY')) {
    visibility = await (options.visibilityReader ?? new PrismaReportVisibilityReader()).load(projectId);
  }

  const factSnapshot = visibility
    ? { ...base.factSnapshot, visibility: visibility.facts }
    : base.factSnapshot;
  const sourceReferences = visibility
    ? [...base.sourceReferences, ...visibility.sourceReferences]
    : base.sourceReferences;

  return persistProjectReport({
    projectId,
    reportVersion: PROJECT_REPORT_V2_VERSION,
    factSnapshot,
    advisoryAi: base.advisoryAi,
    sourceReferences,
    observability
  });
}
