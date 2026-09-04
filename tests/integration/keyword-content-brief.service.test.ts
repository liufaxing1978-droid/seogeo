import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordContentGapService } from '../../src/modules/keywords/keyword-content-gap.service.js';
import { KeywordContentBriefService } from '../../src/modules/keywords/keyword-content-brief.service.js';

const projectIds: string[] = [];
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } }); });

describe('P8 Keyword content brief service', () => {
  it('creates one queued advisory brief request from a project-local content gap', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P8 brief', slug: `p8-brief-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '六壬符纸', normalizedText: '六壬符纸', type: 'CORE', source: 'MANUAL', intent: 'INFORMATIONAL' });
    const gap = await new KeywordContentGapService().evaluateKeyword(project.id, keyword.id, randomUUID());

    const result = await new KeywordContentBriefService().createFromGap({ projectId: project.id, keywordId: keyword.id, contentGapId: gap.id, actorUserId: randomUUID() });

    expect(result.request).toMatchObject({ projectId: project.id, keywordId: keyword.id, contentGapId: gap.id, status: 'QUEUED' });
    expect(result.task).toMatchObject({ projectId: project.id, taskType: 'CONTENT_BRIEF', status: 'QUEUED' });
  });

  it('creates one queued advisory brief request for a Cluster without fanout', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P8 cluster brief', slug: `p8-cluster-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const group = await prisma.keywordGroup.create({ data: { projectId: project.id, name: `六壬主题-${suffix}` } });
    const keywords = await Promise.all(['六壬符纸', '六壬法事'].map((text) => new KeywordRepository().createKeyword({ projectId: project.id, text, normalizedText: text, type: 'LONG_TAIL', source: 'MANUAL' })));
    await prisma.keywordGroupMembership.createMany({ data: keywords.map((keyword) => ({ projectId: project.id, groupId: group.id, keywordId: keyword.id })) });

    const result = await new KeywordContentBriefService().createFromGroup({ projectId: project.id, groupId: group.id, actorUserId: randomUUID() });

    expect(result.request).toMatchObject({ projectId: project.id, groupId: group.id, keywordId: null, contentGapId: null, status: 'QUEUED' });
    expect(await prisma.keywordContentBriefRequest.count({ where: { projectId: project.id } })).toBe(1);
  });
});
