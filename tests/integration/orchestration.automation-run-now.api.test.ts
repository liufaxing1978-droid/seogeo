import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const DEFINITION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function runsUrl(projectId: string) {
  return `/api/v1/projects/${projectId}/optimization/automation-runs`;
}

function createFakeApi(projectId: string) {
  return {
    triggerManual: vi.fn().mockResolvedValue({ id: 'optimization-run-1', status: 'QUEUED' }),
    startAutomationRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      definitionId: DEFINITION_ID,
      projectId,
      source: 'MANUAL',
      requestKey: 'manual:run-now-1',
      status: 'QUEUED',
      attempt: 1,
    }),
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('OL-3 automation run-now API', () => {
  it('requires authentication before creating a manual automation run', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(owner.project.id))
      .send({ definitionId: DEFINITION_ID, requestKey: 'manual:run-now-1' });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    expect(api.startAutomationRun).not.toHaveBeenCalled();
  });

  it('requires OPTIMIZATION_RUN instead of allowing a VIEWER to run automation', async () => {
    const viewer = await seed('VIEWER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie)
      .set('X-CSRF-Token', csrf(viewer))
      .send({ definitionId: DEFINITION_ID, requestKey: 'manual:run-now-1' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
    expect(api.startAutomationRun).not.toHaveBeenCalled();
  });

  it('requires valid CSRF from an OPERATOR before running automation', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .send({ definitionId: DEFINITION_ID, requestKey: 'manual:run-now-1' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    expect(api.startAutomationRun).not.toHaveBeenCalled();
  });

  it('rejects attacker-controlled source fields before touching the automation API', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send({
        definitionId: DEFINITION_ID,
        requestKey: 'manual:run-now-1',
        source: 'SCHEDULED',
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(api.startAutomationRun).not.toHaveBeenCalled();
  });

  it('creates an authorized project-scoped manual automation run asynchronously', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send({ definitionId: DEFINITION_ID, requestKey: 'manual:run-now-1' });

    expect(response.status).toBe(202);
    expect(response.body.data).toMatchObject({
      id: RUN_ID,
      definitionId: DEFINITION_ID,
      projectId: operator.project.id,
      source: 'MANUAL',
      status: 'QUEUED',
      attempt: 1,
    });
    expect(api.startAutomationRun).toHaveBeenCalledWith({
      projectId: operator.project.id,
      definitionId: DEFINITION_ID,
      source: 'MANUAL',
      requestKey: 'manual:run-now-1',
    });
  });
});
