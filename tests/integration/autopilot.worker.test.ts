import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationAutopilotRepository } from '../../src/modules/optimization-autopilot/autopilot.repository.js';
import { processOptimizationAutopilotJob } from '../../src/modules/optimization-autopilot/autopilot.worker.js';
import { authorizePublicationAutomation } from '../../src/modules/publication/publication-automation-authorization.js';
import { PublicationExecutionService } from '../../src/modules/publication/publication-execution.service.js';
import { processPublicationExecutionJob } from '../../src/modules/publication/publication-execution.worker.js';
import type { MutationAdapter, MutationPreview, TargetRef } from '../../src/modules/publication/mutation-adapter.js';

const ORIGINAL_GLOBAL_KILL_SWITCH = process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;
const NOW = new Date('2026-08-24T03:30:00.000Z');
const BASE_SHA = '1111111111111111111111111111111111111111';
const CONTENT_HASH = 'c'.repeat(64);
const PLAN_HASH = 'a'.repeat(64);
const PREVIEW_HASH = 'b'.repeat(64);
const PATH = 'content/culture/p9c-worker.md';

class DraftPrAdapter implements MutationAdapter {
  readonly capability = 'DRAFT_PR' as const;
  reads = 0;
  applies = 0;

  async readTargetSnapshot(input: TargetRef) {
    this.reads += 1;
    return {
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch,
      headSha: BASE_SHA,
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
      branchName: 'seogeo/p9c/worker-aaaaaaaaaaaa',
      commitSha: '2'.repeat(40),
      pullRequestNo: 201,
      pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/201'
    };
  }

  async readExecutionState() {
    return { status: 'PENDING' as const, remoteStateKnown: false };
  }

  async rollback() {
    return { status: 'READY' as const, strategy: 'REVERT_COMMIT', remoteWritePerformed: false };
  }
}

