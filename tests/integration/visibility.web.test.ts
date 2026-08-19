import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createVisibilityWebFixture() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'AI Visibility Center Fixture',
      slug: `visibility-web-${suffix}`,
      primaryDomain: `visibility-web-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

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

  const provider = await prisma.visibilityProviderConfig.create({
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
      promptKey: 'discovery',
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
      status: 'COMPLETED',
      requestedProviderConfigs: [{ id: provider.id, provider: 'OPENAI', model: 'gpt-5-mini', channel: 'API' }],
      maxObservations: 1,
      budgetCeilingMicros: 100_000,
      currency: 'USD',
      policySnapshotJson: { maxObservationsPerRun: 100 },
      startedAt: new Date(Date.now() - 1000),
      finishedAt: new Date()
    }
  });

  await prisma.platformObservation.create({
    data: {
      projectId: project.id,
      visibilityRunId: run.id,
      visibilityPromptId: prompt.id,
      promptVersion: 1,
      samplingUnitKey: `visibility:${run.id}:${prompt.id}:OPENAI:gpt-5-mini:API:en-US:US`,
      provider: 'OPENAI',
      model: 'gpt-5-mini',
      channel: 'API',
      groundingMode: 'WEB_SEARCH',
      locale: 'en-US',
      country: 'US',
      status: 'COMPLETED',
      providerResponseId: 'fixture-response',
      answerText: 'Fixture sampled answer.',
      answerHash: `answer-hash-${suffix}`,
      citationsJson: [{ url: 'https://xingshantang.org/article', title: 'Article', position: 1, sourceType: 'web' }],
      searchMetadataJson: { grounded: true },
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      searchUnits: 1,
      costMicros: 1200,
      costCurrency: 'USD',
      pricingVersion: 'fixture-1',
      latencyMs: 25
    }
  });

  return { project, provider, promptSet, prompt, run };
}

describe('P6-A AI Visibility web UI', () => {
  it('renders the Advanced overview as API sampling without claiming consumer-product rankings', async () => {
    const { project, run } = await createVisibilityWebFixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/visibility`)
      .expect(200);

    expect(response.text).toContain('AI Visibility');
    expect(response.text).toContain('API 采样');
    expect(response.text).toContain('OPENAI');
    expect(response.text).toContain('gpt-5-mini');
    expect(response.text).toContain('COMPLETED');
    expect(response.text).toContain('预算');
    expect(response.text).toContain(`/projects/${project.id}/visibility/prompts`);
    expect(response.text).toContain(`/projects/${project.id}/visibility/runs/${run.id}`);
    expect(response.text).not.toContain('ChatGPT 网页端排名');
    expect(response.text).not.toContain('Mention Rate');
    expect(response.text).not.toContain('Citation Rate');
    expect(response.text).not.toContain('Share of Voice');
  });

  it('renders Prompt Monitor with immutable-version wording and project-scoped creation forms', async () => {
    const { project, promptSet } = await createVisibilityWebFixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/visibility/prompts`)
      .expect(200);

    expect(response.text).toContain('Prompt 监控');
    expect(response.text).toContain('不可变版本');
    expect(response.text).toContain('Unbranded discovery');
    expect(response.text).toContain('Which websites explain Chinese folk religious traditions well?');
    expect(response.text).toContain(`action="/projects/${project.id}/visibility/prompt-sets"`);
    expect(response.text).toContain(`action="/projects/${project.id}/visibility/prompts"`);
    expect(response.text).toContain(`value="${promptSet.id}"`);
  });

  it('renders a run detail with API channel and normalized observation facts', async () => {
    const { project, run } = await createVisibilityWebFixture();
    const response = await request(createApp())
      .get(`/projects/${project.id}/visibility/runs/${run.id}`)
      .expect(200);

    expect(response.text).toContain('采样运行详情');
    expect(response.text).toContain('API');
    expect(response.text).toContain('OPENAI');
    expect(response.text).toContain('gpt-5-mini');
    expect(response.text).toContain('COMPLETED');
    expect(response.text).toContain('https://xingshantang.org/article');
    expect(response.text).not.toMatch(/reasoning|thought|search planning/i);
  });

  it('blocks Standard projects from the P6-A web center', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Standard Visibility Web',
        slug: `standard-visibility-web-${suffix}`,
        primaryDomain: `standard-visibility-web-${suffix}.example.com`,
        planLevel: 'STANDARD'
      }
    });

    await request(createApp())
      .get(`/projects/${project.id}/visibility`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
  });
});
