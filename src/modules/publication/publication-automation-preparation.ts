import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { createContentBriefTask } from './publication-ai.js';
import { contentHashV1 } from './publication.hash.js';

const AUTOMATIC_SOURCE_TYPES = new Set([
  'GROWTH_OPPORTUNITY_IDENTITY',
  'GROWTH_OPPORTUNITY_SNAPSHOT',
  'GROWTH_OPPORTUNITY_EVIDENCE'
]);

export type PublicationAutomationPreparationState =
  | 'WAITING_FOR_BRIEF'
  | 'WAITING_FOR_ARTICLE'
  | 'P8_READY'
  | 'MANUAL_REQUIRED'
  | 'VALIDATION_BLOCKED';

export interface PublicationAutomationPreparationInput {
  projectId: string;
  runItemId: string;
  optimizationPlanId: string;
  decisionId: string;
}

export interface PublicationAutomationPreparationResult {
  state: PublicationAutomationPreparationState;
  proposalId: string | null;
  draftId: string | null;
  planId: string | null;
  previewId: string | null;
  reasonCode: string | null;
}

export interface PublicationAutomationPreparationPort {
  prepareContentCreation(
    input: PublicationAutomationPreparationInput
  ): Promise<PublicationAutomationPreparationResult>;
}

export interface PublicationAutomationPreparationDeps {
  aiTaskService: Pick<AiTaskService, 'createAndEnqueue'>;
}

type AutomaticSourceReference = {
  type:
    | 'GROWTH_OPPORTUNITY_IDENTITY'
    | 'GROWTH_OPPORTUNITY_SNAPSHOT'
    | 'GROWTH_OPPORTUNITY_EVIDENCE';
  id: string;
};

function manual(reasonCode: string): PublicationAutomationPreparationResult {
  return {
    state: 'MANUAL_REQUIRED',
    proposalId: null,
    draftId: null,
    planId: null,
    previewId: null,
    reasonCode
  };
}

