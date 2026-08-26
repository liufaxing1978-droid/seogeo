import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const directProjectIds: string[] = [];

async function seed(options: Parameters<typeof seedAuthenticatedUser>[0]) {
  const fixture = await seedAuthenticatedUser(options);
  fixtures.push(fixture);
  return fixture;
}

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

async function createDirectProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED',
    },
  });
  directProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  for (const projectId of directProjectIds.splice(0).reverse()) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('P10-A authenticated project web and portfolio scope', () => {
  it('requires authentication for dashboard and project web entry points', async () => {
    const project = await createDirectProject('Anonymous web guard');
    const app = createApp();

    for (const response of [
      await request(app).get('/'),
      await request(app).get('/projects'),
      await request(app).get('/projects/new'),
      await request(app).get(`/projects/${project.id}`),
    ]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHENTICATION_REQUIRED' },
      });
    }
  });

  it('scopes dashboard and project list to ACTIVE memberships only', async () => {
    const viewer = await seed({
      role: 'VIEWER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const other = await createDirectProject('Other tenant project');
    const revoked = await createDirectProject('Revoked tenant project');
    await prisma.projectMembership.create({
      data: {
        projectId: revoked.id,
        userId: viewer.user.id,
        role: 'VIEWER',
        status: 'REVOKED',
      },
    });
    const app = createApp();

    const dashboard = await request(app)
      .get('/')
      .set('Cookie', viewer.sessionCookie);
    const list = await request(app)
      .get('/projects')
      .set('Cookie', viewer.sessionCookie);

    expect(dashboard.status).toBe(200);
    expect(dashboard.text).toContain(viewer.project.name);
    expect(dashboard.text).not.toContain(other.name);
    expect(dashboard.text).not.toContain(revoked.name);

    expect(list.status).toBe(200);
    expect(list.text).toContain(viewer.project.name);
    expect(list.text).not.toContain(other.name);
    expect(list.text).not.toContain(revoked.name);
  });

  it('renders a server-derived CSRF token on the authenticated new-project form', async () => {
    const owner = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    const response = await request(createApp())
      .get('/projects/new')
      .set('Cookie', owner.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('name="_csrf"');
    expect(response.text).toContain(`value="${csrfFor(owner)}"`);
  });

  it('requires CSRF and creates the authenticated user as ACTIVE OWNER from the web form', async () => {
    const owner = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      name: 'Web owned project',
      slug: `web-owned-${suffix}`,
      primaryDomain: `web-owned-${suffix}.example.com`,
      planLevel: 'ADVANCED',
    };
    const app = createApp();

    const before = await prisma.project.count();
    const rejected = await request(app)
      .post('/projects')
      .set('Cookie', owner.sessionCookie)
      .type('form')
      .send(payload);
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    await expect(prisma.project.count()).resolves.toBe(before);

    const allowed = await request(app)
      .post('/projects')
      .set('Cookie', owner.sessionCookie)
      .type('form')
      .send({ ...payload, _csrf: csrfFor(owner) });
    expect(allowed.status).toBe(303);
    expect(allowed.headers.location).toMatch(/^\/projects\//);

    const projectId = allowed.headers.location.split('/').pop()!;
    directProjectIds.push(projectId);
    await expect(prisma.projectMembership.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId: owner.user.id,
        },
      },
    })).resolves.toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
  });

  it('uses non-enumerating 404 for a project detail outside the authenticated membership set', async () => {
    const viewer = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const other = await createDirectProject('Hidden web project');
    const app = createApp();

    const allowed = await request(app)
      .get(`/projects/${viewer.project.id}`)
      .set('Cookie', viewer.sessionCookie);
    const hidden = await request(app)
      .get(`/projects/${other.id}`)
      .set('Cookie', viewer.sessionCookie);

    expect(allowed.status).toBe(200);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
  });
});
