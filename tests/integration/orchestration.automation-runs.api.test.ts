import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const RUN_ID = '88888888-8888-4888-8888-888888888888';
const DEFINITION_ID = '99999999-9999-4999-8999-999999999999';

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

function runsUrl(projectId: string) {
  return `/api/v1/projects/${projectId}/optimization/automation-runs`;
}

function automationRun(projectId: string) {
  return {
    id: RUN_ID,
    definitionId: DEFINITION_ID,
    projectId,
    source: 'SCHEDULED',
    requestKey: 'scheduler:2026-09-02T15:00:00.000Z',
    status: 'FAILED',
    attempt: 1,
    deadlineAt: new Date('2026-09-02T15:05:00.000Z'),
    blockedByRunId: null,
    startedAt: new Date('2026-09-02T15:00:01.000Z'),
    completedAt: new Date('2026-09-02T15:00:10.000Z'),
    lastErrorCode: 'UPSTREAM_UNAVAILABLE',
    createdAt: new Date('2026-09-02T15:00:00.000Z'),
    updatedAt: new Date('2026-09-02T15:00:10.000Z'),
  };
}

function createFakeApi(projectId: string) {
  return {
    triggerManual: vi.fn().mockResolvedValue({ id: 'optimization-run-1', status: 'QUEUED' }),
    listAutomationRuns: vi.fn().mockResolvedValue([automationRun(projectId)]),
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('OL-3 automation run visibility API', () => {
  it('requires authentication before listing automation runs', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app).get(runsUrl(owner.project.id));

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    expect(api.listAutomationRuns).not.toHaveBeenCalled();
  });

  it('allows a project VIEWER to list only that project recent automation runs', async () => {
    const viewer = await seed('VIEWER');
    const other = await seed('OWNER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .get(runsUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        id: RUN_ID,
        projectId: viewer.project.id,
        status: 'FAILED',
        lastErrorCode: 'UPSTREAM_UNAVAILABLE',
      }),
    ]);
    expect(api.listAutomationRuns).toHaveBeenCalledWith({
      projectId: viewer.project.id,
      limit: 50,
    });

    const hidden = await request(app)
      .get(runsUrl(other.project.id))
      .set('Cookie', viewer.sessionCookie);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
    expect(api.listAutomationRuns).toHaveBeenCalledTimes(1);
  });

  it('accepts a bounded explicit limit and rejects values above the operational cap', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .get(`${runsUrl(owner.project.id)}?limit=25`)
      .set('Cookie', owner.sessionCookie);
    expect(response.status).toBe(200);
    expect(api.listAutomationRuns).toHaveBeenCalledWith({
      projectId: owner.project.id,
      limit: 25,
    });

    api.listAutomationRuns.mockClear();
    const invalid = await request(app)
      .get(`${runsUrl(owner.project.id)}?limit=101`)
      .set('Cookie', owner.sessionCookie);
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(api.listAutomationRuns).not.toHaveBeenCalled();
  });
});
