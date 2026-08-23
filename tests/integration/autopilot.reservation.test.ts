import { randomUUID } from 'node:crypto';
import type { PublicationExecutionStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { reserveAutopilotCapacity } from '../../src/modules/optimization-autopilot/autopilot.reservation.js';

const TEST_DATE = '2026-08-23';
const NEXT_DATE = '2026-08-24';

async function createProjectContext() {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `P9-C reservation ${suffix}`,
      slug: `p9-c-reservation-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  const policy = await prisma.autopilotPolicy.create({
    data: {
      projectId: project.id,
      enabled: true,
      updatedBy: 'actor:test'
    }
  });
  return { project, policy };
}

async function createDecision(
  projectId: string,
  policyId: string,
  policyVersion = 'CONTROLLED_AUTOPILOT_POLICY_V1'
) {
  const suffix = randomUUID();
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `reservation:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `reservation ${suffix}`,
      canonicalPage: null,
      identityPayload: {}
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
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
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 90,
      rankingEligible: true,
      sourceProvenance: {}
    }
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: null,
      locale: 'en',
      opportunityType: 'CONTENT_GAP',
      normalizedQuery: `reservation ${suffix}`,
      canonicalPage: null,
      growthScore: 80,
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
  const optimizationPlan = await prisma.optimizationPlan.create({
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
  const run = await prisma.optimizationRun.create({
    data: {
      projectId,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `reservation-run:${suffix}`,
      triggerPayload: {},
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1
    }
  });
  const runItem = await prisma.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId,
      optimizationPlanId: optimizationPlan.id,
      itemKey: `reservation-item:${suffix}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date()
    }
  });
  return prisma.optimizationAutopilotDecision.create({
    data: {
      projectId,
      runId: run.id,
      runItemId: runItem.id,
      optimizationPlanId: optimizationPlan.id,
      policyId,
      policyVersion,
      policySnapshot: {},
      sourceSnapshot: {},
      status: 'AUTOPILOT_READY',
      reasonCodes: [],
      decisionKey: `reservation-decision:${suffix}`
    }
  });
}

async function createPublicationPlan(projectId: string) {
  const suffix = randomUUID();
  const site = await prisma.publicationSite.create({
    data: {
      projectId,
      displayName: `Reservation site ${suffix}`,
      domain: `${suffix}.publication.example.com`,
      repositoryIdentity: `owner/repo-${suffix}`,
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/'],
      enabled: true
    }
  });
  const channel = await prisma.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/articles',
      displayName: 'Articles',
      repositoryPathTemplate: 'content/{slug}.md',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      enabled: true
    }
  });
  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId,
      sourceType: 'MANUAL',
      reason: 'P9-C reservation fixture',
      createdBy: 'test'
    }
  });
  const contentHash = `content-${suffix}`;
  const draft = await prisma.contentDraft.create({
    data: {
      projectId,
      sourceProposalId: proposal.id,
      title: 'P9-C reservation fixture',
      slugCandidate: `p9-c-reservation-${suffix}`,
      body: '# P9-C reservation fixture',
      language: 'en',
      currentVersion: 1,
      currentContentHash: contentHash,
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const planHash = `plan-${suffix}`;
  const baseSha = `base-${suffix}`;
  const targetPublicUrl = `https://${site.domain}/articles/${suffix}`;
  const plan = await prisma.publicationPlan.create({
    data: {
      projectId,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl,
      targetRepository: site.repositoryIdentity!,
      targetBranch: 'main',
      baseSha,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: `content/${suffix}.md`,
        targetUrl: targetPublicUrl,
        contentHash,
        content: '# P9-C reservation fixture',
        title: 'P9-C reservation fixture',
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
  return { plan, contentHash };
}

async function createMachineExecution(
  projectId: string,
  decision: Awaited<ReturnType<typeof createDecision>>,
  status: PublicationExecutionStatus
) {
  const { plan, contentHash } = await createPublicationPlan(projectId);
  const authorization = await prisma.publicationAutomationAuthorization.create({
    data: {
      projectId,
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      contentVersion: 1,
      contentHash,
      previewHash: `preview-${randomUUID()}`,
      baseSha: plan.baseSha,
      targetRepository: plan.targetRepository,
      targetBranch: plan.targetBranch,
      targetBlobHashes: {},
      authorizedRiskClass: 'LOW',
      automationDecisionId: decision.id,
      automationPolicyVersion: decision.policyVersion,
      automationPolicyHash: `policy-${randomUUID()}`,
      automationSource: 'CONTROLLED_AUTOPILOT'
    }
  });
  return prisma.publicationExecution.create({
    data: {
      projectId,
      planId: plan.id,
      approvalId: null,
      automationAuthorizationId: authorization.id,
      executionKey: `machine-execution-${randomUUID()}`,
      status
    }
  });
}

async function createHumanExecution(projectId: string) {
  const { plan, contentHash } = await createPublicationPlan(projectId);
  const approval = await prisma.publicationApproval.create({
    data: {
      projectId,
      planId: plan.id,
      planVersion: plan.version,
      planHash: plan.planHash,
      contentVersion: 1,
      contentHash,
      previewHash: `preview-${randomUUID()}`,
      baseSha: plan.baseSha,
      targetRepository: plan.targetRepository,
      targetBranch: plan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'actor:test',
      approvedRiskClass: 'LOW'
    }
  });
  return prisma.publicationExecution.create({
    data: {
      projectId,
      planId: plan.id,
      approvalId: approval.id,
      automationAuthorizationId: null,
      executionKey: `human-execution-${randomUUID()}`,
      status: 'EXECUTING'
    }
  });
}

function reserveInput(projectId: string, decisionId: string, utcDate = TEST_DATE) {
  return {
    projectId,
    decisionId,
    utcDate,
    dailyDraftPrLimit: 1,
    maxConcurrentRuns: 3
  } as const;
}

describe('P9-C race-safe autopilot reservations', () => {
  it('serializes concurrent daily quota claims so only one decision reserves the final slot', async () => {
    const { project, policy } = await createProjectContext();
    const [d1, d2] = await Promise.all([
      createDecision(project.id, policy.id, policy.policyVersion),
      createDecision(project.id, policy.id, policy.policyVersion)
    ]);

    const results = await Promise.all([
      reserveAutopilotCapacity(reserveInput(project.id, d1.id)),
      reserveAutopilotCapacity(reserveInput(project.id, d2.id))
    ]);

    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    expect(results.filter((result) => !result.reserved)).toEqual([
      { reserved: false, reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' }
    ]);
  });

  it('reuses the same reservation for the same decision', async () => {
    const { project, policy } = await createProjectContext();
    const decision = await createDecision(project.id, policy.id, policy.policyVersion);

    const first = await reserveAutopilotCapacity(reserveInput(project.id, decision.id));
    const second = await reserveAutopilotCapacity(reserveInput(project.id, decision.id));

    expect(first.reserved).toBe(true);
    expect(second.reserved).toBe(true);
    if (!first.reserved || !second.reserved) throw new Error('expected reservation reuse');
    expect(second.reservation.id).toBe(first.reservation.id);
  });

  it('isolates daily quota by project and UTC date', async () => {
    const first = await createProjectContext();
    const second = await createProjectContext();
    const [d1, d2, d3] = await Promise.all([
      createDecision(first.project.id, first.policy.id, first.policy.policyVersion),
      createDecision(first.project.id, first.policy.id, first.policy.policyVersion),
      createDecision(second.project.id, second.policy.id, second.policy.policyVersion)
    ]);

    expect((await reserveAutopilotCapacity(reserveInput(first.project.id, d1.id))).reserved).toBe(true);
    expect((await reserveAutopilotCapacity(reserveInput(first.project.id, d2.id, NEXT_DATE))).reserved).toBe(true);
    expect((await reserveAutopilotCapacity(reserveInput(second.project.id, d3.id))).reserved).toBe(true);
  });

  it.each(['AUTOMATION_AUTHORIZED', 'QUEUED', 'EXECUTING'] as const)(
    'counts %s machine execution against concurrency',
    async (status) => {
      const { project, policy } = await createProjectContext();
      const activeDecision = await createDecision(project.id, policy.id, policy.policyVersion);
      const candidateDecision = await createDecision(project.id, policy.id, policy.policyVersion);
      await createMachineExecution(project.id, activeDecision, status);

      expect(await reserveAutopilotCapacity({
        ...reserveInput(project.id, candidateDecision.id),
        dailyDraftPrLimit: 10,
        maxConcurrentRuns: 1
      })).toEqual({ reserved: false, reasonCode: 'AUTOPILOT_CONCURRENCY_LIMIT' });
    }
  );

  it('PR_CREATED releases concurrency while a consumed reservation still retains the daily quota', async () => {
    const { project, policy } = await createProjectContext();
    const completedDecision = await createDecision(project.id, policy.id, policy.policyVersion);
    const candidateDecision = await createDecision(project.id, policy.id, policy.policyVersion);
    await createMachineExecution(project.id, completedDecision, 'PR_CREATED');
    await prisma.autopilotExecutionReservation.create({
      data: {
        projectId: project.id,
        decisionId: completedDecision.id,
        utcDate: new Date(`${TEST_DATE}T00:00:00.000Z`),
        reservationKey: `consumed-${randomUUID()}`,
        status: 'CONSUMED'
      }
    });

    expect(await reserveAutopilotCapacity({
      ...reserveInput(project.id, candidateDecision.id, TEST_DATE),
      maxConcurrentRuns: 1
    })).toEqual({ reserved: false, reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' });

    expect((await reserveAutopilotCapacity({
      ...reserveInput(project.id, candidateDecision.id, NEXT_DATE),
      maxConcurrentRuns: 1
    })).reserved).toBe(true);
  });

  it('does not count a human-approved EXECUTING publication against machine concurrency', async () => {
    const { project, policy } = await createProjectContext();
    const decision = await createDecision(project.id, policy.id, policy.policyVersion);
    await createHumanExecution(project.id);

    expect((await reserveAutopilotCapacity({
      ...reserveInput(project.id, decision.id),
      dailyDraftPrLimit: 10,
      maxConcurrentRuns: 1
    })).reserved).toBe(true);
  });
});
