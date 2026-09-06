import { describe, expect, it } from 'vitest';
import { ContentQualityObservability } from '../../src/modules/content/content-quality.observability.js';

describe('P13-A content-quality observability', () => {
  it('reconstructs only approved bounded fields from a closed event variant', () => {
    const events: unknown[] = [];
    const observability = new ContentQualityObservability((event) => events.push(event));

    observability.emit({
      event: 'content.quality.queued',
      projectId: 'project\n1',
      runId: 'run\t1',
      unexpected: 'must not escape'
    } as never);

    expect(events).toEqual([{
      event: 'content.quality.queued',
      projectId: 'project 1',
      runId: 'run 1',
      queuedCount: 1
    }]);
  });

  it('bounds materialized finding counters by category and priority', () => {
    const events: unknown[] = [];
    const observability = new ContentQualityObservability((event) => events.push(event));

    observability.emit({
      event: 'content.quality.findings.materialized',
      projectId: 'project-1',
      runId: 'run-1',
      materializedCount: Number.POSITIVE_INFINITY,
      categoryCounts: { internalLinkSupport: -1, contentDecay: 2.8, contentQa: 2_000_000 },
      priorityCounts: { info: 0, low: -10, medium: 3.7, high: 9 }
    } as never);

    expect(events).toEqual([{
      event: 'content.quality.findings.materialized',
      projectId: 'project-1',
      runId: 'run-1',
      materializedCount: 0,
      categoryCounts: { internalLinkSupport: 0, contentDecay: 2, contentQa: 1_000_000 },
      priorityCounts: { info: 0, low: 0, medium: 3, high: 9 }
    }]);
  });
});
