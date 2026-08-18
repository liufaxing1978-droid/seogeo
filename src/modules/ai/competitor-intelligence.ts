import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export const COMPETITOR_GAP_PROMPT_ID = 'competitor-gap-v1';

const GapExplanationSchema = z.object({
  summary: z.string().min(1),
  priorities: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    metric: z.string().min(1),
    explanation: z.string().min(1),
    action: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  unavailableClaims: z.array(z.string().min(1)).max(12),
  sourceReferences: z.array(z.string().min(1)).min(1).max(50)
});

export type CompetitorGapExplanation = z.infer<typeof GapExplanationSchema>;

type Ref = { type: string; id: string };
function ref(type: string, id: string) { return `${type}:${id}`; }

function allowedSet(sourceReferences: unknown): Set<string> {
  if (!Array.isArray(sourceReferences)) return new Set();
  return new Set(sourceReferences.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    return typeof type === 'string' && typeof id === 'string' ? [ref(type, id)] : [];
  }));
}

export function parseCompetitorGapOutput(content: string, sourceReferences: unknown): CompetitorGapExplanation {
  const output = parseStructuredOutput(content, GapExplanationSchema);
  const allowed = allowedSet(sourceReferences);
  const returned = [...output.sourceReferences, ...output.priorities.flatMap((item) => item.sourceRefs)];
  if (returned.some((item) => !allowed.has(item))) throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  return output;
}

export async function buildCompetitorGapTaskInput(projectId: string, comparisonId: string): Promise<CreateAiTaskInput> {
  const comparison = await prisma.competitorComparison.findFirst({ where: { id: comparisonId, projectId }, include: { competitor: true } });
  if (!comparison) throw new NotFoundError('Competitor comparison not found', 'COMPETITOR_COMPARISON_NOT_FOUND');

  const refs: Ref[] = [{ type: 'COMPETITOR_COMPARISON', id: comparison.id }];
  if (Array.isArray(comparison.sourceReferences)) {
    for (const item of comparison.sourceReferences) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const type = (item as Record<string, unknown>).type;
      const id = (item as Record<string, unknown>).id;
      if (typeof type === 'string' && typeof id === 'string') refs.push({ type, id });
    }
  }

  return {
    projectId,
    taskType: 'COMPETITOR_GAP_ANALYSIS',
    requestKey: `competitor-gap:${comparison.id}:${COMPETITOR_GAP_PROMPT_ID}`,
    promptVersion: COMPETITOR_GAP_PROMPT_ID,
    factSnapshot: {
      comparison: {
        sourceRef: ref('COMPETITOR_COMPARISON', comparison.id),
        competitorName: comparison.competitor.name,
        competitorDomain: comparison.competitor.domain,
        comparisonVersion: comparison.comparisonVersion,
        ownedMetrics: comparison.ownedMetrics,
        competitorMetrics: comparison.competitorMetrics,
        gaps: comparison.gaps
      },
      unavailableFacts: ['search rankings', 'organic traffic', 'AI citations', 'AI visibility', 'share of voice']
    } as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createCompetitorGapTask(projectId: string, comparisonId: string, service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService): Promise<AiTask> {
  return service.createAndEnqueue(await buildCompetitorGapTaskInput(projectId, comparisonId));
}
