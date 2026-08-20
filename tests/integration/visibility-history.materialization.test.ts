import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { visibilityHistoryRepository } from '../../src/modules/visibility/visibility-history.repository.js';
import { VisibilityHistoryService } from '../../src/modules/visibility/visibility-history.service.js';
import { VisibilityHistoryError } from '../../src/modules/visibility/visibility-history.types.js';

const projectIds: string[] = [];
const CONTRACT = {
  formulaVersion: 'VISIBILITY_METRICS_V1',
  extractorVersion: 'VISIBILITY_EXTRACTION_V1',
  subjectSetHash: 'subject-set-history-v1',
  scopeHash: 'scope-history-v1'
};

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p6d-materialization-${suffix}`,
      primaryDomain: `p6d-materialization-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createSnapshot(input: {
  projectId: string;
  windowStart: string;
  windowEnd: string;
  subjectSetHash?: string;
  scopeHash?: string;
}) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId: input.projectId,
      status: 'COMPLETED',
      formulaVersion: CONTRACT.formulaVersion,
      extractorVersion: CONTRACT.extractorVersion,
      subjectSetHash: input.subjectSetHash ?? CONTRACT.subjectSetHash,
      subjectSnapshotJson: { subjects: [] },
      windowStart: new Date(input.windowStart),
      windowEnd: new Date(input.windowEnd),
      inputCutoffAt: new Date(input.windowEnd),
      scopeJson: { providers: [], promptSetIds: [] },
      scopeHash: input.scopeHash ?? CONTRACT.scopeHash,
      inputFingerprint: `fingerprint-${input.windowStart}`,
      candidateObservationCount: 4,
      completedExtractionCount: 4,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      startedAt: new Date(input.windowEnd),
      completedAt: new Date(input.windowEnd)
    }
  });
}

async function createOwnedMentionRow(snapshotId: string, projectId: string, numerator: number) {
  return prisma.visibilityMetricRow.create({
    data: {
      visibilityMetricSnapshotId: snapshotId,
      projectId,
      metricType: 'MENTION_RATE',
      metricStatus: 'CALCULATED',
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      dimensionLabelSnapshot: null,
      actorType: 'OWNED_ROLLUP',
      actorSubjectId: null,
      actorKey: 'OWNED_ROLLUP',
      numerator,
      denominator: 4,
      candidateObservationCount: 4,
      eligibleObservationCount: 4,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    }
  });
}

