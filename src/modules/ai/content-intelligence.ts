import { createHash } from 'node:crypto';
import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiGatewayConfig } from './ai.config.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export const CONTENT_BRIEF_PROMPT_ID = 'content-brief-v1';
export const CONTENT_OPTIMIZATION_PROMPT_ID = 'content-optimization-v1';

const sourceRefs = z.array(z.string().min(1)).min(1).max(20);

export const ContentBriefSchema = z.object({
  objective: z.string().min(1),
  audience: z.string().min(1),
  primaryTopic: z.string().min(1),
  supportingTopics: z.array(z.string().min(1)).max(12),
  recommendedOutline: z.array(z.string().min(1)).min(1).max(20),
  entitiesToCover: z.array(z.string().min(1)).max(20),
  questionsToAnswer: z.array(z.string().min(1)).max(20),
  internalLinkSuggestions: z.array(z.string().min(1)).max(12),
  evidenceNotes: z.array(z.string().min(1)).max(20),
  sourceReferences: sourceRefs
});

export const ContentOptimizationSchema = z.object({
  summary: z.string().min(1),
  priorities: z.array(z.object({ priority: z.enum(['HIGH', 'MEDIUM', 'LOW']), action: z.string().min(1), sourceRefs })).max(12),
  sectionRecommendations: z.array(z.string().min(1)).max(20),
  entityRecommendations: z.array(z.string().min(1)).max(20),
  internalLinkRecommendations: z.array(z.string().min(1)).max(12),
  citabilityRecommendations: z.array(z.string().min(1)).max(12),
  doNotChange: z.array(z.string().min(1)).max(12),
  sourceReferences: sourceRefs
});

export type ContentBriefOutput = z.infer<typeof ContentBriefSchema>;
export type ContentOptimizationOutput = z.infer<typeof ContentOptimizationSchema>;

type SourceReference = { type: string; id: string };

function ref(type: string, id: string) { return `${type}:${id}`; }

function allowedReferenceSet(sourceReferences: unknown): Set<string> {
  if (!Array.isArray(sourceReferences)) return new Set();
  return new Set(sourceReferences.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    return typeof type === 'string' && typeof id === 'string' ? [ref(type, id)] : [];
  }));
}

function validateReturnedRefs(returned: string[], supplied: unknown) {
  const allowed = allowedReferenceSet(supplied);
  if (returned.some((item) => !allowed.has(item))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }
}

export function parseContentBriefOutput(content: string, supplied: unknown): ContentBriefOutput {
  const output = parseStructuredOutput(content, ContentBriefSchema);
  validateReturnedRefs(output.sourceReferences, supplied);
  return output;
}

export function parseContentOptimizationOutput(content: string, supplied: unknown): ContentOptimizationOutput {
  const output = parseStructuredOutput(content, ContentOptimizationSchema);
  validateReturnedRefs([
    ...output.sourceReferences,
    ...output.priorities.flatMap((item) => item.sourceRefs)
  ], supplied);
  return output;
}

async function buildPacket(projectId: string, documentId: string) {
  const document = await prisma.contentDocument.findFirst({
    where: { id: documentId, projectId },
    include: {
      signals: { orderBy: [{ priority: 'desc' }, { ruleKey: 'asc' }], take: 20 },
      opportunities: { where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }], take: 20 }
    }
  });
  if (!document) throw new NotFoundError('Content document not found for project', 'CONTENT_DOCUMENT_NOT_FOUND');

  const entities = await prisma.pageEntity.findMany({
    where: { pageId: document.pageId, entity: { projectId, status: 'ACTIVE' } },
    include: { entity: { select: { id: true, canonicalName: true, entityType: true } } },
    orderBy: { confidence: 'desc' },
    take: 20
  });

  const refs: SourceReference[] = [{ type: 'CONTENT_DOCUMENT', id: document.id }, { type: 'PAGE_SNAPSHOT', id: document.latestPageSnapshotId }];
  for (const signal of document.signals) refs.push({ type: 'CONTENT_SIGNAL', id: signal.id });
  for (const opportunity of document.opportunities) refs.push({ type: 'CONTENT_OPPORTUNITY', id: opportunity.id });
  for (const item of entities) refs.push({ type: 'ENTITY', id: item.entity.id });

  const packet = {
    document: {
      sourceRef: ref('CONTENT_DOCUMENT', document.id),
      canonicalUrl: document.canonicalUrl,
      title: document.title,
      metaDescription: document.metaDescription,
      h1: document.h1,
      language: document.language,
      wordCount: document.wordCount,
      headingCount: document.headingCount,
      imageCount: document.imageCount,
      internalLinkCount: document.internalLinkCount,
      externalLinkCount: document.externalLinkCount,
      schemaTypes: document.schemaTypes,
      contentHash: document.contentHash
    },
    signals: document.signals.map((signal) => ({
      sourceRef: ref('CONTENT_SIGNAL', signal.id), ruleKey: signal.ruleKey, ruleVersion: signal.ruleVersion,
      status: signal.status, priority: signal.priority, numericValue: signal.numericValue, textValue: signal.textValue
    })),
    opportunities: document.opportunities.map((opportunity) => ({
      sourceRef: ref('CONTENT_OPPORTUNITY', opportunity.id), category: opportunity.category,
      priority: opportunity.priority, status: opportunity.status, summary: opportunity.summary
    })),
    entities: entities.map((item) => ({
      sourceRef: ref('ENTITY', item.entity.id), name: item.entity.canonicalName, type: item.entity.entityType,
      role: item.role, confidence: item.confidence
    }))
  };

  if (JSON.stringify(packet).length > aiGatewayConfig.maxInputChars) {
    throw new AppError('Content AI fact packet exceeds configured input limit', 413, 'AI_INPUT_TOO_LARGE');
  }
  return { document, packet, refs };
}

