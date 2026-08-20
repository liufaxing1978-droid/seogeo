import { describe, expect, it } from 'vitest';
import {
  aggregateQueryPageFacts,
  assessStableWindowCoverage,
  resolveStableWindows
} from '../../src/modules/growth/gsc-window.js';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

describe('P7-A stable GSC windows', () => {
  it('resolves the frozen 28-day current and previous windows after excluding the latest 3 calendar days', () => {
    expect(resolveStableWindows(new Date('2026-08-20T12:00:00.000Z'))).toEqual({
      cutoffDate: '2026-08-17',
      current: { start: '2026-07-21', end: '2026-08-17' },
      previous: { start: '2026-06-23', end: '2026-07-20' }
    });
  });

  it('requires one selected COMPLETED daily source snapshot for all 56 expected dates', () => {
    const windows = resolveStableWindows(new Date('2026-08-20T12:00:00.000Z'));
    const expectedDates = [
      ...enumerateDates(windows.previous.start, windows.previous.end),
      ...enumerateDates(windows.current.start, windows.current.end)
    ];
    const snapshots = expectedDates.map((date, index) => ({
      id: `snapshot-${index + 1}`,
      date,
      status: 'COMPLETED' as const,
      syncVersion: 1
    }));

    expect(assessStableWindowCoverage(windows, snapshots)).toMatchObject({
      state: 'ELIGIBLE',
      expectedDateCount: 56,
      selectedCompletedDateCount: 56
    });
  });

  it('treats a missing or FAILED source day as incomplete instead of a zero-impression day', () => {
    const windows = resolveStableWindows(new Date('2026-08-20T12:00:00.000Z'));
    const expectedDates = [
      ...enumerateDates(windows.previous.start, windows.previous.end),
      ...enumerateDates(windows.current.start, windows.current.end)
    ];
    const complete = expectedDates.map((date, index) => ({
      id: `snapshot-${index + 1}`,
      date,
      status: 'COMPLETED' as const,
      syncVersion: 1
    }));

    const missing = complete.slice(1);
    expect(assessStableWindowCoverage(windows, missing)).toMatchObject({
      state: 'INELIGIBLE',
      expectedDateCount: 56,
      selectedCompletedDateCount: 55
    });

    const failed = complete.map((row, index) => index === 10 ? { ...row, status: 'FAILED' as const } : row);
    expect(assessStableWindowCoverage(windows, failed)).toMatchObject({
      state: 'INELIGIBLE',
      expectedDateCount: 56,
      selectedCompletedDateCount: 55
    });
  });
});

describe('P7-A Query+Page aggregation', () => {
  it('groups by normalized Query + canonical Page, recomputes CTR from totals, and impression-weights position', () => {
    const facts = [
      {
        date: '2026-08-16',
        normalizedQuery: '六壬 seo',
        canonicalPage: 'https://example.com/liuren',
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 4
      },
      {
        date: '2026-08-17',
        normalizedQuery: '六壬 seo',
        canonicalPage: 'https://example.com/liuren',
        clicks: 0,
        impressions: 300,
        ctr: 0,
        position: 8
      },
      {
        date: '2026-08-17',
        normalizedQuery: '六壬 seo',
        canonicalPage: 'https://example.com/other',
        clicks: 2,
        impressions: 20,
        ctr: 0.1,
        position: 12
      }
    ];

    const aggregates = aggregateQueryPageFacts(facts);

    expect(aggregates).toHaveLength(2);
    expect(aggregates).toContainEqual(expect.objectContaining({
      normalizedQuery: '六壬 seo',
      canonicalPage: 'https://example.com/liuren',
      clicks: 10,
      impressions: 400,
      ctr: 0.025,
      position: 7
    }));
    expect(aggregates).toContainEqual(expect.objectContaining({
      normalizedQuery: '六壬 seo',
      canonicalPage: 'https://example.com/other',
      clicks: 2,
      impressions: 20,
      ctr: 0.1,
      position: 12
    }));
  });
});
