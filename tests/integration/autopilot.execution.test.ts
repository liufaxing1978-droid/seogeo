import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { authorizePublicationAutomation } from '../../src/modules/publication/publication-automation-authorization.js';
import { PublicationExecutionService } from '../../src/modules/publication/publication-execution.service.js';
import { processPublicationExecutionJob } from '../../src/modules/publication/publication-execution.worker.js';
import type {
  MutationAdapter,
  MutationPreview,
  TargetRef
} from '../../src/modules/publication/mutation-adapter.js';

const ORIGINAL_GLOBAL_KILL_SWITCH = process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;
const BASE_SHA = '1111111111111111111111111111111111111111';
const COMMIT_SHA = '2222222222222222222222222222222222222222';
const CONTENT_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'content/culture/p9c-machine-execution.md';

const policySnapshot = {
  version: 'CONTROLLED_AUTOPILOT_POLICY_V1',
  enabled: true,
  allowedRiskClass: 'LOW',
  allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
  dailyDraftPrLimit: 3,
  maxConcurrentRuns: 1,
  requireFreshEvidence: true,
  minimumEvidenceCoverage: 70,
  pauseOnVerificationFailure: true,
  killSwitch: false
} as const;

class IntegrationAdapter implements MutationAdapter {
  readonly capability = 'DRAFT_PR' as const;
  reads = 0;
  applies = 0;
  headSha = BASE_SHA;

  async readTargetSnapshot(input: TargetRef) {
    this.reads += 1;
    return {
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch,
      headSha: this.headSha,
      touchedBlobShas: {}
    };
  }

  async preview(): Promise<MutationPreview> {
    throw new Error('not used');
  }

  async apply() {
    this.applies += 1;
    return {
      capability: 'DRAFT_PR' as const,
      status: 'APPLIED' as const,
      remoteWritePerformed: true,
      branchName: 'seogeo/p8/p9c-machine-aaaaaaaaaaaa',
      commitSha: COMMIT_SHA,
      pullRequestNo: 157,
      pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/157'
    };
  }

  async readExecutionState() {
    return { status: 'PENDING' as const, remoteStateKnown: false };
  }

  async rollback() {
    return { status: 'READY' as const, strategy: 'REVERT_COMMIT', remoteWritePerformed: false };
  }
}

