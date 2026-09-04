import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';

const projectIds: string[] = [];

async function createProject() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: 'Keyword target persistence',
      slug: `keyword-target-persistence-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
    },
  });
  projectIds.push(project.id);
  return project;
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('P4 keyword target persistence', () => {
  it('persists one direct keyword target mapping with an optional existing page', async () => {
    const project = await createProject();
    const keyword = await new KeywordRepository().createKeyword({
      projectId: project.id,
      text: '兴善堂法事',
      normalizedText: '兴善堂法事',
      type: 'CORE',
      source: 'MANUAL',
    });
    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: `https://${project.primaryDomain}/rituals`,
        normalizedUrl: `https://${project.primaryDomain}/rituals`,
        host: project.primaryDomain,
        path: '/rituals',
      },
    });

    const mapping = await prisma.keywordTargetMapping.create({
      data: {
        projectId: project.id,
        keywordId: keyword.id,
        targetUrl: `https://${project.primaryDomain}/rituals`,
        normalizedUrl: `https://${project.primaryDomain}/rituals`,
        pageId: page.id,
      },
    });

    expect(mapping).toMatchObject({
      projectId: project.id,
      keywordId: keyword.id,
      groupId: null,
      pageId: page.id,
      normalizedUrl: `https://${project.primaryDomain}/rituals`,
    });
  });
});
