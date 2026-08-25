import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapOwner,
  disableUser,
  enableUser,
  provisionUser,
} from '../../scripts/auth-admin.js';
import { normalizeEmail } from '../../src/auth/email.js';
import { passwordHasher } from '../../src/auth/password.js';
import {
  SESSION_TTL_MS,
  SessionRepository,
  createSessionToken,
} from '../../src/auth/session.repository.js';
import { prisma } from '../../src/db/prisma.js';

const PASSWORD = 'server operator bootstrap password';
const createdProjectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `${label} ${suffix}`,
      slug: `auth-admin-${suffix}`,
      primaryDomain: `auth-admin-${suffix}.example.com`,
    },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function createSession(userId: string) {
  const token = createSessionToken();
  return new SessionRepository().create(
    userId,
    token.tokenHash,
    new Date(Date.now() + SESSION_TTL_MS),
  );
}

beforeEach(async () => {
  await prisma.user.deleteMany();
});

afterEach(async () => {
  await prisma.user.deleteMany();
  if (createdProjectIds.length > 0) {
    await prisma.project.deleteMany({
      where: { id: { in: createdProjectIds.splice(0) } },
    }).catch(() => undefined);
  }
});

describe('P10-A server-operator identity administration', () => {
  it('bootstraps the first ACTIVE user as OWNER of every existing project in one command', async () => {
    const first = await createProject('Bootstrap first');
    const second = await createProject('Bootstrap second');
    const allProjectIds = (await prisma.project.findMany({ select: { id: true } }))
      .map((project) => project.id);
    const email = `bootstrap-${Date.now()}@example.com`;

    await bootstrapOwner(email, PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    expect(user.status).toBe('ACTIVE');
    await expect(passwordHasher.verify(PASSWORD, user.passwordHash)).resolves.toBe(true);

    const memberships = await prisma.projectMembership.findMany({
      where: { userId: user.id },
      select: { projectId: true, role: true, status: true },
    });
    expect(new Set(memberships.map((membership) => membership.projectId)))
      .toEqual(new Set(allProjectIds));
    expect(memberships.every((membership) => (
      membership.role === 'OWNER' && membership.status === 'ACTIVE'
    ))).toBe(true);
    expect(memberships.some((membership) => membership.projectId === first.id)).toBe(true);
    expect(memberships.some((membership) => membership.projectId === second.id)).toBe(true);

    const audits = await prisma.securityAuditEvent.findMany({
      where: {
        OR: [
          { targetUserId: user.id, eventType: 'USER_PROVISIONED' },
          { targetUserId: user.id, eventType: 'MEMBERSHIP_CREATED' },
        ],
      },
    });
    expect(audits.filter((event) => event.eventType === 'USER_PROVISIONED')).toHaveLength(1);
    const membershipAudits = audits.filter((event) => event.eventType === 'MEMBERSHIP_CREATED');
    expect(new Set(membershipAudits.map((event) => event.projectId)))
      .toEqual(new Set(allProjectIds));
    expect(membershipAudits.every((event) => event.roleAfter === 'OWNER')).toBe(true);
  });

  it('refuses bootstrap when any user already exists and performs zero writes', async () => {
    await prisma.user.create({
      data: {
        email: 'existing-admin@example.com',
        normalizedEmail: 'existing-admin@example.com',
        passwordHash: await passwordHasher.hash(PASSWORD),
      },
    });
    const project = await createProject('Already initialized');
    const before = {
      users: await prisma.user.count(),
      memberships: await prisma.projectMembership.count(),
      audits: await prisma.securityAuditEvent.count(),
    };

    await expect(
      bootstrapOwner('second-bootstrap@example.com', PASSWORD),
    ).rejects.toThrow();

    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.projectMembership.count()).toBe(before.memberships);
    expect(await prisma.securityAuditEvent.count()).toBe(before.audits);
    expect(await prisma.projectMembership.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('provisions an ACTIVE global user without implicitly granting project membership', async () => {
    await createProject('Provision target');
    const email = `provision-${Date.now()}@example.com`;

    await provisionUser(email, PASSWORD);

    const user = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    expect(user.status).toBe('ACTIVE');
    await expect(passwordHasher.verify(PASSWORD, user.passwordHash)).resolves.toBe(true);
    expect(await prisma.projectMembership.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.securityAuditEvent.count({
      where: { targetUserId: user.id, eventType: 'USER_PROVISIONED' },
    })).toBe(1);
  });

  it('disables a user with all sessions revoked, then enables without restoring sessions or memberships', async () => {
    const email = `lifecycle-${Date.now()}@example.com`;
    await provisionUser(email, PASSWORD);
    const user = await prisma.user.findUniqueOrThrow({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    const firstSession = await createSession(user.id);
    const secondSession = await createSession(user.id);

    await disableUser(email);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('DISABLED');
    const disabledSessions = await prisma.userSession.findMany({
      where: { id: { in: [firstSession.id, secondSession.id] } },
    });
    expect(disabledSessions.every((session) => session.revokedAt !== null)).toBe(true);
    const disableEvents = await prisma.securityAuditEvent.findMany({
      where: {
        targetUserId: user.id,
        eventType: { in: ['USER_DISABLED', 'SESSIONS_REVOKED_ALL'] },
      },
      select: { eventType: true },
    });
    expect(new Set(disableEvents.map((event) => event.eventType)))
      .toEqual(new Set(['USER_DISABLED', 'SESSIONS_REVOKED_ALL']));

    const membershipCount = await prisma.projectMembership.count({ where: { userId: user.id } });
    await enableUser(email);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).status).toBe('ACTIVE');
    expect(await prisma.userSession.count({
      where: { userId: user.id, revokedAt: null },
    })).toBe(0);
    expect(await prisma.projectMembership.count({ where: { userId: user.id } }))
      .toBe(membershipCount);
    expect(await prisma.securityAuditEvent.count({
      where: { targetUserId: user.id, eventType: 'USER_ENABLED' },
    })).toBe(1);
  });

  it('keeps SecurityAuditEvent rows append-only at the database boundary', async () => {
    const event = await prisma.securityAuditEvent.create({
      data: { eventType: 'USER_ENABLED' },
    });

    await expect(prisma.securityAuditEvent.update({
      where: { id: event.id },
      data: { version: 'mutated' },
    })).rejects.toThrow();
    await expect(prisma.securityAuditEvent.delete({
      where: { id: event.id },
    })).rejects.toThrow();
  });
});
