import type {
  OfficialSearchBindingProvider,
  OfficialSearchSyncFailureReason,
  OfficialSearchSyncState,
} from './official-search-sync.types.js';

export const OFFICIAL_SEARCH_SYNC_OBSERVABILITY_EVENTS = [
  'official_search.sync.started',
  'official_search.sync.completed',
  'official_search.sync.failed',
] as const;

export type OfficialSearchSyncObservabilityEventName =
  typeof OFFICIAL_SEARCH_SYNC_OBSERVABILITY_EVENTS[number];

export type OfficialSearchSyncObservabilityEvent = {
  event: OfficialSearchSyncObservabilityEventName;
  projectId?: string;
  bindingId?: string;
  provider?: OfficialSearchBindingProvider;
  dateFrom?: string;
  dateTo?: string;
  state?: OfficialSearchSyncState;
  reason?: OfficialSearchSyncFailureReason;
  sourceCount?: number;
  snapshotCount?: number;
  durationMs?: number;
};

export type OfficialSearchSyncObservabilitySink = (
  event: OfficialSearchSyncObservabilityEvent,
) => void;

const STRING_FIELDS = [
  'projectId',
  'bindingId',
  'provider',
  'dateFrom',
  'dateTo',
  'state',
  'reason',
] as const;
const NUMBER_FIELDS = ['sourceCount', 'snapshotCount', 'durationMs'] as const;

function cleanString(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class OfficialSearchSyncObservability {
  constructor(
    private readonly sink: OfficialSearchSyncObservabilitySink = (event) => console.info(event),
  ) {}

  emit(input: OfficialSearchSyncObservabilityEvent): void {
    const safe: OfficialSearchSyncObservabilityEvent = { event: input.event };
    for (const field of STRING_FIELDS) {
      const value = input[field];
      if (typeof value === 'string' && value.length > 0) {
        (safe as Record<string, unknown>)[field] = cleanString(value);
      }
    }
    for (const field of NUMBER_FIELDS) {
      const value = input[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        (safe as Record<string, unknown>)[field] = value;
      }
    }
    this.sink(safe);
  }
}

export const officialSearchSyncObservability = new OfficialSearchSyncObservability();