async function buildTaskInput(projectId: string, documentId: string, kind: 'brief' | 'optimization'): Promise<CreateAiTaskInput> {
  const { document, packet, refs } = await buildPacket(projectId, documentId);
  const brief = kind === 'brief';
  const promptVersion = brief ? CONTENT_BRIEF_PROMPT_ID : CONTENT_OPTIMIZATION_PROMPT_ID;
  return {
    projectId,
    taskType: brief ? 'CONTENT_BRIEF' : 'CONTENT_OPTIMIZATION_ANALYSIS',
    requestKey: brief
      ? `content-brief:${document.id}:${document.contentHash}:${CONTENT_BRIEF_PROMPT_ID}`
      : `content-opt:${document.id}:${document.contentHash}:${CONTENT_OPTIMIZATION_PROMPT_ID}`,
    promptVersion,
    factSnapshot: packet as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export function buildContentBriefTaskInput(projectId: string, documentId: string) {
  return buildTaskInput(projectId, documentId, 'brief');
}
export function buildContentOptimizationTaskInput(projectId: string, documentId: string) {
  return buildTaskInput(projectId, documentId, 'optimization');
}

export async function createContentBriefTask(projectId: string, documentId: string, service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService): Promise<AiTask> {
  return service.createAndEnqueue(await buildContentBriefTaskInput(projectId, documentId));
}
export async function createContentOptimizationTask(projectId: string, documentId: string, service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService): Promise<AiTask> {
  return service.createAndEnqueue(await buildContentOptimizationTaskInput(projectId, documentId));
}

export async function persistContentBrief(task: AiTask, output: ContentBriefOutput, tx?: Prisma.TransactionClient) {
  const snapshot = task.factSnapshot as Record<string, unknown>;
  const document = snapshot.document as Record<string, unknown> | undefined;
  const documentRef = typeof document?.sourceRef === 'string' ? document.sourceRef : '';
  const contentDocumentId = documentRef.startsWith('CONTENT_DOCUMENT:') ? documentRef.slice('CONTENT_DOCUMENT:'.length) : null;
  const contentHash = typeof document?.contentHash === 'string' ? document.contentHash : '';
  const factSnapshotHash = createHash('sha256').update(JSON.stringify(task.factSnapshot)).digest('hex');
  const args = {
    where: { aiTaskId: task.id },
    create: {
      projectId: task.projectId,
      contentDocumentId,
      aiTaskId: task.id,
      promptVersion: task.promptVersion,
      factSnapshotHash: contentHash ? `${contentHash}:${factSnapshotHash}` : factSnapshotHash,
      briefJson: output as unknown as Prisma.InputJsonValue,
      sourceReferences: task.sourceReferences as Prisma.InputJsonValue
    },
    update: {
      contentDocumentId,
      promptVersion: task.promptVersion,
      factSnapshotHash: contentHash ? `${contentHash}:${factSnapshotHash}` : factSnapshotHash,
      briefJson: output as unknown as Prisma.InputJsonValue,
      sourceReferences: task.sourceReferences as Prisma.InputJsonValue
    }
  } satisfies Prisma.ContentBriefUpsertArgs;
  return tx ? tx.contentBrief.upsert(args) : prisma.contentBrief.upsert(args);
}
