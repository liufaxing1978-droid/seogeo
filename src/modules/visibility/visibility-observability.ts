export type VisibilityObservabilityEvent =
  | 'visibility.run.queued'
  | 'visibility.run.started'
  | 'visibility.observation.started'
  | 'visibility.observation.completed'
  | 'visibility.observation.unsupported'
  | 'visibility.observation.failed'
  | 'visibility.run.completed'
  | 'visibility.run.partial'
  | 'visibility.run.failed';

const ALLOWED_FIELDS = new Set([
  'projectId',
  'runId',
  'observationId',
  'provider',
  'model',
  'channel',
  'promptId',
  'promptVersion',
  'status',
  'errorCode',
  'latencyMs',
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'searchUnits',
  'costMicros'
]);

export function serializeVisibilityEvent(
  event: VisibilityObservabilityEvent,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
    serialized[key] = value;
  }
  return serialized;
}

export function emitVisibilityEvent(
  event: VisibilityObservabilityEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializeVisibilityEvent(event, fields));
}
