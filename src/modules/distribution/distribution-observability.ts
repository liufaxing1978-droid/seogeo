export type DistributionEventName =
  | 'distribution.preparation.started'
  | 'distribution.preparation.completed'
  | 'distribution.preparation.failed'
  | 'distribution.publish.completed'
  | 'distribution.publish.failed'
  | 'distribution.artifact.outdated';

export type DistributionEventFields = Record<string, unknown>;

const STRING_FIELDS = [
  'projectId',
  'targetId',
  'artifactId',
  'publicationId',
  'platform',
  'mode',
  'status',
  'reasonCode',
  'errorCode'
] as const;
const NUMBER_FIELDS = ['sourceContentVersion', 'durationMs'] as const;

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 300);
  return cleaned || undefined;
}

export function serializeDistributionEvent(
  event: DistributionEventName,
  fields: DistributionEventFields
): Record<string, string | number> {
  const payload: Record<string, string | number> = { event };
  for (const key of STRING_FIELDS) {
    const value = safeString(fields[key]);
    if (value !== undefined) payload[key] = value;
  }
  for (const key of NUMBER_FIELDS) {
    const value = fields[key];
    if (typeof value === 'number' && Number.isFinite(value)) payload[key] = value;
  }
  return payload;
}

export interface DistributionObservability {
  emit(event: DistributionEventName, fields: DistributionEventFields): void;
}

export const distributionObservability: DistributionObservability = {
  emit(event, fields) {
    console.info(JSON.stringify(serializeDistributionEvent(event, fields)));
  }
};