describe('P6-D visibility history materialization', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityMetricComparison.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('chooses the nearest earlier compatible snapshot and materializes immutable deltas idempotently', async () => {
    const project = await createProject('P6-D Nearest Compatible');
    const oldest = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-07-08T00:00:00.000Z'
    });
    const previous = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-08T00:00:00.000Z',
      windowEnd: '2026-07-15T00:00:00.000Z'
    });
    const current = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-15T00:00:00.000Z',
      windowEnd: '2026-07-22T00:00:00.000Z'
    });
    await createOwnedMentionRow(oldest.id, project.id, 0);
    await createOwnedMentionRow(previous.id, project.id, 1);
    await createOwnedMentionRow(current.id, project.id, 2);

    const service = new VisibilityHistoryService();
    const first = await service.materializeForSnapshot(project.id, current.id);
    const second = await service.materializeForSnapshot(project.id, current.id);

    expect(first.outcome).toBe('COMPLETED');
    expect(first.comparisonId).toBeTruthy();
    expect(second).toEqual(first);

    const comparison = await prisma.visibilityMetricComparison.findFirstOrThrow({
      where: { id: first.comparisonId! }
    });
    expect(comparison).toMatchObject({
      projectId: project.id,
      comparisonVersion: 'VISIBILITY_COMPARISON_V1',
      currentSnapshotId: current.id,
      previousSnapshotId: previous.id,
      windowDurationMs: 604_800_000n,
      gapDurationMs: 0n
    });
    expect(await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } })).toBe(1);

    const rows = await prisma.visibilityMetricDeltaRow.findMany({
      where: { visibilityMetricComparisonId: comparison.id }
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metricType: 'MENTION_RATE',
      actorKey: 'OWNED_ROLLUP',
      previousNumerator: 1,
      previousDenominator: 4,
      currentNumerator: 2,
      currentDenominator: 4,
      deltaBasisPoints: 2500
    });

    const sourceSnapshots = await prisma.visibilityMetricSnapshot.findMany({
      where: { id: { in: [oldest.id, previous.id, current.id] } },
      orderBy: { windowStart: 'asc' }
    });
    expect(sourceSnapshots).toHaveLength(3);
    expect(sourceSnapshots.every((snapshot) => snapshot.status === 'COMPLETED')).toBe(true);
  });

  it('returns a normal no-comparison outcome when no compatible predecessor exists', async () => {
    const project = await createProject('P6-D No Previous');
    const current = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-15T00:00:00.000Z',
      windowEnd: '2026-07-22T00:00:00.000Z'
    });
    await createOwnedMentionRow(current.id, project.id, 2);

    const result = await new VisibilityHistoryService().materializeForSnapshot(project.id, current.id);

    expect(result).toEqual({ comparisonId: null, outcome: 'NO_COMPATIBLE_PREVIOUS' });
    expect(await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('reconciles only snapshots that currently have a compatible predecessor', async () => {
    const project = await createProject('P6-D Reconciliation Eligibility');
    const first = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-08T00:00:00.000Z',
      windowEnd: '2026-07-15T00:00:00.000Z'
    });

    const beforeBackfill = await visibilityHistoryRepository.listReconciliationCandidates(100);
    expect(beforeBackfill.some((candidate) => candidate.id === first.id)).toBe(false);

    await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-01T00:00:00.000Z',
      windowEnd: '2026-07-08T00:00:00.000Z'
    });

    const afterBackfill = await visibilityHistoryRepository.listReconciliationCandidates(100);
    expect(afterBackfill.some((candidate) => candidate.id === first.id)).toBe(true);
  });

  it('ignores an earlier snapshot whose subject contract is incompatible', async () => {
    const project = await createProject('P6-D Incompatible Previous');
    const previous = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-08T00:00:00.000Z',
      windowEnd: '2026-07-15T00:00:00.000Z',
      subjectSetHash: 'different-subject-set'
    });
    const current = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-15T00:00:00.000Z',
      windowEnd: '2026-07-22T00:00:00.000Z'
    });
    await createOwnedMentionRow(previous.id, project.id, 1);
    await createOwnedMentionRow(current.id, project.id, 2);

    const result = await new VisibilityHistoryService().materializeForSnapshot(project.id, current.id);

    expect(result).toEqual({ comparisonId: null, outcome: 'NO_COMPATIBLE_PREVIOUS' });
  });

  it('fails closed and persists no comparison when source row identities do not match', async () => {
    const project = await createProject('P6-D Missing Row');
    const previous = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-08T00:00:00.000Z',
      windowEnd: '2026-07-15T00:00:00.000Z'
    });
    const current = await createSnapshot({
      projectId: project.id,
      windowStart: '2026-07-15T00:00:00.000Z',
      windowEnd: '2026-07-22T00:00:00.000Z'
    });
    await createOwnedMentionRow(previous.id, project.id, 1);
    await prisma.visibilityMetricRow.create({
      data: {
        visibilityMetricSnapshotId: current.id,
        projectId: project.id,
        metricType: 'CITATION_RATE',
        metricStatus: 'CALCULATED',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        numerator: 2,
        denominator: 4,
        candidateObservationCount: 4,
        eligibleObservationCount: 4,
        notEligibleObservationCount: 0,
        unknownObservationCount: 0
      }
    });

    try {
      await new VisibilityHistoryService().materializeForSnapshot(project.id, current.id);
      throw new Error('Expected row identity failure');
    } catch (error) {
      expect(error).toBeInstanceOf(VisibilityHistoryError);
      expect((error as VisibilityHistoryError).code).toBe('VISIBILITY_HISTORY_ROW_MISSING');
    }

    expect(await prisma.visibilityMetricComparison.count({ where: { projectId: project.id } })).toBe(0);
  });
});
