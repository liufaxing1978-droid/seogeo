import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OfficialSearchSyncRepository } from '../../src/modules/search-sync/official-search-sync.repository.js';

const createdProjectIds: string[] = [];

async function createProject(label: string) {
  const project = await prisma.project.create({
    data: {
      name: `Official search ${label}`,
      slug: `official-search-${label}-${crypto.randomUUID()}`,
      primaryDomain: `${label}.example.com`,
      planLevel: 'ENTERPRISE',
    },
  });
  createdProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.searchProviderLaneBinding.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('OfficialSearchSyncRepository lane bindings', () => {
  it('creates and lists only project-owned non-secret bindings', async () => {
    const project = await createProject('owned');
    const foreign = await createProject('foreign');
    const repository = new OfficialSearchSyncRepository(prisma);

    const owned = await repository.createBinding({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      propertyRef: 'sc-domain:xingshantang.org',
      marketCode: 'HK',
      locale: 'zh-Hant',
    });
    await repository.createBinding({
      projectId: foreign.id,
      provider: 'BING_WEBMASTER',
      propertyRef: 'https://foreign.example.com/',
      marketCode: 'US',
      locale: 'en-US',
    });

    const listed = await repository.listBindings(project.id);
    expect(listed).toEqual([expect.objectContaining({ id: owned.id, projectId: project.id })]);
    expect(Object.keys(listed[0]!)).not.toEqual(expect.arrayContaining([
      'credentialRef',
      'accessToken',
      'refreshToken',
      'apiKey',
      'authorization',
    ]));
  });

  it('converges duplicate lane identity to the same binding', async () => {
    const project = await createProject('idempotent');
    const repository = new OfficialSearchSyncRepository(prisma);
    const input = {
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE' as const,
      propertyRef: 'sc-domain:xingshantang.org',
      marketCode: 'HK' as const,
      locale: 'zh-Hant',
    };

    const first = await repository.createBinding(input);
    const second = await repository.createBinding(input);

    expect(second.id).toBe(first.id);
    expect(await prisma.searchProviderLaneBinding.count({ where: { projectId: project.id } })).toBe(1);
  });

  it('fails closed when finding or mutating a foreign binding id', async () => {
    const project = await createProject('local-scope');
    const foreign = await createProject('foreign-scope');
    const repository = new OfficialSearchSyncRepository(prisma);
    const foreignBinding = await repository.createBinding({
      projectId: foreign.id,
      provider: 'BING_WEBMASTER',
      propertyRef: 'https://foreign.example.com/',
      marketCode: 'US',
      locale: 'en-US',
    });

    await expect(repository.findBinding(project.id, foreignBinding.id)).resolves.toBeNull();
    await expect(repository.setBindingActive(project.id, foreignBinding.id, false)).resolves.toBeNull();

    const unchanged = await prisma.searchProviderLaneBinding.findUnique({ where: { id: foreignBinding.id } });
    expect(unchanged?.isActive).toBe(true);
  });

  it('rejects unsupported providers and invalid identity text before persistence', async () => {
    const project = await createProject('validation');
    const repository = new OfficialSearchSyncRepository(prisma);

    await expect(repository.createBinding({
      projectId: project.id,
      provider: 'BAIDU_SEARCH_RESOURCE' as never,
      propertyRef: 'https://example.com/',
      marketCode: 'CN',
      locale: 'zh-CN',
    })).rejects.toThrow('OFFICIAL_SEARCH_BINDING_PROVIDER_UNSUPPORTED');

    await expect(repository.createBinding({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      propertyRef: '   ',
      marketCode: 'HK',
      locale: 'zh-Hant',
    })).rejects.toThrow('OFFICIAL_SEARCH_BINDING_IDENTITY_INVALID');

    await expect(repository.createBinding({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      propertyRef: 'sc-domain:xingshantang.org',
      marketCode: 'HK',
      locale: 'x'.repeat(65),
    })).rejects.toThrow('OFFICIAL_SEARCH_BINDING_IDENTITY_INVALID');

    expect(await prisma.searchProviderLaneBinding.count({ where: { projectId: project.id } })).toBe(0);
  });
});
