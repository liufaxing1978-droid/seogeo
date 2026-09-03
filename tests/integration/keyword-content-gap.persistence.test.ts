import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';

const projectIds: string[] = [];
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } }); });

describe('P5 keyword content gaps', () => {
  it('persists an OPEN keyword gap even when no owned Page exists', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P5 gap', slug: `p5-gap-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '无页面法事', normalizedText: '无页面法事', type: 'LONG_TAIL', source: 'MANUAL' });
    const gap = await prisma.keywordContentGap.create({ data: { projectId: project.id, keywordId: keyword.id, coverageStatus: 'NONE', status: 'OPEN', reasonCodes: ['NO_MATCHING_PAGE'], sourceProvenance: { coverage: 'NONE' } } });
    expect(gap).toMatchObject({ projectId: project.id, keywordId: keyword.id, status: 'OPEN', coverageStatus: 'NONE' });
  });
});
