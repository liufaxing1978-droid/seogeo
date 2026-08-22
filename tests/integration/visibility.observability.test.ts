import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  VisibilityProviderError,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from '../../src/modules/visibility/providers/provider.js';
import { VisibilityProviderRegistry } from '../../src/modules/visibility/providers/provider-registry.js';
import { emitVisibilityEvent, serializeVisibilityEvent } from '../../src/modules/visibility/visibility-observability.js';
import { VisibilityRunService, type VisibilityQueue } from '../../src/modules/visibility/visibility-run.service.js';
import { executeVisibilityObservation } from '../../src/modules/visibility/visibility.worker.js';

class FakeVisibilityQueue implements VisibilityQueue {
  readonly observationIds: string[] = [];
  async add(_name: string, data: { observationId: string }) {
    this.observationIds.push(data.observationId);
    return { id: data.observationId };
  }
}

class FixtureAdapter implements VisibilityProviderAdapter {
  readonly provider = 'OPENAI' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;

  constructor(
    private readonly supported = true,
    private readonly behavior: 'SUCCESS' | 'BY_PROMPT' = 'SUCCESS'
  ) {}

  supportsWebGrounding() { return this.supported; }
  estimateCostMicros() { return 100; }
  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (this.behavior === 'BY_PROMPT' && request.prompt.includes('second')) {
      throw new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', 'fixture provider failure', { httpStatus: 500 });
    }
    return {
      status: 'COMPLETED',
      providerResponseId: 'fixture-response',
      answerText: 'private sampled answer body',
      citations: [],
      citationEvidenceState: 'UNKNOWN',
      searchMetadata: {},
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 100,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 15
    };
  }
}

describe('P6-A visibility observability', () => {
  const projectIds: string[] = [];
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of projectIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  async function createRunFixture(label: string, promptTexts: string[]) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: `Visibility Observability ${label}`, slug: `visibility-observability-${suffix}`, primaryDomain: `visibility-observability-${suffix}.example.com`, planLevel: 'ADVANCED' } });
    projectIds.push(project.id);
    await prisma.visibilityProjectSettings.create({ data: { projectId: project.id, maxObservationsPerRun: 20, defaultCurrency: 'USD' } });
    const promptSet = await prisma.visibilityPromptSet.create({ data: { projectId: project.id, name: `Observability ${label}` } });
    for (const [index, promptText] of promptTexts.entries()) {
      await prisma.visibilityPrompt.create({ data: { projectId: project.id, promptSetId: promptSet.id, promptKey: `prompt-${index + 1}`, version: 1, promptText, promptHash: `hash-${suffix}-${index}` } });
    }
    const provider = await prisma.visibilityProviderConfig.create({ data: { projectId: project.id, provider: 'OPENAI', enabled: true, model: 'gpt-5-mini', channel: 'API', groundingMode: 'WEB_SEARCH', maxConcurrency: 1, providerOptionsJson: {} } });
    const queue = new FakeVisibilityQueue();
    const run = await new VisibilityRunService(queue).createManualRun(project.id, { promptSetId: promptSet.id, providerConfigIds: [provider.id], maxObservations: promptTexts.length, budgetCeilingMicros: 10_000 });
    return { project, run, queue };
  }

  function emittedEvents(info: ReturnType<typeof vi.spyOn>) {
    return info.mock.calls.map((call) => call[0]).filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'));
  }

  it('serializes only the approved observability fields', () => {
    const serialized = serializeVisibilityEvent('visibility.observation.completed', {
      projectId: 'project-1', runId: 'run-1', observationId: 'observation-1', provider: 'openai', model: 'gpt-5', channel: 'API', promptId: 'prompt-1', promptVersion: 2,
      status: 'COMPLETED', errorCode: null, latencyMs: 842, promptTokens: 100, completionTokens: 40, totalTokens: 140, searchUnits: 1, costMicros: 1234,
      Authorization: 'Bearer secret', api_key: 'secret-key', cookie: 'session=secret', answerText: 'private answer body', promptText: 'private prompt body', reasoning: 'private chain', thought: 'private thought', searchPlanning: 'private search planning', providerBody: { secret: true }
    });
    expect(serialized).toEqual({ event: 'visibility.observation.completed', projectId: 'project-1', runId: 'run-1', observationId: 'observation-1', provider: 'openai', model: 'gpt-5', channel: 'API', promptId: 'prompt-1', promptVersion: 2, status: 'COMPLETED', errorCode: null, latencyMs: 842, promptTokens: 100, completionTokens: 40, totalTokens: 140, searchUnits: 1, costMicros: 1234 });
    const text = JSON.stringify(serialized);
    for (const forbidden of ['Authorization', 'api_key', 'cookie=', 'private answer body', 'private prompt body', 'reasoning', 'thought', 'search planning', 'providerBody']) expect(text).not.toContain(forbidden);
  });

  it('emits an allowed visibility event without leaking sensitive bodies', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitVisibilityEvent('visibility.run.failed', { runId: 'run-2', projectId: 'project-2', status: 'FAILED', errorCode: 'VISIBILITY_PROVIDER_FAILED', promptText: 'do not log me', answerText: 'do not log me either' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toEqual({ event: 'visibility.run.failed', runId: 'run-2', projectId: 'project-2', status: 'FAILED', errorCode: 'VISIBILITY_PROVIDER_FAILED' });
  });

  it('wires run and worker success events without logging prompt or answer bodies', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { project, run, queue } = await createRunFixture('success', ['private prompt body']);
    await executeVisibilityObservation(queue.observationIds[0]!, { registry: new VisibilityProviderRegistry([new FixtureAdapter()]) });
    const events = emittedEvents(info);
    expect(events.map((entry) => entry.event)).toEqual(expect.arrayContaining(['visibility.run.queued', 'visibility.run.started', 'visibility.observation.started', 'visibility.observation.completed', 'visibility.run.completed']));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'visibility.run.queued', projectId: project.id, runId: run.id }),
      expect.objectContaining({ event: 'visibility.observation.completed', provider: 'OPENAI', channel: 'API', totalTokens: 30, costMicros: 100 })
    ]));
    expect(JSON.stringify(events)).not.toContain('private prompt body');
    expect(JSON.stringify(events)).not.toContain('private sampled answer body');
  });

  it('emits unsupported and failed final run events', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { queue } = await createRunFixture('unsupported', ['unsupported prompt']);
    await executeVisibilityObservation(queue.observationIds[0]!, { registry: new VisibilityProviderRegistry([new FixtureAdapter(false)]) });
    const names = emittedEvents(info).map((entry) => entry.event);
    expect(names).toContain('visibility.observation.unsupported');
    expect(names).toContain('visibility.run.failed');
  });

  it('emits observation failure and run partial when one of two samples fails', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { queue } = await createRunFixture('partial', ['first prompt', 'second prompt']);
    const registry = new VisibilityProviderRegistry([new FixtureAdapter(true, 'BY_PROMPT')]);
    await executeVisibilityObservation(queue.observationIds[0]!, { registry });
    await expect(executeVisibilityObservation(queue.observationIds[1]!, { registry })).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
    const names = emittedEvents(info).map((entry) => entry.event);
    expect(names).toContain('visibility.observation.failed');
    expect(names).toContain('visibility.run.partial');
  });
});
