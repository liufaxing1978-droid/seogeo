import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityPromptService } from '../../src/modules/visibility/visibility-prompts.service.js';
import { VisibilitySettingsService } from '../../src/modules/visibility/visibility-settings.service.js';

describe('P6-A visibility configuration services', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  it('creates default settings and validates project-level safety limits', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Visibility Settings',
        slug: `visibility-settings-${suffix}`,
        primaryDomain: `visibility-settings-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const service = new VisibilitySettingsService();
    const settings = await service.getOrCreate(project.id);
    expect(settings).toMatchObject({
      projectId: project.id,
      maxObservationsPerRun: 100,
      defaultCurrency: 'USD',
      schedulingEnabled: false
    });

    const updated = await service.update(project.id, {
      dailyBudgetMicros: 2_000_000,
      defaultRunBudgetMicros: 500_000,
      maxObservationsPerRun: 250,
      defaultCurrency: 'USD',
      schedulingEnabled: true
    });
    expect(updated).toMatchObject({
      dailyBudgetMicros: 2_000_000,
      defaultRunBudgetMicros: 500_000,
      maxObservationsPerRun: 250,
      schedulingEnabled: true
    });

    await expect(
      service.update(project.id, { maxObservationsPerRun: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_VISIBILITY_MAX_OBSERVATIONS' });

    await expect(
      service.update(project.id, { maxObservationsPerRun: 501 })
    ).rejects.toMatchObject({ code: 'INVALID_VISIBILITY_MAX_OBSERVATIONS' });

    await expect(
      service.update(project.id, { dailyBudgetMicros: -1 })
    ).rejects.toMatchObject({ code: 'INVALID_VISIBILITY_DAILY_BUDGET' });
  });

  it('upserts only API provider configs and rejects secret-like provider options', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Visibility Provider Config',
        slug: `visibility-provider-${suffix}`,
        primaryDomain: `visibility-provider-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const service = new VisibilitySettingsService();
    const config = await service.upsertProviderConfig(project.id, {
      provider: 'OPENAI',
      enabled: true,
      model: 'gpt-5-mini',
      channel: 'API',
      groundingMode: 'WEB_SEARCH',
      maxConcurrency: 2,
      defaultLocale: 'en-US',
      defaultCountry: 'US',
      providerOptionsJson: { searchContextSize: 'medium' }
    });
    expect(config).toMatchObject({
      projectId: project.id,
      provider: 'OPENAI',
      enabled: true,
      channel: 'API',
      maxConcurrency: 2
    });

    const updated = await service.upsertProviderConfig(project.id, {
      provider: 'OPENAI',
      enabled: false,
      model: 'gpt-5-mini',
      channel: 'API',
      groundingMode: 'WEB_SEARCH',
      maxConcurrency: 3,
      providerOptionsJson: { searchContextSize: 'large' }
    });
    expect(updated.id).toBe(config.id);
    expect(updated.enabled).toBe(false);
    expect(updated.maxConcurrency).toBe(3);

    await expect(
      service.upsertProviderConfig(project.id, {
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'CONSUMER_UI',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        providerOptionsJson: {}
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_VISIBILITY_CHANNEL' });

    await expect(
      service.upsertProviderConfig(project.id, {
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        providerOptionsJson: { nested: { apiKey: 'must-not-be-persisted' } }
      })
    ).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_OPTIONS_CONTAIN_SECRET' });
  });

  it('derives persisted provider capabilities from the server adapter and ignores client-authored claims', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Visibility Capability Authority',
        slug: `visibility-capability-${suffix}`,
        primaryDomain: `visibility-capability-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const service = new VisibilitySettingsService();
    const clientPayload = {
      provider: 'QWEN' as const,
      enabled: true,
      model: 'qwen-max',
      channel: 'API' as const,
      groundingMode: 'WEB_SEARCH' as const,
      maxConcurrency: 1,
      defaultLocale: 'zh-CN',
      defaultCountry: 'CN',
      providerOptionsJson: {
        workspaceId: 'workspace-fixture',
        region: 'cn-beijing'
      },
      capabilities: ['CONSUMER_OBSERVATION'] as const
    };

    const config = await service.upsertProviderConfig(project.id, clientPayload);
    expect(config.capabilities).toEqual(['WEB_GROUNDED', 'CITATION_NATIVE']);
    expect(config.capabilities).not.toContain('CONSUMER_OBSERVATION');

    const stored = await prisma.visibilityProviderConfig.findUniqueOrThrow({ where: { id: config.id } });
    expect(stored.capabilities).toEqual(['WEB_GROUNDED', 'CITATION_NATIVE']);
  });

  it('creates immutable prompt versions with deterministic hashes', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Visibility Prompts',
        slug: `visibility-prompts-${suffix}`,
        primaryDomain: `visibility-prompts-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);

    const service = new VisibilityPromptService();
    const promptSet = await service.createPromptSet(project.id, {
      name: 'Unbranded discovery',
      description: 'Discovery prompts',
      defaultLocale: 'en-US',
      defaultCountry: 'US'
    });

    const v1 = await service.createPromptVersion(project.id, {
      promptSetId: promptSet.id,
      promptKey: 'discovery',
      promptText: 'Which sites explain Chinese folk religion?',
      locale: 'en-US',
      country: 'US'
    });
    const v2 = await service.createPromptVersion(project.id, {
      promptSetId: promptSet.id,
      promptKey: 'discovery',
      promptText: 'Which sites best explain Chinese folk religion?',
      locale: 'en-US',
      country: 'US'
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.promptText).toBe('Which sites explain Chinese folk religion?');
    expect(v2.promptText).toBe('Which sites best explain Chinese folk religion?');
    expect(v1.promptHash).not.toBe(v2.promptHash);

    const storedV1 = await prisma.visibilityPrompt.findUniqueOrThrow({ where: { id: v1.id } });
    expect(storedV1.promptText).toBe('Which sites explain Chinese folk religion?');
    expect(storedV1.promptHash).toBe(v1.promptHash);
  });

  it('rejects cross-project prompt-set use', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const first = await prisma.project.create({
      data: {
        name: 'Visibility Prompt Owner',
        slug: `visibility-owner-${suffix}`,
        primaryDomain: `visibility-owner-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    const second = await prisma.project.create({
      data: {
        name: 'Visibility Prompt Stranger',
        slug: `visibility-stranger-${suffix}`,
        primaryDomain: `visibility-stranger-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(first.id, second.id);

    const service = new VisibilityPromptService();
    const promptSet = await service.createPromptSet(first.id, { name: 'Owned set' });

    await expect(
      service.createPromptVersion(second.id, {
        promptSetId: promptSet.id,
        promptKey: 'cross-project',
        promptText: 'This must not be accepted.'
      })
    ).rejects.toMatchObject({ code: 'VISIBILITY_PROMPT_SET_NOT_FOUND' });
  });
});
