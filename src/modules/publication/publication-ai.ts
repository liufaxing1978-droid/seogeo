import { Prisma, type AiTask } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiGatewayConfig } from '../ai/ai.config.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from '../ai/ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from '../ai/structured-output.js';
import { contentHashV1 } from './publication.hash.js';
import { PublicationServiceError } from './publication.service.js';

export const PUBLICATION_CONTENT_BRIEF_PROMPT_ID = 'publication-content-brief-v1';
export const PUBLICATION_ARTICLE_GENERATION_PROMPT_ID = 'publication-article-generation-v1';

const sourceRefArray = z.array(z.string().min(1).max(300)).max(40);

export const PublicationContentBriefSchema = z.object({
  summary: z.string().min(1).max(4000),
  thesis: z.string().min(1).max(4000),
  outline: z.array(z.object({
    heading: z.string().min(1).max(300),
    purpose: z.string().min(1).max(1200),
    evidenceRefs: sourceRefArray
  })).max(24),
  evidenceNeeds: z.array(z.object({
    claim: z.string().min(1).max(1200),
    status: z.enum(['SUPPORTED', 'NEEDS_SOURCE', 'UNCERTAIN']),
    sourceRefs: sourceRefArray
  })).max(30),
  seo: z.object({
    primaryKeyword: z.string().min(1).max(300).nullable(),
    secondaryKeywords: z.array(z.string().min(1).max(300)).max(20),
    titleIdeas: z.array(z.string().min(1).max(300)).max(12),
    metaDescriptionNotes: z.string().min(1).max(1200).nullable()
  }),
  geo: z.object({
    answerTargets: z.array(z.string().min(1).max(600)).max(20),
    entityNotes: z.array(z.string().min(1).max(1200)).max(20),
    citabilityNotes: z.array(z.string().min(1).max(1200)).max(20)
  }),
  caveats: z.array(z.string().min(1).max(1200)).max(30),
  sourceReferences: sourceRefArray
}).strict();

export const PublicationArticleGenerationSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  excerpt: z.string().max(2000).nullable(),
  metaDescription: z.string().max(1000).nullable(),
  schemaJson: z.record(z.unknown()).nullable(),
  sourceReferences: sourceRefArray,
  caveats: z.array(z.string().min(1).max(1200)).max(30)
}).strict();

export type PublicationContentBriefOutput = z.infer<typeof PublicationContentBriefSchema>;
export type PublicationArticleGenerationOutput = z.infer<typeof PublicationArticleGenerationSchema>;

type SourceReference = { type: string; id: string };

function ref(type: string, id: string): string {
  return `${type}:${id}`;
}

function refsFromUnknown(value: unknown): SourceReference[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: SourceReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    if (typeof type !== 'string' || typeof id !== 'string') continue;
    const key = ref(type, id);
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type, id });
  }
  return refs;
}

function validateReturnedRefs(returned: string[], supplied: unknown): void {
  const allowed = new Set(refsFromUnknown(supplied).map((item) => ref(item.type, item.id)));
  if (returned.some((item) => !allowed.has(item))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }
}

export function parseContentBriefOutput(
  content: string,
  suppliedSourceReferences: unknown
): PublicationContentBriefOutput {
  const output = parseStructuredOutput(content, PublicationContentBriefSchema);
  validateReturnedRefs([
    ...output.sourceReferences,
    ...output.outline.flatMap((item) => item.evidenceRefs),
    ...output.evidenceNeeds.flatMap((item) => item.sourceRefs)
  ], suppliedSourceReferences);
  return output;
}

export function parseArticleGenerationOutput(
  content: string,
  suppliedSourceReferences: unknown
): PublicationArticleGenerationOutput {
  const output = parseStructuredOutput(content, PublicationArticleGenerationSchema);
  validateReturnedRefs(output.sourceReferences, suppliedSourceReferences);
  return output;
}

