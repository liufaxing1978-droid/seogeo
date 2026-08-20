import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  PROJECT_REPORT_VERSION,
  PROJECT_REPORT_V2_VERSION,
  generateProjectReportV2,
  type ReportVisibilityReader
} from '../../src/modules/reporting/report-builder.js';

const projectIds: string[] = [];
const alertRuleIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Report V2 ${label}`,
      slug: `report-v2-${suffix}`,
      primaryDomain: `report-v2-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createMetricSnapshot(projectId: string, input: {
  windowStart: string;
  windowEnd: string;
  completedAt: string;
  subjectSetHash?: string;
  scopeHash?: string;
  privateLabel: string;
}) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: input.subjectSetHash ?? 'a'.repeat(64),
      subjectSnapshotJson: { private: `PRIVATE SUBJECT ${input.privateLabel}` },
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      inputCutoffAt: new Date(input.windowEnd),
      scopeJson: { providers: [], promptSetIds: [], private: `PRIVATE SCOPE ${input.privateLabel}` },
      scopeHash: input.scopeHash ?? 'b'.repeat(64),
      inputFingerprint: `${input.privateLabel.charCodeAt(0).toString(16)}`.repeat(64).slice(0, 64),
      candidateObservationCount: 10,
      completedExtractionCount: 8,
      missingExtractionCount: 2,
      failedExtractionCount: 0,
      completedAt: new Date(input.completedAt)
    }
  });
}

async function seedOwnedRows(projectId: string, snapshotId: string) {
  const shared = {
    visibilityMetricSnapshotId: snapshotId,
    projectId,
    candidateObservationCount: 10,
    eligibleObservationCount: 10,
    notEligibleObservationCount: 0,
    unknownObservationCount: 0,
    dimensionType: 'OVERALL' as const,
    dimensionKey: 'OVERALL',
    actorType: 'OWNED_ROLLUP' as const,
    actorKey: 'OWNED_ROLLUP'
  };
  await prisma.visibilityMetricRow.createMany({
    data: [
      { ...shared, metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', numerator: 3, denominator: 10 },
      { ...shared, metricType: 'CITATION_RATE', metricStatus: 'UNKNOWN', numerator: 0, denominator: 0, unknownObservationCount: 2 },
      { ...shared, metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', numerator: 2, denominator: 5 }
    ]
  });
}

async function seedCompetitorRows(projectId: string, snapshotId: string, count: number) {
  await prisma.visibilityMetricRow.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      visibilityMetricSnapshotId: snapshotId,
      projectId,
      metricType: 'MENTION_SHARE_OF_VOICE' as const,
      metricStatus: 'CALCULATED' as const,
      dimensionType: 'OVERALL' as const,
      dimensionKey: 'OVERALL',
      actorType: 'COMPETITOR' as const,
      actorKey: `COMPETITOR:${String(index + 1).padStart(2, '0')}`,
      numerator: index + 1,
      denominator: 100,
      candidateObservationCount: 10,
      eligibleObservationCount: 10,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    }))
  });
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  for (const ruleId of alertRuleIds) {
    await prisma.visibilityAlertRule.delete({ where: { id: ruleId } }).catch(() => undefined);
  }
});

