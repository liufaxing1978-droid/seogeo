import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticationMiddleware, requireAuthentication } from '../../src/auth/authentication.js';
import {
  assertProjectCapability,
  requireProjectCapability,
  requireProjectMembership,
} from '../../src/auth/project-access.js';
import { requireFeature } from '../../src/auth/require-feature.js';
import { errorHandler } from '../../src/core/http.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

async function seed(options: Parameters<typeof seedAuthenticatedUser>[0]) {
  const fixture = await seedAuthenticatedUser(options);
  fixtures.push(fixture);
  return fixture;
}

function createProbeApp() {
  const app = express();
  app.use(authenticationMiddleware);

  app.get(
    '/projects/:projectId/read',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    (_req, res) => res.json({
      projectId: res.locals.project?.id,
      role: res.locals.projectMembership?.role,
    }),
  );

  app.get(
    '/projects/:projectId/settings',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
    (_req, res) => res.status(204).end(),
  );

  app.get(
    '/feature/:projectId',
    (_req, res, next) => {
      res.locals.project = { id: 'already-resolved', planLevel: 'ADVANCED' };
      next();
    },
    requireFeature('OPTIMIZATION_OPERATIONS_CENTER'),
    (_req, res) => res.status(204).end(),
  );

  app.use(errorHandler);
  return app;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('P10-A central project authorization', () => {
  it('requires authentication before project membership resolution', async () => {
    const projectOwner = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${projectOwner.project.id}/read`);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED' },
    });
  });

  it('hides an existing project from an authenticated non-member', async () => {
    const userA = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const userB = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${userB.project.id}/read`)
      .set('Cookie', userA.sessionCookie);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });

  it('treats a revoked membership as PROJECT_NOT_FOUND', async () => {
    const revoked = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'REVOKED',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${revoked.project.id}/read`)
      .set('Cookie', revoked.sessionCookie);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });

  it('resolves the project and ACTIVE membership once for an allowed VIEWER read', async () => {
    const viewer = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${viewer.project.id}/read`)
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      projectId: viewer.project.id,
      role: 'VIEWER',
    });
  });

  it('returns PROJECT_CAPABILITY_REQUIRED for an ACTIVE member lacking capability', async () => {
    const viewer = await seed({
      role: 'VIEWER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${viewer.project.id}/settings`)
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: { code: 'PROJECT_CAPABILITY_REQUIRED' },
    });
  });

  it('allows ADMIN project settings capability', async () => {
    const admin = await seed({
      role: 'ADMIN',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createProbeApp())
      .get(`/projects/${admin.project.id}/settings`)
      .set('Cookie', admin.sessionCookie);

    expect(response.status).toBe(204);
  });

  it('enforces the same non-enumerating rule through assertProjectCapability', async () => {
    const userA = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const userB = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    await expect(
      assertProjectCapability(userA.user.id, userB.project.id, 'PROJECT_READ'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'PROJECT_NOT_FOUND',
    });

    await expect(
      assertProjectCapability(userA.user.id, userA.project.id, 'PROJECT_READ'),
    ).resolves.toMatchObject({
      project: { id: userA.project.id },
      membership: { role: 'VIEWER', status: 'ACTIVE' },
    });
  });

  it('makes requireFeature reuse a project already resolved into res.locals', async () => {
    const response = await request(createProbeApp()).get('/feature/not-a-database-project-id');
    expect(response.status).toBe(204);
  });
});
