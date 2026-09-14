import { describe, expect, test } from 'vitest';
import { SearchConsoleSyncService } from '../../src/modules/search-console/search-console-sync.service.js';

describe('SearchConsoleSyncService', () => {
  test('queues the two stable 28-day windows for the active Property', async () => {
    const queued: Array<{ name: string; data: { projectId: string; propertyId: string; date: string }; opts: { jobId: string } }> = [];
    const service = new SearchConsoleSyncService({
      findActiveProperty: async () => ({ id: 'property-1' }),
      addBulk: async (jobs) => { queued.push(...jobs); }
    });

    const result = await service.enqueueStableWindow('project-1', new Date('2026-09-14T12:00:00.000Z'));

    expect(result).toEqual({ propertyId: 'property-1', queuedDateCount: 56 });
    expect(queued).toHaveLength(56);
    expect(queued[0]).toMatchObject({
      name: 'sync-day',
      data: { projectId: 'project-1', propertyId: 'property-1', date: '2026-07-18' },
      opts: { jobId: 'gsc-sync-project-1-property-1-2026-07-18' }
    });
    expect(queued.at(-1)).toMatchObject({ data: { date: '2026-09-11' } });
  });

  test('does not enqueue work until an active property is selected', async () => {
    const service = new SearchConsoleSyncService({
      findActiveProperty: async () => null,
      addBulk: async () => {
        throw new Error('must not enqueue without a property');
      }
    });

    await expect(service.enqueueStableWindow('project-1')).rejects.toMatchObject({
      code: 'SEARCH_CONSOLE_PROPERTY_REQUIRED',
      status: 409
    });
  });
});
