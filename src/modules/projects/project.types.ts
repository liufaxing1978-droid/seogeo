import type { Project } from '@prisma/client';
import type { CreateProjectInput, UpdateProjectInput } from './project.schema.js';

export interface ProjectRepository {
  create(input: CreateProjectInput): Promise<Project>;
  list(): Promise<Project[]>;
  findById(id: string): Promise<Project | null>;
  update(id: string, input: UpdateProjectInput): Promise<Project>;
}
