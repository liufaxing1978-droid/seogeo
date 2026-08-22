import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityProviderError, type VisibilityProviderAdapter, type VisibilitySampleRequest, type VisibilitySampleResponse } from '../../src/modules/visibility/providers/provider.js';
import { VisibilityProviderRegistry } from '../../src/modules/visibility/providers/provider-registry.js';
import { executeVisibilityObservation } from '../../src/modules/visibility/visibility.worker.js';

class FixtureAdapter implements VisibilityProviderAdapter {
  readonly provider = 'OPENAI' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;
  calls = 0;

  constructor(
    private readonly estimate: number | null = 1200,
    private readonly response: VisibilitySampleResponse = {
      status: 'COMPLETED',
      providerResponseId: 'resp-fixture',
      answerText: 'Xingshantang is one source.',
      citations: [{ url: 'https://xingshantang.org/article', title: 'Article', position: 1, sourceType: 'web' }],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: { grounded: true, reasoning: 'must-not-persist', nested: { thought: 'drop-me' } },
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 1200,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 15
    },
    private readonly supported = true,
    private readonly failure: Error | null = null
  ) {}

  supportsWebGrounding() { return this.supported; }
  estimateCostMicros(_request: VisibilitySampleRequest) { return this.estimate; }
  async sample(_request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    this.calls += 1;
    if (this.failure) throw this.failure;
    return this.response;
  }
}

describe('P6-A visibility worker', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  async function createObservation(label: string, options: { runBudget?: number | null; dailyBudget?: number | null } = {}) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: `Visibility Worker ${label}`, slug: `visibility-worker-${suffix}`, primaryDomain: `visibility-worker-${suffix}.example.com`, planLevel: 'ADVANCED' } });
    projectIds.push(project.id);
    await prisma.visibilityProjectSettings.create({ data: { projectId: project.id, dailyBudgetMicros: options.dailyBudget ?? null, defaultRunBudgetMicros: options.runBudget ?? null, maxObservationsPerRun: 20, defaultCurrency: 'USD' } });
    const set = await prisma.visibilityPromptSet.create({ data: { projectId: project.id, name: 'Worker set', defaultLocale: 'en-US', defaultCountry: 'US' } });
    const prompt = await prisma.visibilityPrompt.create({ data: { projectId: project.id, promptSetId: set.id, promptKey: 'worker', version: 1, promptText: 'Which sources explain Chinese folk religion?', locale: 'en-US', country: 'US', promptHash: `hash-${suffix}` } });
    const run = await prisma.visibilityRun.create({ data: { projectId: project.id, promptSetId: set.id, runType: 'MANUAL', requestedProviderConfigs: [{ id: `config-${suffix}`, provider: 'OPENAI', model: 'gpt-5-mini', channel: 'API', groundingMode: 'WEB_SEARCH', providerOptionsJson: { searchContextSize: 'medium' } }], maxObservations: 1, budgetCeilingMicros: options.runBudget ?? null, currency: 'USD', policySnapshotJson: { dailyBudgetMicros: options.dailyBudget ?? null } } });
    const observation = await prisma.platformObservation.create({ data: { projectId: project.id, visibilityRunId: run.id, visibilityPromptId: prompt.id, promptVersion: 1, samplingUnitKey: `visibility:${run.id}:${prompt.id}:OPENAI:gpt-5-mini:API:en-US:US`, provider: 'OPENAI', model: 'gpt-5-mini', channel: 'API', groundingMode: 'WEB_SEARCH', locale: 'en-US', country: 'US', citationsJson: [], searchMetadataJson: {} } });
    return { project, prompt, run, observation };
  }

  it('persists one normalized completed API observation and strips reasoning-like metadata', async () => {
    const { observation, run } = await createObservation('success');
    const adapter = new FixtureAdapter();
    await executeVisibilityObservation(observation.id, { registry: new VisibilityProviderRegistry([adapter]) });
    const stored = await prisma.platformObservation.findUniqueOrThrow({ where: { id: observation.id } });
    expect(adapter.calls).toBe(1);
    expect(stored).toMatchObject({ status: 'COMPLETED', citationEvidenceState: 'KNOWN_PRESENT', providerResponseId: 'resp-fixture', answerText: 'Xingshantang is one source.', promptTokens: 10, completionTokens: 20, totalTokens: 30, searchUnits: 1, costMicros: 1200, costCurrency: 'USD', pricingVersion: 'fixture-1', latencyMs: 15 });
    expect(stored.answerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.citationsJson).toEqual([{ url: 'https://xingshantang.org/article', title: 'Article', position: 1, sourceType: 'web' }]);
    expect(JSON.stringify(stored.searchMetadataJson)).not.toMatch(/reasoning|thought/i);
    expect((await prisma.visibilityRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('COMPLETED');
  });

  it('does not call a paid adapter twice for duplicate queue delivery', async () => {
    const { observation } = await createObservation('duplicate');
    const adapter = new FixtureAdapter();
    const registry = new VisibilityProviderRegistry([adapter]);
    await Promise.all([executeVisibilityObservation(observation.id, { registry }), executeVisibilityObservation(observation.id, { registry })]);
    expect(adapter.calls).toBe(1);
  });

  it('marks a budget-blocked sample without invoking the provider', async () => {
    const { observation } = await createObservation('budget', { runBudget: 1000 });
    const adapter = new FixtureAdapter(1200);
    await executeVisibilityObservation(observation.id, { registry: new VisibilityProviderRegistry([adapter]) });
    const stored = await prisma.platformObservation.findUniqueOrThrow({ where: { id: observation.id } });
    expect(adapter.calls).toBe(0);
    expect(stored).toMatchObject({ status: 'BUDGET_SKIPPED', citationEvidenceState: 'UNKNOWN', errorCode: 'RUN_BUDGET_EXCEEDED', costMicros: null });
  });

  it('marks unsupported grounding without invoking the adapter sample method', async () => {
    const { observation } = await createObservation('unsupported');
    const adapter = new FixtureAdapter(null, undefined, false);
    await executeVisibilityObservation(observation.id, { registry: new VisibilityProviderRegistry([adapter]) });
    expect(adapter.calls).toBe(0);
    expect(await prisma.platformObservation.findUniqueOrThrow({ where: { id: observation.id } })).toMatchObject({ status: 'UNSUPPORTED', citationEvidenceState: 'NOT_APPLICABLE', errorCode: 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED' });
  });

  it('maps safe provider failure state without persisting raw provider bodies', async () => {
    const { observation } = await createObservation('failure');
    const adapter = new FixtureAdapter(100, undefined, true, new VisibilityProviderError('VISIBILITY_PROVIDER_RATE_LIMITED', 'Provider rate limit reached', { httpStatus: 429 }));
    await expect(executeVisibilityObservation(observation.id, { registry: new VisibilityProviderRegistry([adapter]) })).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_RATE_LIMITED' });
    const stored = await prisma.platformObservation.findUniqueOrThrow({ where: { id: observation.id } });
    expect(stored.status).toBe('FAILED');
    expect(stored.citationEvidenceState).toBe('UNKNOWN');
    expect(stored.errorCode).toBe('VISIBILITY_PROVIDER_RATE_LIMITED');
    expect(stored.answerText).toBeNull();
  });
});
