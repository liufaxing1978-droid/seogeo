import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { derivePipelineStage } from '../../src/modules/optimization-operations/operations.derive.js';
import { OptimizationOperationsRepository } from '../../src/modules/optimization-operations/operations.repository.js';
import { OptimizationOperationsService } from '../../src/modules/optimization-operations/operations.service.js';

const projectIds: string[] = [];
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-25T05:15:00.000Z');

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F repository ${label} ${suffix}`,
      slug: `p9f-repository-${label}-${suffix}`,
      primaryDomain: `p9f-repository-${label}-${suffix}.example.com`,
      planLevel: 'ADVANCED',
    },
  });
  projectIds.push(project.id);
  return project;
}

async function createPolicy(projectId: string, dailyDraftPrLimit = 3) {
  return prisma.autopilotPolicy.create({
    data: {
      projectId,
      enabled: true,
      dailyDraftPrLimit,
      killSwitch: false,
      updatedBy: 'fixture',
    },
  });
}

async function createCandidate(projectId: string, label: string) {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `growth:${label}:${randomUUID()}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `task 36 ${label}`,
      canonicalPage: `https://${label}.example.com/`,
      identityPayload: { label },
      createdAt: ago(12 * 60 * 60 * 1000),
    },
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_FORMULA_V1',
      currentWindowStart: new Date('2026-08-18T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-24T00:00:00.000Z'),
      previousWindowStart: new Date('2026-08-11T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
      dataCutoffAt: ago(10 * 60 * 60 * 1000),
      primaryType: 'RANKING_UPSIDE',
      secondaryTypes: [],
      score: 75,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 100,
      rankingEligible: true,
      sourceProvenance: { fixture: label },
      createdAt: ago(10 * 60 * 60 * 1000),
    },
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${label}:${randomUUID()}`,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: 'zh-CN',
      opportunityType: 'RANKING_UPSIDE',
      normalizedQuery: `task 36 ${label}`,
      canonicalPage: `https://${label}.example.com/`,
      growthScore: 75,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 100,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { fixture: label },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: [],
      createdAt: ago(9 * 60 * 60 * 1000),
    },
  });
  return { identity, candidate };
}

async function createPlan(projectId: string, candidateId: string, label: string) {
  return prisma.optimizationPlan.create({
    data: {
      candidateId,
      projectId,
      planVersion: `OPTIMIZATION_PLAN_V1_${label}_${randomUUID()}`,
      recommendedActionType: 'CONTENT_CREATION',
      sourceFactReferences: [],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { label },
      createdAt: ago(8 * 60 * 60 * 1000),
    },
  });
}