async function createFixture() {
  const suffix = `${Date.now()}-${Math.random()}`.replace('.', '-');
  const project = await prisma.project.create({
    data: {
      name: `P9-C execution ${suffix}`,
      slug: `p9c-execution-${suffix}`,
      primaryDomain: `p9c-execution-${suffix}.example.com`,
      planLevel: 'ADVANCED',
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `execution-identity-${suffix}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: '六壬伏英舘文化源流',
      canonicalPage: null,
      identityPayload: { normalizedQuery: '六壬伏英舘文化源流' }
    }
  });
  const growthSnapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_FORMULA_V1',
      currentWindowStart: new Date('2026-07-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-01T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-06-30T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-01T00:00:00.000Z'),
      primaryType: 'NEW_CONTENT_OPPORTUNITY',
      secondaryTypes: [],
      score: 82,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 100,
      rankingEligible: true,
      sourceProvenance: { provider: 'fixture' }
    }
  });
  const evidence = await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: growthSnapshot.id,
      projectId: project.id,
      sourceModule: 'P5_CONTENT',
      sourceType: 'FIXTURE_FACT',
      sourceId: `execution-source-${suffix}`,
      sourceFactVersion: 'FACT_V1',
      ruleKey: 'new-content-gap',
      rootCauseKey: 'content-gap',
      evidenceState: 'PASS',
      severity: 'MEDIUM',
      textSummary: 'bounded machine execution fixture evidence',
      fingerprint: `execution-fingerprint-${suffix}`
    }
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `p9cexecution${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      opportunityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: '六壬伏英舘文化源流',
      canonicalPage: null,
      growthScore: 82,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 100,
      growthRankingEligible: true,
      growthLifecycleStatus: 'PLANNED',
      sourceProvenance: { source: 'fixture' },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });
  const optimizationPlan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'CONTENT_CREATION',
      sourceFactReferences: [
        { type: 'GROWTH_OPPORTUNITY_IDENTITY', id: identity.id },
        { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: growthSnapshot.id },
        { type: 'GROWTH_OPPORTUNITY_EVIDENCE', id: evidence.id }
      ],
      deterministicRank: 10,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 10,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { summary: 'bounded execution fixture plan' }
    }
  });
  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: `execution-run-${suffix}`,
      triggerPayload: { source: 'fixture' },
      status: 'SUCCEEDED',
      candidateCount: 1,
      plannedCount: 1,
      itemCount: 1,
      completedCount: 1,
      planningCompletedAt: new Date('2026-08-24T00:00:00.000Z'),
      completedAt: new Date('2026-08-24T00:01:00.000Z')
    }
  });
  const runItem = await prisma.optimizationRunItem.create({
    data: {
      runId: run.id,
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      itemKey: `execution-item-${suffix}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date('2026-08-24T00:01:00.000Z')
    }
  });
  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: '兴善堂',
      domain: 'xingshantang.org',
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/culture/'],
      enabled: true
    }
  });
  const channel = await prisma.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/culture',
      displayName: '六壬文化',
      repositoryPathTemplate: 'content/culture/{slug}.md',
      contentType: 'ARTICLE',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      enabled: true
    }
  });
  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'machine execution fixture',
      createdBy: 'CONTROLLED_AUTOPILOT',
      sourceReferenceId: optimizationPlan.id,
      sourceSnapshotId: runItem.id
    }
  });
  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: '六壬伏英舘文化源流',
      slugCandidate: 'p9c-machine-execution',
      body: '# 六壬伏英舘文化源流\n\nBounded content.',
      excerpt: 'Bounded excerpt',
      metaTitle: '六壬伏英舘文化源流',
      metaDescription: 'Bounded description',
      canonicalCandidate: null,
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
      author: null,
      language: 'zh-CN',
      currentVersion: 2,
      currentContentHash: CONTENT_HASH,
      status: 'DRAFT',
      generatedBy: 'DEEPSEEK'
    }
  });
  await prisma.contentDraftVersion.create({
    data: {
      draftId: draft.id,
      version: 2,
      title: draft.title,
      slugCandidate: draft.slugCandidate,
      body: draft.body,
      excerpt: draft.excerpt,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      canonicalCandidate: null,
      schemaJson: draft.schemaJson!,
      author: null,
      language: draft.language,
      contentHash: CONTENT_HASH,
      generatedBy: 'DEEPSEEK'
    }
  });
  const plan = await prisma.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 2,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: 'https://xingshantang.org/culture/p9c-machine-execution',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: BASE_SHA,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: PATH,
        targetUrl: 'https://xingshantang.org/culture/p9c-machine-execution',
        contentHash: CONTENT_HASH,
        content: draft.body,
        title: draft.title,
        excerpt: draft.excerpt,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
        canonicalCandidate: null,
        schemaJson: draft.schemaJson,
        author: null,
        language: draft.language
      }],
      expectedOutcomes: {
        publicUrl: 'https://xingshantang.org/culture/p9c-machine-execution',
        indexable: true
      },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: PLAN_HASH
    }
  });
  const preview = await prisma.publicationPreview.create({
    data: {
      projectId: project.id,
      planId: plan.id,
      previewHash: PREVIEW_HASH,
      diffSummary: '1 created, 0 modified, 0 deleted',
      diffPayload: {
        filesCreated: [PATH],
        filesModified: [],
        filesDeleted: [],
        operations: plan.operations,
        unifiedDiff: `--- /dev/null\n+++ ${PATH}\n+bounded`,
        expectedOutcomes: plan.expectedOutcomes,
        baseSha: BASE_SHA,
        targetBlobHashes: {},
        riskClass: 'LOW',
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        planHash: PLAN_HASH
      },
      validationResult: {
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        findings: [],
        blockingCodes: [],
        warningCodes: [],
        infoCodes: [],
        unconfirmedWarningCodes: [],
        canCreatePlan: true
      }
    }
  });
  const policy = await prisma.autopilotPolicy.create({
    data: {
      projectId: project.id,
      enabled: true,
      policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      allowedRiskClass: 'LOW',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      dailyDraftPrLimit: 3,
      maxConcurrentRuns: 1,
      requireFreshEvidence: true,
      minimumEvidenceCoverage: 70,
      pauseOnVerificationFailure: true,
      killSwitch: false,
      enabledBy: 'fixture',
      enabledAt: new Date(),
      updatedBy: 'fixture'
    }
  });
  const decision = await prisma.optimizationAutopilotDecision.create({
    data: {
      projectId: project.id,
      runId: run.id,
      runItemId: runItem.id,
      optimizationPlanId: optimizationPlan.id,
      policyId: policy.id,
      policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      policySnapshot,
      sourceSnapshot: {
        publicationPlanId: plan.id,
        publicationPlanHash: PLAN_HASH,
        publicationPreviewId: preview.id,
        publicationPreviewHash: PREVIEW_HASH,
        publicationRiskClass: 'LOW',
        publicationBaseSha: BASE_SHA,
        publicationTargetRepository: plan.targetRepository,
        publicationTargetBranch: plan.targetBranch,
        publicationOperationTypes: ['CREATE_CONTENT_PAGE']
      },
      status: 'AUTOPILOT_READY',
      reasonCodes: [],
      p8PlanId: plan.id,
      p8PreviewId: preview.id,
      decisionKey: randomUUID()
    }
  });
  const utcDate = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const reservation = await prisma.autopilotExecutionReservation.create({
    data: {
      projectId: project.id,
      decisionId: decision.id,
      utcDate,
      reservationKey: `execution-${decision.id}`,
      status: 'RESERVED'
    }
  });
  const authorization = await authorizePublicationAutomation({
    projectId: project.id,
    planId: plan.id,
    decisionId: decision.id,
    reservationId: reservation.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000)
  });

  return { project, plan, authorization };
}

beforeEach(() => {
  process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = 'false';
});

afterEach(() => {
  if (ORIGINAL_GLOBAL_KILL_SWITCH === undefined) {
    delete process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;
  } else {
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = ORIGINAL_GLOBAL_KILL_SWITCH;
  }
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
});

describe('P9-C typed machine publication execution', () => {
  it('creates one machine-only execution with a domain-separated V2 key', async () => {
    const fixture = await createFixture();
    const service = new PublicationExecutionService();

    const first = await service.createAutomationAuthorizedExecution({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      automationAuthorizationId: fixture.authorization.id
    });
    const second = await service.createAutomationAuthorizedExecution({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      automationAuthorizationId: fixture.authorization.id
    });

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      approvalId: null,
      automationAuthorizationId: fixture.authorization.id,
      status: 'AUTOMATION_AUTHORIZED'
    });
    expect(first.executionKey).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.publicationExecution.count({
      where: { automationAuthorizationId: fixture.authorization.id }
    })).toBe(1);
  });

  it('runs AUTOMATION_AUTHORIZED -> QUEUED -> EXECUTING -> PR_CREATED through the existing worker and is duplicate-safe', async () => {
    const fixture = await createFixture();
    const service = new PublicationExecutionService();
    const execution = await service.createAutomationAuthorizedExecution({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      automationAuthorizationId: fixture.authorization.id
    });
    const adapter = new IntegrationAdapter();
    const job = { name: 'execute', data: { executionId: execution.id } };
    const deps = { resolveAdapter: () => adapter, emit: () => undefined };

    await processPublicationExecutionJob(job, deps);

    const stored = await prisma.publicationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(stored.status).toBe('PR_CREATED');
    expect(stored.approvalId).toBeNull();
    expect(stored.automationAuthorizationId).toBe(fixture.authorization.id);
    const events = await prisma.publicationExecutionEvent.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(events.map((event) => [event.fromStatus, event.toStatus, event.eventType])).toEqual([
      ['AUTOMATION_AUTHORIZED', 'QUEUED', 'QUEUED'],
      ['QUEUED', 'EXECUTING', 'STARTED'],
      ['EXECUTING', 'PR_CREATED', 'PR_CREATED']
    ]);
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);

    await processPublicationExecutionJob(job, deps);
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);
    expect(await prisma.publicationExecutionEvent.count({ where: { executionId: execution.id } })).toBe(3);
  });

  it('rechecks the global kill switch before adapter resolution for machine execution', async () => {
    const fixture = await createFixture();
    const service = new PublicationExecutionService();
    const execution = await service.createAutomationAuthorizedExecution({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      automationAuthorizationId: fixture.authorization.id
    });
    const adapter = new IntegrationAdapter();
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = 'true';

    await expect(processPublicationExecutionJob(
      { name: 'execute', data: { executionId: execution.id } },
      { resolveAdapter: () => adapter, emit: () => undefined }
    )).rejects.toMatchObject({ code: 'AUTOMATION_KILL_SWITCH_ACTIVE' });
    expect(adapter.reads).toBe(0);
    expect(adapter.applies).toBe(0);
  });

  it('blocks live target drift before machine apply', async () => {
    const fixture = await createFixture();
    const service = new PublicationExecutionService();
    const execution = await service.createAutomationAuthorizedExecution({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      automationAuthorizationId: fixture.authorization.id
    });
    const adapter = new IntegrationAdapter();
    adapter.headSha = '9999999999999999999999999999999999999999';

    await expect(processPublicationExecutionJob(
      { name: 'execute', data: { executionId: execution.id } },
      { resolveAdapter: () => adapter, emit: () => undefined }
    )).rejects.toMatchObject({ code: 'TARGET_REVISION_CHANGED' });
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(0);
  });
});
