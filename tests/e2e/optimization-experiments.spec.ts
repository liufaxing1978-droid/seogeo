import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';

const prisma = new PrismaClient();

type ExperimentFixtureKind = 'SEARCH' | 'VISIBILITY';

type SeededExperiment = Awaited<ReturnType<typeof seedEvaluatedExperiment>>;

async function seedEvaluatedExperiment(kind: ExperimentFixtureKind = 'SEARCH') {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/${kind === 'SEARCH' ? 'optimized-page' : 'visibility-page'}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-D ${kind} Browser Smoke`,
      slug: `p9-d-${kind.toLowerCase()}-browser-${suffix}`,
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
      identityPayload: { fixture: true, kind }
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
      sourceProvenance: { fixture: true, kind }
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
      sourceProvenance: { fixture: true, kind },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const optimizationPlan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: kind === 'SEARCH'
        ? 'ON_PAGE_OPTIMIZATION'
        : 'GEO_CITABILITY_IMPROVEMENT',
      sourceFactReferences: [kind === 'SEARCH' ? 'search-fact:browser-smoke' : 'visibility-fact:browser-smoke'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true, kind }
    }
  });

  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: `P9-D ${kind} browser fixture`,
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });

  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: `P9-D ${kind} browser fixture`,
      body: 'persisted browser fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });

  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: `P9-D ${kind} browser fixture`,
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });

  const channel = await prisma.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: kind === 'SEARCH' ? '/optimized-page' : '/visibility-page',
      displayName: kind === 'SEARCH' ? 'Optimized page' : 'Visibility page'
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
      operations: [{
        type: 'UPDATE_CONTENT_PAGE',
        path: kind === 'SEARCH' ? '/optimized-page' : '/visibility-page'
      }],
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
      interventionType: kind === 'SEARCH'
        ? 'ON_PAGE_OPTIMIZATION'
        : 'GEO_CITABILITY_IMPROVEMENT',
      targetUrl,
      marketCode: 'HK',
      locale: 'zh-Hant',
      verifiedAnchorAt,
      measurementScopeJson: kind === 'SEARCH'
        ? {
          kind: 'SEARCH',
          provider: 'GOOGLE_SEARCH_CONSOLE',
          marketCode: 'HK',
          locale: 'zh-Hant',
          propertyRef: `gsc:${suffix}`,
          normalizedQuery: '兴善堂 六壬文化',
          canonicalPage: targetUrl,
          aggregationScope: 'QUERY_PAGE'
        }
        : {
          kind: 'VISIBILITY',
          metricType: 'CITATION_RATE',
          subjectSetHash: `subject-set:${suffix}`,
          scopeHash: `scope:${suffix}`,
          formulaVersion: 'VISIBILITY_METRICS_V1',
          extractorVersion: 'VISIBILITY_EXTRACTION_V1',
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorType: 'OWNED_ROLLUP',
          actorKey: 'OWNED_ROLLUP'
        },
      observationScheduleJson: [
        { windowType: '14D', windowDays: 14 },
        { windowType: '28D', windowDays: 28 },
        { windowType: '56D', windowDays: 56 }
      ],
      expectedDirectionJson: kind === 'SEARCH'
        ? {
          CLICKS: 'HIGHER',
          GOOGLE_SEARCH_CONSOLE_POSITION: 'LOWER'
        }
        : { CITATION_RATE: 'HIGHER' }
    }
  });

  const observations = kind === 'SEARCH'
    ? [
      {
        windowType: '14D',
        windowDays: 14,
        dueAt: new Date('2026-05-15T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-05-15T12:00:00.000Z'),
        effectState: 'POSITIVE' as const,
        reasonCodes: ['PRIMARY_METRIC_IMPROVED'],
        baseline: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 10 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 5 }
        ],
        observed: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 12 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 4 }
        ],
        delta: [
          { metricKey: 'CLICKS', absoluteDelta: 2, relativeDelta: 0.2 },
          { metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', absoluteDelta: -1, relativeDelta: -0.2 }
        ]
      },
      {
        windowType: '28D',
        windowDays: 28,
        dueAt: new Date('2026-05-29T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-05-29T12:00:00.000Z'),
        effectState: 'NEUTRAL' as const,
        reasonCodes: ['PRIMARY_METRIC_WITHIN_NEUTRAL_BAND'],
        baseline: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 10 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 5 }
        ],
        observed: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 10.2 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 4.8 }
        ],
        delta: [
          { metricKey: 'CLICKS', absoluteDelta: 0.2, relativeDelta: 0.02 },
          { metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', absoluteDelta: -0.2, relativeDelta: -0.04 }
        ]
      },
      {
        windowType: '56D',
        windowDays: 56,
        dueAt: new Date('2026-06-26T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-06-26T12:00:00.000Z'),
        effectState: 'NEGATIVE' as const,
        reasonCodes: ['PRIMARY_METRIC_DECLINED'],
        baseline: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 10 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 5 }
        ],
        observed: [
          { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 9 },
          { family: 'SEARCH', metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', role: 'SECONDARY', direction: 'LOWER', value: 6 }
        ],
        delta: [
          { metricKey: 'CLICKS', absoluteDelta: -1, relativeDelta: -0.1 },
          { metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', absoluteDelta: 1, relativeDelta: 0.2 }
        ]
      }
    ]
    : [14, 28, 56].map((windowDays) => ({
      windowType: `${windowDays}D`,
      windowDays,
      dueAt: new Date(verifiedAnchorAt.getTime() + windowDays * 24 * 60 * 60 * 1000),
      inputCutoffAt: new Date(verifiedAnchorAt.getTime() + windowDays * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
      effectState: 'POSITIVE' as const,
      reasonCodes: ['PRIMARY_METRIC_IMPROVED'],
      baseline: [
        {
          family: 'VISIBILITY',
          metricKey: 'CITATION_RATE',
          role: 'PRIMARY',
          direction: 'HIGHER',
          value: 0.1,
          numerator: 2,
          denominator: 20
        }
      ],
      observed: [
        {
          family: 'VISIBILITY',
          metricKey: 'CITATION_RATE',
          role: 'PRIMARY',
          direction: 'HIGHER',
          value: 0.2,
          numerator: 4,
          denominator: 20
        }
      ],
      delta: [{ metricKey: 'CITATION_RATE', absoluteDelta: 0.1, relativeDelta: 1 }]
    }));

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
        baselineSearchSourceRefs: kind === 'SEARCH' ? [`search-baseline:${observation.windowType}`] : [],
        observedSearchSourceRefs: kind === 'SEARCH' ? [`search-observed:${observation.windowType}`] : [],
        baselineVisibilitySourceRefs: kind === 'VISIBILITY' ? [`visibility-baseline:${observation.windowType}`] : [],
        observedVisibilitySourceRefs: kind === 'VISIBILITY' ? [`visibility-observed:${observation.windowType}`] : [],
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

  return { project, experiment, execution, verification, targetUrl, suffix };
}

async function appendCurrent56DayObservation(input: {
  fixture: SeededExperiment;
  cutoffAt: Date;
  coverageState: 'SUFFICIENT' | 'INSUFFICIENT';
  contaminationState: 'CLEAR' | 'CONFLICTING_MUTATION';
  effectState: 'INCONCLUSIVE';
  reasonCodes: string[];
  baselineMetricsJson: object[];
  observedMetricsJson: object[];
}) {
  return prisma.optimizationExperimentObservation.create({
    data: {
      projectId: input.fixture.project.id,
      experimentId: input.fixture.experiment.id,
      observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
      observationKey: `observation:${input.fixture.suffix}:56D:${input.cutoffAt.toISOString()}`,
      windowType: '56D',
      windowDays: 56,
      dueAt: new Date('2026-06-26T00:00:00.000Z'),
      inputCutoffAt: input.cutoffAt,
      baselineSearchSourceRefs: [],
      observedSearchSourceRefs: ['search-observed:56D:late'],
      baselineVisibilitySourceRefs: [],
      observedVisibilitySourceRefs: [],
      baselineMetricsJson: input.baselineMetricsJson,
      observedMetricsJson: input.observedMetricsJson,
      deltaMetricsJson: [{ metricKey: 'CLICKS', absoluteDelta: null, relativeDelta: null }],
      coverageState: input.coverageState,
      contaminationState: input.contaminationState,
      effectState: input.effectState,
      reasonCodes: input.reasonCodes,
      evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
    }
  });
}

async function projectReadCounts(projectId: string) {
  const [experiments, observations, executions, verifications] = await Promise.all([
    prisma.optimizationExperiment.count({ where: { projectId } }),
    prisma.optimizationExperimentObservation.count({ where: { projectId } }),
    prisma.publicationExecution.count({ where: { projectId } }),
    prisma.publicationVerification.count({ where: { projectId } })
  ]);
  return { experiments, observations, executions, verifications };
}

test.afterAll(async () => {
  // P9-D experiment rows are intentionally immutable. The e2e database is disposable,
  // so append-only fixtures are left intact rather than bypassing immutability triggers.
  await prisma.$disconnect();
});

test('renders persisted experiments read-only and makes lower-is-better position semantics visible', async ({ page }) => {
  const fixture = await seedEvaluatedExperiment('SEARCH');

  await page.goto(`/projects/${fixture.project.id}/growth/new-content`);
  await expect(page.getByRole('heading', { level: 1, name: 'New Content Opportunities', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '优化运营', exact: true })).toHaveAttribute('aria-current', 'page');

  const before = await projectReadCounts(fixture.project.id);
  await page.goto(`/projects/${fixture.project.id}/optimization/experiments`);

  await expect(page.getByRole('heading', { level: 1, name: '优化实验', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '优化运营', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('EVALUATED', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.targetUrl, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: fixture.targetUrl, exact: true }).click();
  expect(page.url()).toContain(fixture.experiment.id);
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

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('GOOGLE_SEARCH_CONSOLE_POSITION');
  expect(bodyText).toContain('"LOWER"');
  await expect(page.getByRole('button', { name: /启动|评估|发布|合并|部署|回滚/ })).toHaveCount(0);

  expect(await projectReadCounts(fixture.project.id)).toEqual(before);
});

test('renders missing baseline as INCONCLUSIVE without manufacturing a zero baseline', async ({ page }) => {
  const fixture = await seedEvaluatedExperiment('SEARCH');
  await appendCurrent56DayObservation({
    fixture,
    cutoffAt: new Date('2026-07-01T12:00:00.000Z'),
    coverageState: 'INSUFFICIENT',
    contaminationState: 'CLEAR',
    effectState: 'INCONCLUSIVE',
    reasonCodes: ['NO_COMPARABLE_BASELINE', 'EXPERIMENT_COVERAGE_INSUFFICIENT'],
    baselineMetricsJson: [
      { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: null, zeroIsExplicit: false }
    ],
    observedMetricsJson: [
      { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 20 }
    ]
  });

  const response = await page.goto(`/projects/${fixture.project.id}/optimization/experiments/${fixture.experiment.id}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('INCONCLUSIVE', { exact: true }).first()).toBeVisible();

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('NO_COMPARABLE_BASELINE');
  expect(bodyText).toContain('"value":null');
  expect(bodyText).not.toContain('"value":0');
});