async function createRunDecision(input: {
  projectId: string;
  optimizationPlanId: string;
  policyId: string;
  label: string;
  decisionStatus?: 'AUTOPILOT_READY' | 'POLICY_BLOCKED' | 'P8_VALIDATION_BLOCKED';
  decisionCreatedAt?: Date;
}) {
  const run = await prisma.optimizationRun.create({
    data: {
      projectId: input.projectId,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `run:${input.label}:${randomUUID()}`,
      triggerPayload: {},
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1,
      failureCount: 0,
      startedAt: ago(7 * 60 * 60 * 1000),
      planningCompletedAt: ago(6 * 60 * 60 * 1000),
      completedAt: ago(60 * 60 * 1000),
      createdAt: ago(7 * 60 * 60 * 1000),
    },
  });
  const item = await prisma.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId: input.projectId,
      optimizationPlanId: input.optimizationPlanId,
      itemKey: `item:${input.label}:${randomUUID()}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      reasonCode: 'READY_FOR_POLICY',
      completedAt: ago(6 * 60 * 60 * 1000),
      createdAt: ago(7 * 60 * 60 * 1000),
    },
  });
  const status = input.decisionStatus ?? 'AUTOPILOT_READY';
  const reasonCode = status === 'POLICY_BLOCKED'
    ? 'AUTOPILOT_POLICY_DISABLED'
    : status === 'P8_VALIDATION_BLOCKED'
      ? 'P8_VALIDATION_FAILED'
      : 'AUTOPILOT_READY';
  const decision = await prisma.optimizationAutopilotDecision.create({
    data: {
      projectId: input.projectId,
      runId: run.id,
      runItemId: item.id,
      optimizationPlanId: input.optimizationPlanId,
      policyId: input.policyId,
      policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      policySnapshot: { enabled: true },
      sourceSnapshot: { fixture: input.label },
      status,
      reasonCodes: [reasonCode],
      p8PlanId: null,
      p8PreviewId: null,
      decisionKey: `decision:${input.label}:${randomUUID()}`,
      createdAt: input.decisionCreatedAt ?? ago(2 * 60 * 60 * 1000),
    },
  });
  return { run, item, decision };
}

async function createP8(input: {
  projectId: string;
  optimizationPlanId: string;
  runItemId: string;
  label: string;
  status: 'PR_CREATED' | 'VERIFIED' | 'VERIFICATION_FAILED' | 'FAILED';
  executionCreatedAt?: Date;
  executionCompletedAt?: Date;
  verificationStatus?: 'PENDING' | 'VERIFIED' | 'FAILED';
}) {
  const site = await prisma.publicationSite.create({
    data: {
      projectId: input.projectId,
      displayName: `Task 36 ${input.label}`,
      domain: `${input.label}-${randomUUID()}.example.com`,
      repositoryIdentity: `owner/${input.label}`,
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
    },
  });
  const channel = await prisma.publicationChannel.create({
    data: { siteId: site.id, pathPrefix: '/', displayName: 'Default', enabled: true },
  });
  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: input.projectId,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'Task 36 fixture',
      createdBy: 'system:test',
      sourceReferenceId: input.optimizationPlanId,
      sourceSnapshotId: input.runItemId,
      sourceMetadata: { label: input.label },
      createdAt: ago(5 * 60 * 60 * 1000),
    },
  });
  const draft = await prisma.contentDraft.create({
    data: {
      projectId: input.projectId,
      sourceProposalId: proposal.id,
      title: `Task 36 ${input.label}`,
      body: 'fixture',
      language: 'zh-CN',
      currentVersion: 1,
      currentContentHash: `hash-${input.label}`,
      status: 'READY_FOR_REVIEW',
      generatedBy: 'DETERMINISTIC_GENERATOR',
      createdAt: ago(5 * 60 * 60 * 1000),
    },
  });
  await prisma.contentDraftVersion.create({
    data: {
      draftId: draft.id,
      version: 1,
      title: draft.title,
      body: draft.body,
      language: draft.language,
      contentHash: `hash-${input.label}`,
      generatedBy: 'DETERMINISTIC_GENERATOR',
      createdAt: ago(5 * 60 * 60 * 1000),
    },
  });
  const publicationPlan = await prisma.publicationPlan.create({
    data: {
      projectId: input.projectId,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: `https://${site.domain}/${input.label}`,
      targetRepository: `owner/${input.label}`,
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      targetBlobHashes: {},
      operations: [{ type: 'CREATE_CONTENT_PAGE', path: `${input.label}.md` }],
      expectedOutcomes: {},
      validatorVersion: 'P8_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: `plan-hash-${input.label}-${randomUUID()}`,
      createdAt: ago(5 * 60 * 60 * 1000),
    },
  });
  const preview = await prisma.publicationPreview.create({
    data: {
      projectId: input.projectId,
      planId: publicationPlan.id,
      previewHash: `preview-${input.label}-${randomUUID()}`,
      diffSummary: 'fixture',
      validationResult: { blockingCodes: [], warningCodes: [] },
      createdAt: ago(4 * 60 * 60 * 1000),
    },
  });
  const approval = await prisma.publicationApproval.create({
    data: {
      projectId: input.projectId,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: `hash-${input.label}`,
      previewHash: preview.previewHash,
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'operator:fixture',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: [],
      createdAt: ago(4 * 60 * 60 * 1000),
    },
  });
  const execution = await prisma.publicationExecution.create({
    data: {
      projectId: input.projectId,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${input.label}:${randomUUID()}`,
      status: input.status,
      branchName: `task-36-${input.label}`,
      commitSha: 'b'.repeat(40),
      pullRequestNo: input.status === 'FAILED' ? null : 36,
      pullRequestUrl: input.status === 'FAILED' ? null : `https://github.com/example/${input.label}/pull/36`,
      errorCode: input.status === 'FAILED'
        ? 'EXECUTION_FAILED'
        : input.status === 'VERIFICATION_FAILED'
          ? 'VERIFICATION_FAILED'
          : null,
      startedAt: ago(4 * 60 * 60 * 1000),
      completedAt: input.executionCompletedAt ?? ago(3 * 60 * 60 * 1000),
      createdAt: input.executionCreatedAt ?? ago(4 * 60 * 60 * 1000),
    },
  });
  const verificationStatus = input.verificationStatus
    ?? (input.status === 'VERIFIED' ? 'VERIFIED' : input.status === 'VERIFICATION_FAILED' ? 'FAILED' : 'PENDING');
  const verification = await prisma.publicationVerification.create({
    data: {
      projectId: input.projectId,
      executionId: execution.id,
      status: verificationStatus,
      observedUrl: publicationPlan.targetPublicUrl,
      observedAt: input.status === 'VERIFIED' ? ago(2 * 60 * 60 * 1000) : null,
      reasonCode: input.status === 'VERIFICATION_FAILED'
        ? 'VERIFICATION_FAILED'
        : input.status === 'VERIFIED'
          ? 'VERIFIED'
          : null,
      createdAt: ago(3 * 60 * 60 * 1000),
    },
  });
  return { proposal, publicationPlan, preview, execution, verification };
}

