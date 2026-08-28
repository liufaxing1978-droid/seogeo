import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `Keyword repository ${label}`,
      slug: `keyword-repository-${label}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
    },
  });
  projectIds.push(project.id);
  return project;
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('KeywordRepository invariants', () => {
  it('rejects a second normalized keyword in the same project', async () => {
    const project = await createProject('unique');
    const repo = new KeywordRepository();

    await repo.createKeyword({
      projectId: project.id,
      text: '符纸',
      normalizedText: '符纸',
      type: 'CORE',
      source: 'MANUAL',
    });

    await expect(repo.createKeyword({
      projectId: project.id,
      text: ' 符纸 ',
      normalizedText: '符纸',
      type: 'CORE',
      source: 'MANUAL',
    })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows the same normalized keyword in different projects', async () => {
    const first = await createProject('first');
    const second = await createProject('second');
    const repo = new KeywordRepository();

    const a = await repo.createKeyword({
      projectId: first.id,
      text: '符纸',
      normalizedText: '符纸',
      type: 'CORE',
      source: 'MANUAL',
    });
    const b = await repo.createKeyword({
      projectId: second.id,
      text: '符纸',
      normalizedText: '符纸',
      type: 'CORE',
      source: 'MANUAL',
    });

    expect(a.projectId).toBe(first.id);
    expect(b.projectId).toBe(second.id);
  });

  it('enforces one canonical parent row per child', async () => {
    const project = await createProject('parent');
    const repo = new KeywordRepository();
    const [parentA, parentB, child] = await Promise.all([
      repo.createKeyword({ projectId: project.id, text: '符纸', normalizedText: '符纸', type: 'CORE', source: 'MANUAL' }),
      repo.createKeyword({ projectId: project.id, text: '六壬', normalizedText: '六壬', type: 'CORE', source: 'MANUAL' }),
      repo.createKeyword({ projectId: project.id, text: '六壬符纸', normalizedText: '六壬符纸', type: 'LONG_TAIL', source: 'MANUAL' }),
    ]);

    await prisma.keywordRelation.create({
      data: {
        projectId: project.id,
        parentKeywordId: parentA.id,
        childKeywordId: child.id,
      },
    });

    await expect(prisma.keywordRelation.create({
      data: {
        projectId: project.id,
        parentKeywordId: parentB.id,
        childKeywordId: child.id,
      },
    })).rejects.toMatchObject({ code: 'P2002' });
  });
});
