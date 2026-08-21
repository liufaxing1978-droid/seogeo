import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p9-0a-market-${suffix}`,
      primaryDomain: `p9-0a-market-${suffix}.example.com`,
      targetCountry: 'CN',
      defaultLanguage: 'zh-CN'
    }
  });
  projectIds.push(project.id);
  return project;
}

describe('P9-0A market persistence foundation', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.projectMarket.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('stores multiple explicit markets without changing legacy project fields', async () => {
    const project = await createProject('P9-0A explicit markets');

    await prisma.projectMarket.createMany({
      data: [
        { projectId: project.id, marketCode: 'CN', locale: 'zh-CN' },
        { projectId: project.id, marketCode: 'GLOBAL', locale: 'zh-Hant' },
        { projectId: project.id, marketCode: 'GLOBAL', locale: 'en' }
      ]
    });

    const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(reloaded.targetCountry).toBe('CN');
    expect(reloaded.defaultLanguage).toBe('zh-CN');
    expect(await prisma.projectMarket.count({ where: { projectId: project.id } })).toBe(3);
  });

  it('rejects duplicate project + market + locale rows', async () => {
    const project = await createProject('P9-0A market uniqueness');

    await prisma.projectMarket.create({
      data: { projectId: project.id, marketCode: 'HK', locale: 'zh-Hant' }
    });

    await expect(
      prisma.projectMarket.create({
        data: { projectId: project.id, marketCode: 'HK', locale: 'zh-Hant' }
      })
    ).rejects.toBeTruthy();
  });
});