async function createVerifiedChain(projectId: string, policyId: string, label: string) {
  const growth = await createCandidate(projectId, label);
  const plan = await createPlan(projectId, growth.candidate.id, label);
  const run = await createRunDecision({ projectId, optimizationPlanId: plan.id, policyId, label });
  const p8 = await createP8({
    projectId,
    optimizationPlanId: plan.id,
    runItemId: run.item.id,
    label,
    status: 'VERIFIED',
    verificationStatus: 'VERIFIED',
  });
  return { growth, plan, run, p8 };
}

async function createTerminalExperiment(input: {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  candidateId: string;
  label: string;
  cutoffAt: Date;
  createdAt: Date;
  effectState: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';
  accepted: boolean;
}) {
  const verifiedAnchorAt = new Date(input.cutoffAt.getTime() - 56 * DAY_MS);
  const experiment = await prisma.optimizationExperiment.create({
    data: {
      projectId: input.projectId,
      optimizationPlanId: input.optimizationPlanId,
      publicationExecutionId: input.publicationExecutionId,
      publicationVerificationId: input.publicationVerificationId,
      experimentVersion: `OPTIMIZATION_EXPERIMENT_V1_${input.label}`,
      experimentKey: `experiment:${input.label}:${randomUUID()}`,
      interventionType: 'CONTENT_CREATION',
      targetUrl: `https://${input.label}.example.com/`,
      marketCode: null,
      locale: 'zh-CN',
      verifiedAnchorAt,
      measurementScopeJson: {},
      observationScheduleJson: [
        { windowType: '14D', windowDays: 14 },
        { windowType: '28D', windowDays: 28 },
        { windowType: '56D', windowDays: 56 },
      ],
      expectedDirectionJson: {},
      createdAt: verifiedAnchorAt,
    },
  });
  const observation = await prisma.optimizationExperimentObservation.create({
    data: {
      projectId: input.projectId,
      experimentId: experiment.id,
      observationVersion: 'OPTIMIZATION_OBSERVATION_V1',
      observationKey: `observation:${input.label}:${randomUUID()}`,
      windowType: '56D',
      windowDays: 56,
      dueAt: input.cutoffAt,
      inputCutoffAt: input.cutoffAt,
      baselineSearchSourceRefs: [],
      observedSearchSourceRefs: [],
      baselineVisibilitySourceRefs: [],
      observedVisibilitySourceRefs: [],
      baselineMetricsJson: {},
      observedMetricsJson: {},
      deltaMetricsJson: {},
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      effectState: input.effectState,
      reasonCodes: [],
      evaluatorVersion: 'P9D_EVALUATOR_V1',
      createdAt: input.createdAt,
    },
  });
  let evidence = null;
  if (input.accepted && input.effectState !== 'INCONCLUSIVE') {
    evidence = await prisma.optimizationFeedbackEvidence.create({
      data: {
        projectId: input.projectId,
        experimentId: experiment.id,
        observationId: observation.id,
        optimizationPlanId: input.optimizationPlanId,
        candidateId: input.candidateId,
        feedbackEvidenceVersion: 'OPTIMIZATION_FEEDBACK_EVIDENCE_V1',
        evidenceKey: `evidence:${input.label}:${randomUUID()}`,
        scopeKey: `scope:${input.label}`,
        marketScopeMode: 'UNCONFIGURED_LEGACY',
        marketCode: null,
        locale: 'zh-CN',
        recommendedActionType: 'CONTENT_CREATION',
        effectState: input.effectState,
        feedbackValue: input.effectState === 'POSITIVE' ? 1 : input.effectState === 'NEGATIVE' ? -1 : 0,
        terminalWindowType: '56D',
        terminalWindowDays: 56,
        inputCutoffAt: input.cutoffAt,
        sourceEvaluatorVersion: 'P9D_EVALUATOR_V1',
        sourceObservationKey: observation.observationKey,
        createdAt: NOW,
      },
    });
  }
  return { experiment, observation, evidence };
}

