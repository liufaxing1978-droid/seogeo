import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationOperationsRepository } from '../../src/modules/optimization-operations/operations.repository.js';
import { OptimizationOperationsService } from '../../src/modules/optimization-operations/operations.service.js';

const projectIds: string[] = [];
const retainedImmutableProjectIds = new Set<string>();
const DAY_MS = 24 * 60 * 60 * 1000;

async function readSourceTree(root: string): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: Array<{ path: string; source: string }> = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await readSourceTree(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ path: fullPath, source: await readFile(fullPath, 'utf8') });
    }
  }
  return files;
}

async function createEligibleProject() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F authority ${suffix}`,
      slug: `p9f-authority-${suffix}`,
      primaryDomain: `p9f-authority-${suffix}.example.com`,
      planLevel: 'ADVANCED',
    },
  });
  projectIds.push(project.id);
  const policy = await prisma.autopilotPolicy.create({
    data: {
      projectId: project.id,
      enabled: true,
      dailyDraftPrLimit: 3,
      killSwitch: false,
      updatedBy: 'authority-fixture',
    },
  });
  const growth = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `authority:${randomUUID()}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'authority fixture',
      canonicalPage: `https://${project.primaryDomain}/authority`,
      identityPayload: { fixture: true },
    },
  });
  return { project, policy, growth };
}

