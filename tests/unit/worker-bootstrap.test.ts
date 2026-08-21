import { describe, expect, it } from 'vitest';
import { processGrowthMaterializationJob } from '../../src/modules/growth/growth.worker.js';
import { processVisibilityJob } from '../../src/modules/visibility/visibility.worker.js';
import { processVisibilityMetricsJob } from '../../src/modules/visibility/visibility-metrics.worker.js';
import { workerDefinitionForQueue } from '../../src/queue/worker-bootstrap.js';

describe('worker bootstrap', () => {
  it('activates the reserved visibility queue with the real visibility processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('visibility');

    expect(definition).toMatchObject({
      processor: processVisibilityJob,
      concurrency: 2
    });
  });

  it('activates the P6-C visibility-metrics queue with the database-only processor at concurrency 2', () => {
    const definition = workerDefinitionForQueue('visibility-metrics');

    expect(definition).toMatchObject({
      processor: processVisibilityMetricsJob,
      concurrency: 2
    });
  });

  it('activates the P7-A growth-materialization queue with the database-only processor at concurrency 1', () => {
    const definition = workerDefinitionForQueue('growth-materialization');

    expect(definition).toMatchObject({
      processor: processGrowthMaterializationJob,
      concurrency: 1
    });
  });
});