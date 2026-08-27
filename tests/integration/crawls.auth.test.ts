import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const directProjectIds: string[] = [];

async function createDirectProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `crawl-auth-${suffix}`,
      primaryDomain: `crawl-auth-${suffix}.example.com`,
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

describe('crawl API project authorization', () => {
  it('rejects anonymous project crawl reads', async () => {
    const project = await createDirectProject('Anonymous crawl guard');

    const response = await request(createApp()).get(`/api/projects/${project.id}/crawls`);

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ error: { code: 'AUTHENTICATION_REQUIRED' } });
  });

  it('hides project crawl reads from authenticated non-members', async () => {
    const viewer = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    fixtures.push(viewer);
    const other = await createDirectProject('Other crawl project');

    const response = await request(createApp())
      .get(`/api/projects/${other.id}/crawls`)
      .set('Cookie', viewer.sessionCookie);

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
  });

  it('forbids viewers from starting project crawls', async () => {
    const viewer = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'STANDARD',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    fixtures.push(viewer);
    const csrfToken = deriveCsrfToken(
      env.SESSION_SECRET,
      viewer.csrfInput.sessionId,
      viewer.csrfInput.tokenHash,
    );

    const response = await request(createApp())
      .post(`/api/projects/${viewer.project.id}/crawls`)
      .set('Cookie', viewer.sessionCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ runType: 'MANUAL' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
  });
});
