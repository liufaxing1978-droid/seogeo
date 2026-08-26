import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const app = createApp();
const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const extraProjectIds: string[] = [];

async function seedOwner() {
  const fixture = await seedAuthenticatedUser({
    role: 'OWNER',
    planLevel: 'ADVANCED',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
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

afterEach(async () => {
  for (const projectId of extraProjectIds.splice(0).reverse()) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('project API', () => {
  it('creates a project and returns 201', async () => {
    const owner = await seedOwner();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfFor(owner))
      .send({
        name: 'Example Project',
        slug: `example-project-${suffix}`,
        primaryDomain: `example-${suffix}.com`,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.primaryDomain).toBe(`example-${suffix}.com`);
    extraProjectIds.push(response.body.data.id);
  });

  it('rejects an invalid slug', async () => {
    const owner = await seedOwner();
    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfFor(owner))
      .send({
        name: 'Example Project',
        slug: 'Bad Slug',
        primaryDomain: 'invalid-slug.example.com',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns joined projects newest first', async () => {
    const owner = await seedOwner();
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const older = await prisma.project.create({
      data: {
        name: 'Older',
        slug: `older-${suffix}`,
        primaryDomain: `older-${suffix}.com`,
        createdAt: new Date('2026-08-17T00:00:00Z'),
        memberships: {
          create: {
            userId: owner.user.id,
            role: 'VIEWER',
            status: 'ACTIVE',
          },
        },
      },
    });
    const newer = await prisma.project.create({
      data: {
        name: 'Newer',
        slug: `newer-${suffix}`,
        primaryDomain: `newer-${suffix}.com`,
        createdAt: new Date('2026-08-18T00:00:00Z'),
        memberships: {
          create: {
            userId: owner.user.id,
            role: 'VIEWER',
            status: 'ACTIVE',
          },
        },
      },
    });
    extraProjectIds.push(older.id, newer.id);

    const response = await request(app)
      .get('/api/projects')
      .set('Cookie', owner.sessionCookie);

    expect(response.status).toBe(200);
    const relevantSlugs = response.body.data
      .map((item: { slug: string }) => item.slug)
      .filter((slug: string) => slug === older.slug || slug === newer.slug);
    expect(relevantSlugs).toEqual([newer.slug, older.slug]);
  });

  it('returns 404 for an unknown UUID', async () => {
    const owner = await seedOwner();
    const response = await request(app)
      .get('/api/projects/00000000-0000-4000-8000-000000000999')
      .set('Cookie', owner.sessionCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
