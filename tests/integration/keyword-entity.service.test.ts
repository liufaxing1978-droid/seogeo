import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordEntityService } from '../../src/modules/keywords/keyword-entity.service.js';

const projectIds: string[] = [];

async function fixture() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: { name: 'P7 entity mapping', slug: `p7-entity-${suffix}`, primaryDomain: `${suffix}.example.com` },
  });
  projectIds.push(project.id);
  const keyword = await new KeywordRepository().createKeyword({
    projectId: project.id,
    text: '符纸法事',
    normalizedText: '符纸法事',
    type: 'CORE',
    source: 'MANUAL',
  });
  const entity = await prisma.entity.create({
    data: {
      projectId: project.id,
      entityType: 'TOPIC',
      canonicalName: '符纸',
      normalizedName: `符纸-${suffix}`,
    },
  });
  return { project, keyword, entity };
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('P7 keyword entity service', () => {
  it('replaces a keyword entity selection atomically and records a project-scoped audit event', async () => {
    const { project, keyword, entity } = await fixture();
    const replacement = await prisma.entity.create({
      data: {
        projectId: project.id,
        entityType: 'SERVICE',
        canonicalName: '祈福法事',
        normalizedName: `祈福法事-${randomUUID()}`,
      },
    });
    const service = new KeywordEntityService();

    await service.setKeywordEntities({
      actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, entityIds: [entity.id],
    });
    const mapped = await service.setKeywordEntities({
      actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, entityIds: [replacement.id],
    });

    expect(mapped.map((item) => item.entityId)).toEqual([replacement.id]);
    expect(await prisma.keywordEntityMapping.findMany({ where: { projectId: project.id, keywordId: keyword.id } }))
      .toEqual([expect.objectContaining({ entityId: replacement.id })]);
    expect(await prisma.keywordAuditEvent.findFirst({
      where: { projectId: project.id, keywordId: keyword.id, eventType: 'KEYWORD_ENTITIES_SET' },
      orderBy: { createdAt: 'desc' },
    })).toEqual(expect.objectContaining({ metadata: { entityIds: [replacement.id] } }));
  });

  it('rejects a foreign entity before changing an existing keyword mapping', async () => {
    const { project, keyword, entity } = await fixture();
    const foreign = await prisma.project.create({
      data: { name: 'P7 foreign', slug: `p7-foreign-${randomUUID()}`, primaryDomain: `${randomUUID()}.example.com` },
    });
    projectIds.push(foreign.id);
    const foreignEntity = await prisma.entity.create({
      data: { projectId: foreign.id, entityType: 'TOPIC', canonicalName: '外部主题', normalizedName: `外部-${randomUUID()}` },
    });
    const service = new KeywordEntityService();
    await service.setKeywordEntities({ actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, entityIds: [entity.id] });

    await expect(service.setKeywordEntities({
      actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, entityIds: [foreignEntity.id],
    })).rejects.toMatchObject({ code: 'ENTITY_NOT_FOUND' });
    expect(await prisma.keywordEntityMapping.findMany({ where: { projectId: project.id, keywordId: keyword.id } }))
      .toEqual([expect.objectContaining({ entityId: entity.id })]);
  });
});
