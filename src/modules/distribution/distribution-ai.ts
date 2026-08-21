import { createHash } from 'node:crypto';
import {
  Prisma,
  type AiTask,
  type DistributionMode,
  type DistributionPlatform
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from '../ai/ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from '../ai/structured-output.js';
import {
  normalizeDistributionTargetContext,
  type CommunityTargetContext
} from './distribution-target-policy.js';

export const DISTRIBUTION_CANONICAL_REPOST_PROMPT_ID = 'distribution-canonical-repost-v1';
export const DISTRIBUTION_ADAPTED_ARTICLE_PROMPT_ID = 'distribution-adapted-article-v1';
export const DISTRIBUTION_SUMMARY_PROMPT_ID = 'distribution-summary-v1';
export const DISTRIBUTION_COMMUNITY_DRAFT_PROMPT_ID = 'distribution-community-draft-v1';

const sourceRefArray = z.array(z.string().min(1).max(300)).max(40);

export const DistributionAdaptationOutputSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(120)).max(20),
  originalUrl: z.string().url(),
  canonicalUrl: z.string().url().nullable(),
  sourceRefs: sourceRefArray,
  platformMetadata: z.record(z.unknown()).default({})
}).strict();

export const CommunityDistributionOutputSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(30_000),
  summary: z.string().min(1).max(4000),
  tags: z.array(z.string().min(1).max(120)).max(20),
  sourceRefs: sourceRefArray,
  promotionalLanguageDetected: z.boolean(),
  brandLinkIncluded: z.boolean(),
  originalUrl: z.string().url(),
  canonicalUrl: z.null()
}).strict();

export type DistributionAdaptationOutput = z.infer<typeof DistributionAdaptationOutputSchema>;
export type CommunityDistributionOutput = z.infer<typeof CommunityDistributionOutputSchema>;
export type DistributionTaskOutput = DistributionAdaptationOutput | CommunityDistributionOutput;

type SourceReference = { type: string; id: string };

export type DistributionAdaptationRequestIdentity = {
  publicationId: string;
  sourceContentVersion: number;
  platform: DistributionPlatform;
  mode: DistributionMode;
  promptVersion: string;
  contextHash?: string;
};

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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function communityContextHash(context: CommunityTargetContext): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(context)))
    .digest('hex');
}

export function promptIdForDistributionMode(mode: DistributionMode | string): string {
  switch (mode) {
    case 'CANONICAL_REPOST':
      return DISTRIBUTION_CANONICAL_REPOST_PROMPT_ID;
    case 'ADAPTED_ARTICLE':
      return DISTRIBUTION_ADAPTED_ARTICLE_PROMPT_ID;
    case 'SUMMARY':
      return DISTRIBUTION_SUMMARY_PROMPT_ID;
    case 'COMMUNITY_DRAFT':
      return DISTRIBUTION_COMMUNITY_DRAFT_PROMPT_ID;
    default:
      throw new AiOutputValidationError(`Distribution mode ${mode} is not supported by the adaptation AI task`);
  }
}

export function parseDistributionAdaptationOutput(
  content: string,
  suppliedSourceReferences: unknown,
  context: { mode: DistributionMode | string; originalUrl: string }
): DistributionAdaptationOutput {
  const parsed = parseStructuredOutput(content, DistributionAdaptationOutputSchema);
  const output: DistributionAdaptationOutput = {
    ...parsed,
    platformMetadata: parsed.platformMetadata ?? {}
  };
  validateReturnedRefs(output.sourceRefs, suppliedSourceReferences);

  if (output.originalUrl !== context.originalUrl) {
    throw new AiOutputValidationError('AI output original URL does not match the supplied original source');
  }
  if (context.mode === 'CANONICAL_REPOST' && output.canonicalUrl !== context.originalUrl) {
    throw new AiOutputValidationError('Canonical repost must retain the supplied canonical source URL');
  }

  return output;
}

export function parseCommunityDistributionOutput(
  content: string,
  suppliedSourceReferences: unknown,
  context: { originalUrl: string; includeBrandLink: boolean }
): CommunityDistributionOutput {
  const output = parseStructuredOutput(content, CommunityDistributionOutputSchema);
  validateReturnedRefs(output.sourceRefs, suppliedSourceReferences);

  if (output.originalUrl !== context.originalUrl) {
    throw new AiOutputValidationError('Community draft original URL does not match the supplied original source');
  }
  if (output.canonicalUrl !== null) {
    throw new AiOutputValidationError('Community draft canonical URL must be null');
  }
  if (output.brandLinkIncluded && !context.includeBrandLink) {
    throw new AiOutputValidationError('Community draft included a brand link without target-context permission');
  }

  return output;
}

export function distributionAdaptationRequestKey(
  input: DistributionAdaptationRequestIdentity
): string {
  return [
    'distribution-adaptation',
    input.publicationId,
    input.sourceContentVersion,
    input.platform,
    input.mode,
    input.promptVersion,
    ...(input.contextHash ? [input.contextHash] : [])
  ].join(':');
}