function parseAutomaticSourceReferences(value: Prisma.JsonValue): AutomaticSourceReference[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return null;

  const seen = new Set<string>();
  const refs: AutomaticSourceReference[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'id,type') return null;
    if (typeof record.type !== 'string' || typeof record.id !== 'string' || !record.id.trim()) {
      return null;
    }
    if (!AUTOMATIC_SOURCE_TYPES.has(record.type)) return null;

    const ref = {
      type: record.type as AutomaticSourceReference['type'],
      id: record.id
    };
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

async function sourceReferencesBelongToProject(
  projectId: string,
  refs: AutomaticSourceReference[]
): Promise<boolean> {
  for (const ref of refs) {
    if (ref.type === 'GROWTH_OPPORTUNITY_IDENTITY') {
      const row = await prisma.growthOpportunityIdentity.findFirst({
        where: { id: ref.id, projectId },
        select: { id: true }
      });
      if (!row) return false;
      continue;
    }
    if (ref.type === 'GROWTH_OPPORTUNITY_SNAPSHOT') {
      const row = await prisma.growthOpportunitySnapshot.findFirst({
        where: { id: ref.id, projectId },
        select: { id: true }
      });
      if (!row) return false;
      continue;
    }
    const row = await prisma.growthOpportunityEvidence.findFirst({
      where: { id: ref.id, projectId },
      select: { id: true }
    });
    if (!row) return false;
  }
  return true;
}

function seedContentHash(input: {
  title: string;
  slugCandidate: string;
  body: string;
  language: string;
}): string {
  return contentHashV1({
    title: input.title,
    slugCandidate: input.slugCandidate,
    body: input.body,
    excerpt: null,
    metaTitle: null,
    metaDescription: null,
    canonicalCandidate: null,
    schemaJson: null,
    author: null,
    language: input.language
  });
}

export class PublicationAutomationPreparationService
implements PublicationAutomationPreparationPort {
  private readonly aiTaskService: Pick<AiTaskService, 'createAndEnqueue'>;

  constructor(deps: Partial<PublicationAutomationPreparationDeps> = {}) {
    this.aiTaskService = deps.aiTaskService ?? aiTaskService;
  }

  async prepareContentCreation(
    input: PublicationAutomationPreparationInput
  ): Promise<PublicationAutomationPreparationResult> {
    const project = await prisma.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, defaultLanguage: true }
    });
    if (!project) return manual('PROJECT_NOT_FOUND');

    const runItem = await prisma.optimizationRunItem.findFirst({
      where: {
        id: input.runItemId,
        projectId: input.projectId,
        optimizationPlanId: input.optimizationPlanId
      },
      select: {
        id: true,
        projectId: true,
        optimizationPlanId: true,
        currentStage: true,
        status: true
      }
    });
    if (!runItem || runItem.status !== 'COMPLETED' || runItem.currentStage !== 'READY_FOR_POLICY') {
      return manual('P9_RUN_ITEM_NOT_READY');
    }

    const optimizationPlan = await prisma.optimizationPlan.findFirst({
      where: { id: input.optimizationPlanId, projectId: input.projectId },
      select: {
        id: true,
        projectId: true,
        candidateId: true,
        planVersion: true,
        recommendedActionType: true,
        sourceFactReferences: true,
        automationEligibility: true
      }
    });
    if (!optimizationPlan) return manual('P9_OPTIMIZATION_PLAN_NOT_FOUND');
    if (
      optimizationPlan.recommendedActionType !== 'CONTENT_CREATION'
      || !optimizationPlan.automationEligibility
    ) {
      return manual('P9_ACTION_NOT_AUTOMATIC_CONTENT_CREATION');
    }

    const candidate = await prisma.optimizationCandidate.findFirst({
      where: { id: optimizationPlan.candidateId, projectId: input.projectId },
      select: {
        id: true,
        candidateKey: true,
        normalizedQuery: true,
        locale: true
      }
    });
    if (!candidate) return manual('P9_OPTIMIZATION_CANDIDATE_NOT_FOUND');

    const refs = parseAutomaticSourceReferences(optimizationPlan.sourceFactReferences);
    if (!refs) return manual('P9_SOURCE_REFERENCES_NOT_ALLOWLISTED');
    if (!(await sourceReferencesBelongToProject(input.projectId, refs))) {
      return manual('P9_SOURCE_REFERENCE_PROJECT_MISMATCH');
    }

    const title = candidate.normalizedQuery.trim();
    const slugCandidate = `p9-${candidate.candidateKey.slice(0, 16)}`;
    if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slugCandidate)) {
      return manual('P9_AUTOMATIC_SEED_INVALID');
    }
    const language = candidate.locale?.trim() || project.defaultLanguage;
    const body = `# ${title}\n\n<!-- Controlled-autopilot seed; generated article revision required before planning. -->`;
    const contentHash = seedContentHash({ title, slugCandidate, body, language });
    const lockKey = `p9c:p8-preparation:${input.projectId}:${optimizationPlan.id}:${runItem.id}`;

    const prepared = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

      let proposal = await tx.publicationProposal.findFirst({
        where: {
          projectId: input.projectId,
          sourceType: 'P9_OPTIMIZATION_PLAN',
          sourceReferenceId: optimizationPlan.id,
          sourceSnapshotId: runItem.id
        }
      });
      if (!proposal) {
        proposal = await tx.publicationProposal.create({
          data: {
            projectId: input.projectId,
            sourceType: 'P9_OPTIMIZATION_PLAN',
            reason: 'Controlled autopilot content-creation preparation from a durable P9 optimization plan.',
            createdBy: 'CONTROLLED_AUTOPILOT',
            sourceReferenceId: optimizationPlan.id,
            sourceSnapshotId: runItem.id,
            sourceMetadata: {
              candidateId: candidate.id,
              candidateKey: candidate.candidateKey,
              decisionId: input.decisionId,
              recommendedActionType: optimizationPlan.recommendedActionType,
              planVersion: optimizationPlan.planVersion
            }
          }
        });
      }

      let draft = await tx.contentDraft.findFirst({
        where: {
          projectId: input.projectId,
          sourceProposalId: proposal.id
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
      });
      if (!draft) {
        draft = await tx.contentDraft.create({
          data: {
            projectId: input.projectId,
            sourceProposalId: proposal.id,
            title,
            slugCandidate,
            body,
            excerpt: null,
            metaTitle: null,
            metaDescription: null,
            canonicalCandidate: null,
            author: null,
            language,
            currentVersion: 1,
            currentContentHash: contentHash,
            status: 'DRAFT',
            generatedBy: 'DETERMINISTIC_GENERATOR'
          }
        });
        await tx.contentDraftVersion.create({
          data: {
            draftId: draft.id,
            version: 1,
            title,
            slugCandidate,
            body,
            excerpt: null,
            metaTitle: null,
            metaDescription: null,
            canonicalCandidate: null,
            author: null,
            language,
            contentHash,
            generatedBy: 'DETERMINISTIC_GENERATOR'
          }
        });
      }

      const existingRefs = await tx.contentSourceReference.findMany({
        where: { projectId: input.projectId, draftId: draft.id },
        select: { sourceType: true, title: true }
      });
      const existingKeys = new Set(
        existingRefs.map((ref) => `${ref.sourceType}:${ref.title}`)
      );
      for (const ref of refs) {
        const refTitle = `${ref.type}:${ref.id}`;
        const key = `${ref.type}:${refTitle}`;
        if (existingKeys.has(key)) continue;
        await tx.contentSourceReference.create({
          data: {
            projectId: input.projectId,
            draftId: draft.id,
            title: refTitle,
            author: null,
            publisher: null,
            sourceUrl: null,
            publishedAt: null,
            sourceType: ref.type,
            accessedAt: null,
            userProvided: false,
            internalRef: true
          }
        });
        existingKeys.add(key);
      }

      return { proposalId: proposal.id, draftId: draft.id };
    });

    await createContentBriefTask(prepared.draftId, this.aiTaskService);

    return {
      state: 'WAITING_FOR_BRIEF',
      proposalId: prepared.proposalId,
      draftId: prepared.draftId,
      planId: null,
      previewId: null,
      reasonCode: null
    };
  }
}

export const publicationAutomationPreparation = new PublicationAutomationPreparationService();
