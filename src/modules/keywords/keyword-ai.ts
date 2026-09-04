import { createHash } from 'node:crypto';
import { Prisma, type AiTask } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from '../ai/ai.service.js';
import { parseStructuredOutput } from '../ai/structured-output.js';
import { projectRepository } from '../projects/project.repository.js';
import { normalizeKeywordText } from './keyword-normalize.js';

export const KEYWORD_EXPANSION_PROMPT_ID = 'keyword-expansion-v1';

export const KeywordExpansionOutputSchema = z.object({
  suggestions: z.array(z.object({
    text: z.string().trim().min(1).max(160),
    type: z.enum(['LONG_TAIL', 'QUESTION', 'LOCAL', 'COMMERCIAL', 'BRAND']),
    intent: z.enum([
      'INFORMATIONAL',
      'NAVIGATIONAL',
      'COMMERCIAL_INVESTIGATION',
      'TRANSACTIONAL',
      'LOCAL',
      'UNKNOWN',
    ]),
    rationale: z.string().trim().min(1).max(300),
  })).max(20),
});

export type KeywordExpansionOutput = z.infer<typeof KeywordExpansionOutputSchema>;

export interface KeywordExpansionSeedFact {
  id: string;
  text: string;
  type: string;
  intent: string | null;
}

export interface KeywordExpansionChildFact {
  id: string;
  text: string;
}

export interface KeywordExpansionProjectContext {
  defaultLanguage: string;
  targetCountry: string;
  industry: string | null;
}

export interface KeywordExpansionFactSnapshot {
  seedKeyword: KeywordExpansionSeedFact;
  existingAcceptedChildren: string[];
  existingProjectKeywords: string[];
  context: KeywordExpansionProjectContext;
}

export function parseKeywordExpansionOutput(content: string, seedText: string): KeywordExpansionOutput {
  const parsed = parseStructuredOutput(content, KeywordExpansionOutputSchema);
  const normalizedSeed = normalizeKeywordText(seedText);
  const seen = new Set<string>();

  return {
    suggestions: parsed.suggestions.filter((suggestion) => {
      const normalized = normalizeKeywordText(suggestion.text);
      if (normalized === normalizedSeed || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    }),
  };
}

export function buildKeywordExpansionFactSnapshot(input: {
  seedKeyword: KeywordExpansionSeedFact;
  projectContext: KeywordExpansionProjectContext;
  existingAcceptedChildren: KeywordExpansionChildFact[];
  existingProjectKeywords: KeywordExpansionChildFact[];
}): KeywordExpansionFactSnapshot {
  return {
    seedKeyword: {
      id: input.seedKeyword.id,
      text: input.seedKeyword.text,
      type: input.seedKeyword.type,
      intent: input.seedKeyword.intent,
    },
    existingAcceptedChildren: [...input.existingAcceptedChildren]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((child) => child.text),
    existingProjectKeywords: [...input.existingProjectKeywords]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((keyword) => keyword.text),
    context: {
      industry: input.projectContext.industry,
      defaultLanguage: input.projectContext.defaultLanguage,
      targetCountry: input.projectContext.targetCountry,
    },
  };
}

export function keywordExpansionRequestKey(
  seed: { id: string; updatedAt: Date },
  factSnapshot: KeywordExpansionFactSnapshot,
): string {
  const factFingerprint = createHash('sha256')
    .update(JSON.stringify(factSnapshot))
    .digest('hex')
    .slice(0, 16);
  return `keyword-expand:${seed.id}:${seed.updatedAt.toISOString()}:${factFingerprint}:${KEYWORD_EXPANSION_PROMPT_ID}`;
}

export async function buildKeywordExpansionTaskInput(
  projectId: string,
  seedKeywordId: string,
): Promise<CreateAiTaskInput> {
  const [project, seed, projectKeywords] = await Promise.all([
    projectRepository.findById(projectId),
    prisma.keyword.findFirst({ where: { id: seedKeywordId, projectId } }),
    prisma.keyword.findMany({ where: { projectId }, select: { id: true, text: true } }),
  ]);

  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!seed) throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');

  const relations = await prisma.keywordRelation.findMany({
    where: { projectId, parentKeywordId: seed.id },
    select: { childKeywordId: true },
    orderBy: { childKeywordId: 'asc' },
  });
  const childIds = relations.map((relation) => relation.childKeywordId);
  const children = childIds.length === 0
    ? []
    : await prisma.keyword.findMany({
        where: { projectId, id: { in: childIds } },
        select: { id: true, text: true },
      });

  const factSnapshot = buildKeywordExpansionFactSnapshot({
    seedKeyword: {
      id: seed.id,
      text: seed.text,
      type: seed.type,
      intent: seed.intent,
    },
    projectContext: {
      industry: project.industry,
      defaultLanguage: project.defaultLanguage,
      targetCountry: project.targetCountry,
    },
    existingAcceptedChildren: children,
    existingProjectKeywords: projectKeywords,
  });

  return {
    projectId,
    taskType: 'KEYWORD_EXPANSION',
    requestKey: keywordExpansionRequestKey(seed, factSnapshot),
    promptVersion: KEYWORD_EXPANSION_PROMPT_ID,
    factSnapshot: factSnapshot as unknown as Prisma.InputJsonValue,
    sourceReferences: [{ type: 'KEYWORD', id: seed.id }] as Prisma.InputJsonValue,
  };
}

export async function createKeywordExpansionTask(
  projectId: string,
  seedKeywordId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService,
) {
  return service.createAndEnqueue(
    await buildKeywordExpansionTaskInput(projectId, seedKeywordId),
  );
}

function extractSeedKeywordId(task: AiTask): string {
  const snapshot = task.factSnapshot as Record<string, unknown>;
  const seed = snapshot.seedKeyword as Record<string, unknown> | undefined;
  if (typeof seed?.id !== 'string' || !seed.id) {
    throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');
  }
  return seed.id;
}

export async function materializeKeywordSuggestions(
  task: AiTask,
  output: KeywordExpansionOutput,
  providerMeta: { model: string; responseId: string | null },
  tx: Prisma.TransactionClient,
): Promise<void> {
  const seedId = extractSeedKeywordId(task);
  const seed = await tx.keyword.findFirst({
    where: { id: seedId, projectId: task.projectId },
  });
  if (!seed) throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');

  const existingKeywords = await tx.keyword.findMany({
    where: { projectId: task.projectId },
    select: { normalizedText: true },
  });
  const existingNormalized = new Set(existingKeywords.map((keyword) => keyword.normalizedText));
  const newSuggestions = output.suggestions.filter((item) => (
    !existingNormalized.has(normalizeKeywordText(item.text))
  ));

  await tx.keywordSuggestion.createMany({
    data: newSuggestions.map((item) => ({
      projectId: task.projectId,
      seedKeywordId: seed.id,
      suggestedText: item.text.trim(),
      normalizedText: normalizeKeywordText(item.text),
      suggestedType: item.type,
      suggestedIntent: item.intent,
      rationale: item.rationale,
      status: 'PENDING',
      provider: 'DEEPSEEK',
      model: providerMeta.model,
      aiTaskId: task.id,
      responseId: providerMeta.responseId,
    })),
    skipDuplicates: true,
  });
}
