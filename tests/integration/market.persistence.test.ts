import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { marketRepository } from '../../src/modules/market/market.repository.js';

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

    const reloaded = await prisma.project.findUniqueOrThrow({
      where: { id: project.id },
      include: { markets: true }
    });
    expect(reloaded.targetCountry).toBe('CN');
    expect(reloaded.defaultLanguage).toBe('zh-CN');
    expect(reloaded.markets).toHaveLength(3);
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

  it('replaces the complete explicit market set atomically', async () => {
    const project = await createProject('P9-0A atomic replace');
    await prisma.projectMarket.createMany({
      data: [
        { projectId: project.id, marketCode: 'CN', locale: 'zh-CN' },
        { projectId: project.id, marketCode: 'HK', locale: 'zh-Hant' }
      ]
    });

    await marketRepository.replaceExplicitMarkets(project.id, [
      { marketCode: 'GLOBAL', locale: 'en', enabled: true },
      { marketCode: 'SG', locale: 'en-SG', enabled: true },
      { marketCode: 'TW', locale: 'zh-Hant', enabled: false }
    ]);

    const rows = await prisma.projectMarket.findMany({
      where: { projectId: project.id }
    });
    const comparableRows = rows
      .map(({ marketCode, locale, enabled }) => ({ marketCode, locale, enabled }))
      .sort((left, right) => {
        const marketOrder = left.marketCode.localeCompare(right.marketCode);
        return marketOrder !== 0 ? marketOrder : left.locale.localeCompare(right.locale);
      });

    expect(comparableRows).toEqual([
      { marketCode: 'GLOBAL', locale: 'en', enabled: true },
      { marketCode: 'SG', locale: 'en-SG', enabled: true },
      { marketCode: 'TW', locale: 'zh-Hant', enabled: false }
    ]);
  });

  it('rolls back deletion when replacement creation fails', async () => {
    const project = await createProject('P9-0A rollback');
    await prisma.projectMarket.create({
      data: { projectId: project.id, marketCode: 'MY', locale: 'en-MY', enabled: true }
    });

    await expect(marketRepository.replaceExplicitMarkets(project.id, [
      { marketCode: 'CN', locale: 'zh-CN', enabled: true },
      { marketCode: 'CN', locale: 'zh-CN', enabled: true }
    ])).rejects.toBeTruthy();

    const rows = await prisma.projectMarket.findMany({ where: { projectId: project.id } });
    expect(rows.map(({ marketCode, locale, enabled }) => ({ marketCode, locale, enabled }))).toEqual([
      { marketCode: 'MY', locale: 'en-MY', enabled: true }
    ]);
  });
});
