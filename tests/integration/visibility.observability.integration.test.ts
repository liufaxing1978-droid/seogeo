import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import type { VisibilityProviderAdapter, VisibilitySampleRequest, VisibilitySampleResponse } from '../../src/modules/visibility/providers/provider.js';
import { VisibilityProviderRegistry } from '../../src/modules/visibility/providers/provider-registry.js';
import { VisibilityRunService, type VisibilityQueue } from '../../src/modules/visibility/visibility-run.service.js';
import { executeVisibilityObservation } from '../../src/modules/visibility/visibility.worker.js';

// This contract must fail until run/worker lifecycle boundaries emit the safe visibility events below.
class FakeVisibilityQueue implements VisibilityQueue {
  async add(_name: string, _data: { observationId: string }, options: { jobId: string; attempts: number }) {
    return { id: options.jobId };
  }
}

class FixtureAdapter implements VisibilityProviderAdapter {
  readonly provider = 'OPENAI' as const;
  readonly channel = 'API' as const;
  supportsWebGrounding() { return true; }
  estimateCostMicros(_request: VisibilitySampleRequest) { return 1200; }
  async sample(_request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    return {
      status: 'COMPLETED',
      providerResponseId: 'resp-observability',
      answerText: 'Private answer body must never be logged.',
      citations: [],
      searchMetadata: { grounded: true },
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 1200,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 15
    };
  }
}

describe('P6-A visibility lifecycle observability', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('emits run and observation lifecycle events without prompt/answer bodies', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Visibility Observability Lifecycle',
        slug: `visibility-observability-${suffix}`,
        primaryDomain: `visibility-observability-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    await prisma.visibilityProjectSettings.create({
      data: {
        projectId: project.id,
        dailyBudgetMicros: 2_000_000,
        defaultRunBudgetMicros: 500_000,
        maxObservationsPerRun: 10,
        defaultCurrency: 'USD'
      }
    });
    const set = await prisma.visibilityPromptSet.create({ data: { projectId: project.id, name: 'Observability set' } });
    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: set.id,
        promptKey: 'observability',
        version: 1,
        promptText: 'Private prompt body must never be logged.',
        promptHash: `hash-${suffix}`
      }
    });
    const provider = await prisma.visibilityProviderConfig.create({
      data: {
        projectId: project.id,
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 1,
        providerOptionsJson: {}
      }
    });

    const service = new VisibilityRunService(new FakeVisibilityQueue());
    const run = await service.createManualRun(project.id, {
      promptSetId: set.id,
      providerConfigIds: [provider.id],
      maxObservations: 1,
      budgetCeilingMicros: 100_000
    });
    const observation = await prisma.platformObservation.findFirstOrThrow({ where: { visibilityRunId: run.id } });

    await executeVisibilityObservation(observation.id, {
      registry: new VisibilityProviderRegistry([new FixtureAdapter()])
    });

    const emitted = info.mock.calls.map((call) => call[0] as Record<string, unknown>);
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'visibility.run.queued', projectId: project.id, runId: run.id }),
      expect.objectContaining({ event: 'visibility.run.started', projectId: project.id, runId: run.id }),
      expect.objectContaining({
        event: 'visibility.observation.started',
        projectId: project.id,
        runId: run.id,
        observationId: observation.id,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        promptId: prompt.id,
        promptVersion: 1
      }),
      expect.objectContaining({
        event: 'visibility.observation.completed',
        observationId: observation.id,
        status: 'COMPLETED',
        totalTokens: 30,
        searchUnits: 1,
        costMicros: 1200
      }),
      expect.objectContaining({ event: 'visibility.run.completed', runId: run.id, status: 'COMPLETED' })
    ]));

    const serialized = JSON.stringify(emitted);
    expect(serialized).not.toContain('Private prompt body');
    expect(serialized).not.toContain('Private answer body');

    info.mockRestore();
  });
});
