import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p6d-history-${suffix}`,
      primaryDomain: `p6d-history-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createCompletedSnapshot(
  projectId: string,
  suffix: string,
  windowStart: string,
  windowEnd: string
) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(63) + suffix,
      subjectSnapshotJson: { subjects: [] },
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
      inputCutoffAt: new Date(windowEnd),
      scopeJson: { providers: [], promptSetIds: [] },
      scopeHash: 'b'.repeat(63) + suffix,
      inputFingerprint: 'c'.repeat(63) + suffix,
      candidateObservationCount: 10,
      completedExtractionCount: 10,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      startedAt: new Date(windowEnd),
      completedAt: new Date(windowEnd)
    }
  });
}

describe('P6-D visibility history persistence', () => {
  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.visibilityMetricComparison.deleteMany({ where: { projectId: id } }).catch(() => undefined);
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('persists a comparison and row-level source facts without truncating millisecond durations', async () => {
    const project = await createProject('P6-D Comparison Persistence');
    const previous = await createCompletedSnapshot(
      project.id,
      '1',
      '2026-06-01T00:00:00.000Z',
      '2026-07-02T00:00:00.000Z'
    );
    const current = await createCompletedSnapshot(
      project.id,
      '2',
      '2026-08-11T00:00:00.000Z',
      '2026-09-11T00:00:00.000Z'
    );

    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: project.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: 2_678_400_000n,
        gapDurationMs: 3_456_000_000n
      }
    });

    const delta = await prisma.visibilityMetricDeltaRow.create({
      data: {
        visibilityMetricComparisonId: comparison.id,
        projectId: project.id,
        metricType: 'MENTION_RATE',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        previousMetricStatus: 'CALCULATED',
        currentMetricStatus: 'UNKNOWN',
        previousNumerator: 2,
        previousDenominator: 10,
        currentNumerator: 0,
        currentDenominator: 0,
        deltaBasisPoints: null
      }
    });

    expect(comparison.windowDurationMs).toBe(2_678_400_000n);
    expect(comparison.gapDurationMs).toBe(3_456_000_000n);
    expect(delta).toMatchObject({
      previousMetricStatus: 'CALCULATED',
      currentMetricStatus: 'UNKNOWN',
      previousNumerator: 2,
      previousDenominator: 10,
      currentNumerator: 0,
      currentDenominator: 0,
      deltaBasisPoints: null
    });
  });

  it('enforces exact comparison and delta-row identity uniqueness', async () => {
    const project = await createProject('P6-D Comparison Uniqueness');
    const previous = await createCompletedSnapshot(
      project.id,
      '3',
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z'
    );
    const current = await createCompletedSnapshot(
      project.id,
      '4',
      '2026-07-08T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z'
    );

    const identity = {
      projectId: project.id,
      comparisonVersion: 'VISIBILITY_COMPARISON_V1',
      currentSnapshotId: current.id,
      previousSnapshotId: previous.id,
      windowDurationMs: 604_800_000n,
      gapDurationMs: 0n
    };

    const comparison = await prisma.visibilityMetricComparison.create({ data: identity });
    await expect(prisma.visibilityMetricComparison.create({ data: identity })).rejects.toBeTruthy();

    const rowIdentity = {
      visibilityMetricComparisonId: comparison.id,
      projectId: project.id,
      metricType: 'MENTION_SHARE_OF_VOICE' as const,
      dimensionType: 'OVERALL' as const,
      dimensionKey: 'OVERALL',
      actorType: 'COMPETITOR' as const,
      actorSubjectId: null,
      actorKey: 'COMPETITOR:fixture',
      previousMetricStatus: 'CALCULATED' as const,
      currentMetricStatus: 'CALCULATED' as const,
      previousNumerator: 1,
      previousDenominator: 4,
      currentNumerator: 2,
      currentDenominator: 4,
      deltaBasisPoints: 2500
    };

    await prisma.visibilityMetricDeltaRow.create({ data: rowIdentity });
    await expect(prisma.visibilityMetricDeltaRow.create({ data: rowIdentity })).rejects.toBeTruthy();
  });

  it('cascades delta rows when the comparison is deleted but preserves both P6-C source snapshots', async () => {
    const project = await createProject('P6-D Comparison Cascade');
    const previous = await createCompletedSnapshot(
      project.id,
      '5',
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z'
    );
    const current = await createCompletedSnapshot(
      project.id,
      '6',
      '2026-07-08T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z'
    );

    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: project.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: 604_800_000n,
        gapDurationMs: 0n
      }
    });
    await prisma.visibilityMetricDeltaRow.create({
      data: {
        visibilityMetricComparisonId: comparison.id,
        projectId: project.id,
        metricType: 'CITATION_RATE',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        previousMetricStatus: 'CALCULATED',
        currentMetricStatus: 'CALCULATED',
        previousNumerator: 1,
        previousDenominator: 2,
        currentNumerator: 1,
        currentDenominator: 4,
        deltaBasisPoints: -2500
      }
    });

    await prisma.visibilityMetricComparison.delete({ where: { id: comparison.id } });

    expect(await prisma.visibilityMetricDeltaRow.count({
      where: { visibilityMetricComparisonId: comparison.id }
    })).toBe(0);
    expect(await prisma.visibilityMetricSnapshot.count({
      where: { id: { in: [previous.id, current.id] } }
    })).toBe(2);
  });

  it('restricts deletion of a referenced P6-C source snapshot until the P6-D comparison is removed', async () => {
    const project = await createProject('P6-D Source Restrict');
    const previous = await createCompletedSnapshot(
      project.id,
      '7',
      '2026-07-01T00:00:00.000Z',
      '2026-07-08T00:00:00.000Z'
    );
    const current = await createCompletedSnapshot(
      project.id,
      '8',
      '2026-07-08T00:00:00.000Z',
      '2026-07-15T00:00:00.000Z'
    );

    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: project.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: 604_800_000n,
        gapDurationMs: 0n
      }
    });

    await expect(
      prisma.visibilityMetricSnapshot.delete({ where: { id: current.id } })
    ).rejects.toBeTruthy();

    await prisma.visibilityMetricComparison.delete({ where: { id: comparison.id } });
    await expect(
      prisma.visibilityMetricSnapshot.delete({ where: { id: current.id } })
    ).resolves.toMatchObject({ id: current.id });
  });
});