test('renders a conflicting mutation as a contaminated INCONCLUSIVE observation', async ({ page }) => {
  const fixture = await seedEvaluatedExperiment('SEARCH');
  await appendCurrent56DayObservation({
    fixture,
    cutoffAt: new Date('2026-07-02T12:00:00.000Z'),
    coverageState: 'SUFFICIENT',
    contaminationState: 'CONFLICTING_MUTATION',
    effectState: 'INCONCLUSIVE',
    reasonCodes: ['EXPERIMENT_CONFLICTING_PUBLICATION_EVENT', 'EXPERIMENT_CONTAMINATED'],
    baselineMetricsJson: [
      { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 10 }
    ],
    observedMetricsJson: [
      { family: 'SEARCH', metricKey: 'CLICKS', role: 'PRIMARY', direction: 'HIGHER', value: 12 }
    ]
  });

  const response = await page.goto(`/projects/${fixture.project.id}/optimization/experiments/${fixture.experiment.id}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText('CONTAMINATED', { exact: true })).toBeVisible();
  await expect(page.getByText('CONFLICTING_MUTATION', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('INCONCLUSIVE', { exact: true }).first()).toBeVisible();
});

test('shows visibility numerator and denominator coverage without fabricating a search rank', async ({ page }) => {
  const fixture = await seedEvaluatedExperiment('VISIBILITY');

  const response = await page.goto(`/projects/${fixture.project.id}/optimization/experiments/${fixture.experiment.id}`);
  expect(response?.status()).toBe(200);

  const bodyText = await page.locator('body').innerText();
  expect(bodyText).toContain('CITATION_RATE');
  expect(bodyText).toContain('"numerator":2');
  expect(bodyText).toContain('"denominator":20');
  expect(bodyText).toContain('"numerator":4');
  expect(bodyText).not.toContain('GOOGLE_SEARCH_CONSOLE_POSITION');
});

test('hides a cross-project experiment id', async ({ page }) => {
  const foreign = await seedEvaluatedExperiment('SEARCH');
  const suffix = randomUUID();
  const ownerProject = await prisma.project.create({
    data: {
      name: 'P9-D Cross Project Owner',
      slug: `p9-d-cross-project-owner-${suffix}`,
      primaryDomain: `p9-d-cross-project-owner-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const response = await page.goto(`/projects/${ownerProject.id}/optimization/experiments/${foreign.experiment.id}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText(foreign.targetUrl, { exact: true })).toHaveCount(0);
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