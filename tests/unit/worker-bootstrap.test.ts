import { describe, expect, it } from 'vitest';
import { processVisibilityJob } from '../../src/modules/visibility/visibility.worker.js';
import { workerDefinitionForQueue } from '../../src/queue/worker-bootstrap.js';

describe('P6-A visibility worker bootstrap', () => {
  it('activates the reserved visibility queue with the real visibility processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('visibility');

    expect(definition).toMatchObject({
      processor: processVisibilityJob,
      concurrency: 2
    });
  });
});
