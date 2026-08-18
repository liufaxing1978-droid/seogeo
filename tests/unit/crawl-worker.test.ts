import { describe, expect, it, vi } from 'vitest';
import { processCrawlJob } from '../../src/modules/crawler/crawl.worker.js';

describe('processCrawlJob', () => {
  it('passes crawlRunId to the crawl executor exactly once', async () => {
    const execute = vi.fn(async () => undefined);

    await processCrawlJob({ data: { crawlRunId: 'run-123' } }, execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('run-123');
  });

  it('rejects a malformed job without a crawlRunId', async () => {
    const execute = vi.fn(async () => undefined);

    await expect(processCrawlJob({ data: {} as { crawlRunId: string } }, execute)).rejects.toThrow(
      /crawlRunId/i
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rethrows executor failures so BullMQ records a failed job', async () => {
    const execute = vi.fn(async () => {
      throw new Error('crawl exploded');
    });

    await expect(processCrawlJob({ data: { crawlRunId: 'run-123' } }, execute)).rejects.toThrow(
      'crawl exploded'
    );
  });
});
