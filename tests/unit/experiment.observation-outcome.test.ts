import { describe, expect, it, vi } from 'vitest';
import {
  OptimizationExperimentRepository,
  type CreateExperimentObservationInput
} from '../../src/modules/optimization-experiments/experiment.repository.js';

type Outcome =
  | { kind: 'CREATED'; observation: Record<string, unknown> }
  | { kind: 'EXISTING'; observation: Record<string, unknown> };

const input: CreateExperimentObservationInput = {
  projectId: 'project-1',
  experimentId: 'experiment-1',
  observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
  observationKey: 'observation-key-1',
  windowType: '7D',
  windowDays: 7,
  dueAt: new Date('2026-08-08T00:00:00.000Z'),
  inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
  baselineSearchSourceRefs: ['SEARCH_FACT:baseline'],
  observedSearchSourceRefs: ['SEARCH_FACT:observed'],
  baselineVisibilitySourceRefs: [],
  observedVisibilitySourceRefs: [],
  baselineMetricsJson: [{ metricKey: 'CTR', value: 0.1 }],
  observedMetricsJson: [{ metricKey: 'CTR', value: 0.2 }],
  deltaMetricsJson: [{ metricKey: 'CTR', absoluteDelta: 0.1 }],
  coverageState: 'SUFFICIENT',
  contaminationState: 'CLEAR',
  effectState: 'POSITIVE',
  reasonCodes: [],
  evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
};

function observation() {
  return {
    id: 'observation-1',
    ...input,
    createdAt: new Date('2026-08-08T12:01:00.000Z')
  };
}

async function createWithOutcome(repository: OptimizationExperimentRepository): Promise<Outcome> {
  return (repository as unknown as {
    createOrGetObservationWithOutcome(
      input: CreateExperimentObservationInput
    ): Promise<Outcome>;
  }).createOrGetObservationWithOutcome(input);
}

describe('P9-D observation persistence outcome', () => {
  it('reports EXISTING when immutable identity already exists', async () => {
    const existing = observation();
    const create = vi.fn();
    const repository = new OptimizationExperimentRepository({
      optimizationExperimentObservation: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create
      }
    } as never);

    await expect(createWithOutcome(repository)).resolves.toEqual({
      kind: 'EXISTING',
      observation: existing
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports CREATED only after a successful immutable insert', async () => {
    const created = observation();
    const repository = new OptimizationExperimentRepository({
      optimizationExperimentObservation: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created)
      }
    } as never);

    await expect(createWithOutcome(repository)).resolves.toEqual({
      kind: 'CREATED',
      observation: created
    });
  });

  it('reports EXISTING after a P2002 race collision and identity re-read', async () => {
    const collided = observation();
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(collided);
    const repository = new OptimizationExperimentRepository({
      optimizationExperimentObservation: {
        findUnique,
        create: vi.fn().mockRejectedValue({ code: 'P2002' })
      }
    } as never);

    await expect(createWithOutcome(repository)).resolves.toEqual({
      kind: 'EXISTING',
      observation: collided
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
