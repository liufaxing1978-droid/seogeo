import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { hashCanonicalJson } from '../../src/modules/optimization-autopilot/autopilot.identity.js';
import {
  assertAutomationAuthorizationCurrent,
  authorizePublicationAutomation
} from '../../src/modules/publication/publication-automation-authorization.js';

const ORIGINAL_GLOBAL_KILL_SWITCH = process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;

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

type FixtureOptions = {
  riskClass?: 'LOW' | 'MEDIUM';
  warningCodes?: string[];
  decisionStatus?: 'AUTOPILOT_READY' | 'P8_PREPARATION_REQUIRED';
  reservationStatus?: 'RESERVED' | 'RELEASED';
  projectKillSwitch?: boolean;
  sourceSnapshotPlanHash?: string;
};

async function createFixture(options: FixtureOptions = {}) {
  const suffix = `${Date.now()}-${Math.random()}`.replace('.', '-');
  const contentHash = 'a'.repeat(64);
  const planHash = 'b'.repeat(64);
  const previewHash = 'c'.repeat(64);
  const baseSha = 'd'.repeat(40);
  const project = await prisma.project.create({
    data: {
      name: `P9-C auth ${suffix}`,
      slug: `p9c-auth-${suffix}`,
      primaryDomain: `p9c-auth-${suffix}.example.com`,
      planLevel: 'ADVANCED',
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });

  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `auth-identity-${suffix}`,
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
  const growthEvidence = await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: growthSnapshot.id,
      projectId: project.id,
      sourceModule: 'P5_CONTENT',
      sourceType: 'FIXTURE_FACT',
      sourceId: `auth-source-${suffix}`,
      sourceFactVersion: 'FACT_V1',
      ruleKey: 'new-content-gap',
      rootCauseKey: 'content-gap',
      evidenceState: 'PASS',
      severity: 'MEDIUM',
      textSummary: 'bounded authorization fixture evidence',
      fingerprint: `auth-fingerprint-${suffix}`
    }
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `p9cauth${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24)}`,
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
        { type: 'GROWTH_OPPORTUNITY_EVIDENCE', id: growthEvidence.id }
      ],
      deterministicRank: 10,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 10,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { summary: 'bounded authorization fixture plan' }
    }
  });
  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: `auth-run-${suffix}`,
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
      itemKey: `auth-item-${suffix}`,
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
      reason: 'authorization fixture',
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
      slugCandidate: 'liuren-culture',
      body: '# 六壬伏英舘文化源流\n\nBounded content.',
      excerpt: 'Bounded excerpt',
      metaTitle: '六壬伏英舘文化源流',
      metaDescription: 'Bounded description',
      canonicalCandidate: null,
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
      author: null,
      language: 'zh-CN',
      currentVersion: 2,
      currentContentHash: contentHash,
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
      canonicalCandidate: draft.canonicalCandidate,
      schemaJson: draft.schemaJson!,
      author: draft.author,
      language: draft.language,
      contentHash,
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
      targetPublicUrl: 'https://xingshantang.org/culture/liuren-culture',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: 'content/culture/liuren-culture.md',
        targetUrl: 'https://xingshantang.org/culture/liuren-culture',
        contentHash,
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
        publicUrl: 'https://xingshantang.org/culture/liuren-culture',
        indexable: true
      },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: options.riskClass ?? 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash
    }
  });
  const warnings = options.warningCodes ?? [];
  const preview = await prisma.publicationPreview.create({
    data: {
      projectId: project.id,
      planId: plan.id,
      previewHash,
      diffSummary: '1 created, 0 modified, 0 deleted',
      diffPayload: {
        filesCreated: ['content/culture/liuren-culture.md'],
        filesModified: [],
        filesDeleted: [],
        operations: plan.operations,
        unifiedDiff: '--- /dev/null\n+++ content/culture/liuren-culture.md\n+bounded',
        expectedOutcomes: plan.expectedOutcomes,
        baseSha,
        targetBlobHashes: {},
        riskClass: options.riskClass ?? 'LOW',
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        planHash
      },
      validationResult: {
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        findings: warnings.map((code) => ({ severity: 'WARNING', code, message: code })),
        blockingCodes: [],
        warningCodes: warnings,
        infoCodes: [],
        unconfirmedWarningCodes: warnings,
        canCreatePlan: warnings.length === 0
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
      killSwitch: options.projectKillSwitch ?? false,
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
        publicationPlanHash: options.sourceSnapshotPlanHash ?? planHash,
        publicationPreviewId: preview.id,
        publicationPreviewHash: previewHash,
        publicationRiskClass: options.riskClass ?? 'LOW',
        publicationBaseSha: baseSha,
        publicationTargetRepository: plan.targetRepository,
        publicationTargetBranch: plan.targetBranch,
        publicationOperationTypes: ['CREATE_CONTENT_PAGE']
      },
      status: options.decisionStatus ?? 'AUTOPILOT_READY',
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
      reservationKey: `auth-${decision.id}`,
      status: options.reservationStatus ?? 'RESERVED',
      releasedAt: options.reservationStatus === 'RELEASED' ? new Date() : null
    }
  });

  return {
    project,
    identity,
    growthSnapshot,
    growthEvidence,
    candidate,
    optimizationPlan,
    run,
    runItem,
    site,
    channel,
    proposal,
    draft,
    plan,
    preview,
    policy,
    decision,
    reservation,
    contentHash,
    planHash,
    previewHash,
    baseSha
  };
}

