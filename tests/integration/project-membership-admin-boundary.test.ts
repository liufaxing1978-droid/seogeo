import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

describe('P10-A ADMIN membership target boundary', () => {
  it('cannot modify or revoke OWNER/ADMIN memberships', async () => {
    const admin = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ADVANCED',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    cleanup.push(admin.cleanup);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const ownerUser = await prisma.user.create({
      data: {
        email: `admin-boundary-owner-${suffix}@example.com`,
        normalizedEmail: `admin-boundary-owner-${suffix}@example.com`,
        passwordHash: 'test-only-hash',
        status: 'ACTIVE',
      },
    });
    cleanup.push(async () => {
      await prisma.user.delete({ where: { id: ownerUser.id } }).catch(() => undefined);
    });

    const ownerMembership = await prisma.projectMembership.create({
      data: {
        projectId: admin.project.id,
        userId: ownerUser.id,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    const token = deriveCsrfToken(
      env.SESSION_SECRET,
      admin.csrfInput.sessionId,
      admin.csrfInput.tokenHash,
    );

    const roleChange = await request(createApp())
      .patch(`/api/projects/${admin.project.id}/members/${ownerMembership.id}`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', token)
      .send({ role: 'VIEWER' });
    expect(roleChange.status).toBe(403);
    expect(roleChange.body).toMatchObject({
      error: { code: 'PROJECT_CAPABILITY_REQUIRED' },
    });

    const revoke = await request(createApp())
      .delete(`/api/projects/${admin.project.id}/members/${ownerMembership.id}`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', token);
    expect(revoke.status).toBe(403);
    expect(revoke.body).toMatchObject({
      error: { code: 'PROJECT_CAPABILITY_REQUIRED' },
    });

    await expect(prisma.projectMembership.findUnique({ where: { id: ownerMembership.id } }))
      .resolves.toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
  });
});
