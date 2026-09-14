import { Queue } from 'bullmq';
import { AppError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import { resolveStableWindows } from '../growth/gsc-window.js';
import { SEARCH_CONSOLE_SYNC_QUEUE_NAME, type SearchConsoleSyncJobData } from './search-console.worker.js';

type ActiveProperty = { id: string } | null;

export type SearchConsoleSyncQueue = {
  addBulk(jobs: Array<{
    name: string;
    data: SearchConsoleSyncJobData;
    opts: { jobId: string; attempts: number; removeOnComplete: number; removeOnFail: number };
  }>): Promise<unknown>;
};

export type SearchConsoleSyncServiceDependencies = {
  findActiveProperty(projectId: string): Promise<ActiveProperty>;
  addBulk: SearchConsoleSyncQueue['addBulk'];
};

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = new Date(`${start}T00:00:00.000Z`); cursor <= new Date(`${end}T00:00:00.000Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export class SearchConsoleSyncService {
  constructor(private readonly dependencies: SearchConsoleSyncServiceDependencies) {}

  async enqueueStableWindow(projectId: string, now = new Date()) {
    const property = await this.dependencies.findActiveProperty(projectId);
    if (!property) {
      throw new AppError('Select a Search Console Property before syncing', 409, 'SEARCH_CONSOLE_PROPERTY_REQUIRED');
    }
    const windows = resolveStableWindows(now);
    const dates = enumerateDates(windows.previous.start, windows.current.end);
    await this.dependencies.addBulk(dates.map((date) => ({
      name: 'sync-day',
      data: { projectId, propertyId: property.id, date },
      opts: {
        jobId: `gsc-sync-${projectId}-${property.id}-${date}`,
        attempts: 3,
        removeOnComplete: 100,
        removeOnFail: 100
      }
    })));
    return { propertyId: property.id, queuedDateCount: dates.length };
  }
}

class LazySearchConsoleSyncQueue {
  private queue: Queue<SearchConsoleSyncJobData> | null = null;

  private getQueue() {
    if (!this.queue) this.queue = new Queue<SearchConsoleSyncJobData>(SEARCH_CONSOLE_SYNC_QUEUE_NAME, { connection: createRedisConnection() });
    return this.queue;
  }

  addBulk: SearchConsoleSyncQueue['addBulk'] = (jobs) => this.getQueue().addBulk(jobs);
}

export const searchConsoleSyncService = new SearchConsoleSyncService({
  findActiveProperty: (projectId) => import('../../db/prisma.js').then(({ prisma }) => prisma.searchConsoleProperty.findFirst({
    where: { projectId, isActive: true, connection: { status: 'CONNECTED' } },
    select: { id: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
  })),
  addBulk: new LazySearchConsoleSyncQueue().addBulk
});
