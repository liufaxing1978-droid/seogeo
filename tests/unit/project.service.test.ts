import { describe, expect, it } from 'vitest';
import { ProjectService } from '../../src/modules/projects/project.service.js';
import type { ProjectRepository } from '../../src/modules/projects/project.types.js';

const now = new Date();
const project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Example',
  slug: 'example',
  primaryDomain: 'example.com',
  industry: null,
  defaultLanguage: 'zh-CN',
  targetCountry: 'CN',
  timezone: 'Asia/Shanghai',
  status: 'ACTIVE' as const,
  planLevel: 'STANDARD' as const,
  createdAt: now,
  updatedAt: now
};

function repository(): ProjectRepository {
  return {
    create: async () => project,
    list: async () => [project],
    findById: async (id) => id === project.id ? project : null,
    update: async () => project
  };
}

describe('ProjectService', () => {
  it('validates and creates a project', async () => {
    const service = new ProjectService(repository());
    const created = await service.create({ name: 'Example', slug: 'example', primaryDomain: 'example.com' });
    expect(created.id).toBe(project.id);
  });

  it('throws for an unknown project', async () => {
    const service = new ProjectService(repository());
    await expect(service.get('00000000-0000-4000-8000-000000000999')).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});
