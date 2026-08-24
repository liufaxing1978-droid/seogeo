import { describe, expect, it } from 'vitest';
import {
  ExperimentObservability,
  type ExperimentObservabilityEvent
} from '../../src/modules/optimization-experiments/experiment.observability.js';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const verifiedAnchorAt = new Date('2026-07-01T00:00:00.000Z');

function searchStartFixture() {
  const candidate = {
    id: 'candidate-1',
    projectId: 'project-1',
    growthSnapshotId: 'growth-snapshot-1',
    marketScopeMode: 'CONFIGURED_MARKET',
    marketCode: 'HK',
    locale: 'zh-Hant',
    normalizedQuery: '興善堂',
    canonicalPage: 'https://example.com/page',
    sourceProvenance: {
      version: 'GROWTH_SEARCH_PROVENANCE_V1',
      mode: 'CONFIGURED_MARKET',
      scoringLane: {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketProjections: [
          { marketCode: 'HK', locale: 'zh-Hant', propertyRef: 'gsc:project-1' }
        ]
      },
      corroboratingLanes: []
    }
  };
  const optimizationPlan = {
    id: 'plan-1',
    recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
    candidate
  };
  return {
    authority: {
      project: { planLevel: 'ADVANCED' },
      execution: { id: 'execution-1', status: 'VERIFIED' },
      verification: {
        id: 'verification-1',
        status: 'VERIFIED',
        observedAt: verifiedAnchorAt,
        observedUrl: 'https://example.com/page'
      },
      proposal: {
        sourceType: 'P9_OPTIMIZATION_PLAN',
        sourceReferenceId: 'plan-1'
      },
      publicationPlan: { targetPublicUrl: 'https://example.com/page' }
    },
    context: {
      proposal: {
        sourceType: 'P9_OPTIMIZATION_PLAN',
        sourceReferenceId: 'plan-1'
      },
      optimizationPlan,
      execution: { id: 'execution-1' },
      verification: {
        id: 'verification-1',
        observedAt: verifiedAnchorAt
      }
    }
  };
}

function captureEvents(service: OptimizationExperimentService): ExperimentObservabilityEvent[] {
  const events: ExperimentObservabilityEvent[] = [];
  const observability = new ExperimentObservability((event) => events.push(event));
  (service as unknown as { observability: ExperimentObservability }).observability = observability;
  return events;
}

describe('P9-D start lifecycle observability', () => {
  it('emits one bounded deferred event with the exact reason code', async () => {
    const repository = {
      inspectStartAuthority: async () => null
    };
    const service = new OptimizationExperimentService(repository as never);
    const events = captureEvents(service);

    const result = await service.startFromVerifiedExecution({
      projectId: 'project-1',
      publicationExecutionId: 'execution-1'
    });

    expect(result).toEqual({
      kind: 'DEFERRED',
      reasonCode: 'EXPERIMENT_P9_SOURCE_MISMATCH'
    });
    expect(events).toEqual([{
      event: 'optimization.experiment.deferred',
      projectId: 'project-1',
      publicationExecutionId: 'execution-1',
      reasonCode: 'EXPERIMENT_P9_SOURCE_MISMATCH'
    }]);
  });

  it('emits started only for a newly created experiment and not for idempotent EXISTING reuse', async () => {
    const fixture = searchStartFixture();
    let existing: Record<string, unknown> | null = null;
    const experiment = { id: 'experiment-1' };
    const repository = {
      inspectStartAuthority: async () => fixture.authority,
      loadVerifiedStartContext: async () => fixture.context,
      findExperimentForStart: async () => existing,
      createOrGetExperiment: async () => experiment
    };
    const service = new OptimizationExperimentService(repository as never);
    const events = captureEvents(service);

    const started = await service.startFromVerifiedExecution({
      projectId: 'project-1',
      publicationExecutionId: 'execution-1'
    });
    expect(started).toEqual({ kind: 'STARTED', experiment });
    expect(events).toEqual([{
      event: 'optimization.experiment.started',
      projectId: 'project-1',
      optimizationPlanId: 'plan-1',
      publicationExecutionId: 'execution-1',
      experimentId: 'experiment-1',
      marketCode: 'HK',
      provider: 'GOOGLE_SEARCH_CONSOLE'
    }]);

    existing = experiment;
    const reused = await service.startFromVerifiedExecution({
      projectId: 'project-1',
      publicationExecutionId: 'execution-1'
    });
    expect(reused).toEqual({ kind: 'EXISTING', experiment });
    expect(events).toHaveLength(1);
  });
});
