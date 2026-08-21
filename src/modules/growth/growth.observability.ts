export const GROWTH_OBSERVABILITY_EVENTS = [
  'growth.materialization.started',
  'growth.materialization.completed',
  'growth.materialization.failed',
  'growth.lifecycle.changed',
  'growth.ai_explanation.completed',
  'growth.ai_explanation.failed'
] as const;

export type GrowthEvent = typeof GROWTH_OBSERVABILITY_EVENTS[number];

const STRING_FIELDS = new Set([
  'projectId',
  'identityId',
  'status',
  'materializationVersion',
  'formulaVersion',
  'currentWindowStart',
  'currentWindowEnd',
  'previousWindowStart',
  'previousWindowEnd',
  'dataCutoffAt',
  'lifecycleEventType',
  'lifecycleStatus',
  'reasonCode',
  'errorCode'
]);

const NUMBER_FIELDS = new Set([
  'selectedGscSnapshotCount',
  'opportunitySnapshotCount',
  'topicSnapshotCount',
  'durationMs'
]);

function cleanString(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export function serializeGrowthEvent(
  event: GrowthEvent,
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

export function emitGrowthEvent(
  event: GrowthEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializeGrowthEvent(event, fields));
}