describe('PROJECT_REPORT_V2', () => {
  it('preserves V1 snapshots and skips restricted P6 reads entirely for Standard', async () => {
    const project = await createProject('STANDARD', 'standard');
    const originalFacts = {
      project: { id: project.id, name: 'immutable-v1' },
      seo: { score: null },
      sentinel: 'V1 MUST REMAIN IMMUTABLE'
    };
    const legacy = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: PROJECT_REPORT_VERSION,
        factSnapshot: originalFacts,
        advisorySnapshot: { ai: [] },
        sourceReferences: [{ type: 'PROJECT', id: project.id }]
      }
    });

    let restrictedReads = 0;
    const visibilityReader: ReportVisibilityReader = {
      async load() {
        restrictedReads += 1;
        throw new Error('Standard must never invoke restricted P6 reader');
      }
    };

    const report = await generateProjectReportV2(project.id, { visibilityReader });
    const facts = report.factSnapshot as Record<string, unknown>;
    const reloadedLegacy = await prisma.reportSnapshot.findUniqueOrThrow({ where: { id: legacy.id } });

    expect(PROJECT_REPORT_VERSION).toBe('PROJECT_REPORT_V1');
    expect(PROJECT_REPORT_V2_VERSION).toBe('PROJECT_REPORT_V2');
    expect(report.reportVersion).toBe(PROJECT_REPORT_V2_VERSION);
    expect(restrictedReads).toBe(0);
    expect(facts).not.toHaveProperty('visibility');
    expect(reloadedLegacy.reportVersion).toBe(PROJECT_REPORT_VERSION);
    expect(reloadedLegacy.factSnapshot).toEqual(originalFacts);
  });

  it('freezes one latest completed P6-C snapshot with safe metrics, bounded competitors, compatible deltas, evidence coverage and open alert severity counts', async () => {
    const project = await createProject('ADVANCED', 'advanced');
    const previous = await createMetricSnapshot(project.id, {
      windowStart: '2026-07-24T00:00:00.000Z',
      windowEnd: '2026-07-31T00:00:00.000Z',
      completedAt: '2026-08-01T00:00:00.000Z',
      privateLabel: 'PREVIOUS'
    });
    const current = await createMetricSnapshot(project.id, {
      windowStart: '2026-08-01T00:00:00.000Z',
      windowEnd: '2026-08-08T00:00:00.000Z',
      completedAt: '2026-08-09T00:00:00.000Z',
      privateLabel: 'CURRENT'
    });
    await seedOwnedRows(project.id, current.id);
    await seedCompetitorRows(project.id, current.id, 25);

    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: project.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: BigInt(7 * 24 * 60 * 60 * 1000),
        gapDurationMs: BigInt(24 * 60 * 60 * 1000)
      }
    });
    await prisma.visibilityMetricDeltaRow.createMany({
      data: [
        {
          visibilityMetricComparisonId: comparison.id,
          projectId: project.id,
          metricType: 'MENTION_RATE',
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'OWNED_ROLLUP',
          actorKey: 'OWNED_ROLLUP',
          previousMetricStatus: 'CALCULATED',
          currentMetricStatus: 'CALCULATED',
          previousNumerator: 2,
          previousDenominator: 10,
          currentNumerator: 3,
          currentDenominator: 10,
          deltaBasisPoints: 1000
        },
        {
          visibilityMetricComparisonId: comparison.id,
          projectId: project.id,
          metricType: 'CITATION_RATE',
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'OWNED_ROLLUP',
          actorKey: 'OWNED_ROLLUP',
          previousMetricStatus: 'CALCULATED',
          currentMetricStatus: 'UNKNOWN',
          previousNumerator: 4,
          previousDenominator: 10,
          currentNumerator: 0,
          currentDenominator: 0,
          deltaBasisPoints: null
        }
      ]
    });

    const infoRule = await prisma.visibilityAlertRule.create({
      data: {
        projectId: project.id,
        ruleType: 'OWNED_MENTION_RATE_DROP',
        name: 'Report V2 info fixture',
        severity: 'INFO',
        thresholdBasisPoints: 100
      }
    });
    const criticalRule = await prisma.visibilityAlertRule.create({
      data: {
        projectId: project.id,
        ruleType: 'OWNED_MENTION_RATE_DROP',
        name: 'Report V2 critical fixture',
        severity: 'CRITICAL',
        thresholdBasisPoints: 100
      }
    });
    alertRuleIds.push(infoRule.id, criticalRule.id);
    await prisma.visibilityAlertEvent.createMany({
      data: [
        {
          projectId: project.id,
          alertRuleId: infoRule.id,
          comparisonId: comparison.id,
          eventFingerprint: `report-v2-info-${project.id}`,
          status: 'OPEN',
          severity: 'INFO',
          reasonCode: 'OWNED_MENTION_RATE_DROP',
          deltaBasisPoints: -500,
          previousMetricStatus: 'CALCULATED',
          currentMetricStatus: 'CALCULATED',
          triggeredAt: new Date('2026-08-09T01:00:00.000Z')
        },
        {
          projectId: project.id,
          alertRuleId: criticalRule.id,
          comparisonId: comparison.id,
          eventFingerprint: `report-v2-critical-${project.id}`,
          status: 'OPEN',
          severity: 'CRITICAL',
          reasonCode: 'OWNED_MENTION_RATE_DROP',
          deltaBasisPoints: -900,
          previousMetricStatus: 'CALCULATED',
          currentMetricStatus: 'CALCULATED',
          triggeredAt: new Date('2026-08-09T02:00:00.000Z')
        }
      ]
    });

    const before = {
      snapshots: await prisma.visibilityMetricSnapshot.count({ where: { projectId: project.id } }),
      rows: await prisma.visibilityMetricRow.count({ where: { projectId: project.id } }),
      comparisons: await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } }),
      runs: await prisma.visibilityRun.count({ where: { projectId: project.id } }),
      extractions: await prisma.visibilityExtraction.count({ where: { projectId: project.id } }),
      aiTasks: await prisma.aiTask.count({ where: { projectId: project.id } })
    };

    const report = await generateProjectReportV2(project.id);
    const facts = report.factSnapshot as any;
    const serialized = JSON.stringify(facts);

    expect(report.reportVersion).toBe(PROJECT_REPORT_V2_VERSION);
    expect(facts.visibility.snapshot.id).toBe(current.id);
    expect(facts.visibility.snapshot.formulaVersion).toBe('VISIBILITY_METRICS_V1');
    expect(facts.visibility.metrics.mentionRate).toMatchObject({ status: 'CALCULATED', numerator: 3, denominator: 10, ratio: 0.3 });
    expect(facts.visibility.metrics.citationRate).toMatchObject({ status: 'UNKNOWN', ratio: null });
    expect(facts.visibility.metrics.ownedSov).toMatchObject({ status: 'CALCULATED', ratio: 0.4 });
    expect(facts.visibility.evidenceCoverage).toEqual({ completedExtractionCount: 8, candidateObservationCount: 10, ratio: 0.8 });
    expect(facts.visibility.competitorSov).toHaveLength(20);
    expect(facts.visibility.comparison.id).toBe(comparison.id);
    expect(facts.visibility.comparison.deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricType: 'MENTION_RATE', actorKey: 'OWNED_ROLLUP', deltaBasisPoints: 1000 }),
      expect.objectContaining({ metricType: 'CITATION_RATE', actorKey: 'OWNED_ROLLUP', deltaBasisPoints: null })
    ]));
    expect(facts.visibility.alerts).toEqual({ openTotal: 2, bySeverity: { INFO: 1, WARNING: 0, CRITICAL: 1 } });
    expect(serialized).not.toContain('PRIVATE SUBJECT CURRENT');
    expect(serialized).not.toContain('PRIVATE SCOPE CURRENT');
    expect(serialized).not.toContain('subjectSnapshotJson');
    expect(serialized).not.toContain('scopeJson');

    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: project.id } })).toBe(before.snapshots);
    expect(await prisma.visibilityMetricRow.count({ where: { projectId: project.id } })).toBe(before.rows);
    expect(await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } })).toBe(before.comparisons);
    expect(await prisma.visibilityRun.count({ where: { projectId: project.id } })).toBe(before.runs);
    expect(await prisma.visibilityExtraction.count({ where: { projectId: project.id } })).toBe(before.extractions);
    expect(await prisma.aiTask.count({ where: { projectId: project.id } })).toBe(before.aiTasks);
  });
});