function ensurePacketBound(packet: unknown): void {
  if (JSON.stringify(packet).length > aiGatewayConfig.maxInputChars) {
    throw new AppError('Publication AI fact packet exceeds configured input limit', 413, 'AI_INPUT_TOO_LARGE');
  }
}

function jsonDate(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

async function loadDraftPacket(draftId: string) {
  const draft = await prisma.contentDraft.findUnique({
    where: { id: draftId },
    include: {
      sourceProposal: {
        select: {
          id: true,
          sourceType: true,
          reason: true,
          createdBy: true,
          sourceReferenceId: true,
          sourceSnapshotId: true,
          sourceMetadata: true,
          createdAt: true
        }
      },
      sourceRefs: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 30,
        select: {
          id: true,
          title: true,
          author: true,
          publisher: true,
          sourceUrl: true,
          publishedAt: true,
          sourceType: true,
          accessedAt: true,
          userProvided: true,
          internalRef: true,
          createdAt: true
        }
      }
    }
  });
  if (!draft) {
    throw new PublicationServiceError('CONTENT_DRAFT_NOT_FOUND', 'Content draft not found');
  }

  const refs: SourceReference[] = [
    { type: 'CONTENT_DRAFT_VERSION', id: `${draft.id}:v${draft.currentVersion}` }
  ];
  if (draft.sourceProposal) refs.push({ type: 'PUBLICATION_PROPOSAL', id: draft.sourceProposal.id });
  for (const source of draft.sourceRefs) refs.push({ type: 'CONTENT_SOURCE_REFERENCE', id: source.id });

  const packet = {
    draft: {
      sourceRef: ref('CONTENT_DRAFT_VERSION', `${draft.id}:v${draft.currentVersion}`),
      id: draft.id,
      projectId: draft.projectId,
      currentVersion: draft.currentVersion,
      currentContentHash: draft.currentContentHash,
      title: draft.title,
      slugCandidate: draft.slugCandidate,
      body: draft.body,
      excerpt: draft.excerpt,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      canonicalCandidate: draft.canonicalCandidate,
      schemaJson: draft.schemaJson,
      author: draft.author,
      language: draft.language,
      status: draft.status,
      generatedBy: draft.generatedBy
    },
    proposal: draft.sourceProposal ? {
      sourceRef: ref('PUBLICATION_PROPOSAL', draft.sourceProposal.id),
      id: draft.sourceProposal.id,
      sourceType: draft.sourceProposal.sourceType,
      reason: draft.sourceProposal.reason,
      createdBy: draft.sourceProposal.createdBy,
      sourceReferenceId: draft.sourceProposal.sourceReferenceId,
      sourceSnapshotId: draft.sourceProposal.sourceSnapshotId,
      sourceMetadata: draft.sourceProposal.sourceMetadata,
      createdAt: draft.sourceProposal.createdAt.toISOString()
    } : null,
    sourceReferences: draft.sourceRefs.map((source) => ({
      sourceRef: ref('CONTENT_SOURCE_REFERENCE', source.id),
      id: source.id,
      title: source.title,
      author: source.author,
      publisher: source.publisher,
      sourceUrl: source.sourceUrl,
      publishedAt: jsonDate(source.publishedAt),
      sourceType: source.sourceType,
      accessedAt: jsonDate(source.accessedAt),
      userProvided: source.userProvided,
      internalRef: source.internalRef,
      createdAt: source.createdAt.toISOString()
    }))
  };
  ensurePacketBound(packet);
  return { draft, packet, refs };
}

