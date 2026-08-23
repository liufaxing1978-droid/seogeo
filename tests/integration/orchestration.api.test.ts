import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import type { OptimizationOrchestrationApiPort } from '../../src/modules/optimization-orchestration/orchestration.routes.js';

const projectIds: string[] = [];

async function createProject(
  label: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE'
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-B orchestration API ${label}`,
      slug: `p9b-orchestration-api-${suffix}`,
      primaryDomain: `p9b-orchestration-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

type ManualInput = {
  projectId: string;
  manualRequestId: string;
  requestedBy: string;
};

function createFakeOptimizationOrchestrationApi() {
  const calls: ManualInput[] = [];
  const api: OptimizationOrchestrationApiPort = {
    async triggerManual(input: ManualInput) {
      calls.push(input);
      return {
        id: `run-${calls.length}`,
        projectId: input.projectId,
        triggerType: 'MANUAL',
        status: 'QUEUED'
      };
    }
  };
  return { api, calls };
}

function appWithOptimizationApi(api: OptimizationOrchestrationApiPort) {
  return createApp({ optimizationOrchestrationApi: api });
}

function manualRunUrl(projectId: string): string {
  return `/api/v1/projects/${projectId}/optimization/runs`;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P9-B strict manual orchestration API', () => {
  it('returns 403 for STANDARD before the trigger API is touched', async () => {
    const project = await createProject('standard', 'STANDARD');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .post(manualRunUrl(project.id))
      .send({ manualRequestId: '11111111-1111-4111-8111-111111111111' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    expect(fake.calls).toEqual([]);
  });

  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    'returns exactly 202 for %s and derives requestedBy from the project route',
    async (planLevel) => {
      const project = await createProject(planLevel.toLowerCase(), planLevel);
      const fake = createFakeOptimizationOrchestrationApi();
      const app = appWithOptimizationApi(fake.api);
      const manualRequestId = planLevel === 'ADVANCED'
        ? '22222222-2222-4222-8222-222222222222'
        : '33333333-3333-4333-8333-333333333333';

      const response = await request(app)
        .post(manualRunUrl(project.id))
        .send({ manualRequestId })
        .expect(202);

      expect(response.body.data).toMatchObject({
        projectId: project.id,
        triggerType: 'MANUAL',
        status: 'QUEUED'
      });
      expect(fake.calls).toEqual([{
        projectId: project.id,
        manualRequestId,
        requestedBy: `project-api:${project.id}`
      }]);
    }
  );

  it('rejects malformed UUIDs and unknown fields before the trigger API is touched', async () => {
    const project = await createProject('strict-body', 'ADVANCED');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .post(manualRunUrl(project.id))
      .send({ manualRequestId: 'not-a-uuid' })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));

    const forbiddenFields: Array<Record<string, unknown>> = [
      { requestedBy: 'attacker-controlled' },
      { actorId: 'attacker-controlled' },
      { risk: 'LOW' },
      { publicationPlanId: 'p8-plan-attacker' },
      { gitRef: 'refs/heads/main' },
      { useAi: true }
    ];

    for (const forbidden of forbiddenFields) {
      await request(app)
        .post(manualRunUrl(project.id))
        .send({
          manualRequestId: '44444444-4444-4444-8444-444444444444',
          ...forbidden
        })
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('VALIDATION_ERROR'));
    }

    expect(fake.calls).toEqual([]);
  });

  it('does not expose a GET orchestration route or invoke the mutation API for unrelated GETs', async () => {
    const project = await createProject('no-get', 'ADVANCED');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .get(manualRunUrl(project.id))
      .expect(404);

    await request(app)
      .get('/health/live')
      .expect(200);

    expect(fake.calls).toEqual([]);
  });
});
