import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';

const projectIds: string[] = [];
const actorUserId = randomUUID();

async function createProject(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `Keyword service ${label}`,
      slug: `keyword-service-${label}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
    },
  });
  projectIds.push(project.id);
  return project;
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('KeywordService manual command semantics', () => {
  it('requires restore rather than recreating archived logical identity', async () => {
    const project = await createProject('restore-required');
    const service = new KeywordService();
    const created = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    });

    await service.archive({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      acknowledgeLock: false,
    });

    await expect(service.createManual({
      actorUserId,
      projectId: project.id,
      text: '  符纸  ',
      type: 'CORE',
    })).rejects.toMatchObject({ code: 'KEYWORD_ARCHIVED_RESTORE_REQUIRED' });
  });

  it('rejects active or disabled duplicate logical identity', async () => {
    const project = await createProject('duplicate');
    const service = new KeywordService();
    const created = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    });

    await expect(service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'LONG_TAIL',
    })).rejects.toMatchObject({ code: 'KEYWORD_DUPLICATE' });

    await service.updateManual({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      status: 'DISABLED',
      acknowledgeLock: false,
    });

    await expect(service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    })).rejects.toMatchObject({ code: 'KEYWORD_DUPLICATE' });
  });

  it('blocks a locked strategic mutation without explicit acknowledgement', async () => {
    const project = await createProject('locked');
    const service = new KeywordService();
    const created = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
      locked: true,
    });

    await expect(service.updateManual({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      text: '符纸文化',
      acknowledgeLock: false,
    })).rejects.toMatchObject({ code: 'KEYWORD_LOCKED' });

    const updated = await service.updateManual({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      text: '符纸文化',
      acknowledgeLock: true,
    });
    expect(updated.text).toBe('符纸文化');
  });

  it('rejects self-parenting', async () => {
    const project = await createProject('self-parent');
    const service = new KeywordService();
    const keyword = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    });

    await expect(service.setParent({
      actorUserId,
      projectId: project.id,
      childKeywordId: keyword.id,
      parentKeywordId: keyword.id,
      acknowledgeLock: false,
    })).rejects.toMatchObject({ code: 'KEYWORD_PARENT_SELF' });
  });

  it('rejects a canonical parent cycle', async () => {
    const project = await createProject('cycle');
    const service = new KeywordService();
    const [a, b, c] = await Promise.all([
      service.createManual({ actorUserId, projectId: project.id, text: 'A', type: 'CORE' }),
      service.createManual({ actorUserId, projectId: project.id, text: 'B', type: 'LONG_TAIL' }),
      service.createManual({ actorUserId, projectId: project.id, text: 'C', type: 'LONG_TAIL' }),
    ]);

    await service.setParent({ actorUserId, projectId: project.id, childKeywordId: b.id, parentKeywordId: a.id, acknowledgeLock: false });
    await service.setParent({ actorUserId, projectId: project.id, childKeywordId: c.id, parentKeywordId: b.id, acknowledgeLock: false });

    await expect(service.setParent({
      actorUserId,
      projectId: project.id,
      childKeywordId: a.id,
      parentKeywordId: c.id,
      acknowledgeLock: false,
    })).rejects.toMatchObject({ code: 'KEYWORD_RELATION_CYCLE' });
  });

  it('fails closed for a foreign parent identifier', async () => {
    const local = await createProject('local-parent');
    const foreign = await createProject('foreign-parent');
    const service = new KeywordService();
    const child = await service.createManual({ actorUserId, projectId: local.id, text: '六壬符纸', type: 'LONG_TAIL' });
    const foreignParent = await service.createManual({ actorUserId, projectId: foreign.id, text: '符纸', type: 'CORE' });

    await expect(service.setParent({
      actorUserId,
      projectId: local.id,
      childKeywordId: child.id,
      parentKeywordId: foreignParent.id,
      acknowledgeLock: false,
    })).rejects.toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
  });

  it('fails closed for a foreign group identifier', async () => {
    const local = await createProject('local-group');
    const foreign = await createProject('foreign-group');
    const service = new KeywordService();
    const keyword = await service.createManual({ actorUserId, projectId: local.id, text: '符纸', type: 'CORE' });
    const foreignGroup = await prisma.keywordGroup.create({
      data: { projectId: foreign.id, name: 'Foreign topic' },
    });

    await expect(service.setGroups({
      actorUserId,
      projectId: local.id,
      keywordId: keyword.id,
      groupIds: [foreignGroup.id],
      acknowledgeLock: false,
    })).rejects.toMatchObject({ code: 'KEYWORD_GROUP_NOT_FOUND' });
  });

  it('restores the same archived row id', async () => {
    const project = await createProject('restore-id');
    const service = new KeywordService();
    const created = await service.createManual({ actorUserId, projectId: project.id, text: '符纸', type: 'CORE' });
    await service.archive({ actorUserId, projectId: project.id, keywordId: created.id, acknowledgeLock: false });

    const restored = await service.restore({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      acknowledgeLock: false,
    });

    expect(restored.id).toBe(created.id);
    expect(restored.status).toBe('ACTIVE');
  });

  it('persists lifecycle independently from the legacy enable/archive status', async () => {
    const project = await createProject('lifecycle');
    const service = new KeywordService();
    const created = await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    });
    expect(created.lifecycleStatus).toBe('DISCOVERED');

    const updated = await service.updateManual({
      actorUserId,
      projectId: project.id,
      keywordId: created.id,
      lifecycleStatus: 'APPROVED',
    });
    expect(updated).toMatchObject({ status: 'ACTIVE', lifecycleStatus: 'APPROVED' });
  });

  it('bulk creates unique lines, reports duplicates, and supports combined filters', async () => {
    const project = await createProject('bulk-filter');
    const service = new KeywordService();
    await service.createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸',
      type: 'CORE',
    });

    const result = await service.createManualBulk({
      actorUserId,
      projectId: project.id,
      text: '符纸\n六壬法教\n六壬法教\n民间信仰',
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      lifecycleStatus: 'APPROVED',
      language: 'zh-Hans',
      targetCountry: 'CN',
    });

    expect(result.created.map((item) => item.text)).toEqual(['六壬法教', '民间信仰']);
    expect(result.duplicates).toEqual([
      expect.objectContaining({ line: 1, reason: 'ALREADY_EXISTS' }),
      expect.objectContaining({ line: 3, reason: 'DUPLICATE_IN_REQUEST' }),
    ]);

    const filtered = await service.list(project.id, {
      q: '六壬',
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      lifecycleStatus: 'APPROVED',
      language: 'zh-Hans',
      region: 'CN',
    });
    expect(filtered.map((item) => item.text)).toEqual(['六壬法教']);
  });

  it('rejects a cluster rename that conflicts inside the same project', async () => {
    const project = await createProject('cluster-rename');
    const service = new KeywordService();
    const first = await service.createGroup({ projectId: project.id, name: '符纸专题' });
    await service.createGroup({ projectId: project.id, name: '六壬专题' });

    await expect(service.renameGroup({
      actorUserId,
      projectId: project.id,
      groupId: first.id,
      name: ' 六壬专题 ',
    })).rejects.toMatchObject({ code: 'KEYWORD_GROUP_DUPLICATE' });
  });

  it('requires a project-local primary keyword and automatically makes it a cluster member', async () => {
    const local = await createProject('cluster-primary-local');
    const foreign = await createProject('cluster-primary-foreign');
    const service = new KeywordService();
    const group = await service.createGroup({ projectId: local.id, name: '符纸专题' });
    const localKeyword = await service.createManual({
      actorUserId,
      projectId: local.id,
      text: '符纸',
      type: 'CORE',
    });
    const foreignKeyword = await service.createManual({
      actorUserId,
      projectId: foreign.id,
      text: '外部符纸',
      type: 'CORE',
    });

    await expect(service.setGroupPrimaryKeyword({
      actorUserId,
      projectId: local.id,
      groupId: group.id,
      primaryKeywordId: foreignKeyword.id,
    })).rejects.toMatchObject({ code: 'KEYWORD_NOT_FOUND' });

    const updated = await service.setGroupPrimaryKeyword({
      actorUserId,
      projectId: local.id,
      groupId: group.id,
      primaryKeywordId: localKeyword.id,
    });

    expect(updated.primaryKeywordId).toBe(localKeyword.id);
    await expect(prisma.keywordGroupMembership.findUnique({
      where: {
        groupId_keywordId: { groupId: group.id, keywordId: localKeyword.id },
      },
    })).resolves.toMatchObject({ projectId: local.id });
  });

  it('bulk assigns a cluster atomically and never leaves partial foreign-project membership', async () => {
    const local = await createProject('cluster-bulk-local');
    const foreign = await createProject('cluster-bulk-foreign');
    const service = new KeywordService();
    const group = await service.createGroup({ projectId: local.id, name: '符纸专题' });
    const first = await service.createManual({ actorUserId, projectId: local.id, text: '符纸', type: 'CORE' });
    const second = await service.createManual({ actorUserId, projectId: local.id, text: '六壬符纸', type: 'LONG_TAIL' });
    const foreignKeyword = await service.createManual({ actorUserId, projectId: foreign.id, text: '外部词', type: 'CORE' });

    await expect(service.assignKeywordsToGroup({
      actorUserId,
      projectId: local.id,
      groupId: group.id,
      keywordIds: [first.id, foreignKeyword.id],
    })).rejects.toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect(await prisma.keywordGroupMembership.count({ where: { groupId: group.id } })).toBe(0);

    const memberships = await service.assignKeywordsToGroup({
      actorUserId,
      projectId: local.id,
      groupId: group.id,
      keywordIds: [first.id, second.id, first.id],
    });
    expect(memberships.map((item) => item.keywordId).sort()).toEqual([first.id, second.id].sort());
  });
});
