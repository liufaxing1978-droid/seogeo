import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P6-C visibility metric persistence', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('persists immutable metric snapshot lifecycle and rows', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6-C Persistence',
        slug: `p6c-${suffix}`,
        primaryDomain: `p6c-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const snapshot = await prisma.visibilityMetricSnapshot.create({
      data: {
        projectId: project.id,
        status: 'QUEUED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'VISIBILITY_EXTRACTION_V1',
        subjectSetHash: 'a'.repeat(64),
        subjectSnapshotJson: { subjects: [] },
        windowStart: new Date('2026-08-01T00:00:00.000Z'),
        windowEnd: new Date('2026-08-08T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-08T00:05:00.000Z'),
        scopeJson: { providers: [], promptSetIds: [] },
        scopeHash: 'b'.repeat(64),
        candidateObservationCount: 2,
        completedExtractionCount: 2,
        missingExtractionCount: 0,
        failedExtractionCount: 0
      }
    });

    expect(snapshot.status).toBe('QUEUED');

    await prisma.visibilityMetricSnapshot.update({
      where: { id: snapshot.id },
      data: {
        status: 'COMPLETED',
        inputFingerprint: 'c'.repeat(64),
        startedAt: new Date('2026-08-08T00:05:01.000Z'),
        completedAt: new Date('2026-08-08T00:05:02.000Z')
      }
    });

    const row = await prisma.visibilityMetricRow.create({
      data: {
        visibilityMetricSnapshotId: snapshot.id,
        projectId: project.id,
        metricType: 'MENTION_RATE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 0,
        denominator: 2,
        candidateObservationCount: 2,
        eligibleObservationCount: 2,
        notEligibleObservationCount: 0,
        unknownObservationCount: 0
      }
    });

    expect(row.dimensionKey).toBe('OVERALL');
    expect(row.numerator).toBe(0);
    expect(row.denominator).toBe(2);
  });

  it('enforces exact snapshot and row identity uniqueness', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6-C Unique',
        slug: `p6c-unique-${suffix}`,
        primaryDomain: `p6c-unique-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const identity = {
      projectId: project.id,
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: 'd'.repeat(64),
      subjectSnapshotJson: { subjects: [] },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-02T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-08-02T00:01:00.000Z'),
      scopeJson: { providers: [], promptSetIds: [] },
      scopeHash: 'e'.repeat(64)
    } as const;

    const snapshot = await prisma.visibilityMetricSnapshot.create({ data: identity });
    await expect(prisma.visibilityMetricSnapshot.create({ data: identity })).rejects.toBeTruthy();

    const metricRow = {
      visibilityMetricSnapshotId: snapshot.id,
      projectId: project.id,
      metricType: 'MENTION_SHARE_OF_VOICE' as const,
      metricStatus: 'NO_SIGNAL' as const,
      dimensionType: 'OVERALL' as const,
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP' as const,
      actorKey: 'OWNED_ROLLUP',
      numerator: 0,
      denominator: 0,
      candidateObservationCount: 1,
      eligibleObservationCount: 1,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    };

    await prisma.visibilityMetricRow.create({ data: metricRow });
    await expect(prisma.visibilityMetricRow.create({ data: metricRow })).rejects.toBeTruthy();
  });

  it('cascades metric rows when a snapshot is deleted', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6-C Cascade',
        slug: `p6c-cascade-${suffix}`,
        primaryDomain: `p6c-cascade-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const snapshot = await prisma.visibilityMetricSnapshot.create({
      data: {
        projectId: project.id,
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'VISIBILITY_EXTRACTION_V1',
        subjectSetHash: 'f'.repeat(64),
        subjectSnapshotJson: { subjects: [] },
        windowStart: new Date('2026-08-03T00:00:00.000Z'),
        windowEnd: new Date('2026-08-04T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-04T00:01:00.000Z'),
        scopeJson: { providers: [], promptSetIds: [] },
        scopeHash: '1'.repeat(64)
      }
    });

    await prisma.visibilityMetricRow.create({
      data: {
        visibilityMetricSnapshotId: snapshot.id,
        projectId: project.id,
        metricType: 'CITATION_RATE',
        metricStatus: 'NO_DATA',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 0,
        denominator: 0,
        candidateObservationCount: 0,
        eligibleObservationCount: 0,
        notEligibleObservationCount: 0,
        unknownObservationCount: 0
      }
    });

    await prisma.visibilityMetricSnapshot.delete({ where: { id: snapshot.id } });
    expect(await prisma.visibilityMetricRow.count({ where: { visibilityMetricSnapshotId: snapshot.id } })).toBe(0);
  });
});
