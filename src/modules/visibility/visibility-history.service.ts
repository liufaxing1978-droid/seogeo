import type { VisibilityMetricRow, VisibilityMetricSnapshot } from '@prisma/client';
import {
  assertComparableSnapshots,
  calculateVisibilityHistoryDeltaRows
} from './visibility-history.calculator.js';
import {
  VisibilityHistoryError,
  type VisibilityHistoryMetricRowInput,
  type VisibilityHistorySnapshotContract
} from './visibility-history.types.js';
import {
  VisibilityHistoryRepository,
  visibilityHistoryRepository
} from './visibility-history.repository.js';
import {
  VisibilityHistoryObservability,
  visibilityHistoryObservability
} from './visibility-history.observability.js';

function snapshotContract(snapshot: VisibilityMetricSnapshot): VisibilityHistorySnapshotContract {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    formulaVersion: snapshot.formulaVersion,
    extractorVersion: snapshot.extractorVersion,
    subjectSetHash: snapshot.subjectSetHash,
    scopeHash: snapshot.scopeHash,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd
  };
}

function metricRowInput(row: VisibilityMetricRow): VisibilityHistoryMetricRowInput {
  return {
    metricType: row.metricType,
    metricStatus: row.metricStatus,
    dimensionType: row.dimensionType,
    dimensionKey: row.dimensionKey,
    actorType: row.actorType,
    actorSubjectId: row.actorSubjectId,
    actorKey: row.actorKey,
    numerator: row.numerator,
    denominator: row.denominator
  };
}

export class VisibilityHistoryService {
  constructor(
    private readonly repository: VisibilityHistoryRepository = visibilityHistoryRepository,
    private readonly observability: VisibilityHistoryObservability = visibilityHistoryObservability
  ) {}

  async materializeForSnapshot(projectId: string, currentSnapshotId: string): Promise<{
    comparisonId: string | null;
    outcome: 'COMPLETED' | 'NO_COMPATIBLE_PREVIOUS';
  }> {
    const startedAt = Date.now();
    try {
      const current = await this.repository.getSnapshot(projectId, currentSnapshotId);
      if (!current) {
        throw new VisibilityHistoryError(
          'VISIBILITY_HISTORY_SNAPSHOT_NOT_FOUND',
          'Visibility history snapshot was not found in the project'
        );
      }
      if (current.status !== 'COMPLETED') {
        throw new VisibilityHistoryError(
          'VISIBILITY_HISTORY_SNAPSHOT_NOT_COMPLETED',
          'Visibility history requires a completed metric snapshot'
        );
      }

      const previous = await this.repository.findNearestCompatiblePrevious(current);
      if (!previous) {
        this.observability.emit({
          event: 'visibility.history.comparison.incomparable',
          projectId,
          currentSnapshotId,
          status: 'NO_COMPATIBLE_PREVIOUS',
          durationMs: Date.now() - startedAt
        });
        return { comparisonId: null, outcome: 'NO_COMPATIBLE_PREVIOUS' };
      }

      const existing = await this.repository.findComparison(projectId, current.id, previous.id);
      if (existing) {
        this.observability.emit({
          event: 'visibility.history.comparison.completed',
          projectId,
          currentSnapshotId: current.id,
          previousSnapshotId: previous.id,
          comparisonId: existing.id,
          status: 'COMPLETED',
          durationMs: Date.now() - startedAt
        });
        return { comparisonId: existing.id, outcome: 'COMPLETED' };
      }

      const compatibility = assertComparableSnapshots(snapshotContract(current), snapshotContract(previous));
      const [currentRows, previousRows] = await Promise.all([
        this.repository.listRows(current.id),
        this.repository.listRows(previous.id)
      ]);
      const rows = calculateVisibilityHistoryDeltaRows({
        currentRows: currentRows.map(metricRowInput),
        previousRows: previousRows.map(metricRowInput)
      });

      const comparison = await this.repository.createComparisonAtomic({
        projectId,
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: compatibility.windowDurationMs,
        gapDurationMs: compatibility.gapDurationMs,
        rows
      });
      this.observability.emit({
        event: 'visibility.history.comparison.completed',
        projectId,
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        comparisonId: comparison.id,
        status: 'COMPLETED',
        durationMs: Date.now() - startedAt
      });
      return { comparisonId: comparison.id, outcome: 'COMPLETED' };
    } catch (error) {
      this.observability.emit({
        event: 'visibility.history.comparison.failed',
        projectId,
        currentSnapshotId,
        status: 'FAILED',
        reasonCode: error instanceof VisibilityHistoryError ? error.code : 'UNEXPECTED_ERROR',
        durationMs: Date.now() - startedAt
      });
      throw error;
    }
  }
}
