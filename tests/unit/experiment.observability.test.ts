import { describe, expect, it } from 'vitest';
import {
  ExperimentObservability,
  type ExperimentObservabilityEvent
} from '../../src/modules/optimization-experiments/experiment.observability.js';

describe('P9-D experiment observability contract', () => {
  it('emits only allowlisted bounded metadata', () => {
    const events: ExperimentObservabilityEvent[] = [];
    const observability = new ExperimentObservability((event) => events.push(event));

    observability.emit({
      event: 'optimization.experiment.evaluated',
      projectId: 'project-1\nforged',
      optimizationPlanId: 'plan-1',
      publicationExecutionId: 'execution-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      windowType: '14D',
      effectState: 'POSITIVE',
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      reasonCode: 'PRIMARY_METRIC_IMPROVED',
      marketCode: 'HK',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      articleBody: 'page body must never be emitted',
      prompt: 'prompt text must never be emitted',
      rawProviderPayload: { secret: 'provider raw data' },
      credential: 'token=secret'
    } as never);

    expect(events).toEqual([{
      event: 'optimization.experiment.evaluated',
      projectId: 'project-1 forged',
      optimizationPlanId: 'plan-1',
      publicationExecutionId: 'execution-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      windowType: '14D',
      effectState: 'POSITIVE',
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      reasonCode: 'PRIMARY_METRIC_IMPROVED',
      marketCode: 'HK',
      provider: 'GOOGLE_SEARCH_CONSOLE'
    }]);

    const serialized = JSON.stringify(events);
    for (const forbidden of [
      'page body',
      'prompt text',
      'provider raw data',
      'token=secret',
      'articleBody',
      'rawProviderPayload',
      'credential'
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('accepts exactly the five approved lifecycle event names', () => {
    const events: ExperimentObservabilityEvent[] = [];
    const observability = new ExperimentObservability((event) => events.push(event));
    const names = [
      'optimization.experiment.started',
      'optimization.experiment.deferred',
      'optimization.experiment.observation.created',
      'optimization.experiment.evaluated',
      'optimization.experiment.inconclusive'
    ] as const;

    for (const event of names) {
      observability.emit({ event, projectId: 'project-1' });
    }

    expect(events.map((event) => event.event)).toEqual(names);
  });
});
