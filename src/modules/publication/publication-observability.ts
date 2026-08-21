export const PUBLICATION_OBSERVABILITY_EVENTS = [
  'mutation.execution.started',
  'mutation.execution.applied',
  'mutation.execution.failed'
] as const;

export type PublicationObservabilityEvent = typeof PUBLICATION_OBSERVABILITY_EVENTS[number];

const STRING_FIELDS = new Set([
  'projectId',
  'executionId',
  'status',
  'capability',
  'reasonCode',
  'errorCode'
]);

const NUMBER_FIELDS = new Set([
  'pullRequestNo',
  'durationMs'
]);

function cleanString(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export function serializePublicationEvent(
  event: PublicationObservabilityEvent,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (STRING_FIELDS.has(key)) {
      if (typeof value === 'string' && value.length > 0) serialized[key] = cleanString(value);
      continue;
    }
    if (NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
      serialized[key] = value;
    }
  }
  return serialized;
}

export function emitPublicationEvent(
  event: PublicationObservabilityEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializePublicationEvent(event, fields));
}
