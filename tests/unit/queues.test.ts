import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES } from '../../src/queue/queues.js';

describe('queue registry', () => {
  it('uses the current platform queue names without duplicates', () => {
    expect(QUEUE_NAMES).toEqual([
      'crawl',
      'seo-audit',
      'geo-audit',
      'content',
      'competitor',
      'search-console-sync',
      'growth-materialization',
      'optimization-planning',
      'optimization-orchestration',
      'optimization-automation',
      'optimization-autopilot',
      'optimization-experiment-evaluation',
      'optimization-feedback-materialization',
      'visibility',
      'visibility-extraction',
      'visibility-metrics',
      'visibility-monitoring',
      'site-mutation-execution',
      'site-mutation-verification',
      'distribution-preparation',
      'ai',
      'report'
    ]);
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
  });
});