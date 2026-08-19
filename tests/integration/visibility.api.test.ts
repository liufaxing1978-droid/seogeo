import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
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

describe('P6-A visibility REST API', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const id of projectIds) {
      await prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
  });

  async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE', label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Visibility API ${label}`,
        slug: `visibility-api-${suffix}`,
        primaryDomain: `visibility-api-${suffix}.example.com`,
        planLevel
      }
    });
    projectIds.push(project.id);
    return project;
  }

  it('serves the Advanced visibility settings, providers, prompts, runs and observations without real provider calls', async () => {
    const project = await createProject('ADVANCED', 'advanced');
    const queue = new FakeVisibilityQueue();
    const app = createApp({ visibilityRunService: new VisibilityRunService(queue) });

    const settings = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/settings`)
      .expect(200);
    expect(settings.body.data).toMatchObject({
      projectId: project.id,
      maxObservationsPerRun: 100,
      defaultCurrency: 'USD',
      schedulingEnabled: false
    });

    await request(app)
      .patch(`/api/v1/projects/${project.id}/visibility/settings`)
      .send({
        dailyBudgetMicros: 2_000_000,
        defaultRunBudgetMicros: 500_000,
        maxObservationsPerRun: 100,
        defaultCurrency: 'USD',
        schedulingEnabled: false
      })
      .expect(200);

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

    const providers = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/providers`)
      .expect(200);
    expect(providers.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: provider.id, provider: 'OPENAI', channel: 'API' })
      ])
    );

    const updatedProvider = await request(app)
      .put(`/api/v1/projects/${project.id}/visibility/providers/${provider.id}`)
      .send({
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 3,
        defaultLocale: 'en-US',
        defaultCountry: 'US',
        providerOptionsJson: { searchContextSize: 'large' }
      })
      .expect(200);
    expect(updatedProvider.body.data).toMatchObject({ id: provider.id, maxConcurrency: 3 });

    const createdSet = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/prompt-sets`)
      .send({
        name: 'Unbranded discovery',
        defaultLocale: 'en-US',
        defaultCountry: 'US'
      })
      .expect(201);
    const promptSetId = createdSet.body.data.id as string;

    const createdPrompt = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/prompts`)
      .send({
        promptSetId,
        promptKey: 'discovery',
        promptText: 'Which websites explain Chinese folk religious traditions well?',
        locale: 'en-US',
        country: 'US'
      })
      .expect(201);
    expect(createdPrompt.body.data).toMatchObject({ promptSetId, promptKey: 'discovery', version: 1 });

    const promptSets = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/prompt-sets`)
      .expect(200);
    expect(promptSets.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: promptSetId })])
    );

    const prompts = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/prompts`)
      .expect(200);
    expect(prompts.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdPrompt.body.data.id, version: 1 })])
    );

    const createdRun = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/runs`)
      .send({
        promptSetId,
        providerConfigIds: [provider.id],
        maxObservations: 1,
        budgetCeilingMicros: 100_000
      })
      .expect(202);
    expect(createdRun.body.data).toMatchObject({
      projectId: project.id,
      promptSetId,
      status: 'QUEUED',
      runType: 'MANUAL'
    });
    expect(queue.calls).toHaveLength(1);
    expect(queue.calls[0]?.options.attempts).toBe(1);

    const runs = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/runs`)
      .expect(200);
    expect(runs.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createdRun.body.data.id })])
    );

    const runDetail = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/runs/${createdRun.body.data.id}`)
      .expect(200);
    expect(runDetail.body.data).toMatchObject({ id: createdRun.body.data.id, projectId: project.id });
    expect(runDetail.body.data.observations).toHaveLength(1);
    expect(runDetail.body.data.observations[0]).toMatchObject({ channel: 'API', status: 'PENDING' });

    const observations = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/observations`)
      .expect(200);
    expect(observations.body.data).toHaveLength(1);
    expect(observations.body.data[0]).toMatchObject({ channel: 'API', provider: 'OPENAI' });
  });

  it('blocks Standard projects from prompt-monitor and visibility-run writes before persistence', async () => {
    const project = await createProject('STANDARD', 'standard');
    const queue = new FakeVisibilityQueue();
    const app = createApp({ visibilityRunService: new VisibilityRunService(queue) });

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/prompt-sets`)
      .send({ name: 'Blocked' })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE');
      });

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/runs`)
      .send({ promptSetId: '00000000-0000-0000-0000-000000000000', providerConfigIds: [], maxObservations: 1 })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE');
      });

    expect(await prisma.visibilityPromptSet.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.visibilityRun.count({ where: { projectId: project.id } })).toBe(0);
    expect(queue.calls).toHaveLength(0);
  });

  it('does not disclose or mutate cross-project visibility resources', async () => {
    const owner = await createProject('ADVANCED', 'owner');
    const stranger = await createProject('ADVANCED', 'stranger');
    const queue = new FakeVisibilityQueue();
    const app = createApp({ visibilityRunService: new VisibilityRunService(queue) });

    const ownerSet = await prisma.visibilityPromptSet.create({
      data: { projectId: owner.id, name: 'Owner set' }
    });
    const ownerProvider = await prisma.visibilityProviderConfig.create({
      data: {
        projectId: owner.id,
        provider: 'OPENAI',
        enabled: true,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 2,
        providerOptionsJson: {}
      }
    });

    await request(app)
      .post(`/api/v1/projects/${stranger.id}/visibility/prompts`)
      .send({
        promptSetId: ownerSet.id,
        promptKey: 'cross-project',
        promptText: 'Must not be accepted.'
      })
      .expect(404);

    await request(app)
      .put(`/api/v1/projects/${stranger.id}/visibility/providers/${ownerProvider.id}`)
      .send({
        provider: 'OPENAI',
        enabled: false,
        model: 'gpt-5-mini',
        channel: 'API',
        groundingMode: 'WEB_SEARCH',
        maxConcurrency: 1,
        providerOptionsJson: {}
      })
      .expect(404);

    expect((await prisma.visibilityProviderConfig.findUniqueOrThrow({ where: { id: ownerProvider.id } })).enabled).toBe(true);
  });
});
