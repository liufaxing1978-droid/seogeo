import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityAlertsService } from '../../src/modules/visibility/visibility-alerts.service.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p6d-alerts-${suffix}`,
      primaryDomain: `p6d-alerts-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createSnapshot(projectId: string, start: string, end: string) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: 'alerts-subject-set',
      subjectSnapshotJson: { subjects: [] },
      windowStart: new Date(start),
      windowEnd: new Date(end),
      inputCutoffAt: new Date(end),
      scopeJson: { providers: [], promptSetIds: [] },
      scopeHash: 'alerts-scope',
      inputFingerprint: `alerts-${start}`,
      candidateObservationCount: 10,
      completedExtractionCount: 10,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      startedAt: new Date(end),
      completedAt: new Date(end)
    }
  });
}

async function createComparison(projectId: string, previousId: string, currentId: string, deltaBasisPoints: number) {
  const comparison = await prisma.visibilityMetricComparison.create({
    data: {
      projectId,
      comparisonVersion: 'VISIBILITY_COMPARISON_V1',
      currentSnapshotId: currentId,
      previousSnapshotId: previousId,
      windowDurationMs: 604_800_000n,
      gapDurationMs: 0n
    }
  });
  await prisma.visibilityMetricDeltaRow.create({
    data: {
      visibilityMetricComparisonId: comparison.id,
      projectId,
      metricType: 'MENTION_RATE',
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'OWNED_ROLLUP',
      previousMetricStatus: 'CALCULATED',
      currentMetricStatus: 'CALCULATED',
      previousNumerator: deltaBasisPoints < 0 ? 4 : 2,
      previousDenominator: 10,
      currentNumerator: deltaBasisPoints < 0 ? 2 : 4,
      currentDenominator: 10,
      deltaBasisPoints
    }
  });
  return comparison;
}

describe('P6-D visibility alerts persistence', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityAlertEvent.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityAlertRule.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricComparison.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('deduplicates triggers, acknowledges lifecycle only, and resolves on the next non-triggering comparison', async () => {
    const project = await createProject('P6-D Alert Lifecycle');
    const s1 = await createSnapshot(project.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const s2 = await createSnapshot(project.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
    const s3 = await createSnapshot(project.id, '2026-07-15T00:00:00.000Z', '2026-07-22T00:00:00.000Z');
    const drop = await createComparison(project.id, s1.id, s2.id, -2000);
    const recovery = await createComparison(project.id, s2.id, s3.id, 2000);
    const service = new VisibilityAlertsService();
    const rule = await service.createRule(project.id, {
      ruleType: 'OWNED_MENTION_RATE_DROP',
      name: 'Owned mention drop',
      thresholdBasisPoints: 1000,
      severity: 'CRITICAL'
    });

    expect(await service.evaluateComparison(project.id, drop.id)).toEqual({ triggered: 1, resolved: 0 });
    expect(await service.evaluateComparison(project.id, drop.id)).toEqual({ triggered: 0, resolved: 0 });

    const event = await prisma.visibilityAlertEvent.findFirstOrThrow({ where: { projectId: project.id, alertRuleId: rule.id } });
    const evidenceBefore = {
      comparisonId: event.comparisonId,
      reasonCode: event.reasonCode,
      actorKey: event.actorKey,
      deltaBasisPoints: event.deltaBasisPoints,
      triggeredAt: event.triggeredAt
    };
    const acknowledged = await service.acknowledge(project.id, event.id);
    expect(acknowledged.status).toBe('ACKNOWLEDGED');
    expect({
      comparisonId: acknowledged.comparisonId,
      reasonCode: acknowledged.reasonCode,
      actorKey: acknowledged.actorKey,
      deltaBasisPoints: acknowledged.deltaBasisPoints,
      triggeredAt: acknowledged.triggeredAt
    }).toEqual(evidenceBefore);

    expect(await service.evaluateComparison(project.id, recovery.id)).toEqual({ triggered: 0, resolved: 1 });
    const resolved = await prisma.visibilityAlertEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(resolved.status).toBe('RESOLVED');
    expect(resolved.resolvedAt).not.toBeNull();
  });

  it('fails closed on foreign project rule/event identifiers', async () => {
    const left = await createProject('P6-D Alert Left');
    const right = await createProject('P6-D Alert Right');
    const service = new VisibilityAlertsService();
    const rule = await service.createRule(left.id, {
      ruleType: 'METRIC_BECAME_UNKNOWN',
      name: 'Unknown transition'
    });

    await expect(service.updateRule(right.id, rule.id, { name: 'foreign' })).rejects.toMatchObject({
      code: 'VISIBILITY_ALERT_RULE_NOT_FOUND'
    });
    await expect(service.acknowledge(right.id, '00000000-0000-0000-0000-000000000001')).rejects.toMatchObject({
      code: 'VISIBILITY_ALERT_NOT_FOUND'
    });
  });
});
