import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export const VISIBILITY_TREND_PROMPT_ID = 'visibility-trend-analysis-v1';

const VisibilityTrendAnalysisSchema = z.object({
  summary: z.string().min(1),
  trends: z.array(z.object({
    metricType: z.enum(['MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE']),
    direction: z.enum(['IMPROVED', 'DECLINED', 'UNCHANGED', 'STATE_CHANGE', 'NO_NUMERIC_TREND']),
    explanation: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  priorities: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    action: z.string().min(1),
    rationale: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  caveats: z.array(z.string().min(1)).max(12),
  sourceReferences: z.array(z.string().min(1)).min(1).max(80)
});

export type VisibilityTrendAnalysisOutput = z.infer<typeof VisibilityTrendAnalysisSchema>;

type Ref = { type: string; id: string };
function ref(type: string, id: string) { return `${type}:${id}`; }

function refsFromJson(value: unknown): Ref[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    return typeof type === 'string' && typeof id === 'string' ? [{ type, id }] : [];
  });
}

function allowedSet(sourceReferences: unknown): Set<string> {
  return new Set(refsFromJson(sourceReferences).map((item) => ref(item.type, item.id)));
}

export function parseVisibilityTrendAnalysisOutput(content: string, sourceReferences: unknown): VisibilityTrendAnalysisOutput {
  const output = parseStructuredOutput(content, VisibilityTrendAnalysisSchema);
  const allowed = allowedSet(sourceReferences);
  const returned = [
    ...output.sourceReferences,
    ...output.trends.flatMap((item) => item.sourceRefs),
    ...output.priorities.flatMap((item) => item.sourceRefs)
  ];
  if (returned.some((item) => !allowed.has(item))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }
  return output;
}

function coverage(snapshot: { candidateObservationCount: number; completedExtractionCount: number }) {
  return {
    candidateObservationCount: snapshot.candidateObservationCount,
    completedExtractionCount: snapshot.completedExtractionCount,
    ratio: snapshot.candidateObservationCount > 0
      ? snapshot.completedExtractionCount / snapshot.candidateObservationCount
      : null
  };
}

export async function buildVisibilityTrendAnalysisTaskInput(projectId: string, comparisonId: string): Promise<CreateAiTaskInput> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      primaryDomain: true,
      industry: true,
      defaultLanguage: true,
      targetCountry: true,
      planLevel: true
    }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'COMPETITOR_SOV')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }

  const comparison = await prisma.visibilityMetricComparison.findFirst({
    where: { id: comparisonId, projectId },
    select: {
      id: true,
      comparisonVersion: true,
      currentSnapshotId: true,
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
  });
  if (!comparison) throw new NotFoundError('Visibility comparison not found', 'VISIBILITY_HISTORY_COMPARISON_NOT_FOUND');

  const [snapshots, metricRows, alerts] = await Promise.all([
    prisma.visibilityMetricSnapshot.findMany({
      where: {
        projectId,
        id: { in: [comparison.currentSnapshotId, comparison.previousSnapshotId] },
        status: 'COMPLETED'
      },
      select: {
        id: true,
        windowStart: true,
        windowEnd: true,
        candidateObservationCount: true,
        completedExtractionCount: true
      }
    }),
    prisma.visibilityMetricRow.findMany({
      where: {
        projectId,
        visibilityMetricSnapshotId: { in: [comparison.currentSnapshotId, comparison.previousSnapshotId] },
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorKey: 'OWNED_ROLLUP',
        metricType: { in: ['MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE'] }
      },
      orderBy: [{ visibilityMetricSnapshotId: 'asc' }, { metricType: 'asc' }],
      select: {
        visibilityMetricSnapshotId: true,
        metricType: true,
        metricStatus: true,
        numerator: true,
        denominator: true
      }
    }),
    prisma.visibilityAlertEvent.findMany({
      where: { projectId, comparisonId: comparison.id },
      orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }],
      take: 20,
      select: {
        id: true,
        severity: true,
        reasonCode: true,
        deltaBasisPoints: true,
        previousMetricStatus: true,
        currentMetricStatus: true,
        rule: { select: { ruleType: true } }
      }
    })
  ]);

  const bySnapshotId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const currentSnapshot = bySnapshotId.get(comparison.currentSnapshotId);
  const previousSnapshot = bySnapshotId.get(comparison.previousSnapshotId);
  if (!currentSnapshot || !previousSnapshot) {
    throw new NotFoundError('Visibility trend source snapshot not found', 'VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND');
  }

  const metricsFor = (snapshotId: string) => metricRows
    .filter((row) => row.visibilityMetricSnapshotId === snapshotId)
    .map((row) => ({
      metricType: row.metricType,
      status: row.metricStatus,
      numerator: row.numerator,
      denominator: row.denominator
    }));

  const refs: Ref[] = [
    { type: 'PROJECT', id: project.id },
    { type: 'VISIBILITY_METRIC_SNAPSHOT', id: currentSnapshot.id },
    { type: 'VISIBILITY_METRIC_SNAPSHOT', id: previousSnapshot.id },
    { type: 'VISIBILITY_METRIC_COMPARISON', id: comparison.id },
    ...alerts.map((alert) => ({ type: 'VISIBILITY_ALERT_EVENT', id: alert.id }))
  ];

  const factSnapshot = {
    project: {
      id: project.id,
      name: project.name,
      primaryDomain: project.primaryDomain,
      industry: project.industry,
      defaultLanguage: project.defaultLanguage,
      targetCountry: project.targetCountry
    },
    current: {
      snapshotId: currentSnapshot.id,
      windowStart: currentSnapshot.windowStart.toISOString(),
      windowEnd: currentSnapshot.windowEnd.toISOString(),
      metrics: metricsFor(currentSnapshot.id)
    },
    previous: {
      snapshotId: previousSnapshot.id,
      windowStart: previousSnapshot.windowStart.toISOString(),
      windowEnd: previousSnapshot.windowEnd.toISOString(),
      metrics: metricsFor(previousSnapshot.id)
    },
    comparison: {
      comparisonId: comparison.id,
      comparisonVersion: comparison.comparisonVersion,
      gapDurationMs: comparison.gapDurationMs.toString(),
      deltas: comparison.rows
    },
    evidenceCoverage: {
      current: coverage(currentSnapshot),
      previous: coverage(previousSnapshot)
    },
    alerts: alerts.map((alert) => ({
      alertId: alert.id,
      ruleType: alert.rule.ruleType,
      severity: alert.severity,
      reasonCode: alert.reasonCode,
      deltaBasisPoints: alert.deltaBasisPoints,
      currentMetricStatus: alert.currentMetricStatus,
      previousMetricStatus: alert.previousMetricStatus
    })),
    sourceReferences: refs
  };

  return {
    projectId,
    taskType: 'VISIBILITY_TREND_ANALYSIS',
    requestKey: `visibility-trend:${comparison.id}:${VISIBILITY_TREND_PROMPT_ID}`,
    promptVersion: VISIBILITY_TREND_PROMPT_ID,
    factSnapshot: factSnapshot as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createVisibilityTrendAnalysisTask(
  projectId: string,
  comparisonId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildVisibilityTrendAnalysisTaskInput(projectId, comparisonId));
}
