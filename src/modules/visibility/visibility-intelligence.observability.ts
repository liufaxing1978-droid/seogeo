export type VisibilityIntelligenceEvent =
  | 'visibility.extraction.queued'
  | 'visibility.extraction.started'
  | 'visibility.extraction.completed'
  | 'visibility.extraction.failed'
  | 'visibility.extraction.backfill_queued'
  | 'visibility.subject.created'
  | 'visibility.subject.archived'
  | 'visibility.subject.alias_added'
  | 'visibility.subject.alias_ambiguous';

const ALLOWED_FIELDS = new Set([
  'projectId',
  'observationId',
  'extractionId',
  'subjectId',
  'extractorVersion',
  'subjectSetHash',
  'status',
  'mentionStatus',
  'citationStatus',
  'mentionCount',
  'citationCount',
  'enqueuedCount',
  'errorCode',
  'durationMs'
]);

export function serializeVisibilityIntelligenceEvent(
  event: VisibilityIntelligenceEvent,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
    serialized[key] = value;
  }
  return serialized;
}

export function emitVisibilityIntelligenceEvent(
  event: VisibilityIntelligenceEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializeVisibilityIntelligenceEvent(event, fields));
}
