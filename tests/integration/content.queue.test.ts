import type { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { ContentService, type ContentRefreshJobData } from '../../src/modules/content/content.service.js';

describe('P5-A content refresh queue', () => {
  it('uses a stable logical job id and deduplicates active work', async () => {
    const added: Array<{ name: string; data: ContentRefreshJobData; options: Record<string, unknown> }> = [];
    let state: string | null = null;
    const queue = {
      async getJob() {
        if (!state) return undefined;
        return { async getState() { return state; } };
      },
      async add(name: string, data: ContentRefreshJobData, options: Record<string, unknown>) {
        added.push({ name, data, options });
        state = 'waiting';
        return {};
      }
    } as unknown as Queue<ContentRefreshJobData>;

    const service = new ContentService(queue);
    const first = await service.enqueueRefresh('project-1');
    const second = await service.enqueueRefresh('project-1');

    expect(first).toEqual({ jobId: 'content-refresh-project-1', deduplicated: false });
    expect(second).toEqual({ jobId: 'content-refresh-project-1', deduplicated: true });
    expect(added).toHaveLength(1);
    expect(added[0]?.options).toMatchObject({ jobId: 'content-refresh-project-1', attempts: 1 });
  });
});
