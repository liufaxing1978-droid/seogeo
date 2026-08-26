import type {
  MembershipStatus,
  PlanLevel,
  ProjectRole,
  UserStatus,
} from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  SessionRepository,
  createSessionToken,
} from '../../src/auth/session.repository.js';

export interface SeedAuthenticatedUserOptions {
  role: ProjectRole;
  planLevel: PlanLevel;
  userStatus: UserStatus;
  membershipStatus: MembershipStatus;
}

export async function seedAuthenticatedUser(
  options: SeedAuthenticatedUserOptions,
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await prisma.user.create({
    data: {
      email: `auth-fixture-${suffix}@example.com`,
      normalizedEmail: `auth-fixture-${suffix}@example.com`,
      passwordHash: 'test-only-hash',
      status: options.userStatus,
    },
  });

  const project = await prisma.project.create({
    data: {
      name: `Auth fixture ${suffix}`,
      slug: `auth-fixture-${suffix}`,
      primaryDomain: `auth-fixture-${suffix}.example.com`,
      planLevel: options.planLevel,
    },
  });

  const membership = await prisma.projectMembership.create({
    data: {
      projectId: project.id,
      userId: user.id,
      role: options.role,
      status: options.membershipStatus,
    },
  });

  const token = createSessionToken();
  const session = await new SessionRepository().create(
    user.id,
    token.tokenHash,
    new Date(Date.now() + SESSION_TTL_MS),
  );

  return {
    user,
    project,
    membership,
    session,
    rawSessionToken: token.rawToken,
    sessionCookie: `${SESSION_COOKIE_NAME}=${token.rawToken}`,
    csrfInput: {
      sessionId: session.id,
      tokenHash: token.tokenHash,
    },
    cleanup: async () => {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
    },
  };
}
