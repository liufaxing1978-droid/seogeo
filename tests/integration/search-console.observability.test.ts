import { describe, expect, it } from 'vitest';
import {
  SEARCH_CONSOLE_OBSERVABILITY_EVENTS,
  SearchConsoleObservability
} from '../../src/modules/search-console/search-console.observability.js';

describe('P7-A Search Console safe observability', () => {
  it('exposes only the final allowlisted Search Console event catalog', () => {
    expect([...SEARCH_CONSOLE_OBSERVABILITY_EVENTS]).toEqual([
      'gsc.connection.connected',
      'gsc.connection.revoked',
      'gsc.property.bound',
      'gsc.sync.started',
      'gsc.sync.completed',
      'gsc.sync.failed'
    ]);
  });

  it('keeps only bounded scalar metadata and drops credentials, account payloads, queries and arbitrary fields', () => {
    const emitted: unknown[] = [];
    const observability = new SearchConsoleObservability((event) => emitted.push(event));

    observability.emit({
      event: 'gsc.property.bound',
      projectId: 'project-1\nforged',
      propertyId: 'property-1',
      date: '2026-08-21',
      rowCount: 42,
      durationMs: 75,
      state: 'READY',
      reason: 'PROPERTY_BOUND',
      access_token: 'ACCESS_SECRET',
      refresh_token: 'REFRESH_SECRET',
      clientSecret: 'CLIENT_SECRET',
      googleAccountCredentialPayload: { email: 'private@example.com' },
      queries: ['sensitive query'],
      evidence: [{ private: true }],
      arbitrary: 'DROP_ME'
    } as any);

    expect(emitted).toEqual([{
      event: 'gsc.property.bound',
      projectId: 'project-1 forged',
      propertyId: 'property-1',
      date: '2026-08-21',
      state: 'READY',
      reason: 'PROPERTY_BOUND',
      rowCount: 42,
      durationMs: 75
    }]);
    expect(JSON.stringify(emitted)).not.toMatch(/ACCESS_SECRET|REFRESH_SECRET|CLIENT_SECRET|private@example|sensitive query|DROP_ME/);
  });
});
