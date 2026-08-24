import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PrismaExperimentEvaluationSource } from '../../src/modules/optimization-experiments/experiment.evaluation-source.js';
import { OptimizationExperimentRepository } from '../../src/modules/optimization-experiments/experiment.repository.js';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ROLLBACK_SENTINEL = 'P9_D_CONTAMINATION_ROLLBACK';

async function withRollback(
  run: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK_SENTINEL) return;
    throw error;
  }
}

async function seedFixture(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/page`;
  const project = await tx.project.create({
    data: {
      name: `P9-D contamination ${suffix}`,
      slug: `p9-d-contamination-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const growthIdentity = await tx.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '興善堂',
      canonicalPage: targetUrl,
      identityPayload: { fixture: true }
    }
  });
  const growthSnapshot = await tx.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-07-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-03T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-06-30T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-07-29T00:00:00.000Z'),
      primaryType: 'CTR_UNDERPERFORMANCE',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { fixture: true }
    }
  });
  const candidate = await tx.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      opportunityType: 'CTR_UNDERPERFORMANCE',
      normalizedQuery: '興善堂',
      canonicalPage: targetUrl,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'PLANNED',
      sourceProvenance: { fixture: true },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });
  const optimizationPlan = await tx.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
      sourceFactReferences: ['search-fact:contamination'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });

  const proposal = await tx.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-D contamination fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });
  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D contamination fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D contamination fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const channel = await tx.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/page',
      displayName: 'Page'
    }
  });
  const publicationPlan = await tx.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: targetUrl,
      targetRepository: 'fixture/repository',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      operations: [{ type: 'UPDATE_CONTENT_PAGE', path: '/page' }],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'b'.repeat(64)
    }
  });
  const approval = await tx.publicationApproval.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: 'c'.repeat(64),
      previewHash: 'd'.repeat(64),
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'p9-d-contamination',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    }
  });

  const originalExecution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:original:${suffix}`,
      status: 'VERIFIED'
    }
  });
  const verifiedAnchorAt = new Date('2026-08-01T00:00:00.000Z');
  const verification = await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: originalExecution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: verifiedAnchorAt
    }
  });

  const conflictingExecution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:conflicting:${suffix}`,
      status: 'DEPLOYED'
    }
  });
  await tx.publicationExecutionEvent.create({
    data: {
      executionId: conflictingExecution.id,
      eventType: 'DEPLOYED',
      fromStatus: 'EXECUTING',
      toStatus: 'DEPLOYED',
      reasonCode: 'SECOND_SAME_TARGET_DEPLOYMENT',
      createdAt: new Date(verifiedAnchorAt.getTime() + 3 * DAY_MS)
    }
  });

  const propertyRef = `gsc:${suffix}`;
  const experiment = await tx.optimizationExperiment.create({
    data: {
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      publicationExecutionId: originalExecution.id,
      publicationVerificationId: verification.id,
      experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1',
      experimentKey: `experiment:${suffix}`,
      interventionType: 'SERP_SNIPPET_OPTIMIZATION',
      targetUrl,
      marketCode: 'HK',
      locale: 'zh-Hant',
      verifiedAnchorAt,
      measurementScopeJson: {
        kind: 'SEARCH',
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'HK',
        locale: 'zh-Hant',
        propertyRef,
        normalizedQuery: '興善堂',
        canonicalPage: targetUrl,
        aggregationScope: 'QUERY_PAGE'
      },
      observationScheduleJson: [{ windowType: '7D', windowDays: 7 }],
      expectedDirectionJson: { CTR: 'HIGHER' }
    }
  });

  return {
    project,
    originalExecution,
    conflictingExecution,
    experiment,
    verifiedAnchorAt,
    targetUrl,
    propertyRef
  };
}

