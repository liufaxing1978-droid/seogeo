import type { ProjectRole } from '@prisma/client';
import type { RequestHandler } from 'express';
import { AppError, NotFoundError } from '../core/errors.js';
import { prisma } from '../db/prisma.js';
import { hasProjectCapability, type ProjectCapability } from './project-capabilities.js';

function projectIdFromParams(params: Record<string, string | string[] | undefined>): string {
  const rawId = params.projectId ?? params.id;
  const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!projectId) throw new NotFoundError();
  return projectId;
}

async function resolveProjectAccess(userId: string, projectId: string) {
  const row = await prisma.projectMembership.findFirst({
    where: { projectId, userId, status: 'ACTIVE' },
    include: { project: true },
  });
  if (!row) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  const { project, ...membership } = row;
  return { project, membership };
}

function assertCapability(role: ProjectRole, capability: ProjectCapability): void {
  if (!hasProjectCapability(role, capability)) {
    throw new AppError('Project capability required', 403, 'PROJECT_CAPABILITY_REQUIRED');
  }
}

export function requireProjectMembership(): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
      }
      const access = await resolveProjectAccess(req.auth.userId, projectIdFromParams(req.params));
      res.locals.project = access.project;
      res.locals.projectMembership = access.membership;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireProjectCapability(capability: ProjectCapability): RequestHandler {
  return (_req, res, next) => {
    try {
      const membership = res.locals.projectMembership as { role: ProjectRole; status?: string } | undefined;
      if (!membership || membership.status !== 'ACTIVE') {
        throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      }
      assertCapability(membership.role, capability);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function assertProjectCapability(
  userId: string,
  projectId: string,
  capability: ProjectCapability,
) {
  const access = await resolveProjectAccess(userId, projectId);
  assertCapability(access.membership.role, capability);
  return access;
}
