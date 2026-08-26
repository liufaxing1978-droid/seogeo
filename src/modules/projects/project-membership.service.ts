import type { ProjectRole } from '@prisma/client';
import { normalizeEmail } from '../../auth/email.js';
import { hasProjectCapability } from '../../auth/project-capabilities.js';
import { SecurityAuditRepository } from '../../auth/security-audit.repository.js';
import { AppError, NotFoundError, ValidationError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { ProjectMembershipRepository } from './project-membership.repository.js';

const PROJECT_ROLES = new Set<ProjectRole>(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']);
const BASIC_MANAGEABLE_ROLES = new Set<ProjectRole>(['OPERATOR', 'VIEWER']);

function parseRole(value: unknown): ProjectRole {
  if (typeof value !== 'string' || !PROJECT_ROLES.has(value as ProjectRole)) {
    throw new ValidationError('Invalid project role', { field: 'role' });
  }
  return value as ProjectRole;
}

function parseEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Invalid email', { field: 'email' });
  }
  const normalized = normalizeEmail(value);
  if (!normalized) {
    throw new ValidationError('Invalid email', { field: 'email' });
  }
  return normalized;
}

function assertManageTarget(
  actorRole: ProjectRole,
  currentRole: ProjectRole | null,
  requestedRole: ProjectRole | null,
): void {
  if (hasProjectCapability(actorRole, 'PROJECT_MEMBER_MANAGE_ALL')) return;

  if (!hasProjectCapability(actorRole, 'PROJECT_MEMBER_MANAGE_BASIC')) {
    throw new AppError('Project capability required', 403, 'PROJECT_CAPABILITY_REQUIRED');
  }

  const currentAllowed = currentRole === null || BASIC_MANAGEABLE_ROLES.has(currentRole);
  const requestedAllowed = requestedRole === null || BASIC_MANAGEABLE_ROLES.has(requestedRole);
  if (!currentAllowed || !requestedAllowed) {
    throw new AppError('Project capability required', 403, 'PROJECT_CAPABILITY_REQUIRED');
  }
}

function assertActiveMembership<T extends { status: string }>(membership: T | null): T {
  if (!membership || membership.status !== 'ACTIVE') {
    throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  }
  return membership;
}

export class ProjectMembershipService {
  list(projectId: string) {
    return new ProjectMembershipRepository().listForProject(projectId);
  }

  async addOrReactivate(input: {
    actorUserId: string;
    actorRole: ProjectRole;
    projectId: string;
    email: unknown;
    role: unknown;
  }) {
    const normalizedEmail = parseEmail(input.email);
    const requestedRole = parseRole(input.role);

    return prisma.$transaction(async (tx) => {
      const repository = new ProjectMembershipRepository(tx);
      const audit = new SecurityAuditRepository(tx);
      if (!(await repository.lockProject(input.projectId))) {
        throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      }

      const target = await repository.findAvailableUserByNormalizedEmail(normalizedEmail);
      if (!target) {
        throw new NotFoundError('User not available', 'USER_NOT_AVAILABLE');
      }

      const existing = await repository.findByProjectAndUser(input.projectId, target.id);
      if (existing?.status === 'ACTIVE') {
        assertManageTarget(input.actorRole, existing.role, requestedRole);
        throw new AppError('Project membership already active', 409, 'PROJECT_MEMBERSHIP_EXISTS');
      }

      if (existing) {
        assertManageTarget(input.actorRole, existing.role, requestedRole);
        const membership = await repository.reactivate(existing.id, requestedRole);
        await audit.append({
          eventType: 'MEMBERSHIP_REACTIVATED',
          actorUserId: input.actorUserId,
          targetUserId: target.id,
          projectId: input.projectId,
          roleBefore: existing.role,
          roleAfter: requestedRole,
        });
        return { membership, created: false };
      }

      assertManageTarget(input.actorRole, null, requestedRole);
      const membership = await repository.create(input.projectId, target.id, requestedRole);
      await audit.append({
        eventType: 'MEMBERSHIP_CREATED',
        actorUserId: input.actorUserId,
        targetUserId: target.id,
        projectId: input.projectId,
        roleAfter: requestedRole,
      });
      return { membership, created: true };
    });
  }

  async changeRole(input: {
    actorUserId: string;
    actorRole: ProjectRole;
    projectId: string;
    membershipId: string;
    role: unknown;
  }) {
    const requestedRole = parseRole(input.role);

    return prisma.$transaction(async (tx) => {
      const repository = new ProjectMembershipRepository(tx);
      const audit = new SecurityAuditRepository(tx);
      if (!(await repository.lockProject(input.projectId))) {
        throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      }

      const current = assertActiveMembership(
        await repository.findByIdForProject(input.projectId, input.membershipId),
      );
      assertManageTarget(input.actorRole, current.role, requestedRole);

      if (current.role === 'OWNER' && requestedRole !== 'OWNER') {
        const ownerCount = await repository.countActiveOwners(input.projectId);
        if (ownerCount <= 1) {
          throw new AppError(
            'Project requires at least one active owner',
            409,
            'LAST_PROJECT_OWNER_REQUIRED',
          );
        }
      }

      if (current.role === requestedRole) return current;

      const membership = await repository.updateRole(current.id, requestedRole);
      await audit.append({
        eventType: 'MEMBERSHIP_ROLE_CHANGED',
        actorUserId: input.actorUserId,
        targetUserId: current.userId,
        projectId: input.projectId,
        roleBefore: current.role,
        roleAfter: requestedRole,
      });
      return membership;
    });
  }

  async revoke(input: {
    actorUserId: string;
    actorRole: ProjectRole;
    projectId: string;
    membershipId: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const repository = new ProjectMembershipRepository(tx);
      const audit = new SecurityAuditRepository(tx);
      if (!(await repository.lockProject(input.projectId))) {
        throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      }

      const current = assertActiveMembership(
        await repository.findByIdForProject(input.projectId, input.membershipId),
      );
      assertManageTarget(input.actorRole, current.role, null);

      if (current.role === 'OWNER') {
        const ownerCount = await repository.countActiveOwners(input.projectId);
        if (ownerCount <= 1) {
          throw new AppError(
            'Project requires at least one active owner',
            409,
            'LAST_PROJECT_OWNER_REQUIRED',
          );
        }
      }

      const membership = await repository.revoke(current.id);
      await audit.append({
        eventType: 'MEMBERSHIP_REVOKED',
        actorUserId: input.actorUserId,
        targetUserId: current.userId,
        projectId: input.projectId,
        roleBefore: current.role,
      });
      return membership;
    });
  }
}
