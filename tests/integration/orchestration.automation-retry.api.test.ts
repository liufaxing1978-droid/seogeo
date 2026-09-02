import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const RUN_ID = '77777777-7777-4777-8777-777777777777';

async function seed(role: 'VIEWER' | 'OPERATOR' | 'ADMIN' | 'OWNER') {
  const fixture = await seedAuthenticatedUser({
    role,
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  fixtures.push(fixture);
  return fixture;
}

function csrf(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

function retryUrl(projectId: string) {
  return `/api/v1/projects/${projectId}/optimization/automation-runs/${RUN_ID}/retry`;
}

function createFakeApi(projectId: string) {
  return {
    triggerManual: vi.fn().mockResolvedValue({ id: 'optimization-run-1', status: 'QUEUED' }),
    retryAutomationRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      projectId,
      status: 'QUEUED',
      attempt: 2,
    }),
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('OL-3 automation retry API', () => {
  it('rejects unauthenticated retry commands before touching the automation API', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(retryUrl(owner.project.id))
      .send({});

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    expect(api.retryAutomationRun).not.toHaveBeenCalled();
  });

  it('requires OPTIMIZATION_RUN instead of allowing a VIEWER to retry failed automation', async () => {
    const viewer = await seed('VIEWER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(retryUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie)
      .set('X-CSRF-Token', csrf(viewer))
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
    expect(api.retryAutomationRun).not.toHaveBeenCalled();
  });

  it('requires valid CSRF from an OPERATOR before retrying automation', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(retryUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .send({});

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    expect(api.retryAutomationRun).not.toHaveBeenCalled();
  });

  it('rejects attacker-controlled retry body fields before touching the automation API', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(retryUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send({ actorId: 'attacker-controlled' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(api.retryAutomationRun).not.toHaveBeenCalled();
  });

  it('accepts an authorized retry as a project-scoped async command', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(retryUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send({});

    expect(response.status).toBe(202);
    expect(response.body.data).toMatchObject({
      id: RUN_ID,
      projectId: operator.project.id,
      status: 'QUEUED',
      attempt: 2,
    });
    expect(api.retryAutomationRun).toHaveBeenCalledWith({
      projectId: operator.project.id,
      runId: RUN_ID,
    });
  });
});
