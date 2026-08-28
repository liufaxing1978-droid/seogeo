import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

describe('P11-01 keyword JSON API authorization', () => {
  it('rejects anonymous keyword reads', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/00000000-0000-0000-0000-000000000001/keywords')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('lets VIEWER read but rejects keyword mutation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const read = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(read.body.data).toEqual([]);

      const response = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed for a project with no active membership', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const foreignProject = await prisma.project.create({
      data: {
        name: `Foreign keyword project ${suffix}`,
        slug: `foreign-keyword-${suffix}`,
        primaryDomain: `foreign-keyword-${suffix}.example.com`,
        planLevel: 'ENTERPRISE',
      },
    });

    try {
      const response = await request(createApp())
        .get(`/api/v1/projects/${foreignProject.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    } finally {
      await prisma.project.delete({ where: { id: foreignProject.id } }).catch(() => undefined);
      await fixture.cleanup();
    }
  });

  it('requires a valid CSRF token for OPERATOR mutations', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const missing = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);
      expect(missing.body.error.code).toBe('CSRF_INVALID');

      const invalid = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', 'invalid')
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);
      expect(invalid.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('lets an OPERATOR create and then list a manual keyword', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const created = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          text: ' 符纸 ',
          type: 'CORE',
          intent: 'INFORMATIONAL',
          priority: 'HIGH',
        })
        .expect(201);

      expect(created.body.data).toMatchObject({
        text: '符纸',
        normalizedText: '符纸',
        type: 'CORE',
        source: 'MANUAL',
      });

      const listed = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(listed.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: created.body.data.id, normalizedText: '符纸' }),
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
