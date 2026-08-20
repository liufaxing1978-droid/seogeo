import type {
  GscCoverageSnapshot,
  QueryPageAggregate,
  QueryPageFactLike,
  StableGrowthWindows,
  StableWindowCoverage
} from './growth.types.js';

export const GROWTH_WINDOW_V1 = {
  days: 28,
  excludeRecentDays: 3
} as const;

function startOfUtcDay(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new RangeError('asOfDate must be a valid date');
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateKey(value: string | Date): string {
  if (typeof value === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`Invalid source date: ${value}`);
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new RangeError(`Invalid source date: ${value}`);
    }
    return value;
  }
  if (Number.isNaN(value.getTime())) throw new RangeError('Source date must be valid');
  return value.toISOString().slice(0, 10);
}

function enumerateRange(start: string, end: string): string[] {
  const first = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  const dates: string[] = [];
  for (let cursor = first; cursor <= last; cursor = addUtcDays(cursor, 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export function resolveStableWindows(asOfDate: Date): StableGrowthWindows {
  const asOfDay = startOfUtcDay(asOfDate);
  const currentEnd = addUtcDays(asOfDay, -GROWTH_WINDOW_V1.excludeRecentDays);
  const currentStart = addUtcDays(currentEnd, -(GROWTH_WINDOW_V1.days - 1));
  const previousEnd = addUtcDays(currentStart, -1);
  const previousStart = addUtcDays(previousEnd, -(GROWTH_WINDOW_V1.days - 1));

  return {
    cutoffDate: currentEnd.toISOString().slice(0, 10),
    current: {
      start: currentStart.toISOString().slice(0, 10),
      end: currentEnd.toISOString().slice(0, 10)
    },
    previous: {
      start: previousStart.toISOString().slice(0, 10),
      end: previousEnd.toISOString().slice(0, 10)
    }
  };
}

export function assessStableWindowCoverage(
  windows: StableGrowthWindows,
  snapshots: readonly GscCoverageSnapshot[]
): StableWindowCoverage {
  const expectedDates = [
    ...enumerateRange(windows.previous.start, windows.previous.end),
    ...enumerateRange(windows.current.start, windows.current.end)
  ];
  const expected = new Set(expectedDates);
  const selected = new Map<string, GscCoverageSnapshot>();

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'COMPLETED') continue;
    const date = dateKey(snapshot.date);
    if (!expected.has(date)) continue;
    const current = selected.get(date);
    if (
      !current ||
      snapshot.syncVersion > current.syncVersion ||
      (snapshot.syncVersion === current.syncVersion && snapshot.id.localeCompare(current.id) > 0)
    ) {
      selected.set(date, snapshot);
    }
  }

  const missingDates = expectedDates.filter((date) => !selected.has(date));
  const selectedSnapshots = expectedDates.flatMap((date) => {
    const snapshot = selected.get(date);
    return snapshot ? [{ id: snapshot.id, date, syncVersion: snapshot.syncVersion }] : [];
  });

  return {
    state: missingDates.length === 0 ? 'ELIGIBLE' : 'INELIGIBLE',
    expectedDateCount: expectedDates.length,
    selectedCompletedDateCount: selectedSnapshots.length,
    missingDates,
    selectedSnapshots
  };
}

type AggregateAccumulator = {
  normalizedQuery: string;
  canonicalPage: string;
  clicks: number;
  impressions: number;
  weightedPosition: number;
};

export function aggregateQueryPageFacts(facts: readonly QueryPageFactLike[]): QueryPageAggregate[] {
  const groups = new Map<string, AggregateAccumulator>();

  for (const fact of facts) {
    const key = JSON.stringify([fact.normalizedQuery, fact.canonicalPage]);
    const current = groups.get(key) ?? {
      normalizedQuery: fact.normalizedQuery,
      canonicalPage: fact.canonicalPage,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0
    };
    current.clicks += fact.clicks;
    current.impressions += fact.impressions;
    current.weightedPosition += fact.position * fact.impressions;
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      normalizedQuery: group.normalizedQuery,
      canonicalPage: group.canonicalPage,
      clicks: group.clicks,
      impressions: group.impressions,
      ctr: group.impressions > 0 ? group.clicks / group.impressions : 0,
      position: group.impressions > 0 ? group.weightedPosition / group.impressions : null
    }))
    .sort((left, right) =>
      left.normalizedQuery.localeCompare(right.normalizedQuery) ||
      left.canonicalPage.localeCompare(right.canonicalPage)
    );
}