export async function buildDistributionAdaptationTaskInput(
  targetId: string,
  sourceContentVersion: number
): Promise<CreateAiTaskInput> {
  if (!Number.isInteger(sourceContentVersion) || sourceContentVersion < 1) {
    throw new AiOutputValidationError('Distribution source content version must be a positive integer');
  }

  const target = await prisma.distributionTarget.findUnique({ where: { id: targetId } });
  if (!target) throw new AiOutputValidationError('Distribution target not found');

  const promptVersion = promptIdForDistributionMode(target.mode);
  const communityContext = target.mode === 'COMMUNITY_DRAFT'
    ? normalizeDistributionTargetContext({
      platform: target.platform,
      mode: target.mode,
      context: target.targetContext
    })
    : null;
  const contextHash = communityContext ? communityContextHash(communityContext) : undefined;

  const publication = await prisma.publicationExecution.findFirst({
    where: {
      id: target.publicationId,
      projectId: target.projectId
    },
    select: {
      id: true,
      projectId: true,
      plan: {
        select: {
          draftId: true,
          draftVersion: true,
          targetPublicUrl: true
        }
      }
    }
  });
  if (!publication) {
    throw new AiOutputValidationError('Distribution primary publication not found');
  }
  if (publication.plan.draftVersion !== sourceContentVersion) {
    throw new AiOutputValidationError('Distribution source content version does not match the bound primary publication');
  }

  const sourceVersion = await prisma.contentDraftVersion.findFirst({
    where: {
      draftId: publication.plan.draftId,
      version: sourceContentVersion
    }
  });
  if (!sourceVersion) {
    throw new AiOutputValidationError('Distribution source draft version not found');
  }

  const communitySources = communityContext
    ? await prisma.contentSourceReference.findMany({
      where: {
        projectId: target.projectId,
        draftId: sourceVersion.draftId
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
    : [];

  const sourceReferences: SourceReference[] = [
    { type: 'PUBLICATION_EXECUTION', id: publication.id },
    { type: 'CONTENT_DRAFT_VERSION', id: `${sourceVersion.draftId}:v${sourceVersion.version}` },
    ...communitySources.map((source) => ({
      type: 'CONTENT_SOURCE_REFERENCE',
      id: source.id
    }))
  ];
  const factSnapshot = {
    target: {
      id: target.id,
      publicationId: target.publicationId,
      platform: target.platform,
      mode: target.mode,
      targetKey: target.targetKey,
      ...(communityContext ? { context: communityContext } : {})
    },
    primary: {
      sourceContentVersion,
      originalUrl: publication.plan.targetPublicUrl,
      draftId: sourceVersion.draftId,
      title: sourceVersion.title,
      body: sourceVersion.body,
      language: sourceVersion.language
    },
    ...(communityContext ? {
      sources: communitySources.map((source) => ({
        id: source.id,
        title: source.title,
        author: source.author,
        publisher: source.publisher,
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType,
        userProvided: source.userProvided,
        internalRef: source.internalRef
      }))
    } : {})
  };

  return {
    projectId: target.projectId,
    taskType: 'PUBLICATION_CONTENT_ADAPTATION',
    requestKey: distributionAdaptationRequestKey({
      publicationId: target.publicationId,
      sourceContentVersion,
      platform: target.platform,
      mode: target.mode,
      promptVersion,
      contextHash
    }),
    promptVersion,
    factSnapshot: factSnapshot as unknown as Prisma.InputJsonValue,
    sourceReferences: sourceReferences as unknown as Prisma.InputJsonValue
  };
}

export async function createDistributionAdaptationTask(
  targetId: string,
  sourceContentVersion: number,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(
    await buildDistributionAdaptationTaskInput(targetId, sourceContentVersion)
  );
}

type TaskBinding = {
  targetId: string;
  publicationId: string;
  sourceContentVersion: number;
  mode: DistributionMode | string;
  platform: DistributionPlatform | string;
  originalUrl: string;
  communityContext: CommunityTargetContext | null;
};

function taskBinding(task: AiTask): TaskBinding {
  const facts = task.factSnapshot as Record<string, unknown>;
  const target = facts.target as Record<string, unknown> | undefined;
  const primary = facts.primary as Record<string, unknown> | undefined;
  const targetId = typeof target?.id === 'string' ? target.id : null;
  const publicationId = typeof target?.publicationId === 'string' ? target.publicationId : null;
  const mode = typeof target?.mode === 'string' ? target.mode : null;
  const platform = typeof target?.platform === 'string' ? target.platform : null;
  const sourceContentVersion = typeof primary?.sourceContentVersion === 'number'
    ? primary.sourceContentVersion
    : null;
  const originalUrl = typeof primary?.originalUrl === 'string' ? primary.originalUrl : null;

  if (!targetId || !publicationId || !mode || !platform || !sourceContentVersion || !originalUrl) {
    throw new AiOutputValidationError('Distribution adaptation task is missing its bound source facts');
  }

  let communityContext: CommunityTargetContext | null = null;
  if (mode === 'COMMUNITY_DRAFT') {
    communityContext = normalizeDistributionTargetContext({
      platform: platform as DistributionPlatform,
      mode: mode as DistributionMode,
      context: target?.context
    });
  }

  return {
    targetId,
    publicationId,
    sourceContentVersion,
    mode,
    platform,
    originalUrl,
    communityContext
  };
}

export function parseDistributionAdaptationTaskOutput(
  task: AiTask,
  content: string
): DistributionTaskOutput {
  const binding = taskBinding(task);
  if (binding.mode === 'COMMUNITY_DRAFT') {
    if (!binding.communityContext) {
      throw new AiOutputValidationError('Community distribution task is missing target context');
    }
    return parseCommunityDistributionOutput(content, task.sourceReferences, {
      originalUrl: binding.originalUrl,
      includeBrandLink: binding.communityContext.includeBrandLink
    });
  }

  return parseDistributionAdaptationOutput(content, task.sourceReferences, {
    mode: binding.mode,
    originalUrl: binding.originalUrl
  });
}

export function promptIdForDistributionTask(task: AiTask): string {
  return promptIdForDistributionMode(taskBinding(task).mode);
}

export async function materializeDistributionAdaptationOutput(
  task: AiTask,
  output: DistributionTaskOutput,
  tx: Prisma.TransactionClient
): Promise<void> {
  const binding = taskBinding(task);
  const target = await tx.distributionTarget.findFirst({
    where: {
      id: binding.targetId,
      projectId: task.projectId,
      publicationId: binding.publicationId
    }
  });
  if (!target) {
    throw new AiOutputValidationError('Distribution target not found during AI materialization');
  }

  let platformMetadata: Record<string, unknown>;
  if (binding.mode === 'COMMUNITY_DRAFT') {
    if (!binding.communityContext) {
      throw new AiOutputValidationError('Community distribution task is missing target context');
    }
    const communityOutput = output as CommunityDistributionOutput;
    platformMetadata = {
      kind: 'COMMUNITY_DRAFT',
      question: binding.communityContext.question,
      topicUrl: binding.communityContext.topicUrl,
      includeBrandLink: binding.communityContext.includeBrandLink,
      promotionalLanguageDetected: communityOutput.promotionalLanguageDetected,
      brandLinkIncluded: communityOutput.brandLinkIncluded,
      contextHash: communityContextHash(binding.communityContext)
    };
  } else {
    platformMetadata = (output as DistributionAdaptationOutput).platformMetadata ?? {};
  }

  const latestArtifact = await tx.distributionArtifact.findFirst({
    where: { targetId: target.id },
    orderBy: [{ artifactVersion: 'desc' }, { id: 'asc' }],
    select: { artifactVersion: true }
  });
  const artifactVersion = (latestArtifact?.artifactVersion ?? 0) + 1;
  const artifactHash = createHash('sha256')
    .update(JSON.stringify(canonicalize({
      targetId: target.id,
      sourceContentVersion: binding.sourceContentVersion,
      adaptationVersion: task.promptVersion,
      artifactVersion,
      title: output.title,
      body: output.body,
      summary: output.summary,
      tags: output.tags,
      originalUrl: output.originalUrl,
      canonicalUrl: output.canonicalUrl,
      sourceRefs: output.sourceRefs,
      platformMetadata
    })))
    .digest('hex');

  const artifact = await tx.distributionArtifact.create({
    data: {
      targetId: target.id,
      projectId: target.projectId,
      sourceContentVersion: binding.sourceContentVersion,
      adaptationVersion: task.promptVersion,
      artifactVersion,
      artifactHash,
      title: output.title,
      body: output.body,
      summary: output.summary,
      tags: output.tags as unknown as Prisma.InputJsonValue,
      originalUrl: output.originalUrl,
      canonicalUrl: output.canonicalUrl,
      sourceRefs: output.sourceRefs as unknown as Prisma.InputJsonValue,
      platformMetadata: platformMetadata as Prisma.InputJsonValue
    }
  });

  await tx.distributionTargetEvent.create({
    data: {
      targetId: target.id,
      artifactId: artifact.id,
      fromStatus: target.status,
      toStatus: 'DRAFT_READY',
      reasonCode: 'ARTIFACT_PREPARED',
      sourceContentVersion: binding.sourceContentVersion
    }
  });

  await tx.distributionTarget.update({
    where: { id: target.id },
    data: {
      status: 'DRAFT_READY',
      sourceContentVersion: Math.max(
        target.sourceContentVersion ?? binding.sourceContentVersion,
        binding.sourceContentVersion
      )
    }
  });
}
