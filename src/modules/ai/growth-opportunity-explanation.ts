import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export const GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID = 'growth-opportunity-explanation-v1';

const GrowthOpportunityExplanationSchema = z.object({
  summary: z.string().min(1),
  whyNow: z.string().min(1),
  actions: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    action: z.string().min(1),
    rationale: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  caveats: z.array(z.string().min(1)).max(12),
  sourceReferences: z.array(z.string().min(1)).min(1).max(80)
});

export type GrowthOpportunityExplanationOutput = z.infer<typeof GrowthOpportunityExplanationSchema>;

type Ref = { type: string; id: string };
function ref(type: string, id: string) { return `${type}:${id}`; }

function refsFromJson(value: unknown): Ref[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    return typeof type === 'string' && typeof id === 'string' ? [{ type, id }] : [];
  });
}

function allowedSet(sourceReferences: unknown): Set<string> {
  return new Set(refsFromJson(sourceReferences).map((item) => ref(item.type, item.id)));
}

export function parseGrowthOpportunityExplanationOutput(
  content: string,
  sourceReferences: unknown
): GrowthOpportunityExplanationOutput {
  const output = parseStructuredOutput(content, GrowthOpportunityExplanationSchema);
  const allowed = allowedSet(sourceReferences);
  const returned = [
    ...output.sourceReferences,
    ...output.actions.flatMap((item) => item.sourceRefs)
  ];
  if (returned.some((item) => !allowed.has(item))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }
  return output;
}

export async function buildGrowthOpportunityExplanationTaskInput(
  projectId: string,
  opportunityId: string
): Promise<CreateAiTaskInput> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      primaryDomain: true,
      industry: true,
      defaultLanguage: true,
      targetCountry: true,
      planLevel: true
    }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'GROWTH_AI_EXPLANATION')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }

  const identity = await prisma.growthOpportunityIdentity.findFirst({
    where: { id: opportunityId, projectId },
    select: {
      id: true,
      identityType: true,
      normalizedQuery: true,
      canonicalPage: true,
      lifecycle: {
        select: {
          status: true,
          reviewedAt: true,
          plannedAt: true,
          startedAt: true,
          doneAt: true,
          dismissedAt: true,
          resolvedAt: true,
          reopenedAt: true,
          updatedAt: true
        }
      },
      snapshots: {
        orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          id: true,
          snapshotVersion: true,
          formulaVersion: true,
          currentWindowStart: true,
          currentWindowEnd: true,
          previousWindowStart: true,
          previousWindowEnd: true,
          dataCutoffAt: true,
          primaryType: true,
          secondaryTypes: true,
          score: true,
          priority: true,
          scoreState: true,
          evidenceQuality: true,
          evidenceCoverage: true,
          rankingEligible: true,
          breakdown: {
            select: {
              demandState: true,
              demandScore: true,
              positionPotentialState: true,
              positionPotentialScore: true,
              ctrGapState: true,
              ctrGapScore: true,
              siteGapState: true,
              siteGapScore: true,
              gscTrendState: true,
              gscTrendScore: true,
              p6VisibilityState: true,
              p6VisibilityScore: true,
              trendVisibilityDisplayState: true,
              trendVisibilityDisplayScore: true,
              availableWeight: true,
              evidenceCoverage: true,
              weightedTotal: true,
              formulaVersion: true
            }
          },
          evidence: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 50,
            select: {
              id: true,
              sourceModule: true,
              sourceType: true,
              sourceId: true,
              sourceFactVersion: true,
              ruleKey: true,
              rootCauseKey: true,
              evidenceState: true,
              severity: true,
              numericValue: true,
              textSummary: true,
              fingerprint: true
            }
          }
        }
      }
    }
  });
  if (!identity) {
    throw new NotFoundError('Growth opportunity not found', 'GROWTH_OPPORTUNITY_NOT_FOUND');
  }
  const snapshot = identity.snapshots[0];
  if (!snapshot) {
    throw new NotFoundError('Growth opportunity snapshot not found', 'GROWTH_OPPORTUNITY_SNAPSHOT_NOT_FOUND');
  }

  const refs: Ref[] = [
    { type: 'PROJECT', id: project.id },
    { type: 'GROWTH_OPPORTUNITY_IDENTITY', id: identity.id },
    { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: snapshot.id },
    ...snapshot.evidence.map((item) => ({ type: 'GROWTH_OPPORTUNITY_EVIDENCE', id: item.id }))
  ];

  const factSnapshot = {
    project: {
      id: project.id,
      name: project.name,
      primaryDomain: project.primaryDomain,
      industry: project.industry,
      defaultLanguage: project.defaultLanguage,
      targetCountry: project.targetCountry
    },
    opportunity: {
      identityId: identity.id,
      identityType: identity.identityType,
      normalizedQuery: identity.normalizedQuery,
      canonicalPage: identity.canonicalPage
    },
    snapshot: {
      snapshotId: snapshot.id,
      snapshotVersion: snapshot.snapshotVersion,
      formulaVersion: snapshot.formulaVersion,
      currentWindowStart: snapshot.currentWindowStart.toISOString(),
      currentWindowEnd: snapshot.currentWindowEnd.toISOString(),
      previousWindowStart: snapshot.previousWindowStart.toISOString(),
      previousWindowEnd: snapshot.previousWindowEnd.toISOString(),
      dataCutoffAt: snapshot.dataCutoffAt.toISOString(),
      primaryType: snapshot.primaryType,
      secondaryTypes: snapshot.secondaryTypes,
      score: snapshot.score,
      priority: snapshot.priority,
      scoreState: snapshot.scoreState,
      evidenceQuality: snapshot.evidenceQuality,
      evidenceCoverage: snapshot.evidenceCoverage,
      rankingEligible: snapshot.rankingEligible
    },
    breakdown: snapshot.breakdown,
    lifecycle: identity.lifecycle,
    evidence: snapshot.evidence,
    sourceReferences: refs
  };

  return {
    projectId,
    taskType: 'GROWTH_OPPORTUNITY_EXPLANATION',
    requestKey: `growth-opportunity-explanation:${snapshot.id}:${GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID}`,
    promptVersion: GROWTH_OPPORTUNITY_EXPLANATION_PROMPT_ID,
    factSnapshot: factSnapshot as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createGrowthOpportunityExplanationTask(
  projectId: string,
  opportunityId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildGrowthOpportunityExplanationTaskInput(projectId, opportunityId));
}