async function createFeedbackProfile(input: {
  projectId: string;
  label: string;
  oldest: Date;
  newest: Date;
  evidenceIds: string[];
  sampleCount: number;
  positiveCount: number;
  negativeCount: number;
}) {
  return prisma.optimizationFeedbackProfile.create({
    data: {
      projectId: input.projectId,
      feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
      profileKey: `profile:${input.label}:${randomUUID()}`,
      scopeKey: `scope:${input.label}`,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: 'zh-CN',
      recommendedActionType: 'CONTENT_CREATION',
      sampleCount: input.sampleCount,
      positiveCount: input.positiveCount,
      neutralCount: 0,
      negativeCount: input.negativeCount,
      rollingEffectBalance: input.positiveCount - input.negativeCount,
      historicalRankAdjustment: input.positiveCount - input.negativeCount,
      windowLimit: 30,
      oldestEvidenceCutoffAt: input.oldest,
      newestEvidenceCutoffAt: input.newest,
      inputEvidenceIdsJson: input.evidenceIds,
      inputFingerprint: `profile-input:${input.label}:${randomUUID()}`,
      createdAt: NOW,
    },
  });
}

async function cleanup(): Promise<void> {
  if (projectIds.length === 0) return;
  const where = { projectId: { in: projectIds } };
  await prisma.optimizationFeedbackEvidence.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationFeedbackProfile.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationExperimentObservation.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationExperiment.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationVerification.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationExecution.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationApproval.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationPreview.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationPlan.deleteMany({ where }).catch(() => undefined);
  await prisma.contentDraft.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationProposal.deleteMany({ where }).catch(() => undefined);
  await prisma.publicationSite.deleteMany({ where }).catch(() => undefined);
  await prisma.autopilotExecutionReservation.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationAutopilotDecision.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationRunItem.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationRun.deleteMany({ where }).catch(() => undefined);
  await prisma.autopilotPolicy.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationPlan.deleteMany({ where }).catch(() => undefined);
  await prisma.optimizationCandidate.deleteMany({ where }).catch(() => undefined);
  await prisma.growthOpportunitySnapshot.deleteMany({ where }).catch(() => undefined);
  await prisma.growthOpportunityIdentity.deleteMany({ where }).catch(() => undefined);
  await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
}

afterAll(cleanup);

