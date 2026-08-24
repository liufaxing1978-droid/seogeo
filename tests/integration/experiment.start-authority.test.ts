import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationExperimentRepository } from '../../src/modules/optimization-experiments/experiment.repository.js';

const ROLLBACK_SENTINEL = 'P9_D_START_AUTHORITY_ROLLBACK';

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

async function seedVerifiedStartGraph(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/page`;
  const project = await tx.project.create({
    data: {
      name: `P9-D start ${suffix}`,
      slug: `p9-d-start-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  const otherProject = await tx.project.create({
    data: {
      name: `P9-D other ${suffix}`,
      slug: `p9-d-other-${suffix}`,
      primaryDomain: `other-${suffix}.example.com`,
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

  const growthProvenance = {
    version: 'GROWTH_SEARCH_PROVENANCE_V1',
    mode: 'CONFIGURED_MARKET',
    scoringLane: {
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketProjections: [
        { marketCode: 'HK', locale: 'zh-Hant', propertyRef: 'gsc:property:1' }
      ]
    },
    corroboratingLanes: []
  } as const;

  const growthSnapshot = await tx.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'CTR_UNDERPERFORMANCE',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: growthProvenance
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
      growthLifecycleStatus: 'NEW',
      sourceProvenance: {
        version: 'P9_A_SOURCE_PROVENANCE_V1',
        wrappedGrowthSnapshotId: growthSnapshot.id
      },
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
      sourceFactReferences: ['source:one'],
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
      reason: 'P9-D authority fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });
  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D authority fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D authority fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const publicationPlan = await tx.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
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
      approverActorId: 'p9-d-test',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    }
  });
  const execution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${suffix}`,
      status: 'VERIFIED'
    }
  });
  const verification = await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: new Date('2026-08-24T00:00:00.000Z')
    }
  });

  return {
    project,
    otherProject,
    growthProvenance,
    optimizationPlan,
    proposal,
    publicationPlan,
    execution,
    verification
  };
}

describe('P9-D verified start authority loading', () => {
  it('loads the exact project-scoped P8/P9 binding and uses immutable Growth snapshot provenance', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedVerifiedStartGraph(tx);
      const repository = new OptimizationExperimentRepository(tx);

      const context = await repository.loadVerifiedStartContext({
        projectId: fixture.project.id,
        publicationExecutionId: fixture.execution.id
      });

      expect(context).not.toBeNull();
      expect(context?.project).toEqual({ id: fixture.project.id, planLevel: 'ADVANCED' });
      expect(context?.optimizationPlan.id).toBe(fixture.optimizationPlan.id);
      expect(context?.optimizationPlan.candidate.sourceProvenance).toEqual(fixture.growthProvenance);
      expect(context?.proposal).toMatchObject({
        id: fixture.proposal.id,
        projectId: fixture.project.id,
        sourceType: 'P9_OPTIMIZATION_PLAN',
        sourceReferenceId: fixture.optimizationPlan.id
      });
      expect(context?.publicationPlan).toMatchObject({
        id: fixture.publicationPlan.id,
        projectId: fixture.project.id,
        targetPublicUrl: fixture.publicationPlan.targetPublicUrl
      });
      expect(context?.execution).toMatchObject({
        id: fixture.execution.id,
        projectId: fixture.project.id,
        status: 'VERIFIED'
      });
      expect(context?.verification).toMatchObject({
        id: fixture.verification.id,
        projectId: fixture.project.id,
        status: 'VERIFIED',
        observedUrl: fixture.publicationPlan.targetPublicUrl,
        observedAt: fixture.verification.observedAt
      });

      await expect(repository.loadVerifiedStartContext({
        projectId: fixture.otherProject.id,
        publicationExecutionId: fixture.execution.id
      })).resolves.toBeNull();
    });
  });
});
