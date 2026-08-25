import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import type { OptimizationExperimentApiPort } from '../../src/modules/optimization-experiments/experiment.routes.js';

const projectIds: string[] = [];

async function createProject(
  label: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE'
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-D experiment API ${label}`,
      slug: `p9d-experiment-api-${suffix}`,
      primaryDomain: `p9d-experiment-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

type ListCall = { projectId: string; limit: number; offset: number };
type DetailCall = { projectId: string; experimentId: string };

function createFakeOptimizationExperimentApi() {
  const listCalls: ListCall[] = [];
  const detailCalls: DetailCall[] = [];
  const visibleExperimentId = '11111111-1111-4111-8111-111111111111';
  let visibleProjectId = '';

  const api: OptimizationExperimentApiPort = {
    async listExperiments(projectId, limit, offset) {
      listCalls.push({ projectId, limit, offset });
      return [{
        id: visibleExperimentId,
        projectId,
        interventionType: 'CONTENT_REFRESH',
        targetUrl: 'https://example.com/page',
        derivedState: 'OBSERVING'
      }];
    },
    async getExperiment(projectId, experimentId) {
      detailCalls.push({ projectId, experimentId });
      if (projectId !== visibleProjectId || experimentId !== visibleExperimentId) return null;
      return {
        id: visibleExperimentId,
        projectId,
        interventionType: 'CONTENT_REFRESH',
        targetUrl: 'https://example.com/page',
        derivedState: 'OBSERVING'
      };
    }
  };

  return {
    api,
    listCalls,
    detailCalls,
    visibleExperimentId,
    setVisibleProject(projectId: string) {
      visibleProjectId = projectId;
    }
  };
}

function appWithExperimentApi(api: OptimizationExperimentApiPort) {
  return createApp({ optimizationExperimentApi: api });
}

function listUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/optimization/experiments`;
}

function detailUrl(projectId: string, experimentId: string): string {
  return `${listUrl(projectId)}/${experimentId}`;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P9-D read-only experiment API', () => {
  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    'returns persisted experiment list for %s with strict bounded pagination',
    async (planLevel) => {
      const project = await createProject(`list-${planLevel.toLowerCase()}`, planLevel);
      const fake = createFakeOptimizationExperimentApi();
      const app = appWithExperimentApi(fake.api);

      const response = await request(app)
        .get(`${listUrl(project.id)}?limit=25&offset=50`)
        .expect(200);

      expect(response.body.data).toEqual([expect.objectContaining({
        projectId: project.id,
        derivedState: 'OBSERVING'
      })]);
      expect(fake.listCalls).toEqual([{ projectId: project.id, limit: 25, offset: 50 }]);
      expect(fake.detailCalls).toEqual([]);
    }
  );

  it('returns detail for the same project and fails closed for another project', async () => {
    const ownerProject = await createProject('detail-owner', 'ADVANCED');
    const otherProject = await createProject('detail-other', 'ADVANCED');
    const fake = createFakeOptimizationExperimentApi();
    fake.setVisibleProject(ownerProject.id);
    const app = appWithExperimentApi(fake.api);

    const response = await request(app)
      .get(detailUrl(ownerProject.id, fake.visibleExperimentId))
      .expect(200);

    expect(response.body.data).toMatchObject({
      id: fake.visibleExperimentId,
      projectId: ownerProject.id,
      derivedState: 'OBSERVING'
    });

    await request(app)
      .get(detailUrl(otherProject.id, fake.visibleExperimentId))
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('EXPERIMENT_NOT_FOUND'));

    expect(fake.detailCalls).toEqual([
      { projectId: ownerProject.id, experimentId: fake.visibleExperimentId },
      { projectId: otherProject.id, experimentId: fake.visibleExperimentId }
    ]);
    expect(fake.listCalls).toEqual([]);
  });

  it('returns 403 for STANDARD before the read port is touched', async () => {
    const project = await createProject('standard', 'STANDARD');
    const fake = createFakeOptimizationExperimentApi();
    const app = appWithExperimentApi(fake.api);

    await request(app)
      .get(listUrl(project.id))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    await request(app)
      .get(detailUrl(project.id, fake.visibleExperimentId))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    expect(fake.listCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });

  it('rejects malformed UUIDs and out-of-range pagination before the read port is touched', async () => {
    const project = await createProject('validation', 'ADVANCED');
    const fake = createFakeOptimizationExperimentApi();
    const app = appWithExperimentApi(fake.api);

    await request(app)
      .get(listUrl('not-a-uuid'))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    await request(app)
      .get(detailUrl(project.id, 'not-a-uuid'))
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    const invalidQueries = [
      'limit=0',
      'limit=101',
      'limit=abc',
      'offset=-1',
      'offset=100001',
      'offset=abc'
    ];
    for (const query of invalidQueries) {
      await request(app)
        .get(`${listUrl(project.id)}?${query}`)
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
    }

    expect(fake.listCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });

  it('uses only GET list/detail surfaces and exposes no public experiment mutation route', async () => {
    const project = await createProject('read-only', 'ADVANCED');
    const fake = createFakeOptimizationExperimentApi();
    const app = appWithExperimentApi(fake.api);
    const url = listUrl(project.id);

    await request(app).post(url).send({}).expect(404);
    await request(app).put(`${url}/${fake.visibleExperimentId}`).send({}).expect(404);
    await request(app).patch(`${url}/${fake.visibleExperimentId}`).send({}).expect(404);
    await request(app).delete(`${url}/${fake.visibleExperimentId}`).expect(404);

    expect(fake.listCalls).toEqual([]);
    expect(fake.detailCalls).toEqual([]);
  });
});
