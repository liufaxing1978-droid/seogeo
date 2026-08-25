import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const targetUserIds: string[] = [];

async function seed(options: Parameters<typeof seedAuthenticatedUser>[0]) {
  const fixture = await seedAuthenticatedUser(options);
  fixtures.push(fixture);
  return fixture;
}

async function createTargetUser(status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `membership-target-${suffix}@example.com`,
      normalizedEmail: `membership-target-${suffix}@example.com`,
      passwordHash: 'test-only-hash',
      status,
    },
  });
  targetUserIds.push(user.id);
  return user;
}

function csrf(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
  for (const id of targetUserIds.splice(0).reverse()) {
    await prisma.user.delete({ where: { id } }).catch(() => undefined);
  }
});

describe('P10-A project membership API', () => {
  it('allows ADMIN/OWNER membership reads but denies VIEWER', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const viewer = await seed({
      role: 'VIEWER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });

    const ownerResponse = await request(createApp())
      .get(`/api/projects/${owner.project.id}/members`)
      .set('Cookie', owner.sessionCookie);
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: owner.user.id, role: 'OWNER', status: 'ACTIVE' }),
    ]));

    const viewerResponse = await request(createApp())
      .get(`/api/projects/${viewer.project.id}/members`)
      .set('Cookie', viewer.sessionCookie);
    expect(viewerResponse.status).toBe(403);
    expect(viewerResponse.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });
  });

  it('creates an ACTIVE membership and audit event atomically for an OWNER', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const target = await createTargetUser();

    const response = await request(createApp())
      .post(`/api/projects/${owner.project.id}/members`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrf(owner))
      .send({ email: target.email, role: 'VIEWER' });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      projectId: owner.project.id,
      userId: target.id,
      role: 'VIEWER',
      status: 'ACTIVE',
    });
    await expect(prisma.securityAuditEvent.findFirst({
      where: {
        eventType: 'MEMBERSHIP_CREATED',
        actorUserId: owner.user.id,
        targetUserId: target.id,
        projectId: owner.project.id,
      },
    })).resolves.toMatchObject({ roleAfter: 'VIEWER' });
  });

  it('rejects unsafe membership writes without valid CSRF before creating a membership', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const target = await createTargetUser();

    const response = await request(createApp())
      .post(`/api/projects/${owner.project.id}/members`)
      .set('Cookie', owner.sessionCookie)
      .send({ email: target.email, role: 'VIEWER' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ error: { code: 'CSRF_INVALID' } });
    await expect(prisma.projectMembership.findUnique({
      where: { projectId_userId: { projectId: owner.project.id, userId: target.id } },
    })).resolves.toBeNull();
  });

  it('returns USER_NOT_AVAILABLE for missing or disabled users', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const disabled = await createTargetUser('DISABLED');

    for (const email of [disabled.email, `missing-${Date.now()}@example.com`]) {
      const response = await request(createApp())
        .post(`/api/projects/${owner.project.id}/members`)
        .set('Cookie', owner.sessionCookie)
        .set('X-CSRF-Token', csrf(owner))
        .send({ email, role: 'VIEWER' });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ error: { code: 'USER_NOT_AVAILABLE' } });
    }
  });

  it('limits ADMIN membership management to VIEWER and OPERATOR targets', async () => {
    const admin = await seed({
      role: 'ADMIN', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const target = await createTargetUser();

    const denied = await request(createApp())
      .post(`/api/projects/${admin.project.id}/members`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', csrf(admin))
      .send({ email: target.email, role: 'ADMIN' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ error: { code: 'PROJECT_CAPABILITY_REQUIRED' } });

    const allowed = await request(createApp())
      .post(`/api/projects/${admin.project.id}/members`)
      .set('Cookie', admin.sessionCookie)
      .set('X-CSRF-Token', csrf(admin))
      .send({ email: target.email, role: 'OPERATOR' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.data).toMatchObject({ role: 'OPERATOR', status: 'ACTIVE' });
  });

  it('reactivates a revoked membership in place and appends MEMBERSHIP_REACTIVATED', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const target = await createTargetUser();
    const revoked = await prisma.projectMembership.create({
      data: { projectId: owner.project.id, userId: target.id, role: 'VIEWER', status: 'REVOKED' },
    });

    const response = await request(createApp())
      .post(`/api/projects/${owner.project.id}/members`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrf(owner))
      .send({ email: target.email, role: 'OPERATOR' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: revoked.id, role: 'OPERATOR', status: 'ACTIVE' });
    await expect(prisma.securityAuditEvent.findFirst({
      where: { eventType: 'MEMBERSHIP_REACTIVATED', projectId: owner.project.id, targetUserId: target.id },
    })).resolves.toMatchObject({ roleBefore: 'VIEWER', roleAfter: 'OPERATOR' });
  });

  it('fails closed when demoting or revoking the last ACTIVE OWNER', async () => {
    const owner = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });

    const demote = await request(createApp())
      .patch(`/api/projects/${owner.project.id}/members/${owner.membership.id}`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrf(owner))
      .send({ role: 'ADMIN' });
    expect(demote.status).toBe(409);
    expect(demote.body).toMatchObject({ error: { code: 'LAST_PROJECT_OWNER_REQUIRED' } });

    const revoke = await request(createApp())
      .delete(`/api/projects/${owner.project.id}/members/${owner.membership.id}`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrf(owner));
    expect(revoke.status).toBe(409);
    expect(revoke.body).toMatchObject({ error: { code: 'LAST_PROJECT_OWNER_REQUIRED' } });

    await expect(prisma.projectMembership.findUnique({ where: { id: owner.membership.id } }))
      .resolves.toMatchObject({ role: 'OWNER', status: 'ACTIVE' });
  });

  it('hides a membership id that belongs to another project', async () => {
    const ownerA = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });
    const ownerB = await seed({
      role: 'OWNER', planLevel: 'ADVANCED', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE',
    });

    const response = await request(createApp())
      .patch(`/api/projects/${ownerA.project.id}/members/${ownerB.membership.id}`)
      .set('Cookie', ownerA.sessionCookie)
      .set('X-CSRF-Token', csrf(ownerA))
      .send({ role: 'VIEWER' });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'PROJECT_NOT_FOUND' } });
  });
});