export async function buildContentBriefTaskInput(draftId: string): Promise<CreateAiTaskInput> {
  const { draft, packet, refs } = await loadDraftPacket(draftId);
  const contentHash = draft.currentContentHash ?? 'NO_CONTENT_HASH';
  return {
    projectId: draft.projectId,
    taskType: 'PUBLICATION_CONTENT_BRIEF',
    requestKey: `publication-content-brief:${draft.id}:${draft.currentVersion}:${contentHash}:${PUBLICATION_CONTENT_BRIEF_PROMPT_ID}`,
    promptVersion: PUBLICATION_CONTENT_BRIEF_PROMPT_ID,
    factSnapshot: packet as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createContentBriefTask(
  draftId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildContentBriefTaskInput(draftId));
}

export async function buildArticleGenerationTaskInput(
  draftId: string,
  briefTaskId: string,
  expectedDraftVersion: number
): Promise<CreateAiTaskInput> {
  if (!Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1) {
    throw new PublicationServiceError('PUBLICATION_VALIDATION_FAILED', 'expectedDraftVersion must be a positive integer');
  }

  const { draft, packet, refs } = await loadDraftPacket(draftId);
  if (draft.currentVersion !== expectedDraftVersion) {
    throw new PublicationServiceError('DRAFT_VERSION_CONFLICT', 'Content draft version changed before article task creation');
  }

  const briefTask = await prisma.aiTask.findFirst({
    where: { id: briefTaskId, projectId: draft.projectId },
    include: {
      runs: {
        orderBy: [{ attemptNo: 'desc' }, { id: 'asc' }],
        include: { result: true }
      }
    }
  });
  if (!briefTask || briefTask.taskType !== 'PUBLICATION_CONTENT_BRIEF') {
    throw new PublicationServiceError('PUBLICATION_BRIEF_NOT_FOUND', 'Completed publication content brief task not found');
  }
  if (briefTask.status !== 'COMPLETED') {
    throw new PublicationServiceError('PUBLICATION_BRIEF_NOT_COMPLETED', 'Publication content brief must be completed first');
  }
  const briefResult = briefTask.runs.map((run) => run.result).find((result) => result !== null) ?? null;
  if (!briefResult) {
    throw new PublicationServiceError('PUBLICATION_BRIEF_RESULT_NOT_FOUND', 'Publication content brief result not found');
  }

  const briefFacts = briefTask.factSnapshot as Record<string, unknown>;
  const briefDraft = briefFacts.draft as Record<string, unknown> | undefined;
  if (
    briefDraft?.id !== draft.id ||
    briefDraft?.currentVersion !== expectedDraftVersion ||
    briefDraft?.currentContentHash !== draft.currentContentHash
  ) {
    throw new PublicationServiceError('DRAFT_VERSION_CONFLICT', 'Publication brief is stale for the current draft revision');
  }

  const articleRefs = refsFromUnknown(briefTask.sourceReferences);
  const allowedKeys = new Set(articleRefs.map((item) => ref(item.type, item.id)));
  for (const item of refs) {
    const key = ref(item.type, item.id);
    if (!allowedKeys.has(key)) {
      allowedKeys.add(key);
      articleRefs.push(item);
    }
  }
  articleRefs.push({ type: 'AI_ANALYSIS_RESULT', id: briefResult.id });

  const articlePacket = {
    ...packet,
    brief: {
      sourceRef: ref('AI_ANALYSIS_RESULT', briefResult.id),
      taskId: briefTask.id,
      resultId: briefResult.id,
      promptVersion: briefResult.promptVersion,
      structuredOutput: briefResult.structuredOutput
    },
    expectedDraftVersion
  };
  ensurePacketBound(articlePacket);
  return {
    projectId: draft.projectId,
    taskType: 'PUBLICATION_ARTICLE_GENERATION',
    requestKey: `publication-article:${draft.id}:${expectedDraftVersion}:${briefTask.id}:${draft.currentContentHash ?? 'NO_CONTENT_HASH'}:${PUBLICATION_ARTICLE_GENERATION_PROMPT_ID}`,
    promptVersion: PUBLICATION_ARTICLE_GENERATION_PROMPT_ID,
    factSnapshot: articlePacket as unknown as Prisma.InputJsonValue,
    sourceReferences: articleRefs as unknown as Prisma.InputJsonValue
  };
}

export async function createArticleGenerationTask(
  draftId: string,
  briefTaskId: string,
  expectedDraftVersion: number,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildArticleGenerationTaskInput(
    draftId,
    briefTaskId,
    expectedDraftVersion
  ));
}

