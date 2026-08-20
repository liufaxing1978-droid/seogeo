import type {
  Prisma,
  VisibilityMetricRow,
  VisibilityMetricSnapshot
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { CalculatedVisibilityMetricRow } from './visibility-metrics.types.js';

export interface VisibilityMetricSnapshotIdentity {
  projectId: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  subjectSnapshotJson: Prisma.InputJsonValue;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  scopeJson: Prisma.InputJsonValue;
  scopeHash: string;
}

export interface CompleteVisibilityMetricSnapshotInput {
  inputFingerprint: string;
  candidateObservationCount: number;
  completedExtractionCount: number;
  missingExtractionCount: number;
  failedExtractionCount: number;
  rows: CalculatedVisibilityMetricRow[];
}

export class VisibilityMetricsRepository {
  async createOrGetShell(input: VisibilityMetricSnapshotIdentity): Promise<VisibilityMetricSnapshot> {
    return prisma.visibilityMetricSnapshot.upsert({
      where: {
        projectId_formulaVersion_extractorVersion_subjectSetHash_windowStart_windowEnd_inputCutoffAt_scopeHash: {
          projectId: input.projectId,
          formulaVersion: input.formulaVersion,
          extractorVersion: input.extractorVersion,
          subjectSetHash: input.subjectSetHash,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          inputCutoffAt: input.inputCutoffAt,
          scopeHash: input.scopeHash
        }
      },
      create: {
        ...input,
        status: 'QUEUED'
      },
      update: {}
    });
  }

  async get(projectId: string, snapshotId: string): Promise<VisibilityMetricSnapshot | null> {
    return prisma.visibilityMetricSnapshot.findFirst({ where: { id: snapshotId, projectId } });
  }

  async claim(projectId: string, snapshotId: string): Promise<boolean> {
    const result = await prisma.visibilityMetricSnapshot.updateMany({
      where: { id: snapshotId, projectId, status: { in: ['QUEUED', 'FAILED'] } },
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        completedAt: null,
        errorCode: null
      }
    });
    return result.count === 1;
  }

  async completeAtomic(
    snapshot: VisibilityMetricSnapshot,
    input: CompleteVisibilityMetricSnapshotInput
  ): Promise<VisibilityMetricSnapshot> {
    return prisma.$transaction(async (tx) => {
      const running = await tx.visibilityMetricSnapshot.findFirst({
        where: { id: snapshot.id, projectId: snapshot.projectId, status: 'RUNNING' },
        select: { id: true }
      });
      if (!running) {
        throw new Error('VISIBILITY_METRICS_SNAPSHOT_NOT_RUNNING');
      }

      await tx.visibilityMetricRow.deleteMany({ where: { visibilityMetricSnapshotId: snapshot.id } });
      if (input.rows.length > 0) {
        await tx.visibilityMetricRow.createMany({
          data: input.rows.map((row) => ({
            visibilityMetricSnapshotId: snapshot.id,
            projectId: snapshot.projectId,
            metricType: row.metricType,
            metricStatus: row.metricStatus,
            dimensionType: row.dimensionType,
            dimensionKey: row.dimensionKey,
            dimensionLabelSnapshot: row.dimensionLabelSnapshot,
            actorType: row.actorType,
            actorSubjectId: row.actorSubjectId,
            actorKey: row.actorKey,
            numerator: row.numerator,
            denominator: row.denominator,
            candidateObservationCount: row.candidateObservationCount,
            eligibleObservationCount: row.eligibleObservationCount,
            notEligibleObservationCount: row.notEligibleObservationCount,
            unknownObservationCount: row.unknownObservationCount
          }))
        });
      }

      const finalized = await tx.visibilityMetricSnapshot.updateMany({
        where: { id: snapshot.id, projectId: snapshot.projectId, status: 'RUNNING' },
        data: {
          status: 'COMPLETED',
          inputFingerprint: input.inputFingerprint,
          candidateObservationCount: input.candidateObservationCount,
          completedExtractionCount: input.completedExtractionCount,
          missingExtractionCount: input.missingExtractionCount,
          failedExtractionCount: input.failedExtractionCount,
          errorCode: null,
          completedAt: new Date()
        }
      });
      if (finalized.count !== 1) {
        throw new Error('VISIBILITY_METRICS_SNAPSHOT_FINALIZE_CONFLICT');
      }

      return tx.visibilityMetricSnapshot.findFirstOrThrow({
        where: { id: snapshot.id, projectId: snapshot.projectId }
      });
    });
  }

  async fail(projectId: string, snapshotId: string, errorCode: string): Promise<VisibilityMetricSnapshot> {
    const failed = await prisma.visibilityMetricSnapshot.updateMany({
      where: { id: snapshotId, projectId, status: 'RUNNING' },
      data: {
        status: 'FAILED',
        errorCode,
        completedAt: new Date()
      }
    });
    if (failed.count !== 1) {
      throw new Error('VISIBILITY_METRICS_SNAPSHOT_FAIL_CONFLICT');
    }
    return prisma.visibilityMetricSnapshot.findFirstOrThrow({ where: { id: snapshotId, projectId } });
  }

  async listRows(snapshotId: string): Promise<VisibilityMetricRow[]> {
    return prisma.visibilityMetricRow.findMany({
      where: { visibilityMetricSnapshotId: snapshotId },
      orderBy: [
        { dimensionType: 'asc' },
        { dimensionKey: 'asc' },
        { metricType: 'asc' },
        { actorKey: 'asc' }
      ]
    });
  }
}

export const visibilityMetricsRepository = new VisibilityMetricsRepository();