async function createFullPersistedChain() {
  const { project, policy, growth } = await createEligibleProject();
  retainedImmutableProjectIds.add(project.id);
  const now = new Date();
  const cutoffAt = new Date(now.getTime() - DAY_MS);
  const verifiedAnchorAt = new Date(cutoffAt.getTime() - 56 * DAY_MS);
  const label = `authority-chain-${randomUUID()}`;

  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growth.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_FORMULA_V1',
      currentWindowStart: new Date(now.getTime() - 7 * DAY_MS),
      currentWindowEnd: now,
      previousWindowStart: new Date(now.getTime() - 14 * DAY_MS),
      previousWindowEnd: new Date(now.getTime() - 8 * DAY_MS),
      dataCutoffAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      primaryType: 'RANKING_UPSIDE',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 100,
      rankingEligible: true,
      sourceProvenance: { authority: true },
    },
  });

  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: growth.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${label}`,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: 'zh-CN',
      opportunityType: 'RANKING_UPSIDE',
      normalizedQuery: 'authority fixture',
      canonicalPage: growth.canonicalPage,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 100,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { authority: true },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: [],
    },
  });

  const optimizationPlan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: `OPTIMIZATION_PLAN_V1_${randomUUID()}`,
      recommendedActionType: 'CONTENT_CREATION',
      sourceFactReferences: [],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { authority: true },
    },
  });

  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: `run:${label}`,
      triggerPayload: {},
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1,
      failureCount: 0,
      startedAt: new Date(now.getTime() - 90 * 60 * 1000),
      planningCompletedAt: new Date(now.getTime() - 80 * 60 * 1000),
      completedAt: new Date(now.getTime() - 70 * 60 * 1000),
    },
  });
  const runItem = await prisma.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      itemKey: `item:${label}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      reasonCode: 'READY_FOR_POLICY',
      completedAt: new Date(now.getTime() - 70 * 60 * 1000),
    },
  });
  const decision = await prisma.optimizationAutopilotDecision.create({
    data: {
      projectId: project.id,
      runId: run.id,
      runItemId: runItem.id,
      optimizationPlanId: optimizationPlan.id,
      policyId: policy.id,
      policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      policySnapshot: { enabled: true },
      sourceSnapshot: { authority: true },
      status: 'AUTOPILOT_READY',
      reasonCodes: ['AUTOPILOT_READY'],
      p8PlanId: null,
      p8PreviewId: null,
      decisionKey: `decision:${label}`,
    },
  });

  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-F authority site',
      domain: `${randomUUID()}.example.com`,
      repositoryIdentity: 'owner/p9-f-authority',
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
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-F authority chain',
      createdBy: 'system:test',
      sourceReferenceId: optimizationPlan.id,
      sourceSnapshotId: runItem.id,
      sourceMetadata: { authority: true },
    },
  });
  const contentHash = `hash-${label}`;
  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-F authority chain',
      body: 'fixture',
      language: 'zh-CN',
      currentVersion: 1,
      currentContentHash: contentHash,
      status: 'READY_FOR_REVIEW',
      generatedBy: 'DETERMINISTIC_GENERATOR',
    },
  });
  await prisma.contentDraftVersion.create({
    data: {
      draftId: draft.id,
      version: 1,
      title: draft.title,
      body: draft.body,
      language: draft.language,
      contentHash,
      generatedBy: 'DETERMINISTIC_GENERATOR',
    },
  });
  const publicationPlan = await prisma.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: `https://${site.domain}/authority`,
      targetRepository: 'owner/p9-f-authority',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      targetBlobHashes: {},
      operations: [{ type: 'CREATE_CONTENT_PAGE', path: 'authority.md' }],
      expectedOutcomes: {},
      validatorVersion: 'P8_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: `plan-hash-${label}`,
    },
  });
  const preview = await prisma.publicationPreview.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      previewHash: `preview-${label}`,
      diffSummary: 'fixture',
      validationResult: { blockingCodes: [], warningCodes: [] },
    },
  });
  const approval = await prisma.publicationApproval.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: publicationPlan.version,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash,
      previewHash: preview.previewHash,
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'operator:authority-fixture',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: [],
    },
  });
  const execution = await prisma.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${label}`,
      status: 'VERIFIED',
      branchName: `p9-f-${randomUUID()}`,
      commitSha: 'b'.repeat(40),
      pullRequestNo: 39,
      pullRequestUrl: 'https://github.com/example/p9-f/pull/39',
      startedAt: new Date(now.getTime() - 60 * 60 * 1000),
      completedAt: new Date(now.getTime() - 50 * 60 * 1000),
    },
  });
  const verification = await prisma.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: publicationPlan.targetPublicUrl,
      observedAt: new Date(now.getTime() - 40 * 60 * 1000),
      reasonCode: 'VERIFIED',
    },
  });

  const experiment = await prisma.optimizationExperiment.create({
    data: {
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      publicationExecutionId: execution.id,
      publicationVerificationId: verification.id,
      experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1_AUTHORITY',
      experimentKey: `experiment:${label}`,
      interventionType: 'CONTENT_CREATION',
      targetUrl: publicationPlan.targetPublicUrl,
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
    },
  });
  const observation = await prisma.optimizationExperimentObservation.create({
    data: {
      projectId: project.id,
      experimentId: experiment.id,
      observationVersion: 'OPTIMIZATION_OBSERVATION_V1',
      observationKey: `observation:${label}`,
      windowType: '56D',
      windowDays: 56,
      dueAt: cutoffAt,
      inputCutoffAt: cutoffAt,
      baselineSearchSourceRefs: [],
      observedSearchSourceRefs: [],
      baselineVisibilitySourceRefs: [],
      observedVisibilitySourceRefs: [],
      baselineMetricsJson: {},
      observedMetricsJson: {},
      deltaMetricsJson: {},
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      effectState: 'POSITIVE',
      reasonCodes: [],
      evaluatorVersion: 'P9D_EVALUATOR_V1',
    },
  });
  const evidence = await prisma.optimizationFeedbackEvidence.create({
    data: {
      projectId: project.id,
      experimentId: experiment.id,
      observationId: observation.id,
      optimizationPlanId: optimizationPlan.id,
      candidateId: candidate.id,
      feedbackEvidenceVersion: 'OPTIMIZATION_FEEDBACK_EVIDENCE_V1',
      evidenceKey: `evidence:${label}`,
      scopeKey: `scope:${label}`,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: 'zh-CN',
      recommendedActionType: 'CONTENT_CREATION',
      effectState: 'POSITIVE',
      feedbackValue: 1,
      terminalWindowType: '56D',
      terminalWindowDays: 56,
      inputCutoffAt: cutoffAt,
      sourceEvaluatorVersion: 'P9D_EVALUATOR_V1',
      sourceObservationKey: observation.observationKey,
    },
  });
  const profile = await prisma.optimizationFeedbackProfile.create({
    data: {
      projectId: project.id,
      feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
      profileKey: `profile:${label}`,
      scopeKey: `scope:${label}`,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: 'zh-CN',
      recommendedActionType: 'CONTENT_CREATION',
      sampleCount: 1,
      positiveCount: 1,
      neutralCount: 0,
      negativeCount: 0,
      rollingEffectBalance: 1,
      historicalRankAdjustment: 1,
      windowLimit: 30,
      oldestEvidenceCutoffAt: cutoffAt,
      newestEvidenceCutoffAt: cutoffAt,
      inputEvidenceIdsJson: [evidence.id],
      inputFingerprint: `profile-input:${label}`,
    },
  });

  return {
    now,
    project,
    growth,
    candidate,
    optimizationPlan,
    run,
    decision,
    proposal,
    publicationPlan,
    preview,
    execution,
    verification,
    experiment,
    observation,
    evidence,
    profile,
  };
}

async function authoritySnapshot(projectId: string) {
  return {
    policy: await prisma.autopilotPolicy.findUnique({ where: { projectId } }),
    revisions: await prisma.autopilotPolicyRevision.count({ where: { projectId } }),
    growth: await prisma.growthOpportunityIdentity.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    candidates: await prisma.optimizationCandidate.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    plans: await prisma.optimizationPlan.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    runs: await prisma.optimizationRun.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    decisions: await prisma.optimizationAutopilotDecision.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    executions: await prisma.publicationExecution.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    observations: await prisma.optimizationExperimentObservation.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
    evidence: await prisma.optimizationFeedbackEvidence.findMany({ where: { projectId }, orderBy: { id: 'asc' } }),
  };
}

async function cleanup() {
  const cleanupProjectIds = projectIds.filter((projectId) => !retainedImmutableProjectIds.has(projectId));
  if (cleanupProjectIds.length === 0) return;
  const where = { projectId: { in: cleanupProjectIds } };
  await prisma.autopilotPolicy.deleteMany({ where });
  await prisma.growthOpportunityIdentity.deleteMany({ where });
  await prisma.project.deleteMany({ where: { id: { in: cleanupProjectIds } } });
}

afterAll(cleanup);

describe('P9-F Operations authority hardening', () => {
  it('keeps the Operations module free of privileged provider, queue, Git and execution dependencies', async () => {
    const moduleRoot = fileURLToPath(new URL('../../src/modules/optimization-operations/', import.meta.url));
    const files = await readSourceTree(moduleRoot);
    const clientPath = fileURLToPath(new URL('../../src/public/js/optimization-operations.js', import.meta.url));
    const clientSource = await readFile(clientPath, 'utf8');

    const forbiddenImport = /(?:from\s+|import\s*\()\s*['"][^'"]*(?:deepseek|ai[-_.]?gateway|search[^'"]*provider|visibility[^'"]*provider|github|bullmq|queue|publication[^'"]*execution[^'"]*service|experiment[^'"]*evaluator|feedback[^'"]*materializer)[^'"]*['"]/i;
    const privilegedWrite = /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;

    for (const file of files) {
      const relativePath = path.relative(moduleRoot, file.path);
      expect(file.source, `${relativePath} imports privileged runtime authority`).not.toMatch(forbiddenImport);
      if (!relativePath.startsWith('policy-revision.')) {
        expect(file.source, `${relativePath} performs a persistence write`).not.toMatch(privilegedWrite);
      }
    }

    expect(clientSource).not.toMatch(/\/(?:merge|deploy|rollback)(?:\b|\/)/i);
    expect(clientSource).not.toMatch(/global[-_]?kill[-_]?switch/i);
    expect(clientSource).not.toMatch(/deepseek|ai[-_.]?gateway|feedback[-_.]?materializer|experiment[-_.]?evaluator/i);
  });

  it('keeps every Operations GET and SSR route persisted-read only', async () => {
    const { project } = await createEligibleProject();
    const before = await authoritySnapshot(project.id);
    const app = createApp();
    const apiBase = `/api/v1/projects/${project.id}/optimization`;

    const getPaths = [
      `${apiBase}/operations`,
      `${apiBase}/operations/pipeline`,
      `${apiBase}/operations/inbox`,
      `${apiBase}/operations/experiments`,
      `${apiBase}/operations/feedback`,
      `${apiBase}/autopilot-policy`,
      `${apiBase}/autopilot-policy/revisions`,
    ];
    for (const endpoint of getPaths) {
      const response = await request(app).get(endpoint);
      expect(
        { endpoint, status: response.status, body: response.body },
        `GET ${endpoint} must stay a persisted-read success`,
      ).toMatchObject({ status: 200 });
    }
    await request(app).get(`/projects/${project.id}/optimization`).expect(200);

    const after = await authoritySnapshot(project.id);
    expect(after).toEqual(before);
  });

  it('reflects one exact persisted P7 to P9-F chain without copying pipeline authority', async () => {
    const chain = await createFullPersistedChain();
    const repository = new OptimizationOperationsRepository(prisma);
    const service = new OptimizationOperationsService(repository, () => false);

    const pipeline = await service.listPipeline(chain.project.id, { limit: 100, offset: 0 });
    const rows = pipeline.filter((row) => row.growthOpportunityId === chain.growth.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      growthOpportunityId: chain.growth.id,
      candidate: { id: chain.candidate.id },
      optimizationPlanId: chain.optimizationPlan.id,
      autopilotDecision: { id: chain.decision.id },
      p8Authority: {
        proposalId: chain.proposal.id,
        planId: chain.publicationPlan.id,
        previewId: chain.preview.id,
      },
      publicationExecution: { id: chain.execution.id },
      publicationVerification: { id: chain.verification.id },
      experiment: { id: chain.experiment.id },
      terminalObservation: { id: chain.observation.id },
      stage: 'EVALUATED',
    });

    const overview = await service.getOverview(chain.project.id, chain.now);
    expect(overview.pipelineCounts.EVALUATED).toBe(1);
    expect(overview.feedbackSummary.profileId).toBe(chain.profile.id);
    const activityIds = new Set(overview.recentActivity.map((activity) => activity.authorityId));
    for (const authorityId of [
      chain.optimizationPlan.id,
      chain.run.id,
      chain.decision.id,
      chain.execution.id,
      chain.verification.id,
      chain.observation.id,
      chain.evidence.id,
    ]) {
      expect(activityIds.has(authorityId), `missing persisted authority activity ${authorityId}`).toBe(true);
    }

    await expect(service.listFeedback(chain.project.id, { limit: 10, offset: 0 })).resolves.toEqual([
      expect.objectContaining({ id: chain.profile.id, projectId: chain.project.id }),
    ]);
  });

  it('exposes no global kill-switch write authority', async () => {
    const { project } = await createEligibleProject();
    const app = createApp();
    const endpoints = [
      `/api/v1/projects/${project.id}/optimization/global-kill-switch`,
      `/api/v1/projects/${project.id}/optimization/operations/global-kill-switch`,
    ];

    for (const endpoint of endpoints) {
      await request(app).post(endpoint).send({ enabled: true }).expect(404);
      await request(app).put(endpoint).send({ enabled: true }).expect(404);
      await request(app).patch(endpoint).send({ enabled: true }).expect(404);
      await request(app).delete(endpoint).expect(404);
    }
  });

  it('keeps the default actor rollout gate fail-closed while eligible reads remain available', async () => {
    const { project, policy } = await createEligibleProject();
    const app = createApp();

    await request(app).get(`/projects/${project.id}/optimization`).expect(200);
    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/optimization/autopilot-policy/revisions`)
      .send({
        requestId: randomUUID(),
        expectedUpdatedAt: policy.updatedAt.toISOString(),
        policy: {
          enabled: policy.enabled,
          dailyDraftPrLimit: policy.dailyDraftPrLimit,
          maxConcurrentRuns: policy.maxConcurrentRuns,
          requireFreshEvidence: policy.requireFreshEvidence,
          minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
          pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
          killSwitch: policy.killSwitch,
        },
      })
      .expect(503);

    expect(response.body.error.code).toBe('OPERATIONS_ACTOR_UNAVAILABLE');
    await expect(prisma.autopilotPolicyRevision.count({ where: { projectId: project.id } })).resolves.toBe(0);
  });

  it('keeps the development authority guide complete and placeholder-free', async () => {
    const guidePath = fileURLToPath(new URL('../../docs/development/p9-f-autonomous-operations-center.md', import.meta.url));
    const guide = await readFile(guidePath, 'utf8');

    for (const required of [
      'P7', 'P9-A', 'P9-B', 'P9-C', 'P8', 'P9-D', 'P9-E', 'P9-F',
      'farthest', 'Inbox', 'inputCutoffAt', 'quota', 'occurredAt',
      'optimistic concurrency', 'idempotency', 'actor', 'fail-closed',
      'LOW', 'CREATE_CONTENT_PAGE', '/projects/:id/optimization',
      '/api/v1/projects/:projectId/optimization/operations',
      'Merge', 'Deploy', 'Rollback', 'retention', 'vitest', 'typecheck',
    ]) {
      expect(guide, `missing guide contract: ${required}`).toContain(required);
    }
    expect(guide).not.toMatch(/\b(?:TBD|TODO|PLACEHOLDER|implement later)\b/i);
  });
});
