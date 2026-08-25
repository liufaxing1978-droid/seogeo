import { ZodError } from 'zod';
import { NotFoundError, ValidationError } from '../../core/errors.js';
import { createProjectSchema, updateProjectSchema } from './project.schema.js';
import type { ProjectRepository } from './project.types.js';

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  async create(input: unknown) {
    try {
      return await this.repository.create(createProjectSchema.parse(input));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid project data', error.flatten());
      }
      throw error;
    }
  }

  async createForOwner(userId: string, input: unknown) {
    try {
      return await this.repository.createForOwner(userId, createProjectSchema.parse(input));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid project data', error.flatten());
      }
      throw error;
    }
  }

  list() {
    return this.repository.list();
  }

  listForUser(userId: string) {
    return this.repository.listForUser(userId);
  }

  async get(id: string) {
    const project = await this.repository.findById(id);
    if (!project) throw new NotFoundError();
    return project;
  }

  async update(id: string, input: unknown) {
    await this.get(id);
    try {
      return await this.repository.update(id, updateProjectSchema.parse(input));
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ValidationError('Invalid project data', error.flatten());
      }
      throw error;
    }
  }
}
