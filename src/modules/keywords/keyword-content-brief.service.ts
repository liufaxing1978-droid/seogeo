import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService } from '../ai/ai.service.js';

export class KeywordContentBriefService {
  findFromGap(projectId: string, keywordId: string) {
    return prisma.keywordContentBriefRequest.findFirst({
      where: { projectId, keywordId, contentGapId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
  }

  findFromGroup(projectId: string, groupId: string) {
    return prisma.keywordContentBriefRequest.findFirst({
      where: { projectId, groupId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createFromGroup(input: { projectId: string; groupId: string; actorUserId: string }) {
    const group = await prisma.keywordGroup.findFirst({
      where: { id: input.groupId, projectId: input.projectId },
      include: { memberships: { where: { keyword: { status: 'ACTIVE' } }, include: { keyword: { select: { id: true, text: true, normalizedText: true, type: true, intent: true, lifecycleStatus: true } } } } },
    });
    if (!group || !group.memberships.length) throw new AppError('Keyword group not found', 404, 'KEYWORD_GROUP_NOT_FOUND');
    const factsSnapshot = {
      group: { sourceRef: `KEYWORD_GROUP:${group.id}`, name: group.name, description: group.description },
      keywords: group.memberships.map((membership) => ({ sourceRef: `KEYWORD:${membership.keyword.id}`, text: membership.keyword.text, normalizedText: membership.keyword.normalizedText, type: membership.keyword.type, intent: membership.keyword.intent, lifecycleStatus: membership.keyword.lifecycleStatus })),
    };
    const snapshotHash = createHash('sha256').update(JSON.stringify(factsSnapshot)).digest('hex');
    const request = await prisma.keywordContentBriefRequest.upsert({
      where: { groupId_snapshotHash: { groupId: group.id, snapshotHash } },
      create: { projectId: input.projectId, groupId: group.id, snapshotHash, factsSnapshot, createdByUserId: input.actorUserId },
      update: {},
    });
    if (request.aiTaskId) return { request, task: await prisma.aiTask.findUniqueOrThrow({ where: { id: request.aiTaskId } }) };
    const task = await aiTaskService.createAndEnqueue({
      projectId: input.projectId, taskType: 'CONTENT_BRIEF', requestKey: `keyword-content-brief:${request.id}:${snapshotHash}:content-brief-v1`, promptVersion: 'content-brief-v1', factSnapshot: factsSnapshot,
      sourceReferences: [{ type: 'KEYWORD_GROUP', id: group.id }, ...group.memberships.map((membership) => ({ type: 'KEYWORD', id: membership.keyword.id }))],
    });
    const queued = await prisma.keywordContentBriefRequest.update({ where: { id: request.id }, data: { aiTaskId: task.id, status: 'QUEUED' } });
    return { request: queued, task };
  }

  async createFromGap(input: { projectId: string; keywordId: string; contentGapId: string; actorUserId: string }) {
    const gap = await prisma.keywordContentGap.findFirst({
      where: { id: input.contentGapId, projectId: input.projectId, keywordId: input.keywordId, status: { not: 'RESOLVED' } },
      include: { keyword: { include: { entityMappings: { include: { entity: { select: { id: true, canonicalName: true, entityType: true, status: true } } } } } } },
    });
    if (!gap?.keyword) throw new AppError('Keyword content gap not found', 404, 'KEYWORD_CONTENT_GAP_NOT_FOUND');

    const entities = gap.keyword.entityMappings
      .filter((mapping) => mapping.entity.status === 'ACTIVE')
      .map((mapping) => ({ sourceRef: `ENTITY:${mapping.entity.id}`, name: mapping.entity.canonicalName, type: mapping.entity.entityType }));
    const factsSnapshot = {
      keyword: { sourceRef: `KEYWORD:${gap.keyword.id}`, text: gap.keyword.text, normalizedText: gap.keyword.normalizedText, type: gap.keyword.type, intent: gap.keyword.intent, lifecycleStatus: gap.keyword.lifecycleStatus },
      gap: { sourceRef: `KEYWORD_CONTENT_GAP:${gap.id}`, coverageStatus: gap.coverageStatus, status: gap.status, targetUrl: gap.targetUrl, reasonCodes: gap.reasonCodes },
      entities,
    };
    const snapshotHash = createHash('sha256').update(JSON.stringify(factsSnapshot)).digest('hex');
    const request = await prisma.keywordContentBriefRequest.upsert({
      where: { contentGapId_snapshotHash: { contentGapId: gap.id, snapshotHash } },
      create: { projectId: input.projectId, keywordId: gap.keyword.id, contentGapId: gap.id, snapshotHash, factsSnapshot, createdByUserId: input.actorUserId },
      update: {},
    });
    if (request.aiTaskId) return { request, task: await prisma.aiTask.findUniqueOrThrow({ where: { id: request.aiTaskId } }) };
    const sourceReferences = [{ type: 'KEYWORD', id: gap.keyword.id }, { type: 'KEYWORD_CONTENT_GAP', id: gap.id }, ...entities.map((entity) => ({ type: 'ENTITY', id: entity.sourceRef.slice('ENTITY:'.length) }))];
    const task = await aiTaskService.createAndEnqueue({ projectId: input.projectId, taskType: 'CONTENT_BRIEF', requestKey: `keyword-content-brief:${request.id}:${snapshotHash}:content-brief-v1`, promptVersion: 'content-brief-v1', factSnapshot: factsSnapshot, sourceReferences });
    const queued = await prisma.keywordContentBriefRequest.update({ where: { id: request.id }, data: { aiTaskId: task.id, status: 'QUEUED' } });
    return { request: queued, task };
  }
}
