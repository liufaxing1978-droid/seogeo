import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const RUN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seed(role: 'VIEWER' | 'OWNER') {
  const fixture = await seedAuthenticatedUser({
    role,
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  fixtures.push(fixture);
  return fixture;
}

function runUrl(projectId: string, runId: string = RUN_ID) {
  return `/api/v1/projects/${projectId}/optimization/automation-runs/${runId}`;
}

function createFakeApi(projectId: string) {
  return {
    triggerManual: vi.fn().mockResolvedValue({ id: 'optimization-run-1', status: 'QUEUED' }),
    getAutomationRun: vi.fn().mockResolvedValue({
      id: RUN_ID,
      projectId,
      definitionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: 'MANUAL',
      requestKey: 'manual:detail-1',
      status: 'SUCCEEDED',
      attempt: 1,
      lastErrorCode: null,
    }),
  };
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('OL-3 automation run detail API', () => {
  it('requires authentication before reading an automation run', async () => {
    const owner = await seed('OWNER');
    const api = createFakeApi(owner.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app).get(runUrl(owner.project.id));

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    expect(api.getAutomationRun).not.toHaveBeenCalled();
  });

  it('allows a project VIEWER to read one project-scoped automation run', async () => {
    const viewer = await seed('VIEWER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .get(runUrl(viewer.project.id))
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: RUN_ID,
      projectId: viewer.project.id,
      status: 'SUCCEEDED',
      attempt: 1,
    });
    expect(api.getAutomationRun).toHaveBeenCalledWith({
      projectId: viewer.project.id,
      runId: RUN_ID,
    });
  });

  it('rejects an invalid run id before touching the automation API', async () => {
    const viewer = await seed('VIEWER');
    const api = createFakeApi(viewer.project.id);
    const app = createApp({ optimizationOrchestrationApi: api as never });

    const response = await request(app)
      .get(runUrl(viewer.project.id, 'not-a-uuid'))
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(api.getAutomationRun).not.toHaveBeenCalled();
  });
});
