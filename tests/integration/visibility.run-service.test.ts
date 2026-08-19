import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityRepository } from '../../src/modules/visibility/visibility.repository.js';
import {
  VisibilityRunService,
  type VisibilityQueue
} from '../../src/modules/visibility/visibility-run.service.js';

class FakeVisibilityQueue implements VisibilityQueue {
  readonly calls: Array<{
    name: string;
    data: { observationId: string };
    options: { jobId: string; attempts: number };
  }> = [];

  async add(
    name: string,
    data: { observationId: string },
    options: { jobId: string; attempts: number }
  ) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

describe('P6-A visibility run orchestration', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  async function createAdvancedMatrixFixture(label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Visibility Run ${label}`,
        slug: `visibility-run-${suffix}`,
        primaryDomain: `visibility-run-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    await prisma.visibilityProjectSettings.create({
      data: {
        projectId: project.id,
        dailyBudgetMicros: 2_000_000,
        defaultRunBudgetMicros: 500_000,
        maxObservationsPerRun: 100,
        defaultCurrency: 'USD',
        schedulingEnabled: false
      }
    });

    const promptSet = await prisma.visibilityPromptSet.create({
      data: {
        projectId: project.id,
        name: 'Unbranded discovery',
        defaultLocale: 'en-US',
        defaultCountry: 'US'
      }
    });
    const promptA = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'discovery-a',
        version: 1,
        promptText: 'Which sites explain Chinese folk religion?',
        locale: 'en-US',
        country: 'US',
        promptHash: `hash-a-${suffix}`
      }
    });
    const promptB = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'discovery-b',
        version: 1,
        promptText: 'Which sites explain Chinese folk traditions?',
        locale: 'zh-CN',
        country: 'CN',
        promptHash: `hash-b-${suffix}`
      }
    });

    const openAi = await prisma.visibilityProviderConfig.create({
      data: {
        projectId: project.id,
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        defaultLocale: 'en-US',
        defaultCountry: 'US',
        providerOptionsJson: { searchContextSize: 'medium' }
      }
    });
    const gemini = await prisma.visibilityProviderConfig.create({
      data: {
        projectId: project.id,
        provider: 'GEMINI',
        enabled: true,
        model: 'gemini-2.5-flash',
        channel: 'API',
        groundingMode: 'SEARCH_GROUNDING',
        maxConcurrency: 2,
        providerOptionsJson: {}
      }
    });

    return { project, promptSet, promptA, promptB, openAi, gemini };
  }

  it('expands active prompts × enabled provider configs into stable queued observations', async () => {
    const fixture = await createAdvancedMatrixFixture('matrix');
    const queue = new FakeVisibilityQueue();
    const service = new VisibilityRunService(queue);

    const run = await service.createManualRun(fixture.project.id, {
      promptSetId: fixture.promptSet.id,
      providerConfigIds: [fixture.openAi.id, fixture.gemini.id],
      maxObservations: 4,
      budgetCeilingMicros: 100_000
    });

    expect(run).toMatchObject({
      projectId: fixture.project.id,
      promptSetId: fixture.promptSet.id,
      runType: 'MANUAL',
      status: 'QUEUED',
      maxObservations: 4,
      budgetCeilingMicros: 100_000,
      currency: 'USD'
    });

    const observations = await prisma.platformObservation.findMany({
      where: { visibilityRunId: run.id },
      orderBy: [{ visibilityPromptId: 'asc' }, { provider: 'asc' }]
    });
    expect(observations).toHaveLength(4);
    expect(observations.every((item) => item.status === 'PENDING')).toBe(true);
    expect(new Set(observations.map((item) => item.samplingUnitKey)).size).toBe(4);
    expect(observations.every((item) => item.channel === 'API')).toBe(true);

    const openAiA = observations.find(
      (item) => item.visibilityPromptId === fixture.promptA.id && item.provider === 'OPENAI'
    );
    expect(openAiA?.samplingUnitKey).toBe(
      `visibility:${run.id}:${fixture.promptA.id}:OPENAI:gpt-5-mini:API:en-US:US`
    );

    const geminiB = observations.find(
      (item) => item.visibilityPromptId === fixture.promptB.id && item.provider === 'GEMINI'
    );
    expect(geminiB?.samplingUnitKey).toBe(
      `visibility:${run.id}:${fixture.promptB.id}:GEMINI:gemini-2.5-flash:API:zh-CN:CN`
    );

    expect(queue.calls).toHaveLength(4);
    expect(queue.calls.every((call) => call.name === 'visibility-observation')).toBe(true);
    expect(queue.calls.every((call) => call.options.attempts === 1)).toBe(true);
    expect(new Set(queue.calls.map((call) => call.options.jobId)).size).toBe(4);

    const providerSnapshot = run.requestedProviderConfigs as Array<Record<string, unknown>>;
    expect(providerSnapshot).toHaveLength(2);
    expect(providerSnapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.openAi.id,
          provider: 'OPENAI',
          model: 'gpt-5-mini',
          channel: 'API',
          groundingMode: 'WEB_SEARCH',
          providerOptionsJson: { searchContextSize: 'medium' }
        }),
        expect.objectContaining({
          id: fixture.gemini.id,
          provider: 'GEMINI',
          model: 'gemini-2.5-flash',
          channel: 'API',
          groundingMode: 'SEARCH_GROUNDING'
        })
      ])
    );
  });

  it('fails before persistence when the matrix exceeds the requested or project observation ceiling', async () => {
    const fixture = await createAdvancedMatrixFixture('limits');
    const queue = new FakeVisibilityQueue();
    const service = new VisibilityRunService(queue);

    await expect(
      service.createManualRun(fixture.project.id, {
        promptSetId: fixture.promptSet.id,
        providerConfigIds: [fixture.openAi.id, fixture.gemini.id],
        maxObservations: 3,
        budgetCeilingMicros: 100_000
      })
    ).rejects.toMatchObject({ code: 'VISIBILITY_OBSERVATION_LIMIT_EXCEEDED' });

    expect(await prisma.visibilityRun.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.platformObservation.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });

  it('blocks Standard projects before any paid-sampling rows or queue jobs are created', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Standard Visibility Run',
        slug: `standard-visibility-run-${suffix}`,
        primaryDomain: `standard-visibility-run-${suffix}.example.com`,
        planLevel: 'STANDARD'
      }
    });
    projectIds.push(project.id);
    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: 'Standard set' }
    });
    const queue = new FakeVisibilityQueue();
    const service = new VisibilityRunService(queue);

    await expect(
      service.createManualRun(project.id, {
        promptSetId: promptSet.id,
        providerConfigIds: [],
        maxObservations: 1
      })
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });

    expect(await prisma.visibilityRun.count({ where: { projectId: project.id } })).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });

  it('atomically grants paid execution rights to only one duplicate worker delivery', async () => {
    const fixture = await createAdvancedMatrixFixture('claim');
    const queue = new FakeVisibilityQueue();
    const service = new VisibilityRunService(queue);
    const repository = new VisibilityRepository();

    const run = await service.createManualRun(fixture.project.id, {
      promptSetId: fixture.promptSet.id,
      providerConfigIds: [fixture.openAi.id],
      maxObservations: 2
    });
    const observation = await prisma.platformObservation.findFirstOrThrow({
      where: { visibilityRunId: run.id }
    });

    const claims = await Promise.all([
      repository.claimPendingObservation(observation.id),
      repository.claimPendingObservation(observation.id)
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await prisma.platformObservation.findUniqueOrThrow({ where: { id: observation.id } })).status).toBe('RUNNING');
  });

  it('rejects provider configs from another project without disclosing or sampling them', async () => {
    const owner = await createAdvancedMatrixFixture('owner');
    const stranger = await createAdvancedMatrixFixture('stranger');
    const queue = new FakeVisibilityQueue();
    const service = new VisibilityRunService(queue);

    await expect(
      service.createManualRun(stranger.project.id, {
        promptSetId: stranger.promptSet.id,
        providerConfigIds: [owner.openAi.id],
        maxObservations: 2
      })
    ).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_CONFIG_NOT_FOUND' });

    expect(await prisma.visibilityRun.count({ where: { projectId: stranger.project.id } })).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });
});
