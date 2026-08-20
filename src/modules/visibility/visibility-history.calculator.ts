import {
  VisibilityHistoryError,
  type VisibilityHistoryDeltaRow,
  type VisibilityHistoryMetricRowInput,
  type VisibilityHistorySnapshotContract
} from './visibility-history.types.js';

function validWindow(snapshot: VisibilityHistorySnapshotContract) {
  const start = snapshot.windowStart.getTime();
  const end = snapshot.windowEnd.getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start;
}

export function assertComparableSnapshots(
  current: VisibilityHistorySnapshotContract,
  previous: VisibilityHistorySnapshotContract
): { windowDurationMs: number; gapDurationMs: number } {
  if (current.projectId !== previous.projectId) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_PROJECT_MISMATCH',
      'Visibility history snapshots belong to different projects'
    );
  }
  if (current.formulaVersion !== previous.formulaVersion) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_FORMULA_MISMATCH',
      'Visibility history formula versions do not match'
    );
  }
  if (current.extractorVersion !== previous.extractorVersion) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_EXTRACTOR_MISMATCH',
      'Visibility history extractor versions do not match'
    );
  }
  if (current.subjectSetHash !== previous.subjectSetHash) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_SUBJECT_SET_MISMATCH',
      'Visibility history subject sets do not match'
    );
  }
  if (current.scopeHash !== previous.scopeHash) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_SCOPE_MISMATCH',
      'Visibility history scopes do not match'
    );
  }
  if (!validWindow(current) || !validWindow(previous)) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_WINDOW_MISMATCH',
      'Visibility history measurement window is invalid'
    );
  }

  const currentDuration = current.windowEnd.getTime() - current.windowStart.getTime();
  const previousDuration = previous.windowEnd.getTime() - previous.windowStart.getTime();
  if (currentDuration !== previousDuration) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_WINDOW_MISMATCH',
      'Visibility history measurement window durations do not match'
    );
  }
  if (previous.windowEnd.getTime() > current.windowStart.getTime()) {
    throw new VisibilityHistoryError(
      'VISIBILITY_HISTORY_WINDOW_OVERLAP',
      'Visibility history measurement windows overlap'
    );
  }

  return {
    windowDurationMs: currentDuration,
    gapDurationMs: current.windowStart.getTime() - previous.windowEnd.getTime()
  };
}

function rowIdentity(row: VisibilityHistoryMetricRowInput) {
  return [row.metricType, row.dimensionType, row.dimensionKey, row.actorKey].join('\u0000');
}

function numericRatio(row: VisibilityHistoryMetricRowInput): number | null {
  if (row.metricStatus !== 'CALCULATED' || row.denominator <= 0) return null;
  return row.numerator / row.denominator;
}

function indexRows(rows: VisibilityHistoryMetricRowInput[]) {
  const indexed = new Map<string, VisibilityHistoryMetricRowInput>();
  for (const row of rows) indexed.set(rowIdentity(row), row);
  return indexed;
}

export function calculateVisibilityHistoryDeltaRows(input: {
  currentRows: VisibilityHistoryMetricRowInput[];
  previousRows: VisibilityHistoryMetricRowInput[];
}): VisibilityHistoryDeltaRow[] {
  const currentByIdentity = indexRows(input.currentRows);
  const previousByIdentity = indexRows(input.previousRows);
  const identities = [...new Set([
    ...currentByIdentity.keys(),
    ...previousByIdentity.keys()
  ])].sort();

  const result: VisibilityHistoryDeltaRow[] = [];
  for (const identity of identities) {
    const current = currentByIdentity.get(identity);
    const previous = previousByIdentity.get(identity);
    if (!current || !previous) {
      throw new VisibilityHistoryError(
        'VISIBILITY_HISTORY_ROW_MISSING',
        'Visibility history comparison row identity is missing on one side'
      );
    }

    const currentRatio = numericRatio(current);
    const previousRatio = numericRatio(previous);
    result.push({
      metricType: current.metricType,
      dimensionType: current.dimensionType,
      dimensionKey: current.dimensionKey,
      actorType: current.actorType,
      actorSubjectId: current.actorSubjectId,
      actorKey: current.actorKey,
      previousMetricStatus: previous.metricStatus,
      currentMetricStatus: current.metricStatus,
      previousNumerator: previous.numerator,
      previousDenominator: previous.denominator,
      currentNumerator: current.numerator,
      currentDenominator: current.denominator,
      deltaBasisPoints: currentRatio === null || previousRatio === null
        ? null
        : Math.round((currentRatio - previousRatio) * 10_000)
    });
  }
  return result;
}

function coverageBasisPoints(candidateCount: number, completedCount: number): number | null {
  if (candidateCount <= 0) return null;
  return Math.round((completedCount / candidateCount) * 10_000);
}

export function calculateCoverageBasisPoints(input: {
  currentCandidateCount: number;
  currentCompletedCount: number;
  previousCandidateCount: number;
  previousCompletedCount: number;
}): {
  currentBasisPoints: number | null;
  previousBasisPoints: number | null;
  deltaBasisPoints: number | null;
} {
  const currentBasisPoints = coverageBasisPoints(
    input.currentCandidateCount,
    input.currentCompletedCount
  );
  const previousBasisPoints = coverageBasisPoints(
    input.previousCandidateCount,
    input.previousCompletedCount
  );
  return {
    currentBasisPoints,
    previousBasisPoints,
    deltaBasisPoints: currentBasisPoints === null || previousBasisPoints === null
      ? null
      : currentBasisPoints - previousBasisPoints
  };
}
