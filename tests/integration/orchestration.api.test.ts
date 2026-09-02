import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import type { OptimizationOrchestrationApiPort } from '../../src/modules/optimization-orchestration/orchestration.routes.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

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

async function seedOperator(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE') {
  const fixture = await seedAuthenticatedUser({
    role: 'OPERATOR',
    planLevel,
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE'
  });
  fixtures.push(fixture);
  return fixture;
}

function csrf(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash
  );
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('P9-B strict manual orchestration API', () => {
  it('returns 403 for STANDARD before the trigger API is touched', async () => {
    const fixture = await seedOperator('STANDARD');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .post(manualRunUrl(fixture.project.id))
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrf(fixture))
      .send({ manualRequestId: '11111111-1111-4111-8111-111111111111' })
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    expect(fake.calls).toEqual([]);
  });

  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    'returns exactly 202 for %s and binds requestedBy to the authenticated user',
    async (planLevel) => {
      const fixture = await seedOperator(planLevel);
      const fake = createFakeOptimizationOrchestrationApi();
      const app = appWithOptimizationApi(fake.api);
      const manualRequestId = planLevel === 'ADVANCED'
        ? '22222222-2222-4222-8222-222222222222'
        : '33333333-3333-4333-8333-333333333333';

      const response = await request(app)
        .post(manualRunUrl(fixture.project.id))
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf(fixture))
        .send({ manualRequestId })
        .expect(202);

      expect(response.body.data).toMatchObject({
        projectId: fixture.project.id,
        triggerType: 'MANUAL',
        status: 'QUEUED'
      });
      expect(fake.calls).toEqual([{
        projectId: fixture.project.id,
        manualRequestId,
        requestedBy: `user:${fixture.user.id}`
      }]);
    }
  );

  it('rejects malformed UUIDs and unknown fields before the trigger API is touched', async () => {
    const fixture = await seedOperator('ADVANCED');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .post(manualRunUrl(fixture.project.id))
      .set('Cookie', fixture.sessionCookie)
      .set('X-CSRF-Token', csrf(fixture))
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
        .post(manualRunUrl(fixture.project.id))
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf(fixture))
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
    const fixture = await seedOperator('ADVANCED');
    const fake = createFakeOptimizationOrchestrationApi();
    const app = appWithOptimizationApi(fake.api);

    await request(app)
      .get(manualRunUrl(fixture.project.id))
      .expect(404);

    await request(app)
      .get('/health/live')
      .expect(200);

    expect(fake.calls).toEqual([]);
  });
});
