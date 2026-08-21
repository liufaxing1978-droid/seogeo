import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(label: string, planLevel: 'ADVANCED' | 'ENTERPRISE') {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-C persistence ${label}`,
      slug: `p8c-persistence-${label}-${suffix}`,
      primaryDomain: `p8c-persistence-${label}-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.distributionTarget.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-C distribution target persistence', () => {
  it('persists bounded community target context and new community platforms', async () => {
    const project = await createProject('community', 'ADVANCED');
    const publicationId = randomUUID();

    for (const platform of ['JIANSHU', 'PTT', 'MOBILE01'] as const) {
      const question = `Question for ${platform}`;
      const target = await prisma.distributionTarget.create({
        data: {
          projectId: project.id,
          publicationId,
          platform,
          mode: 'COMMUNITY_DRAFT',
          targetKey: platform.toLowerCase(),
          targetContext: {
            sourceType: 'USER',
            question,
            topicUrl: null,
            includeBrandLink: false
          }
        } as never
      });

      const stored = await prisma.distributionTarget.findUniqueOrThrow({ where: { id: target.id } });
      expect((stored as unknown as { targetContext: unknown }).targetContext).toEqual({
        sourceType: 'USER',
        question,
        topicUrl: null,
        includeBrandLink: false
      });
    }
  });

  it('keeps Enterprise entity context project-scoped', async () => {
    const owner = await createProject('entity-owner', 'ENTERPRISE');
    const other = await createProject('entity-other', 'ENTERPRISE');
    const target = await prisma.distributionTarget.create({
      data: {
        projectId: owner.id,
        publicationId: randomUUID(),
        platform: 'WIKIDATA',
        mode: 'ENTITY_SUGGESTION',
        targetKey: 'entity-default',
        targetContext: {
          entityName: '兴善堂',
          language: 'zh-CN'
        }
      } as never
    });

    expect(await prisma.distributionTarget.findFirst({
      where: { id: target.id, projectId: owner.id }
    })).not.toBeNull();
    expect(await prisma.distributionTarget.findFirst({
      where: { id: target.id, projectId: other.id }
    })).toBeNull();
  });
});
