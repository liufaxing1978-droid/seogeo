import { prisma } from '../../db/prisma.js';

function rowValue(row: { metricStatus: string; numerator: number; denominator: number }) {
  return {
    status: row.metricStatus,
    numerator: row.numerator,
    denominator: row.denominator,
    ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0 ? row.numerator / row.denominator : null
  };
}

export class VisibilityHistoryWebRepository {
  async getHistory(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const snapshots = await prisma.visibilityMetricSnapshot.findMany({
      where: { projectId, status: 'COMPLETED' },
      select: {
        id: true,
        formulaVersion: true,
        extractorVersion: true,
        subjectSetHash: true,
        scopeHash: true,
        windowStart: true,
        windowEnd: true,
        inputCutoffAt: true,
        candidateObservationCount: true,
        completedExtractionCount: true,
        missingExtractionCount: true,
        failedExtractionCount: true,
        completedAt: true
      },
      orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }],
      take: 30
    });
    const snapshotIds = snapshots.map((snapshot) => snapshot.id);
    const rows = snapshotIds.length ? await prisma.visibilityMetricRow.findMany({
      where: {
        projectId,
        visibilityMetricSnapshotId: { in: snapshotIds },
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        OR: [
          { actorKey: 'OWNED_ROLLUP' },
          { actorType: 'COMPETITOR', metricType: 'MENTION_SHARE_OF_VOICE' }
        ]
      },
      select: {
        visibilityMetricSnapshotId: true,
        metricType: true,
        metricStatus: true,
        actorType: true,
        actorSubjectId: true,
        actorKey: true,
        numerator: true,
        denominator: true
      }
    }) : [];
    const comparisons = await prisma.visibilityMetricComparison.findMany({
      where: { projectId },
      select: {
        id: true,
        currentSnapshotId: true,
        previousSnapshotId: true,
        gapDurationMs: true,
        createdAt: true,
        rows: {
          where: { dimensionType: 'OVERALL', dimensionKey: 'OVERALL' },
          select: {
            metricType: true,
            actorType: true,
            actorKey: true,
            previousMetricStatus: true,
            currentMetricStatus: true,
            deltaBasisPoints: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 25
    });

    const rowMap = new Map(rows.map((row) => [
      `${row.visibilityMetricSnapshotId}:${row.metricType}:${row.actorKey}`,
      row
    ]));
    const pointsFor = (metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE', actorKey: string) =>
      [...snapshots].reverse().map((snapshot) => {
        const row = rowMap.get(`${snapshot.id}:${metricType}:${actorKey}`);
        return {
          snapshotId: snapshot.id,
          windowStart: snapshot.windowStart,
          windowEnd: snapshot.windowEnd,
          value: row ? rowValue(row) : null
        };
      });
    const competitorKeys = [...new Set(rows.filter((row) => row.actorType === 'COMPETITOR').map((row) => row.actorKey))].slice(0, 20);

    return {
      project,
      snapshots: snapshots.map((snapshot) => ({
        ...snapshot,
        evidenceCoverageRatio: snapshot.candidateObservationCount > 0
          ? snapshot.completedExtractionCount / snapshot.candidateObservationCount
          : null
      })),
      series: {
        mentionRate: pointsFor('MENTION_RATE', 'OWNED_ROLLUP'),
        citationRate: pointsFor('CITATION_RATE', 'OWNED_ROLLUP'),
        ownedSov: pointsFor('MENTION_SHARE_OF_VOICE', 'OWNED_ROLLUP'),
        competitors: competitorKeys.map((actorKey) => ({ actorKey, points: pointsFor('MENTION_SHARE_OF_VOICE', actorKey) }))
      },
      comparisons: comparisons.map((comparison) => ({
        ...comparison,
        gapDurationMs: comparison.gapDurationMs.toString()
      }))
    };
  }

  async getAlerts(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [alerts, rules] = await Promise.all([
      prisma.visibilityAlertEvent.findMany({
        where: { projectId },
        select: {
          id: true,
          alertRuleId: true,
          comparisonId: true,
          actorKey: true,
          status: true,
          severity: true,
          reasonCode: true,
          deltaBasisPoints: true,
          previousMetricStatus: true,
          currentMetricStatus: true,
          triggeredAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          rule: { select: { name: true, ruleType: true } },
          comparison: {
            select: { currentSnapshotId: true, previousSnapshotId: true, gapDurationMs: true }
          }
        },
        orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }],
        take: 100
      }),
      prisma.visibilityAlertRule.findMany({
        where: { projectId },
        select: {
          id: true,
          ruleType: true,
          name: true,
          enabled: true,
          severity: true,
          thresholdBasisPoints: true,
          actorSubjectId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      })
    ]);

    const snapshotIds = [...new Set(alerts.flatMap((alert) => [alert.comparison.currentSnapshotId, alert.comparison.previousSnapshotId]))];
    const snapshots = snapshotIds.length ? await prisma.visibilityMetricSnapshot.findMany({
      where: { projectId, id: { in: snapshotIds } },
      select: { id: true, windowStart: true, windowEnd: true }
    }) : [];
    const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));

    return {
      project,
      rules,
      alerts: alerts.map((alert) => ({
        ...alert,
        comparison: {
          ...alert.comparison,
          gapDurationMs: alert.comparison.gapDurationMs.toString(),
          currentWindow: byId.get(alert.comparison.currentSnapshotId) ?? null,
          previousWindow: byId.get(alert.comparison.previousSnapshotId) ?? null
        }
      }))
    };
  }
}

export const visibilityHistoryWebRepository = new VisibilityHistoryWebRepository();
