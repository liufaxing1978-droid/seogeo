import { Prisma, type VisibilityMetricComparison, type VisibilityMetricRow, type VisibilityMetricSnapshot } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { P6D_COMPARISON_VERSION, type VisibilityHistoryDeltaRow } from './visibility-history.types.js';

const PREDECESSOR_SCAN_LIMIT = 100;
const RECONCILIATION_SCAN_LIMIT = 100;

function snapshotWindowDurationMs(snapshot: Pick<VisibilityMetricSnapshot, 'windowStart' | 'windowEnd'>) {
  return snapshot.windowEnd.getTime() - snapshot.windowStart.getTime();
}

export type CreateVisibilityComparisonInput = {
  projectId: string;
  currentSnapshotId: string;
  previousSnapshotId: string;
  windowDurationMs: number;
  gapDurationMs: number;
  rows: VisibilityHistoryDeltaRow[];
};

export class VisibilityHistoryRepository {
  async getSnapshot(projectId: string, snapshotId: string): Promise<VisibilityMetricSnapshot | null> {
    return prisma.visibilityMetricSnapshot.findFirst({
      where: { id: snapshotId, projectId }
    });
  }

  async listRows(snapshotId: string): Promise<VisibilityMetricRow[]> {
    return prisma.visibilityMetricRow.findMany({
      where: { visibilityMetricSnapshotId: snapshotId },
      orderBy: [
        { metricType: 'asc' },
        { dimensionType: 'asc' },
        { dimensionKey: 'asc' },
        { actorKey: 'asc' }
      ]
    });
  }

  async findNearestCompatiblePrevious(current: VisibilityMetricSnapshot): Promise<VisibilityMetricSnapshot | null> {
    const durationMs = snapshotWindowDurationMs(current);
    const candidates = await prisma.visibilityMetricSnapshot.findMany({
      where: {
        projectId: current.projectId,
        id: { not: current.id },
        status: 'COMPLETED',
        formulaVersion: current.formulaVersion,
        extractorVersion: current.extractorVersion,
        subjectSetHash: current.subjectSetHash,
        scopeHash: current.scopeHash,
        windowEnd: { lte: current.windowStart }
      },
      orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }],
      take: PREDECESSOR_SCAN_LIMIT
    });

    return candidates.find((candidate) => snapshotWindowDurationMs(candidate) === durationMs) ?? null;
  }

  async findComparison(
    projectId: string,
    currentSnapshotId: string,
    previousSnapshotId: string
  ): Promise<VisibilityMetricComparison | null> {
    return prisma.visibilityMetricComparison.findFirst({
      where: {
        projectId,
        comparisonVersion: P6D_COMPARISON_VERSION,
        currentSnapshotId,
        previousSnapshotId
      }
    });
  }

  async createComparisonAtomic(input: CreateVisibilityComparisonInput): Promise<VisibilityMetricComparison> {
    const existing = await this.findComparison(
      input.projectId,
      input.currentSnapshotId,
      input.previousSnapshotId
    );
    if (existing) return existing;

    try {
      return await prisma.$transaction(async (tx) => {
        const comparison = await tx.visibilityMetricComparison.create({
          data: {
            projectId: input.projectId,
            comparisonVersion: P6D_COMPARISON_VERSION,
            currentSnapshotId: input.currentSnapshotId,
            previousSnapshotId: input.previousSnapshotId,
            windowDurationMs: BigInt(input.windowDurationMs),
            gapDurationMs: BigInt(input.gapDurationMs)
          }
        });

        if (input.rows.length > 0) {
          await tx.visibilityMetricDeltaRow.createMany({
            data: input.rows.map((row) => ({
              visibilityMetricComparisonId: comparison.id,
              projectId: input.projectId,
              metricType: row.metricType,
              dimensionType: row.dimensionType,
              dimensionKey: row.dimensionKey,
              actorType: row.actorType,
              actorSubjectId: row.actorSubjectId,
              actorKey: row.actorKey,
              previousMetricStatus: row.previousMetricStatus,
              currentMetricStatus: row.currentMetricStatus,
              previousNumerator: row.previousNumerator,
              previousDenominator: row.previousDenominator,
              currentNumerator: row.currentNumerator,
              currentDenominator: row.currentDenominator,
              deltaBasisPoints: row.deltaBasisPoints
            }))
          });
        }

        return comparison;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.findComparison(
          input.projectId,
          input.currentSnapshotId,
          input.previousSnapshotId
        );
        if (raced) return raced;
      }
      throw error;
    }
  }

  async listReconciliationCandidates(limit = RECONCILIATION_SCAN_LIMIT) {
    const boundedLimit = Math.max(1, Math.min(RECONCILIATION_SCAN_LIMIT, limit));
    const snapshots = await prisma.visibilityMetricSnapshot.findMany({
      where: { status: 'COMPLETED' },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: boundedLimit
    });
    if (snapshots.length === 0) return [];

    const existing = await prisma.visibilityMetricComparison.findMany({
      where: {
        comparisonVersion: P6D_COMPARISON_VERSION,
        currentSnapshotId: { in: snapshots.map((snapshot) => snapshot.id) }
      },
      select: { currentSnapshotId: true }
    });
    const processed = new Set(existing.map((row) => row.currentSnapshotId));
    const candidates: Array<{ id: string; projectId: string }> = [];

    for (const snapshot of snapshots) {
      if (processed.has(snapshot.id)) continue;
      const previous = await this.findNearestCompatiblePrevious(snapshot);
      if (!previous) continue;
      candidates.push({ id: snapshot.id, projectId: snapshot.projectId });
      if (candidates.length >= boundedLimit) break;
    }

    return candidates;
  }
}

export const visibilityHistoryRepository = new VisibilityHistoryRepository();
