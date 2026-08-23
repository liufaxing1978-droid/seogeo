import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationAutopilotRepository } from '../../src/modules/optimization-autopilot/autopilot.repository.js';

type TestDb = typeof prisma | Prisma.TransactionClient;
const ROLLBACK_SENTINEL = 'P9_C_P8_AUTHORITY_TEST_ROLLBACK';

async function withRollback(run: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) throw error;
  }
}

async function createProject(db: TestDb) {
  const suffix = randomUUID();
  return db.project.create({
    data: {
      name: `P9-C P8 authority ${suffix}`,
      slug: `p9-c-p8-authority-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
}

async function createP9Fixture(db: TestDb, projectId: string) {
  const growthIdentity = await db.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `p9c-p8:${randomUUID()}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'p9 c exact p8 authority',
      canonicalPage: null,
      identityPayload: {}
    }
  });
  const growthSnapshot = await db.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'CONTENT_GAP',
      secondaryTypes: [],
      score: 82,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 90,
      rankingEligible: true,
      sourceProvenance: {}
    }
  });
  const candidate = await db.optimizationCandidate.create({
    data: {
      projectId,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${randomUUID()}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: null,
      locale: 'en',
      opportunityType: 'CONTENT_GAP',
      normalizedQuery: 'p9 c exact p8 authority',
      canonicalPage: null,
      growthScore: 82,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 90,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: {},
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });
  const optimizationPlan = await db.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'CONTENT_CREATION',
      sourceFactReferences: [],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: {}
    }
  });
  const run = await db.optimizationRun.create({
    data: {
      projectId,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `run:${randomUUID()}`,
      triggerPayload: {},
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1
    }
  });
  const runItem = await db.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId,
      optimizationPlanId: optimizationPlan.id,
      itemKey: `item:${randomUUID()}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date()
    }
  });

  return { growthIdentity, growthSnapshot, candidate, optimizationPlan, run, runItem };
}

async function createExactP8Fixture(
  db: TestDb,
  project: { id: string; primaryDomain: string },
  p9: Awaited<ReturnType<typeof createP9Fixture>>
) {
  const proposal = await db.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      sourceReferenceId: p9.optimizationPlan.id,
      sourceSnapshotId: p9.runItem.id,
      sourceMetadata: { source: 'CONTROLLED_AUTOPILOT_TEST' },
      reason: 'P9-C exact P8 authority fixture',
      createdBy: 'system:p9-c-test'
    }
  });
  const contentHash = `content-${randomUUID()}`;
  const draft = await db.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-C exact P8 authority',
      slugCandidate: 'p9-c-exact-p8-authority',
      body: '# P9-C exact P8 authority',
      language: 'en',
      currentVersion: 1,
      currentContentHash: contentHash,
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  await db.contentDraftVersion.create({
    data: {
      draftId: draft.id,
      version: 1,
      title: draft.title,
      slugCandidate: draft.slugCandidate,
      body: draft.body,
      excerpt: null,
      metaTitle: null,
      metaDescription: null,
      canonicalCandidate: null,
      schemaJson: null,
      author: null,
      language: draft.language,
      contentHash,
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await db.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-C Git site',
      domain: project.primaryDomain,
      repositoryIdentity: `owner/repo-${randomUUID()}`,
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/'],
      enabled: true
    }
  });
  const channel = await db.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/articles',
      displayName: 'Articles',
      repositoryPathTemplate: 'content/{slug}.md',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      enabled: true
    }
  });
  const targetPublicUrl = `https://${project.primaryDomain}/articles/p9-c-exact-p8-authority`;
  const targetRepository = site.repositoryIdentity!;
  const baseSha = `base-${randomUUID()}`;
  const planHash = `plan-${randomUUID()}`;
  const plan = await db.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl,
      targetRepository,
      targetBranch: 'main',
      baseSha,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: 'content/p9-c-exact-p8-authority.md',
        targetUrl: targetPublicUrl,
        contentHash,
        content: '# P9-C exact P8 authority',
        title: 'P9-C exact P8 authority',
        excerpt: null,
        metaTitle: null,
        metaDescription: null,
        canonicalCandidate: null,
        schemaJson: null,
        author: null,
        language: 'en'
      }],
      expectedOutcomes: {},
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'draft-pr-only',
      planHash
    }
  });
  const validationResult = {
    validatorVersion: 'PUBLICATION_VALIDATOR_V1',
    findings: [],
    blockingCodes: [],
    warningCodes: [],
    infoCodes: [],
    unconfirmedWarningCodes: [],
    canCreatePlan: true
  };
  const preview = await db.publicationPreview.create({
    data: {
      projectId: project.id,
      planId: plan.id,
      previewHash: `preview-${randomUUID()}`,
      diffSummary: '1 created, 0 modified, 0 deleted',
      diffPayload: { bounded: true },
      validationResult
    }
  });

  return { proposal, draft, site, channel, plan, preview, contentHash };
}

