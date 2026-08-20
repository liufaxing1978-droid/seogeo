export type VisibilityMetricsEvent =
  | 'visibility.metrics.queued'
  | 'visibility.metrics.started'
  | 'visibility.metrics.completed'
  | 'visibility.metrics.failed';

const ALLOWED_FIELDS = new Set([
  'projectId',
  'snapshotId',
  'formulaVersion',
  'extractorVersion',
  'subjectSetHash',
  'scopeHash',
  'status',
  'candidateCount',
  'eligibleCount',
  'unknownCount',
  'notEligibleCount',
  'errorCode',
  'durationMs'
]);

export function serializeVisibilityMetricsEvent(
  event: VisibilityMetricsEvent,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
    serialized[key] = value;
  }
  return serialized;
}

export function emitVisibilityMetricsEvent(
  event: VisibilityMetricsEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializeVisibilityMetricsEvent(event, fields));
}
