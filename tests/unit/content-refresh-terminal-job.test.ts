import { describe, expect, it } from 'vitest';
import { ContentService, type ContentQueue, type ContentRefreshJobData } from '../../src/modules/content/content.service.js';

describe('content refresh terminal job retry', () => {
  it('removes a completed stable-id job before enqueueing its replacement', async () => {
    const calls: string[] = [];
    let removed = false;
    const queue: ContentQueue = {
      async getJob() {
        return {
          async getState() { return 'completed'; },
          async remove() {
            calls.push('remove');
            removed = true;
          }
        };
      },
      async add(_name: string, _data: ContentRefreshJobData, _options) {
        if (!removed) throw new Error('terminal job must be removed before reusing its stable id');
        calls.push('add');
        return {};
      }
    };

    const service = new ContentService(queue);
    const result = await service.enqueueRefresh('project-1');

    expect(result).toEqual({ jobId: 'content-refresh-project-1', deduplicated: false });
    expect(calls).toEqual(['remove', 'add']);
  });
});
