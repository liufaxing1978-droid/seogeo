import { SecurityAuditRepository } from '../../auth/security-audit.repository.js';
import { prisma } from '../../db/prisma.js';
import type { CreateProjectInput, UpdateProjectInput } from './project.schema.js';
import type { ProjectRepository } from './project.types.js';

export const projectRepository: ProjectRepository = {
  create(input: CreateProjectInput) {
    return prisma.project.create({ data: input });
  },

  createForOwner(userId: string, input: CreateProjectInput) {
    return prisma.$transaction(async (tx) => {
      const project = await tx.project.create({ data: input });
      await tx.projectMembership.create({
        data: {
          projectId: project.id,
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      await new SecurityAuditRepository(tx).append({
        eventType: 'MEMBERSHIP_CREATED',
        actorUserId: userId,
        targetUserId: userId,
        projectId: project.id,
        roleAfter: 'OWNER',
      });
      return project;
    });
  },

  list() {
    return prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  },

  listForUser(userId: string) {
    return prisma.project.findMany({
      where: {
        memberships: {
          some: {
            userId,
            status: 'ACTIVE',
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  findById(id: string) {
    return prisma.project.findUnique({ where: { id } });
  },

  update(id: string, input: UpdateProjectInput) {
    return prisma.project.update({ where: { id }, data: input });
  }
};
