export const SEARCH_CONSOLE_OBSERVABILITY_EVENTS = [
  'gsc.connection.connected',
  'gsc.connection.revoked',
  'gsc.property.bound',
  'gsc.sync.started',
  'gsc.sync.completed',
  'gsc.sync.failed'
] as const;

export type SearchConsoleObservabilityEventName = typeof SEARCH_CONSOLE_OBSERVABILITY_EVENTS[number];

export type SearchConsoleObservabilityEvent = {
  event: SearchConsoleObservabilityEventName;
  projectId?: string;
  propertyId?: string;
  date?: string;
  rowCount?: number;
  durationMs?: number;
  state?: string;
  reason?: string;
};

export type SearchConsoleObservabilitySink = (event: SearchConsoleObservabilityEvent) => void;

const STRING_FIELDS = ['projectId', 'propertyId', 'date', 'state', 'reason'] as const;
const NUMBER_FIELDS = ['rowCount', 'durationMs'] as const;

function cleanString(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class SearchConsoleObservability {
  constructor(private readonly sink: SearchConsoleObservabilitySink = (event) => console.info(event)) {}

  emit(input: SearchConsoleObservabilityEvent): void {
    const safe: SearchConsoleObservabilityEvent = { event: input.event };
    for (const field of STRING_FIELDS) {
      const value = input[field];
      if (typeof value === 'string' && value.length > 0) safe[field] = cleanString(value);
    }
    for (const field of NUMBER_FIELDS) {
      const value = input[field];
      if (typeof value === 'number' && Number.isFinite(value)) safe[field] = value;
    }
    this.sink(safe);
  }
}

export const searchConsoleObservability = new SearchConsoleObservability();
