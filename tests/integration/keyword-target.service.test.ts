import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordTargetService } from '../../src/modules/keywords/keyword-target.service.js';

const projectIds: string[] = [];
async function fixture(locked = false) {
  const suffix = randomUUID();
  const project = await prisma.project.create({ data: { name: 'P4 target', slug: `p4-target-${suffix}`, primaryDomain: `${suffix}.example.com` } });
  projectIds.push(project.id);
  const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '法事', normalizedText: '法事', type: 'CORE', source: 'MANUAL', locked, lifecycleStatus: 'APPROVED' });
  return { project, keyword };
}
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } }); });

describe('P4 keyword target service', () => {
  it('sets an in-scope target, links an existing Page, and advances APPROVED to MAPPED', async () => {
    const { project, keyword } = await fixture();
    const url = `https://${project.primaryDomain}/guide`;
    const page = await prisma.page.create({ data: { projectId: project.id, url, normalizedUrl: url, host: project.primaryDomain, path: '/guide' } });
    const mapping = await new KeywordTargetService().setKeywordTargetUrl({ actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, targetUrl: url });
    expect(mapping.pageId).toBe(page.id);
    expect((await prisma.keyword.findUniqueOrThrow({ where: { id: keyword.id } })).lifecycleStatus).toBe('MAPPED');
  });

  it('requires acknowledgement for a locked keyword and leaves no mapping', async () => {
    const { project, keyword } = await fixture(true);
    await expect(new KeywordTargetService().setKeywordTargetUrl({ actorUserId: randomUUID(), projectId: project.id, keywordId: keyword.id, targetUrl: `https://${project.primaryDomain}/guide` }))
      .rejects.toMatchObject({ code: 'KEYWORD_LOCKED' });
    expect(await prisma.keywordTargetMapping.count({ where: { projectId: project.id } })).toBe(0);
  });
});
