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
});
