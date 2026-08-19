import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P6-A visibility persistence foundation', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('persists project policy, provider config, prompt versions, runs and API observations', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6 Visibility Persistence',
        slug: `p6-visibility-${suffix}`,
        primaryDomain: `p6-visibility-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const settings = await prisma.visibilityProjectSettings.create({
      data: {
        projectId: project.id,
        dailyBudgetMicros: 2_000_000,
        defaultRunBudgetMicros: 500_000,
        maxObservationsPerRun: 100,
        defaultCurrency: 'USD',
        schedulingEnabled: false
      }
    });
    expect(settings.projectId).toBe(project.id);

    const provider = await prisma.visibilityProviderConfig.create({
      data: {
        projectId: project.id,
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        providerOptionsJson: {}
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

    const prompt = await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'traditional-culture-discovery',
        version: 1,
        promptText: 'Which websites explain Chinese folk religious traditions well?',
        locale: 'en-US',
        country: 'US',
        promptHash: `prompt-hash-${suffix}`
      }
    });

    const run = await prisma.visibilityRun.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        runType: 'MANUAL',
        requestedProviderConfigs: [{ providerConfigId: provider.id }],
        maxObservations: 10,
        budgetCeilingMicros: 100_000,
        currency: 'USD',
        policySnapshotJson: {
          dailyBudgetMicros: settings.dailyBudgetMicros,
          defaultRunBudgetMicros: settings.defaultRunBudgetMicros,
          maxObservationsPerRun: settings.maxObservationsPerRun
        }
      }
    });

    const samplingUnitKey = `visibility:${run.id}:${prompt.id}:OPENAI:gpt-5-mini:API:en-US:US`;
    const observation = await prisma.platformObservation.create({
      data: {
        projectId: project.id,
        visibilityRunId: run.id,
        visibilityPromptId: prompt.id,
        promptVersion: 1,
        samplingUnitKey,
        provider: 'OPENAI',
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        locale: 'en-US',
        country: 'US',
        status: 'COMPLETED',
        providerResponseId: `response-${suffix}`,
        answerText: 'Fixture answer.',
        answerHash: `answer-hash-${suffix}`,
        citationsJson: [
          {
            url: 'https://xingshantang.org/article',
            title: 'Article',
            position: 1,
            sourceType: 'web'
          }
        ],
        searchMetadataJson: { grounded: true },
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        searchUnits: 1,
        costMicros: 1234,
        costCurrency: 'USD',
        pricingVersion: 'fixture-2026-08',
        latencyMs: 25
      }
    });

    expect(observation.samplingUnitKey).toBe(samplingUnitKey);
    expect(observation.channel).toBe('API');
    expect(observation.costCurrency).toBe('USD');
    expect(observation.pricingVersion).toBe('fixture-2026-08');
  });

  it('enforces the P6-A uniqueness contracts', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'P6 Visibility Uniqueness',
        slug: `p6-visibility-unique-${suffix}`,
        primaryDomain: `p6-visibility-unique-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    await prisma.visibilityProjectSettings.create({
      data: {
        projectId: project.id,
        maxObservationsPerRun: 100,
        defaultCurrency: 'USD',
        schedulingEnabled: false
      }
    });
    await expect(
      prisma.visibilityProjectSettings.create({
        data: {
          projectId: project.id,
          maxObservationsPerRun: 50,
          defaultCurrency: 'USD',
          schedulingEnabled: false
        }
      })
    ).rejects.toBeTruthy();

    await prisma.visibilityProviderConfig.create({
      data: {
        projectId: project.id,
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        providerOptionsJson: {}
      }
    });
    await expect(
      prisma.visibilityProviderConfig.create({
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
      })
    ).rejects.toBeTruthy();

    const promptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: project.id, name: 'Discovery' }
    });
    await prisma.visibilityPrompt.create({
      data: {
        projectId: project.id,
        promptSetId: promptSet.id,
        promptKey: 'discovery',
        version: 1,
        promptText: 'Which sites are useful?',
        promptHash: `hash-${suffix}`
      }
    });
    await expect(
      prisma.visibilityPrompt.create({
        data: {
          projectId: project.id,
          promptSetId: promptSet.id,
          promptKey: 'discovery',
          version: 1,
          promptText: 'Duplicate version should fail.',
          promptHash: `other-hash-${suffix}`
        }
      })
    ).rejects.toBeTruthy();
  });

  it('cascades P6 rows with the project without touching unrelated P0-P5 projects', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const sourceProject = await prisma.project.create({
      data: {
        name: 'Existing source project',
        slug: `existing-${suffix}`,
        primaryDomain: `existing-${suffix}.example.com`
      }
    });
    projectIds.push(sourceProject.id);

    const visibilityProject = await prisma.project.create({
      data: {
        name: 'Visibility cascade project',
        slug: `visibility-cascade-${suffix}`,
        primaryDomain: `visibility-cascade-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });

    await prisma.visibilityProjectSettings.create({
      data: {
        projectId: visibilityProject.id,
        maxObservationsPerRun: 100,
        defaultCurrency: 'USD',
        schedulingEnabled: false
      }
    });
    const set = await prisma.visibilityPromptSet.create({
      data: { projectId: visibilityProject.id, name: 'Cascade set' }
    });
    await prisma.visibilityPrompt.create({
      data: {
        projectId: visibilityProject.id,
        promptSetId: set.id,
        promptKey: 'cascade',
        version: 1,
        promptText: 'Cascade fixture prompt',
        promptHash: `cascade-hash-${suffix}`
      }
    });

    await prisma.project.delete({ where: { id: visibilityProject.id } });

    expect(
      await prisma.visibilityProjectSettings.findUnique({
        where: { projectId: visibilityProject.id }
      })
    ).toBeNull();
    expect(
      await prisma.visibilityPromptSet.count({ where: { projectId: visibilityProject.id } })
    ).toBe(0);
    expect(await prisma.project.findUnique({ where: { id: sourceProject.id } })).not.toBeNull();
  });
});
