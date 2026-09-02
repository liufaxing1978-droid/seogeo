import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const DEFINITION_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const MANUAL_REQUEST_ID = '66666666-6666-4666-8666-666666666666';

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

function definition(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: DEFINITION_ID,
    projectId,
    key: 'daily-search-refresh',
    actionType: 'SEARCH_REFRESH',
    actionConfig: {
      version: 'SEARCH_REFRESH_V1',
      bindingId: BINDING_ID,
      lookbackDays: 7,
      lagDays: 1,
    },
    enabled: true,
    scheduleCron: '0 7 * * *',
    overlapPolicy: 'SKIP_IF_RUNNING',
    maxAttempts: 3,
    timeoutMs: 300_000,
    createdAt: new Date('2026-09-02T21:00:00.000Z'),
    updatedAt: new Date('2026-09-02T21:00:00.000Z'),
    ...overrides,
  };
}

function createFakeApi(projectId: string) {
  const current = definition(projectId);
  const api = {
    triggerManual: vi.fn().mockResolvedValue({ id: 'optimization-run-1', status: 'QUEUED' }),
    listAutomationDefinitions: vi.fn().mockResolvedValue([current]),
    createAutomationDefinition: vi.fn().mockResolvedValue(current),
    updateAutomationDefinition: vi.fn().mockImplementation(async (input: { patch: Record<string, unknown> }) => ({
      ...current,
      ...input.patch,
    })),
    reconcileAutomationSchedules: vi.fn().mockResolvedValue({ considered: 1, synced: 1 }),
  };
  return api;
}

function definitionsUrl(projectId: string) {
  return `/api/v1/projects/${projectId}/optimization/automation-definitions`;
}

function runsUrl(projectId: string) {
  return `/api/v1/projects/${projectId}/optimization/runs`;
}

function createBody() {
  return {
    key: 'daily-search-refresh',
    actionType: 'SEARCH_REFRESH',
    actionConfig: {
      version: 'SEARCH_REFRESH_V1',
      bindingId: BINDING_ID,
      lookbackDays: 7,
      lagDays: 1,
    },
    enabled: true,
    scheduleCron: '0 7 * * *',
    maxAttempts: 3,
    timeoutMs: 300_000,
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('OL-3 automation definition management API', () => {
  it('allows an authenticated project VIEWER to list only that project definitions', async () => {
    const viewer = await seed('VIEWER');
    const other = await seed('OWNER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .get(definitionsUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: DEFINITION_ID,
        projectId: viewer.project.id,
        key: 'daily-search-refresh',
      }),
    ]);
    expect(api.listAutomationDefinitions).toHaveBeenCalledWith(viewer.project.id);

    const hidden = await request(app)
      .get(definitionsUrl(other.project.id))
      .set('Cookie', viewer.sessionCookie);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
    expect(api.listAutomationDefinitions).toHaveBeenCalledTimes(1);
  });

  it('requires PROJECT_SETTINGS_WRITE and valid CSRF before creating a definition', async () => {
    const operator = await seed('OPERATOR');
    const operatorApi = createFakeApi(operator.project.id);
    const operatorApp = createApp({ optimizationOrchestrationApi: operatorApi as never });

    const denied = await request(operatorApp)
      .post(definitionsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send(createBody());
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
    expect(operatorApi.createAutomationDefinition).not.toHaveBeenCalled();

    const admin = await seed('ADMIN');
    const adminApi = createFakeApi(admin.project.id);
    const adminApp = createApp({ optimizationOrchestrationApi: adminApi as never });

    const noCsrf = await request(adminApp)
      .post(definitionsUrl(admin.project.id))
      .set('Cookie', admin.sessionCookie)
      .send(createBody());
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    expect(adminApi.createAutomationDefinition).not.toHaveBeenCalled();

    const created = await request(adminApp)
      .post(definitionsUrl(admin.project.id))
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', csrf(admin))
      .send(createBody());
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      projectId: admin.project.id,
      key: 'daily-search-refresh',
      enabled: true,
    });
    expect(adminApi.createAutomationDefinition).toHaveBeenCalledWith({
      projectId: admin.project.id,
      ...createBody(),
    });
  });

  it('patches enable/schedule state through the project-scoped API and rejects unknown fields', async () => {
    const admin = await seed('ADMIN');
    const api = createFakeApi(admin.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .patch(`${definitionsUrl(admin.project.id)}/${DEFINITION_ID}`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', csrf(admin))
      .send({ enabled: false, scheduleCron: null });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ enabled: false, scheduleCron: null });
    expect(api.updateAutomationDefinition).toHaveBeenCalledWith({
      projectId: admin.project.id,
      definitionId: DEFINITION_ID,
      patch: { enabled: false, scheduleCron: null },
    });

    const malformed = await request(app)
      .patch(`${definitionsUrl(admin.project.id)}/${DEFINITION_ID}`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', csrf(admin))
      .send({ enabled: true, actorId: 'attacker-controlled' });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(api.updateAutomationDefinition).toHaveBeenCalledTimes(1);
  });

  it('offers an ADMIN/OWNER-only CSRF-protected reconciliation command for scheduler drift repair', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(`${definitionsUrl(owner.project.id)}/reconcile`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrf(owner))
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ considered: 1, synced: 1 });
    expect(api.reconcileAutomationSchedules).toHaveBeenCalledWith(owner.project.id);
  });

  it('rejects unauthenticated manual optimization triggers', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(owner.project.id))
      .send({ manualRequestId: MANUAL_REQUEST_ID });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    expect(api.triggerManual).not.toHaveBeenCalled();
  });

  it('requires OPTIMIZATION_RUN instead of allowing a VIEWER to trigger optimization', async () => {
    const viewer = await seed('VIEWER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie)
      .set('X-CSRF-Token', csrf(viewer))
      .send({ manualRequestId: MANUAL_REQUEST_ID });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
    expect(api.triggerManual).not.toHaveBeenCalled();
  });

  it('requires valid CSRF from an OPERATOR before triggering optimization', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .send({ manualRequestId: MANUAL_REQUEST_ID });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    expect(api.triggerManual).not.toHaveBeenCalled();
  });

  it('binds an authorized manual trigger to the authenticated user actor', async () => {
    const operator = await seed('OPERATOR');
    const api = createFakeApi(operator.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .post(runsUrl(operator.project.id))
      .set('Cookie', operator.sessionCookie)
      .set('X-CSRF-Token', csrf(operator))
      .send({ manualRequestId: MANUAL_REQUEST_ID });

    expect(response.status).toBe(202);
    expect(api.triggerManual).toHaveBeenCalledWith({
      projectId: operator.project.id,
      manualRequestId: MANUAL_REQUEST_ID,
      requestedBy: `user:${operator.user.id}`,
    });
  });
});