function completeSearchFacts(input: {
  projectId: string;
  propertyRef: string;
  targetUrl: string;
  verifiedAnchorAt: Date;
}) {
  return Array.from({ length: 14 }, (_, index) => {
    const baseline = index < 7;
    return {
      snapshotId: `contamination-snapshot-${index}`,
      projectId: input.projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE' as const,
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: input.propertyRef,
      propertyType: 'URL_PREFIX',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: `contamination-source-${index}`,
      sourceObservationRef: `contamination-observation-${index}`,
      sourceCutoffAt: new Date(input.verifiedAnchorAt.getTime() + 7 * DAY_MS + index),
      sourceCompleteness: 'COMPLETE' as const,
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
      factKey: `contamination-fact-${index}`,
      factKind: 'QUERY_PAGE' as const,
      sourceDate: new Date(input.verifiedAnchorAt.getTime() + (index - 7) * DAY_MS),
      query: '興善堂',
      normalizedQuery: '興善堂',
      queryNormalizationVersion: 'QUERY_NORMALIZATION_V1',
      page: input.targetUrl,
      canonicalPage: input.targetUrl,
      canonicalizationVersion: 'URL_CANONICALIZATION_V1',
      metrics: [
        {
          metricSemantic: 'CLICKS' as const,
          numericValue: baseline ? 10 : 15,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'clicks'
        },
        {
          metricSemantic: 'IMPRESSIONS' as const,
          numericValue: 100,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'impressions'
        },
        {
          metricSemantic: 'CTR' as const,
          numericValue: baseline ? 0.1 : 0.15,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'ctr'
        },
        {
          metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION' as const,
          numericValue: baseline ? 5 : 4,
          evidenceState: 'KNOWN_PRESENT' as const,
          sourceField: 'position'
        }
      ]
    };
  });
}

describe('P9-D contamination persistence boundary', () => {
  it('stores a conflicting same-target P8 deployment as INCONCLUSIVE without mutating either execution', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFixture(tx);
      const repository = new OptimizationExperimentRepository(tx);
      const service = new OptimizationExperimentService(repository, undefined, { emit: () => undefined });
      const persistedSource = new PrismaExperimentEvaluationSource(tx as never);
      (service as unknown as { evaluationSource: unknown }).evaluationSource = persistedSource;
      (service as unknown as { contaminationSource: unknown }).contaminationSource = persistedSource;
      (service as unknown as { searchSource: unknown }).searchSource = {
        listCompletedFacts: async () => completeSearchFacts({
          projectId: fixture.project.id,
          propertyRef: fixture.propertyRef,
          targetUrl: fixture.targetUrl,
          verifiedAnchorAt: fixture.verifiedAnchorAt
        })
      };
      (service as unknown as { now: () => Date }).now = () =>
        new Date(fixture.verifiedAnchorAt.getTime() + 8 * DAY_MS);

      const originalBefore = await tx.publicationExecution.findUnique({
        where: { id: fixture.originalExecution.id }
      });
      const conflictingBefore = await tx.publicationExecution.findUnique({
        where: { id: fixture.conflictingExecution.id }
      });

      const observation = await service.evaluateWindow({
        projectId: fixture.project.id,
        experimentId: fixture.experiment.id,
        windowType: '7D'
      });

      expect(observation).toMatchObject({
        projectId: fixture.project.id,
        experimentId: fixture.experiment.id,
        coverageState: 'SUFFICIENT',
        contaminationState: 'CONFLICTING_MUTATION',
        effectState: 'INCONCLUSIVE'
      });
      expect(observation?.reasonCodes).toEqual(expect.arrayContaining([
        'EXPERIMENT_CONFLICTING_PUBLICATION_EVENT',
        'EXPERIMENT_CONTAMINATED'
      ]));

      const stored = await tx.optimizationExperimentObservation.findUnique({
        where: { id: observation?.id }
      });
      expect(stored).toEqual(observation);

      const originalAfter = await tx.publicationExecution.findUnique({
        where: { id: fixture.originalExecution.id }
      });
      const conflictingAfter = await tx.publicationExecution.findUnique({
        where: { id: fixture.conflictingExecution.id }
      });
      expect(originalAfter).toEqual(originalBefore);
      expect(conflictingAfter).toEqual(conflictingBefore);
    });
  });
});
