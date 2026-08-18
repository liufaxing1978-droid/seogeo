import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '../../src/queue/queues.js';

describe('queue registry', () => {
  it('uses the agreed queue names without duplicates', () => {
    expect(QUEUE_NAMES).toEqual(['crawl', 'seo-audit', 'geo-audit', 'visibility', 'ai', 'report']);
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
  });
});
