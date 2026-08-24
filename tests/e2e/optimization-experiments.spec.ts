import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';

const prisma = new PrismaClient();

async function seedEvaluatedExperiment() {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/optimized-page`;
  const project = await prisma.project.create({
    data: {
      name: 'P9-D Experiment Browser Smoke',
      slug: `p9-d-experiment-browser-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const growthIdentity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '兴善堂 六壬文化',
      canonicalPage: targetUrl,
      identityPayload: { fixture: true }
    }
  });

  const growthSnapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-04-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-04-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-03-04T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-03-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-04-29T00:00:00.000Z'),
      primaryType: 'CTR_UNDERPERFORMANCE',
      secondaryTypes: [],
      score: 88,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { fixture: true }
    }
  });

  const candidate = await prisma.optimizationCandidate.create({
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
      normalizedQuery: '兴善堂 六壬文化',
      canonicalPage: targetUrl,
      growthScore: 88,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { fixture: true },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const optimizationPlan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'ON_PAGE_OPTIMIZATION',
      sourceFactReferences: ['search-fact:browser-smoke'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });

  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-D browser fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });

  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D browser fixture',
      body: 'persisted browser fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });

  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D browser fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });

  const channel = await prisma.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/optimized-page',
      displayName: 'Optimized page'
    }
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
      targetPublicUrl: targetUrl,
      targetRepository: 'fixture/repository',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      operations: [{ type: 'UPDATE_CONTENT_PAGE', path: '/optimized-page' }],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'b'.repeat(64)
    }
  });

  const approval = await prisma.publicationApproval.create({
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
      approverActorId: 'p9-d-e2e',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    }
  });

  const execution = await prisma.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${suffix}`,
      status: 'VERIFIED'
    }
  });

  const verifiedAnchorAt = new Date('2026-05-01T00:00:00.000Z');
  const verification = await prisma.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: verifiedAnchorAt
    }
  });

  const experiment = await prisma.optimizationExperiment.create({
    data: {
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      publicationExecutionId: execution.id,
      publicationVerificationId: verification.id,
      experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1',
      experimentKey: `experiment:${suffix}`,
      interventionType: 'ON_PAGE_OPTIMIZATION',
      targetUrl,
      marketCode: 'HK',
      locale: 'zh-Hant',
      verifiedAnchorAt,
      measurementScopeJson: {
        kind: 'SEARCH',
        provider: 'GOOGLE_SEARCH_CONSOLE',
        normalizedQuery: '兴善堂 六壬文化',
        canonicalPage: targetUrl
      },
      observationScheduleJson: [
        { windowType: '14D', windowDays: 14 },
        { windowType: '28D', windowDays: 28 },
        { windowType: '56D', windowDays: 56 }
      ],
      expectedDirectionJson: { clicks: 'HIGHER' }
    }
  });

  const observations = [
    {
      windowType: '14D',
      windowDays: 14,
      dueAt: new Date('2026-05-15T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-05-15T12:00:00.000Z'),
      effectState: 'POSITIVE' as const,
      reasonCodes: ['PRIMARY_METRIC_IMPROVED'],
      baseline: { clicksPerDay: 10, impressionsPerDay: 200 },
      observed: { clicksPerDay: 12, impressionsPerDay: 210 },
      delta: { clicksRelative: 0.2 }
    },
    {
      windowType: '28D',
      windowDays: 28,
      dueAt: new Date('2026-05-29T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-05-29T12:00:00.000Z'),
      effectState: 'NEUTRAL' as const,
      reasonCodes: ['PRIMARY_METRIC_WITHIN_NEUTRAL_BAND'],
      baseline: { clicksPerDay: 10, impressionsPerDay: 200 },
      observed: { clicksPerDay: 10.2, impressionsPerDay: 202 },
      delta: { clicksRelative: 0.02 }
    },
    {
      windowType: '56D',
      windowDays: 56,
      dueAt: new Date('2026-06-26T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-06-26T12:00:00.000Z'),
      effectState: 'NEGATIVE' as const,
      reasonCodes: ['PRIMARY_METRIC_DECLINED'],
      baseline: { clicksPerDay: 10, impressionsPerDay: 200 },
      observed: { clicksPerDay: 9, impressionsPerDay: 195 },
      delta: { clicksRelative: -0.1 }
    }
  ];

  for (const observation of observations) {
    await prisma.optimizationExperimentObservation.create({
      data: {
        projectId: project.id,
        experimentId: experiment.id,
        observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
        observationKey: `observation:${suffix}:${observation.windowType}`,
        windowType: observation.windowType,
        windowDays: observation.windowDays,
        dueAt: observation.dueAt,
        inputCutoffAt: observation.inputCutoffAt,
        baselineSearchSourceRefs: [`search-baseline:${observation.windowType}`],
        observedSearchSourceRefs: [`search-observed:${observation.windowType}`],
        baselineVisibilitySourceRefs: [],
        observedVisibilitySourceRefs: [],
        baselineMetricsJson: observation.baseline,
        observedMetricsJson: observation.observed,
        deltaMetricsJson: observation.delta,
        coverageState: 'SUFFICIENT',
        contaminationState: 'CLEAR',
        effectState: observation.effectState,
        reasonCodes: observation.reasonCodes,
        evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
      }
    });
  }

  return { project, experiment, targetUrl };
}

test.afterAll(async () => {
  // P9-D experiment rows are intentionally immutable. The e2e database is disposable,
  // so append-only fixtures are left intact rather than bypassing immutability triggers.
  await prisma.$disconnect();
});

test('renders the persisted-read optimization experiment workspace without mutation controls', async ({ page }) => {
  const { project, experiment, targetUrl } = await seedEvaluatedExperiment();

  await page.goto(`/projects/${project.id}/growth/new-content`);
  const experimentLink = page.getByRole('link', { name: /优化实验/ });
  await expect(experimentLink).toBeVisible();
  await experimentLink.click();

  await expect(page.getByRole('heading', { level: 1, name: '优化实验', exact: true })).toBeVisible();
  await expect(page.getByText('EVALUATED', { exact: true })).toBeVisible();
  await expect(page.getByText(targetUrl, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: targetUrl, exact: true }).click();
  expect(page.url()).toContain(experiment.id);
  await expect(page.getByRole('heading', { level: 1, name: '优化实验详情', exact: true })).toBeVisible();
  await expect(page.getByText('观察关联，不代表因果关系', { exact: true })).toBeVisible();

  for (const window of ['14D', '28D', '56D']) {
    await expect(page.getByText(window, { exact: true })).toBeVisible();
  }
  for (const effect of ['POSITIVE', 'NEUTRAL', 'NEGATIVE']) {
    await expect(page.getByText(effect, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('SUFFICIENT', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('CLEAR', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('OPTIMIZATION_EXPERIMENT_EVALUATOR_V1', { exact: true }).first()).toBeVisible();

  await expect(page.getByRole('button', { name: /启动|评估|发布|合并|部署|回滚/ })).toHaveCount(0);
});

test('denies the optimization experiment web workspace to STANDARD projects', async ({ page }) => {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: 'P9-D Standard Browser Denial',
      slug: `p9-d-standard-browser-${suffix}`,
      primaryDomain: `p9-d-standard-browser-${suffix}.example.com`,
      planLevel: 'STANDARD'
    }
  });

  const response = await page.goto(`/projects/${project.id}/optimization/experiments`);
  expect(response?.status()).toBe(403);
});