describe('P9-F persisted-read Operations repository and service', () => {
  it('keeps pipeline reads project-scoped and emits one farthest stage per growth identity', async () => {
    const projectA = await createProject('pipeline-a');
    const projectB = await createProject('pipeline-b');
    const policyA = await createPolicy(projectA.id);
    const policyB = await createPolicy(projectB.id, 9);

    const eligible = await createCandidate(projectA.id, 'eligible');

    const planned = await createCandidate(projectA.id, 'planned');
    await createPlan(projectA.id, planned.candidate.id, 'planned');

    const draft = await createCandidate(projectA.id, 'draft');
    const draftPlan = await createPlan(projectA.id, draft.candidate.id, 'draft');
    const draftRun = await createRunDecision({ projectId: projectA.id, optimizationPlanId: draftPlan.id, policyId: policyA.id, label: 'draft' });
    await createP8({ projectId: projectA.id, optimizationPlanId: draftPlan.id, runItemId: draftRun.item.id, label: 'draft', status: 'PR_CREATED' });

    const verified = await createVerifiedChain(projectA.id, policyA.id, 'verified');
    const evaluated = await createVerifiedChain(projectA.id, policyA.id, 'evaluated');
    await createTerminalExperiment({
      projectId: projectA.id,
      optimizationPlanId: evaluated.plan.id,
      publicationExecutionId: evaluated.p8.execution.id,
      publicationVerificationId: evaluated.p8.verification.id,
      candidateId: evaluated.growth.candidate.id,
      label: 'evaluated',
      cutoffAt: ago(2 * DAY_MS),
      createdAt: NOW,
      effectState: 'POSITIVE',
      accepted: true,
    });

    const foreign = await createCandidate(projectB.id, 'foreign');
    const foreignPlan = await createPlan(projectB.id, foreign.candidate.id, 'foreign');
    await createRunDecision({ projectId: projectB.id, optimizationPlanId: foreignPlan.id, policyId: policyB.id, label: 'foreign' });

    const repository = new OptimizationOperationsRepository(prisma);
    const rows = await repository.listPipelineAuthority(projectA.id, 100, 0);
    const stages = new Map(rows.map((row) => [row.growthOpportunityId, derivePipelineStage(row)]));

    expect(stages.get(eligible.identity.id)).toBe('ELIGIBLE');
    expect(stages.get(planned.identity.id)).toBe('PLANNED');
    expect(stages.get(draft.identity.id)).toBe('DRAFT_PR');
    expect(stages.get(verified.growth.identity.id)).toBe('VERIFIED');
    expect(stages.get(evaluated.growth.identity.id)).toBe('EVALUATED');
    expect(rows.filter((row) => row.growthOpportunityId === evaluated.growth.identity.id)).toHaveLength(1);
    expect(rows.some((row) => row.growthOpportunityId === foreign.identity.id)).toBe(false);
    await expect(repository.getCurrentPolicy(projectA.id)).resolves.toMatchObject({
      id: policyA.id,
      projectId: projectA.id,
      dailyDraftPrLimit: 3,
    });
  });

  it('preserves inbox authority, business cutoffs, quota state and semantic activity time', async () => {
    const projectA = await createProject('semantics-a');
    const projectB = await createProject('semantics-b');
    const policyA = await createPolicy(projectA.id);
    const policyB = await createPolicy(projectB.id);

    const blocked = await createCandidate(projectA.id, 'blocked');
    const blockedPlan = await createPlan(projectA.id, blocked.candidate.id, 'blocked');
    await createRunDecision({ projectId: projectA.id, optimizationPlanId: blockedPlan.id, policyId: policyA.id, label: 'blocked', decisionStatus: 'POLICY_BLOCKED' });

    const failed = await createCandidate(projectA.id, 'failed');
    const failedPlan = await createPlan(projectA.id, failed.candidate.id, 'failed');
    const failedRun = await createRunDecision({ projectId: projectA.id, optimizationPlanId: failedPlan.id, policyId: policyA.id, label: 'failed' });
    await createP8({
      projectId: projectA.id,
      optimizationPlanId: failedPlan.id,
      runItemId: failedRun.item.id,
      label: 'failed',
      status: 'FAILED',
      executionCreatedAt: ago(10 * 60 * 1000),
      executionCompletedAt: ago(3 * 60 * 60 * 1000),
    });

    const recentChain = await createVerifiedChain(projectA.id, policyA.id, 'recent-positive');
    const recent = await createTerminalExperiment({
      projectId: projectA.id,
      optimizationPlanId: recentChain.plan.id,
      publicationExecutionId: recentChain.p8.execution.id,
      publicationVerificationId: recentChain.p8.verification.id,
      candidateId: recentChain.growth.candidate.id,
      label: 'recent-positive',
      cutoffAt: ago(4 * 60 * 60 * 1000),
      createdAt: NOW,
      effectState: 'POSITIVE',
      accepted: true,
    });
    const olderChain = await createVerifiedChain(projectA.id, policyA.id, 'older-negative');
    const older = await createTerminalExperiment({
      projectId: projectA.id,
      optimizationPlanId: olderChain.plan.id,
      publicationExecutionId: olderChain.p8.execution.id,
      publicationVerificationId: olderChain.p8.verification.id,
      candidateId: olderChain.growth.candidate.id,
      label: 'older-negative',
      cutoffAt: ago(20 * DAY_MS),
      createdAt: NOW,
      effectState: 'NEGATIVE',
      accepted: false,
    });
    const outsideChain = await createVerifiedChain(projectA.id, policyA.id, 'outside-window');
    await createTerminalExperiment({
      projectId: projectA.id,
      optimizationPlanId: outsideChain.plan.id,
      publicationExecutionId: outsideChain.p8.execution.id,
      publicationVerificationId: outsideChain.p8.verification.id,
      candidateId: outsideChain.growth.candidate.id,
      label: 'outside-window',
      cutoffAt: ago(31 * DAY_MS),
      createdAt: NOW,
      effectState: 'POSITIVE',
      accepted: false,
    });
    await createFeedbackProfile({
      projectId: projectA.id,
      label: 'semantics',
      oldest: older.observation.inputCutoffAt,
      newest: recent.observation.inputCutoffAt,
      evidenceIds: recent.evidence ? [recent.evidence.id] : [],
      sampleCount: 2,
      positiveCount: 1,
      negativeCount: 1,
    });

    const quotaDecisions = [];
    for (const label of ['reserved', 'consumed', 'released'] as const) {
      quotaDecisions.push(await prisma.optimizationAutopilotDecision.create({
        data: {
          projectId: projectA.id,
          runId: failedRun.run.id,
          runItemId: failedRun.item.id,
          optimizationPlanId: failedPlan.id,
          policyId: policyA.id,
          policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
          policySnapshot: {},
          sourceSnapshot: {},
          status: 'DEFERRED_QUOTA',
          reasonCodes: [label],
          p8PlanId: null,
          p8PreviewId: null,
          decisionKey: `quota:${label}:${randomUUID()}`,
          createdAt: ago(90 * 60 * 1000),
        },
      }));
    }
    const utcDate = new Date('2026-08-25T00:00:00.000Z');
    await prisma.autopilotExecutionReservation.createMany({
      data: [
        { projectId: projectA.id, decisionId: quotaDecisions[0]!.id, utcDate, reservationKey: `reserved:${randomUUID()}`, status: 'RESERVED' },
        { projectId: projectA.id, decisionId: quotaDecisions[1]!.id, utcDate, reservationKey: `consumed:${randomUUID()}`, status: 'CONSUMED' },
        { projectId: projectA.id, decisionId: quotaDecisions[2]!.id, utcDate, reservationKey: `released:${randomUUID()}`, status: 'RELEASED', releasedAt: ago(30 * 60 * 1000) },
      ],
    });

    const foreign = await createCandidate(projectB.id, 'semantic-foreign');
    const foreignPlan = await createPlan(projectB.id, foreign.candidate.id, 'semantic-foreign');
    await createRunDecision({ projectId: projectB.id, optimizationPlanId: foreignPlan.id, policyId: policyB.id, label: 'semantic-foreign', decisionStatus: 'POLICY_BLOCKED' });

    const repository = new OptimizationOperationsRepository(prisma);
    const inbox = await repository.listInboxAuthority(projectA.id, 100, 0);
    expect(inbox.some((item) => item.authorityType === 'AUTOPILOT_DECISION' && item.status === 'POLICY_BLOCKED')).toBe(true);
    expect(inbox.some((item) => item.authorityType === 'PUBLICATION_EXECUTION' && item.status === 'FAILED')).toBe(true);

    const observations = await repository.listTerminalObservations(projectA.id, ago(30 * DAY_MS), NOW);
    expect(observations.map((item) => item.id)).toContain(recent.observation.id);
    expect(observations.map((item) => item.id)).toContain(older.observation.id);
    expect(observations).toHaveLength(2);
    const feedback = await repository.listFeedbackEvidence(projectA.id, ago(30 * DAY_MS), NOW);
    expect(feedback.map((item) => item.observationId)).toEqual([recent.observation.id]);

    const reservations = await repository.listReservations(projectA.id, utcDate);
    expect(reservations.map((item) => item.status).sort()).toEqual(['CONSUMED', 'RELEASED', 'RESERVED']);

    const activity = await repository.listRecentActivityAuthority(projectA.id, 100);
    const p9d = activity.find((item) => item.authorityId === recent.observation.id);
    const p9e = activity.find((item) => item.authorityId === recent.evidence?.id);
    expect(p9d?.occurredAt.toISOString()).toBe(recent.observation.inputCutoffAt.toISOString());
    expect(p9e?.occurredAt.toISOString()).toBe(recent.evidence?.inputCutoffAt.toISOString());
    expect(activity[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(activity.at(-1)?.occurredAt.getTime() ?? 0);
  });

  it('composes overview counts without conflating experiment outcome with feedback acceptance', async () => {
    const project = await createProject('overview');
    const policy = await createPolicy(project.id, 1);

    const positiveChain = await createVerifiedChain(project.id, policy.id, 'overview-positive');
    const positive = await createTerminalExperiment({
      projectId: project.id,
      optimizationPlanId: positiveChain.plan.id,
      publicationExecutionId: positiveChain.p8.execution.id,
      publicationVerificationId: positiveChain.p8.verification.id,
      candidateId: positiveChain.growth.candidate.id,
      label: 'overview-positive',
      cutoffAt: ago(2 * DAY_MS),
      createdAt: NOW,
      effectState: 'POSITIVE',
      accepted: true,
    });
    const inconclusiveChain = await createVerifiedChain(project.id, policy.id, 'overview-inconclusive');
    await createTerminalExperiment({
      projectId: project.id,
      optimizationPlanId: inconclusiveChain.plan.id,
      publicationExecutionId: inconclusiveChain.p8.execution.id,
      publicationVerificationId: inconclusiveChain.p8.verification.id,
      candidateId: inconclusiveChain.growth.candidate.id,
      label: 'overview-inconclusive',
      cutoffAt: ago(DAY_MS),
      createdAt: NOW,
      effectState: 'INCONCLUSIVE',
      accepted: false,
    });
    await createFeedbackProfile({
      projectId: project.id,
      label: 'overview',
      oldest: positive.observation.inputCutoffAt,
      newest: positive.observation.inputCutoffAt,
      evidenceIds: positive.evidence ? [positive.evidence.id] : [],
      sampleCount: 1,
      positiveCount: 1,
      negativeCount: 0,
    });

    const extraDecision = await prisma.optimizationAutopilotDecision.create({
      data: {
        projectId: project.id,
        runId: positiveChain.run.run.id,
        runItemId: positiveChain.run.item.id,
        optimizationPlanId: positiveChain.plan.id,
        policyId: policy.id,
        policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
        policySnapshot: {},
        sourceSnapshot: {},
        status: 'DEFERRED_QUOTA',
        reasonCodes: ['quota'],
        p8PlanId: null,
        p8PreviewId: null,
        decisionKey: `overview-quota:${randomUUID()}`,
        createdAt: ago(30 * 60 * 1000),
      },
    });
    const utcDate = new Date('2026-08-25T00:00:00.000Z');
    await prisma.autopilotExecutionReservation.createMany({
      data: [
        { projectId: project.id, decisionId: positiveChain.run.decision.id, utcDate, reservationKey: `overview-reserved:${randomUUID()}`, status: 'RESERVED' },
        { projectId: project.id, decisionId: extraDecision.id, utcDate, reservationKey: `overview-consumed:${randomUUID()}`, status: 'CONSUMED' },
      ],
    });
    await prisma.optimizationRun.create({
      data: {
        projectId: project.id,
        runVersion: 'OPTIMIZATION_RUN_V1',
        triggerType: 'MANUAL',
        triggerSource: 'MANUAL_REQUEST',
        triggerKey: `run:overview-today:${randomUUID()}`,
        triggerPayload: {},
        status: 'SUCCEEDED',
        candidateCount: 0,
        plannedCount: 0,
        itemCount: 0,
        completedCount: 0,
        failureCount: 0,
        startedAt: ago(60 * 60 * 1000),
        planningCompletedAt: ago(50 * 60 * 1000),
        completedAt: ago(30 * 60 * 1000),
        createdAt: ago(60 * 60 * 1000),
      },
    });

    const repository = new OptimizationOperationsRepository(prisma);
    const service = new OptimizationOperationsService(repository, () => false);
    const overview = await service.getOverview(project.id, NOW);

    expect(overview.effectiveAutopilotState).toBe('ACTIVE');
    expect(overview.quota).toEqual({ configuredLimit: 1, reserved: 1, consumed: 1, remaining: 0 });
    expect(overview.pipelineCounts.EVALUATED).toBe(2);
    expect(overview.experimentSummary.last7Days).toMatchObject({
      positive: 1,
      inconclusive: 1,
      feedbackAccepted: 1,
      feedbackDeferred: 1,
    });
    expect(overview.feedbackSummary.sampleCount).toBe(1);
    expect(overview.todayRunCount).toBeGreaterThanOrEqual(1);
    expect(overview.generatedAt.toISOString()).toBe(NOW.toISOString());

    await expect(service.getPolicy(project.id)).resolves.toMatchObject({ id: policy.id });
    await expect(service.listPolicyRevisions(project.id, { limit: 25, offset: 0 })).resolves.toEqual([]);
  });
});
