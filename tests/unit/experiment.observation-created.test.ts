import { describe, expect, it } from 'vitest';
import {
  ExperimentObservability,
  type ExperimentObservabilityEvent
} from '../../src/modules/optimization-experiments/experiment.observability.js';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const verifiedAnchorAt = new Date('2026-08-01T00:00:00.000Z');

function frozenSearchExperiment() {
  return {
    id: 'experiment-1',
    projectId: 'project-1',
    publicationExecutionId: 'execution-1',
    interventionType: 'SERP_SNIPPET_OPTIMIZATION',
    targetUrl: 'https://example.com/page',
    verifiedAnchorAt,
    measurementScopeJson: {
      kind: 'SEARCH',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'gsc:property:1',
      normalizedQuery: '興善堂',
      canonicalPage: 'https://example.com/page',
      aggregationScope: 'QUERY_PAGE'
    },
    observationScheduleJson: [{ windowType: '7D', windowDays: 7 }],
    expectedDirectionJson: { CTR: 'HIGHER' }
  };
}

function observation(input: Record<string, unknown>) {
  return {
    id: 'observation-1',
    createdAt: new Date('2026-08-08T12:01:00.000Z'),
    ...input
  };
}

function serviceFixture(outcomeKind: 'CREATED' | 'EXISTING') {
  const lifecycle: string[] = [];
  const events: ExperimentObservabilityEvent[] = [];
  let legacyCalls = 0;
  let outcomeCalls = 0;
  const observability = new ExperimentObservability((event) => {
    lifecycle.push(`event:${event.event}`);
    events.push(event);
  });
  const repository = {
    findExperimentForEvaluation: async () => frozenSearchExperiment(),
    listPublicationEvents: async () => [],
    createOrGetObservation: async (input: Record<string, unknown>) => {
      legacyCalls += 1;
      lifecycle.push('persisted:LEGACY');
      return observation(input);
    },
    createOrGetObservationWithOutcome: async (input: Record<string, unknown>) => {
      outcomeCalls += 1;
      lifecycle.push(`persisted:${outcomeKind}`);
      return {
        kind: outcomeKind,
        observation: observation(input)
      };
    }
  };
  const service = new OptimizationExperimentService(repository as never, undefined, observability);
  (service as unknown as { searchSource: unknown }).searchSource = {
    listCompletedFacts: async () => []
  };
  (service as unknown as { now: () => Date }).now = () => new Date(
    verifiedAnchorAt.getTime() + 8 * DAY_MS
  );

  return {
    service,
    lifecycle,
    events,
    calls: () => ({ legacyCalls, outcomeCalls })
  };
}

async function evaluate(service: OptimizationExperimentService) {
  return (service as unknown as {
    evaluateWindow(input: {
      projectId: string;
      experimentId: string;
      windowType: '7D';
    }): Promise<Record<string, unknown> | null>;
  }).evaluateWindow({
    projectId: 'project-1',
    experimentId: 'experiment-1',
    windowType: '7D'
  });
}

describe('P9-D observation created lifecycle observability', () => {
  it('emits observation.created only after a CREATED persistence outcome and before inconclusive', async () => {
    const fixture = serviceFixture('CREATED');

    await expect(evaluate(fixture.service)).resolves.toMatchObject({ id: 'observation-1' });

    expect(fixture.calls()).toEqual({ legacyCalls: 0, outcomeCalls: 1 });
    expect(fixture.lifecycle).toEqual([
      'persisted:CREATED',
      'event:optimization.experiment.observation.created',
      'event:optimization.experiment.inconclusive'
    ]);
    expect(fixture.events[0]).toEqual({
      event: 'optimization.experiment.observation.created',
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      windowType: '7D'
    });
    expect(fixture.events[1]).toMatchObject({
      event: 'optimization.experiment.inconclusive',
      projectId: 'project-1',
      experimentId: 'experiment-1',
      observationId: 'observation-1',
      windowType: '7D',
      effectState: 'INCONCLUSIVE',
      coverageState: 'INSUFFICIENT',
      contaminationState: 'CLEAR'
    });
  });

  it('keeps observation.created silent for an EXISTING idempotent persistence outcome', async () => {
    const fixture = serviceFixture('EXISTING');

    await expect(evaluate(fixture.service)).resolves.toMatchObject({ id: 'observation-1' });

    expect(fixture.calls()).toEqual({ legacyCalls: 0, outcomeCalls: 1 });
    expect(fixture.lifecycle).toEqual([
      'persisted:EXISTING',
      'event:optimization.experiment.inconclusive'
    ]);
    expect(fixture.events.map((event) => event.event)).toEqual([
      'optimization.experiment.inconclusive'
    ]);
  });
});
