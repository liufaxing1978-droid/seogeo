import type { OptimizationExperiment, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  ExperimentContaminationEvent,
  ExperimentContaminationReadPort
} from './experiment.contamination.js';
import type { ExperimentMeasurementScope } from './experiment.types.js';
import type {
  VisibilityExperimentSnapshotView,
  VisibilityExperimentSourcePort
} from './experiment.visibility-source.js';

export interface ExperimentEvaluationReadPort {
  findExperimentForEvaluation(input: {
    projectId: string;
    experimentId: string;
  }): Promise<OptimizationExperiment | null>;
}

export class PrismaExperimentEvaluationSource
implements ExperimentEvaluationReadPort, ExperimentContaminationReadPort, VisibilityExperimentSourcePort {
  constructor(private readonly db: PrismaClient = prisma) {}

  async findExperimentForEvaluation(input: {
    projectId: string;
    experimentId: string;
  }): Promise<OptimizationExperiment | null> {
    return this.db.optimizationExperiment.findFirst({
      where: {
        id: input.experimentId,
        projectId: input.projectId
      }
    });
  }

  async listPublicationEvents(input: {
    experimentId: string;
    projectId: string;
    targetUrl: string;
    verifiedAnchorAt: Date;
    observedWindowEnd: Date;
  }): Promise<readonly ExperimentContaminationEvent[]> {
    const events = await this.db.publicationExecutionEvent.findMany({
      where: {
        createdAt: {
          gte: input.verifiedAnchorAt,
          lte: input.observedWindowEnd
        },
        execution: {
          projectId: input.projectId
        }
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
      select: {
        executionId: true,
        eventType: true,
        createdAt: true,
        execution: {
          select: {
            projectId: true,
            plan: {
              select: { targetPublicUrl: true }
            }
          }
        }
      }
    });

    return events.map((event) => ({
      projectId: event.execution.projectId,
      executionId: event.executionId,
      eventType: event.eventType,
      targetUrl: event.execution.plan.targetPublicUrl,
      createdAt: event.createdAt
    }));
  }

  async listCompatibleSnapshots(input: {
    projectId: string;
    scope: Extract<ExperimentMeasurementScope, { kind: 'VISIBILITY' }>;
  }): Promise<readonly VisibilityExperimentSnapshotView[]> {
    const snapshots = await this.db.visibilityMetricSnapshot.findMany({
      where: {
        projectId: input.projectId,
        status: 'COMPLETED',
        formulaVersion: input.scope.formulaVersion,
        extractorVersion: input.scope.extractorVersion,
        subjectSetHash: input.scope.subjectSetHash,
        scopeHash: input.scope.scopeHash
      },
      orderBy: [
        { windowEnd: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        projectId: true,
        status: true,
        formulaVersion: true,
        extractorVersion: true,
        subjectSetHash: true,
        scopeHash: true,
        windowStart: true,
        windowEnd: true,
        inputCutoffAt: true
      }
    });
    if (snapshots.length === 0) return [];

    const rows = await this.db.visibilityMetricRow.findMany({
      where: {
        projectId: input.projectId,
        visibilityMetricSnapshotId: { in: snapshots.map((snapshot) => snapshot.id) },
        metricType: input.scope.metricType,
        dimensionType: input.scope.dimensionType as never,
        dimensionKey: input.scope.dimensionKey,
        actorType: input.scope.actorType as never,
        actorKey: input.scope.actorKey
      },
      orderBy: [
        { visibilityMetricSnapshotId: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        projectId: true,
        visibilityMetricSnapshotId: true,
        metricType: true,
        metricStatus: true,
        dimensionType: true,
        dimensionKey: true,
        actorType: true,
        actorKey: true,
        numerator: true,
        denominator: true,
        eligibleObservationCount: true
      }
    });
    const rowsBySnapshot = new Map(rows.map((row) => [row.visibilityMetricSnapshotId, row]));

    return snapshots.flatMap((snapshot) => {
      const row = rowsBySnapshot.get(snapshot.id);
      if (!row) return [];
      return [{
        snapshotId: snapshot.id,
        projectId: snapshot.projectId,
        status: snapshot.status,
        formulaVersion: snapshot.formulaVersion,
        extractorVersion: snapshot.extractorVersion,
        subjectSetHash: snapshot.subjectSetHash,
        scopeHash: snapshot.scopeHash,
        windowStart: snapshot.windowStart,
        windowEnd: snapshot.windowEnd,
        inputCutoffAt: snapshot.inputCutoffAt,
        row: {
          rowId: row.id,
          projectId: row.projectId,
          metricType: row.metricType,
          metricStatus: row.metricStatus,
          dimensionType: row.dimensionType,
          dimensionKey: row.dimensionKey,
          actorType: row.actorType,
          actorKey: row.actorKey,
          numerator: row.numerator,
          denominator: row.denominator,
          eligibleObservationCount: row.eligibleObservationCount
        }
      } satisfies VisibilityExperimentSnapshotView];
    });
  }
}