describe('P9-C exact P8 persisted authority readers', () => {
  it('loads bounded exact P8 plan/preview/site/channel facts only for the P9 preparation identity', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const otherProject = await createProject(db);
      const p9 = await createP9Fixture(db, project.id);
      const p8 = await createExactP8Fixture(db, project, p9);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);

      expect(await repository.loadExactP8AuthorityFacts({
        projectId: project.id,
        optimizationPlanId: p9.optimizationPlan.id,
        runItemId: p9.runItem.id
      })).toEqual({
        proposalId: p8.proposal.id,
        p8PlanId: p8.plan.id,
        p8PreviewId: p8.preview.id,
        siteId: p8.site.id,
        channelId: p8.channel.id,
        draftId: p8.draft.id,
        draftVersion: 1,
        contentHash: p8.contentHash,
        riskClass: 'LOW',
        operationTypes: ['CREATE_CONTENT_PAGE'],
        blockingCodes: [],
        warningCodes: [],
        gitDraftPrAvailable: true,
        targetPublicUrl: p8.plan.targetPublicUrl,
        targetRepository: p8.plan.targetRepository,
        targetBranch: p8.plan.targetBranch,
        baseSha: p8.plan.baseSha,
        targetBlobHashes: {},
        planHash: p8.plan.planHash,
        previewHash: p8.preview.previewHash
      });

      expect(await repository.loadExactP8AuthorityFacts({
        projectId: otherProject.id,
        optimizationPlanId: p9.optimizationPlan.id,
        runItemId: p9.runItem.id
      })).toBeNull();
      expect(await repository.loadExactP8AuthorityFacts({
        projectId: project.id,
        optimizationPlanId: p9.optimizationPlan.id,
        runItemId: randomUUID()
      })).toBeNull();
    });
  });

  it('treats an existing machine authorization as an existing automatic handoff for the run item', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const otherProject = await createProject(db);
      const p9 = await createP9Fixture(db, project.id);
      const p8 = await createExactP8Fixture(db, project, p9);
      const policy = await db.autopilotPolicy.create({
        data: {
          projectId: project.id,
          enabled: true,
          updatedBy: 'actor:test'
        }
      });
      const decision = await db.optimizationAutopilotDecision.create({
        data: {
          projectId: project.id,
          runId: p9.run.id,
          runItemId: p9.runItem.id,
          optimizationPlanId: p9.optimizationPlan.id,
          policyId: policy.id,
          policyVersion: policy.policyVersion,
          policySnapshot: {},
          sourceSnapshot: {},
          status: 'AUTOPILOT_READY',
          reasonCodes: [],
          p8PlanId: p8.plan.id,
          p8PreviewId: p8.preview.id,
          decisionKey: `decision-${randomUUID()}`
        }
      });
      await db.publicationAutomationAuthorization.create({
        data: {
          projectId: project.id,
          planId: p8.plan.id,
          planVersion: p8.plan.version,
          planHash: p8.plan.planHash,
          contentVersion: 1,
          contentHash: p8.contentHash,
          previewHash: p8.preview.previewHash,
          baseSha: p8.plan.baseSha,
          targetRepository: p8.plan.targetRepository,
          targetBranch: p8.plan.targetBranch,
          targetBlobHashes: {},
          authorizedRiskClass: 'LOW',
          automationDecisionId: decision.id,
          automationPolicyVersion: policy.policyVersion,
          automationPolicyHash: `policy-${randomUUID()}`,
          automationSource: 'CONTROLLED_AUTOPILOT'
        }
      });
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);

      expect(await repository.hasExistingAutomaticHandoff(project.id, p9.runItem.id)).toBe(true);
      expect(await repository.hasExistingAutomaticHandoff(otherProject.id, p9.runItem.id)).toBe(false);
    });
  });
});