function authorizeInput(fixture: Awaited<ReturnType<typeof createFixture>>, expiresAt?: Date) {
  return {
    projectId: fixture.project.id,
    planId: fixture.plan.id,
    decisionId: fixture.decision.id,
    reservationId: fixture.reservation.id,
    expiresAt: expiresAt ?? new Date(Date.now() + 60 * 60 * 1000)
  };
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

describe('P9-C immutable P8 machine authorization', () => {
  it('creates and reuses one machine-only authorization frozen to exact P8, decision, policy and reservation facts', async () => {
    const fixture = await createFixture();
    const input = authorizeInput(fixture);

    const first = await authorizePublicationAutomation(input);
    const second = await authorizePublicationAutomation(input);

    expect(second.id).toBe(first.id);
    expect(await prisma.publicationAutomationAuthorization.count({
      where: { automationDecisionId: fixture.decision.id }
    })).toBe(1);
    expect(first).toMatchObject({
      projectId: fixture.project.id,
      planId: fixture.plan.id,
      planVersion: 1,
      planHash: fixture.planHash,
      contentVersion: 2,
      contentHash: fixture.contentHash,
      previewHash: fixture.previewHash,
      baseSha: fixture.baseSha,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      targetBlobHashes: {},
      authorizedRiskClass: 'LOW',
      automationDecisionId: fixture.decision.id,
      automationPolicyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      automationPolicyHash: hashCanonicalJson(policySnapshot),
      automationSource: 'CONTROLLED_AUTOPILOT'
    });
    expect('approverActorId' in first).toBe(false);
    expect('confirmedWarningCodes' in first).toBe(false);
  });

  it.each([
    ['MEDIUM plan', { riskClass: 'MEDIUM' as const }],
    ['preview warning', { warningCodes: ['SOURCE_GAP'] }],
    ['non-ready decision', { decisionStatus: 'P8_PREPARATION_REQUIRED' as const }],
    ['released reservation', { reservationStatus: 'RELEASED' as const }],
    ['project kill switch', { projectKillSwitch: true }],
    ['decision source snapshot drift', { sourceSnapshotPlanHash: 'e'.repeat(64) }]
  ])('fails closed for %s', async (_label, options) => {
    const fixture = await createFixture(options);
    await expect(authorizePublicationAutomation(authorizeInput(fixture))).rejects.toThrow();
    expect(await prisma.publicationAutomationAuthorization.count({
      where: { automationDecisionId: fixture.decision.id }
    })).toBe(0);
  });

  it('fails closed when the global kill switch is not explicitly OFF', async () => {
    const fixture = await createFixture();
    delete process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH;

    await expect(authorizePublicationAutomation(authorizeInput(fixture))).rejects.toThrow();
    expect(await prisma.publicationAutomationAuthorization.count({
      where: { automationDecisionId: fixture.decision.id }
    })).toBe(0);
  });

  it('requires future expiry and rejects stale authorization before any adapter work', async () => {
    const fixture = await createFixture();
    await expect(authorizePublicationAutomation({
      ...authorizeInput(fixture),
      expiresAt: new Date(Date.now() - 1_000)
    })).rejects.toThrow();

    const expiresAt = new Date(Date.now() + 60_000);
    const authorization = await authorizePublicationAutomation(authorizeInput(fixture, expiresAt));
    const adapterWork = vi.fn();
    const invoke = () => {
      assertAutomationAuthorizationCurrent({
        authorization,
        plan: fixture.plan,
        preview: fixture.preview,
        decision: fixture.decision,
        policy: fixture.policy,
        reservation: fixture.reservation,
        liveTarget: {
          repositoryIdentity: fixture.plan.targetRepository,
          branch: fixture.plan.targetBranch,
          headSha: fixture.plan.baseSha,
          files: {}
        },
        globalKillSwitch: false,
        now: new Date(expiresAt.getTime() + 1)
      });
      adapterWork();
    };

    expect(invoke).toThrow();
    expect(adapterWork).not.toHaveBeenCalled();
  });

  it('rejects live target drift before adapter work', async () => {
    const fixture = await createFixture();
    const authorization = await authorizePublicationAutomation(authorizeInput(fixture));
    const adapterWork = vi.fn();
    const invoke = () => {
      assertAutomationAuthorizationCurrent({
        authorization,
        plan: fixture.plan,
        preview: fixture.preview,
        decision: fixture.decision,
        policy: fixture.policy,
        reservation: fixture.reservation,
        liveTarget: {
          repositoryIdentity: fixture.plan.targetRepository,
          branch: fixture.plan.targetBranch,
          headSha: 'f'.repeat(40),
          files: {}
        },
        globalKillSwitch: false,
        now: new Date()
      });
      adapterWork();
    };

    expect(invoke).toThrow();
    expect(adapterWork).not.toHaveBeenCalled();
  });

  it('keeps the machine authorization row database-immutable', async () => {
    const fixture = await createFixture();
    const authorization = await authorizePublicationAutomation(authorizeInput(fixture));

    await expect(prisma.publicationAutomationAuthorization.update({
      where: { id: authorization.id },
      data: { planHash: '0'.repeat(64) }
    })).rejects.toThrow();
  });
});
