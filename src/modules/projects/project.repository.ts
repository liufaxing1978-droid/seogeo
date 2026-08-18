import { prisma } from '../../db/prisma.js';
import type { CreateProjectInput, UpdateProjectInput } from './project.schema.js';
import type { ProjectRepository } from './project.types.js';

export const projectRepository: ProjectRepository = {
  create(input: CreateProjectInput) {
    return prisma.project.create({ data: input });
  },

  list() {
    return prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  },

  findById(id: string) {
    return prisma.project.findUnique({ where: { id } });
  },

  update(id: string, input: UpdateProjectInput) {
    return prisma.project.update({ where: { id }, data: input });
  }
};