function hashPayload(input: {
  title: string;
  slugCandidate: string | null;
  body: string;
  excerpt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalCandidate: string | null;
  schemaJson: Prisma.JsonValue | Prisma.InputJsonValue | null;
  author: string | null;
  language: string;
}) {
  return {
    title: input.title,
    slugCandidate: input.slugCandidate,
    body: input.body,
    excerpt: input.excerpt,
    metaTitle: input.metaTitle,
    metaDescription: input.metaDescription,
    canonicalCandidate: input.canonicalCandidate,
    schemaJson: input.schemaJson,
    author: input.author,
    language: input.language
  };
}

export async function materializeArticleGenerationOutput(
  task: AiTask,
  output: PublicationArticleGenerationOutput,
  tx: Prisma.TransactionClient
): Promise<void> {
  const facts = task.factSnapshot as Record<string, unknown>;
  const draftFacts = facts.draft as Record<string, unknown> | undefined;
  const draftId = typeof draftFacts?.id === 'string' ? draftFacts.id : null;
  const expectedVersion = typeof facts.expectedDraftVersion === 'number'
    ? facts.expectedDraftVersion
    : typeof draftFacts?.currentVersion === 'number'
      ? draftFacts.currentVersion
      : null;
  const expectedHash = typeof draftFacts?.currentContentHash === 'string'
    ? draftFacts.currentContentHash
    : draftFacts?.currentContentHash === null
      ? null
      : undefined;
  if (!draftId || !expectedVersion) {
    throw new AiOutputValidationError('Publication article task is missing its bound draft revision');
  }

  const current = await tx.contentDraft.findFirst({
    where: { id: draftId, projectId: task.projectId }
  });
  if (!current) {
    throw new PublicationServiceError('CONTENT_DRAFT_NOT_FOUND', 'Content draft not found during AI materialization');
  }
  if (current.currentVersion !== expectedVersion || current.currentContentHash !== expectedHash) {
    throw new PublicationServiceError('DRAFT_VERSION_CONFLICT', 'Content draft changed before AI article materialization');
  }

  const schemaJson = output.schemaJson as Prisma.InputJsonObject | null;
  const nextVersion = expectedVersion + 1;
  const contentHash = contentHashV1(hashPayload({
    title: output.title,
    slugCandidate: current.slugCandidate,
    body: output.body,
    excerpt: output.excerpt,
    metaTitle: current.metaTitle,
    metaDescription: output.metaDescription,
    canonicalCandidate: current.canonicalCandidate,
    schemaJson,
    author: current.author,
    language: current.language
  }));

  const updated = await tx.contentDraft.updateMany({
    where: {
      id: current.id,
      projectId: task.projectId,
      currentVersion: expectedVersion,
      currentContentHash: expectedHash
    },
    data: {
      title: output.title,
      body: output.body,
      excerpt: output.excerpt,
      metaDescription: output.metaDescription,
      schemaJson: schemaJson === null ? Prisma.JsonNull : schemaJson,
      currentVersion: nextVersion,
      currentContentHash: contentHash,
      generatedBy: 'DEEPSEEK'
    }
  });
  if (updated.count !== 1) {
    throw new PublicationServiceError('DRAFT_VERSION_CONFLICT', 'Content draft changed before AI article materialization');
  }

  await tx.contentDraftVersion.create({
    data: {
      draftId: current.id,
      version: nextVersion,
      title: output.title,
      slugCandidate: current.slugCandidate,
      body: output.body,
      excerpt: output.excerpt,
      metaTitle: current.metaTitle,
      metaDescription: output.metaDescription,
      canonicalCandidate: current.canonicalCandidate,
      ...(schemaJson !== null ? { schemaJson } : {}),
      author: current.author,
      language: current.language,
      contentHash,
      generatedBy: 'DEEPSEEK'
    }
  });
}
