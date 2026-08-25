import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { projectRepository } from '../../src/modules/projects/project.repository.js';
import { ProjectService } from '../../src/modules/projects/project.service.js';
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

describe('P10-A project ownership and membership scoping', () => {
  it('rejects anonymous project create/list/get/update requests', async () => {
    const project = await createDirectProject('Anonymous guard');
    const app = createApp();

    const createResponse = await request(app).post('/api/projects').send({
      name: 'Anonymous create',
      slug: `anonymous-create-${Date.now()}`,
      primaryDomain: 'anonymous-create.example.com',
      planLevel: 'ADVANCED',
    });
    const listResponse = await request(app).get('/api/projects');
    const getResponse = await request(app).get(`/api/projects/${project.id}`);
    const patchResponse = await request(app)
      .patch(`/api/projects/${project.id}`)
      .send({ name: 'Anonymous update' });

    for (const response of [createResponse, listResponse, getResponse, patchResponse]) {
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHENTICATION_REQUIRED' },
      });
    }
  });

  it('creates an ACTIVE OWNER membership in the same project creation flow', async () => {
    const owner = await seed({
      role: 'OWNER',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const response = await request(createApp())
      .post('/api/projects')
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfFor(owner))
      .send({
        name: 'Owned project',
        slug: `owned-project-${suffix}`,
        primaryDomain: `owned-project-${suffix}.example.com`,
        planLevel: 'ADVANCED',
      });

    expect(response.status).toBe(201);
    directProjectIds.push(response.body.data.id);

    await expect(
      prisma.projectMembership.findUnique({
        where: {
          projectId_userId: {
            projectId: response.body.data.id,
            userId: owner.user.id,
          },
        },
      }),
    ).resolves.toMatchObject({
      role: 'OWNER',
      status: 'ACTIVE',
    });
  });

  it('rolls project creation back when OWNER membership persistence fails', async () => {
    const service = new ProjectService(projectRepository) as ProjectService & {
      createForOwner(userId: string, input: unknown): Promise<unknown>;
    };
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const slug = `rollback-owner-${suffix}`;

    await expect(
      Promise.resolve().then(() => service.createForOwner(randomUUID(), {
        name: 'Rollback owner',
        slug,
        primaryDomain: `rollback-owner-${suffix}.example.com`,
        planLevel: 'ADVANCED',
      })),
    ).rejects.toBeDefined();

    await expect(prisma.project.findUnique({ where: { slug } })).resolves.toBeNull();
  });

  it('lists only projects joined through an ACTIVE membership', async () => {
    const user = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const nonMember = await createDirectProject('Non member');
    const revoked = await createDirectProject('Revoked member');
    await prisma.projectMembership.create({
      data: {
        projectId: revoked.id,
        userId: user.user.id,
        role: 'VIEWER',
        status: 'REVOKED',
      },
    });

    const response = await request(createApp())
      .get('/api/projects')
      .set('Cookie', user.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.map((project: { id: string }) => project.id)).toEqual([
      user.project.id,
    ]);
    expect(response.body.data.map((project: { id: string }) => project.id)).not.toContain(nonMember.id);
    expect(response.body.data.map((project: { id: string }) => project.id)).not.toContain(revoked.id);
  });

  it('hides project detail from authenticated non-members and allows ACTIVE members to read it', async () => {
    const viewer = await seed({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const other = await createDirectProject('Other project');
    const app = createApp();

    const allowed = await request(app)
      .get(`/api/projects/${viewer.project.id}`)
      .set('Cookie', viewer.sessionCookie);
    const hidden = await request(app)
      .get(`/api/projects/${other.id}`)
      .set('Cookie', viewer.sessionCookie);

    expect(allowed.status).toBe(200);
    expect(allowed.body.data.id).toBe(viewer.project.id);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
  });
});
