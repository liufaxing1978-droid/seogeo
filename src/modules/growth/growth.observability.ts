export type GrowthEvent =
  | 'growth.materialization.started'
  | 'growth.materialization.completed'
  | 'growth.materialization.failed'
  | 'growth.lifecycle.changed';

const ALLOWED_FIELDS = new Set([
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
  'selectedGscSnapshotCount',
  'opportunitySnapshotCount',
  'topicSnapshotCount',
  'lifecycleEventType',
  'lifecycleStatus',
  'reasonCode',
  'errorCode',
  'durationMs'
]);

export function serializeGrowthEvent(
  event: GrowthEvent,
  fields: Record<string, unknown>
): Record<string, unknown> {
  const serialized: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_FIELDS.has(key) || value === undefined) continue;
    serialized[key] = value;
  }
  return serialized;
}

export function emitGrowthEvent(
  event: GrowthEvent,
  fields: Record<string, unknown>
): void {
  console.info(serializeGrowthEvent(event, fields));
}