async function createReadyFixture(planLevel: 'STANDARD' | 'ADVANCED' = 'ADVANCED') {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `P9-C worker ${suffix}`,
      slug: `p9c-worker-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel,
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `worker:${suffix}`,
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
      sourceId: `worker-source-${suffix}`,
      sourceFactVersion: 'FACT_V1',
      ruleKey: 'content-gap',
      rootCauseKey: 'content-gap',
      evidenceState: 'PASS',
      severity: 'MEDIUM',
      textSummary: 'bounded worker fixture evidence',
      fingerprint: `worker-fingerprint-${suffix}`
    }
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `p9cworker${suffix.replace(/-/g, '').slice(0, 20)}`,
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
      explanation: { summary: 'bounded worker fixture plan' }
    }
  });
  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: `worker-run-${suffix}`,
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
      itemKey: `worker-item-${suffix}`,
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
      reason: 'worker fixture',
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
      slugCandidate: 'p9c-worker',
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
  const publicationPlan = await prisma.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 2,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: 'https://xingshantang.org/culture/p9c-worker',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: BASE_SHA,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: PATH,
        targetUrl: 'https://xingshantang.org/culture/p9c-worker',
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
        publicUrl: 'https://xingshantang.org/culture/p9c-worker',
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
      planId: publicationPlan.id,
      previewHash: PREVIEW_HASH,
      diffSummary: '1 created, 0 modified, 0 deleted',
      diffPayload: {
        filesCreated: [PATH],
        filesModified: [],
        filesDeleted: [],
        operations: publicationPlan.operations,
        unifiedDiff: `--- /dev/null\n+++ ${PATH}\n+bounded`,
        expectedOutcomes: publicationPlan.expectedOutcomes,
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
      enabledAt: NOW,
      updatedBy: 'fixture'
    }
  });
  return { project, identity, growthSnapshot, candidate, optimizationPlan, run, runItem, publicationPlan, preview, policy };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = 'false';
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_GLOBAL_KILL_SWITCH === undefined) delete process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;
  else process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = ORIGINAL_GLOBAL_KILL_SWITCH;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
});

describe('P9-C full controlled autopilot worker', () => {
  it('hands one exact ready item to the existing P8 worker exactly once and keeps CONSUMED capacity executable', async () => {
    const fixture = await createReadyFixture();
    const logicalJobs = new Map<string, { name: string; data: unknown }>();
    const executionQueue = {
      add: async (name: string, data: unknown, options: { jobId?: string }) => {
        const jobId = String(options.jobId ?? `${name}:${logicalJobs.size}`);
        logicalJobs.set(jobId, { name, data });
      }
    };
    const deps = {
      repository: new OptimizationAutopilotRepository(),
      queue: { enqueueRunItem: async () => undefined },
      preparation: { prepareContentCreation: async () => { throw new Error('P8 preparation should not run for exact-ready fixture'); } },
      authorizePublicationAutomation,
      executionService: new PublicationExecutionService(),
      executionQueue,
      now: () => NOW,
      emit: () => undefined
    };
    const job = {
      name: 'evaluate-run-item',
      data: { kind: 'EVALUATE_RUN_ITEM' as const, runItemId: fixture.runItem.id, projectId: fixture.project.id }
    };

    await processOptimizationAutopilotJob(job, deps);
    await processOptimizationAutopilotJob(job, deps);

    const decisions = await prisma.optimizationAutopilotDecision.findMany({
      where: { projectId: fixture.project.id, runItemId: fixture.runItem.id, status: 'AUTOPILOT_READY' }
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      p8PlanId: fixture.publicationPlan.id,
      p8PreviewId: fixture.preview.id,
      policyId: fixture.policy.id
    });

    const reservation = await prisma.autopilotExecutionReservation.findUniqueOrThrow({
      where: { decisionId: decisions[0]!.id }
    });
    expect(reservation.status).toBe('CONSUMED');
    expect(reservation.utcDate.toISOString().slice(0, 10)).toBe('2026-08-24');

    const authorization = await prisma.publicationAutomationAuthorization.findUniqueOrThrow({
      where: { automationDecisionId: decisions[0]!.id }
    });
    const executions = await prisma.publicationExecution.findMany({
      where: { automationAuthorizationId: authorization.id }
    });
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      approvalId: null,
      status: 'AUTOMATION_AUTHORIZED',
      planId: fixture.publicationPlan.id
    });
    expect(logicalJobs.size).toBe(1);
    expect([...logicalJobs.values()][0]).toMatchObject({
      name: 'execute',
      data: { executionId: executions[0]!.id }
    });

    const adapter = new DraftPrAdapter();
    await processPublicationExecutionJob(
      { name: 'execute', data: { executionId: executions[0]!.id } },
      { resolveAdapter: () => adapter, emit: () => undefined, now: () => NOW }
    );
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: executions[0]!.id } })).status).toBe('PR_CREATED');
  });

  it('fails closed for Standard entitlement before creating machine authorization or execution', async () => {
    const fixture = await createReadyFixture('STANDARD');
    const deps = {
      repository: new OptimizationAutopilotRepository(),
      queue: { enqueueRunItem: async () => undefined },
      preparation: { prepareContentCreation: async () => { throw new Error('restricted P8 preparation must not run'); } },
      authorizePublicationAutomation,
      executionService: new PublicationExecutionService(),
      executionQueue: { add: async () => { throw new Error('execution queue must not run'); } },
      now: () => NOW,
      emit: () => undefined
    };

    await processOptimizationAutopilotJob({
      name: 'evaluate-run-item',
      data: { kind: 'EVALUATE_RUN_ITEM', runItemId: fixture.runItem.id, projectId: fixture.project.id }
    }, deps);

    expect(await prisma.publicationAutomationAuthorization.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.publicationExecution.count({ where: { projectId: fixture.project.id, automationAuthorizationId: { not: null } } })).toBe(0);
  });

  it('rechecks the global kill switch immediately before machine authorization and enqueue', async () => {
    const fixture = await createReadyFixture();
    let authorizationCalls = 0;
    const deps = {
      repository: new OptimizationAutopilotRepository(),
      queue: { enqueueRunItem: async () => undefined },
      preparation: { prepareContentCreation: async () => { throw new Error('P8 preparation should not run'); } },
      authorizePublicationAutomation: async (...args: Parameters<typeof authorizePublicationAutomation>) => {
        authorizationCalls += 1;
        return authorizePublicationAutomation(...args);
      },
      executionService: new PublicationExecutionService(),
      executionQueue: { add: async () => { throw new Error('execution queue must not run'); } },
      now: () => NOW,
      beforeMachineAuthorization: () => {
        process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH = 'true';
      },
      emit: () => undefined
    };

    await processOptimizationAutopilotJob({
      name: 'evaluate-run-item',
      data: { kind: 'EVALUATE_RUN_ITEM', runItemId: fixture.runItem.id, projectId: fixture.project.id }
    }, deps);

    expect(authorizationCalls).toBe(0);
    expect(await prisma.publicationAutomationAuthorization.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.publicationExecution.count({ where: { projectId: fixture.project.id, automationAuthorizationId: { not: null } } })).toBe(0);
  });
});
