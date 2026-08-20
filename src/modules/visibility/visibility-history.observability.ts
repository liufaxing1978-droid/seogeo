export const P6D_OBSERVABILITY_EVENTS = [
  'visibility.history.comparison.completed',
  'visibility.history.comparison.incomparable',
  'visibility.history.comparison.failed',
  'visibility.alert.triggered',
  'visibility.alert.acknowledged',
  'visibility.alert.resolved',
  'visibility.monitoring.reconcile.completed',
  'report.v2.generated'
] as const;

export type P6DObservabilityEventName = typeof P6D_OBSERVABILITY_EVENTS[number];

export interface P6DObservabilityEventInput extends Record<string, unknown> {
  event: P6DObservabilityEventName;
}

export type P6DObservabilitySink = (event: Record<string, unknown> & { event: P6DObservabilityEventName }) => void;

const STRING_FIELDS = [
  'projectId',
  'currentSnapshotId',
  'previousSnapshotId',
  'comparisonId',
  'ruleId',
  'alertId',
  'metricType',
  'actorKey',
  'status',
  'reasonCode'
] as const;

const NUMBER_FIELDS = [
  'deltaBasisPoints',
  'processedCount',
  'enqueuedCount',
  'alertCount',
  'durationMs'
] as const;

function cleanString(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class VisibilityHistoryObservability {
  constructor(private readonly sink: P6DObservabilitySink = (event) => console.info(event)) {}

  emit(input: P6DObservabilityEventInput): void {
    const event: Record<string, unknown> & { event: P6DObservabilityEventName } = { event: input.event };

    for (const field of STRING_FIELDS) {
      const value = input[field];
      if (typeof value === 'string' && value.length > 0) event[field] = cleanString(value);
    }
    for (const field of NUMBER_FIELDS) {
      const value = input[field];
      if (typeof value === 'number' && Number.isFinite(value)) event[field] = value;
    }

    this.sink(event);
  }
}

export const visibilityHistoryObservability = new VisibilityHistoryObservability();
