import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { PublicationAutomationPreparationService } from '../../src/modules/publication/publication-automation-preparation.js';

async function createReadyFixture() {
  const suffix = `${Date.now()}-${Math.random()}`.replace('.', '-');
  const project = await prisma.project.create({
    data: {
      name: `P9-C validation ${suffix}`,
      slug: `p9c-validation-${suffix}`,
      primaryDomain: `p9c-validation-${suffix}.example.com`,
      planLevel: 'ADVANCED',
      industry: 'Traditional Culture',
      defaultLanguage: 'zh-CN',
      targetCountry: 'US'
    }
  });
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `identity-${suffix}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: '六壬伏英舘文化源流',
      canonicalPage: null,
      identityPayload: { normalizedQuery: '六壬伏英舘文化源流' }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
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
      snapshotId: snapshot.id,
      projectId: project.id,
      sourceModule: 'P5_CONTENT',
      sourceType: 'FIXTURE_FACT',
      sourceId: `source-${suffix}`,
      sourceFactVersion: 'FACT_V1',
      ruleKey: 'content-gap',
      rootCauseKey: 'content-gap',
      evidenceState: 'PASS',
      severity: 'MEDIUM',
      textSummary: 'bounded fixture evidence',
      fingerprint: `fingerprint-${suffix}`
    }
  });
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `p9cvalidation${suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)}`,
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
        { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: snapshot.id },
        { type: 'GROWTH_OPPORTUNITY_EVIDENCE', id: evidence.id }
      ],
      deterministicRank: 10,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 10,
      advisoryContext: {},
      automationEligibility: true,
      explanation: { summary: 'bounded fixture plan' }
    }
  });
  const run = await prisma.optimizationRun.create({
    data: {
      projectId: project.id,
      runVersion: 'OPTIMIZATION_RUN_V1',
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: `run-${suffix}`,
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
      itemKey: `item-${suffix}`,
      currentStage: 'READY_FOR_POLICY',
      status: 'COMPLETED',
      completedAt: new Date('2026-08-24T00:01:00.000Z')
    }
  });
  return { project, candidate, optimizationPlan, runItem };
}

function briefContent(sourceRef: string) {
  return JSON.stringify({
    summary: 'Bounded P8 brief.',
    thesis: 'Preserve unresolved claims for deterministic validation.',
    outline: [{ heading: 'Background', purpose: 'Supported background only.', evidenceRefs: [sourceRef] }],
    evidenceNeeds: [
      { claim: 'Historical transmission detail needs a source.', status: 'NEEDS_SOURCE', sourceRefs: [] },
      { claim: 'Regional attribution remains uncertain.', status: 'UNCERTAIN', sourceRefs: [sourceRef] }
    ],
    seo: {
      primaryKeyword: '六壬伏英舘文化源流',
      secondaryKeywords: ['传统文化'],
      titleIdeas: ['六壬伏英舘文化源流'],
      metaDescriptionNotes: 'Keep claims bounded.'
    },
    geo: {
      answerTargets: ['What can the supplied references establish?'],
      entityNotes: ['Do not invent entities.'],
      citabilityNotes: ['Keep unresolved gaps explicit.']
    },
    caveats: ['Unsupported claims remain unresolved.'],
    sourceReferences: [sourceRef]
  });
}

function cleanBriefContent(sourceRef: string) {
  return JSON.stringify({
    summary: 'Bounded P8 brief with no unresolved evidence gaps.',
    thesis: 'Create only the source-backed page described by the supplied references.',
    outline: [{ heading: 'Background', purpose: 'Supported background only.', evidenceRefs: [sourceRef] }],
    evidenceNeeds: [],
    seo: {
      primaryKeyword: '六壬伏英舘文化源流',
      secondaryKeywords: ['传统文化'],
      titleIdeas: ['六壬伏英舘文化源流'],
      metaDescriptionNotes: 'Keep claims bounded.'
    },
    geo: {
      answerTargets: ['What can the supplied references establish?'],
      entityNotes: ['Do not invent entities.'],
      citabilityNotes: ['Keep all claims source-backed.']
    },
    caveats: [],
    sourceReferences: [sourceRef]
  });
}

function articleContent(sourceRef: string) {
  return JSON.stringify({
    title: '六壬伏英舘文化源流',
    body: '# 六壬伏英舘文化源流\n\nGenerated V2 content bounded to supplied references.',
    excerpt: '资料边界内的介绍。',
    metaDescription: '从可核资料边界介绍六壬伏英舘文化源流。',
    schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
    sourceReferences: [sourceRef],
    caveats: []
  });
}

async function materializeArticle(input: {
  service: PublicationAutomationPreparationService;
  projectId: string;
  runItemId: string;
  optimizationPlanId: string;
  decisionId: string;
  briefWithGaps: boolean;
}) {
  const request = {
    projectId: input.projectId,
    runItemId: input.runItemId,
    optimizationPlanId: input.optimizationPlanId,
    decisionId: input.decisionId
  };
  const seeded = await input.service.prepareContentCreation(request);
  const source = await prisma.contentSourceReference.findFirstOrThrow({
    where: { projectId: input.projectId, draftId: seeded.draftId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
  });
  const sourceRef = `CONTENT_SOURCE_REFERENCE:${source.id}`;
  const briefTask = await prisma.aiTask.findFirstOrThrow({
    where: { projectId: input.projectId, taskType: 'PUBLICATION_CONTENT_BRIEF' }
  });
  const briefGateway: AiCompletionGateway = {
    complete: vi.fn(async () => ({
      provider: 'DEEPSEEK' as const,
      model: 'deepseek-reasoner',
      responseId: `p9c-brief-${input.briefWithGaps ? 'gaps' : 'clean'}`,
      content: input.briefWithGaps ? briefContent(sourceRef) : cleanBriefContent(sourceRef),
      finishReason: 'stop',
      latencyMs: 10,
      usage: { promptTokens: 40, completionTokens: 30, totalTokens: 70, cacheHitTokens: 0, cacheMissTokens: 40, reasoningTokens: 10 }
    }))
  };
  await executeAiTask(briefTask.id, { repository: new AiRepository(), gateway: briefGateway });

  await input.service.prepareContentCreation(request);
  const articleTask = await prisma.aiTask.findFirstOrThrow({
    where: { projectId: input.projectId, taskType: 'PUBLICATION_ARTICLE_GENERATION' }
  });
  const articleGateway: AiCompletionGateway = {
    complete: vi.fn(async () => ({
      provider: 'DEEPSEEK' as const,
      model: 'deepseek-chat',
      responseId: 'p9c-article',
      content: articleContent(sourceRef),
      finishReason: 'stop',
      latencyMs: 10,
      usage: { promptTokens: 60, completionTokens: 50, totalTokens: 110, cacheHitTokens: 0, cacheMissTokens: 60, reasoningTokens: 0 }
    }))
  };
  await executeAiTask(articleTask.id, { repository: new AiRepository(), gateway: articleGateway });
  return { request, seeded };
}

async function createGitTarget(projectId: string) {
  const site = await prisma.publicationSite.create({
    data: {
      projectId,
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
  return { site, channel };
}

afterAll(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Project" CASCADE');
});

describe('P9-C P8 preparation validation gate', () => {
  it('turns completed-brief NEEDS_SOURCE/UNCERTAIN into SOURCE_GAP and never plans the generated V2', async () => {
    const fixture = await createReadyFixture();
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);
    const service = new PublicationAutomationPreparationService({ aiTaskService: taskService });
    const { request, seeded } = await materializeArticle({
      service,
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.optimizationPlan.id,
      decisionId: '11111111-1111-4111-8111-111111111111',
      briefWithGaps: true
    });

    const result = await service.prepareContentCreation(request);

    expect(result).toMatchObject({
      state: 'VALIDATION_BLOCKED',
      proposalId: seeded.proposalId,
      draftId: seeded.draftId,
      planId: null,
      previewId: null,
      reasonCode: 'SOURCE_GAP'
    });
    const draft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: seeded.draftId! } });
    expect(draft).toMatchObject({ currentVersion: 2, generatedBy: 'DEEPSEEK' });
    expect(await prisma.publicationPlan.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.publicationPreview.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('creates and reuses one LOW exact CREATE_CONTENT_PAGE plan and preview for the only eligible Git target', async () => {
    const fixture = await createReadyFixture();
    const { site, channel } = await createGitTarget(fixture.project.id);
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);
    const targetPort = {
      readTarget: vi.fn(async () => ({
        repositoryIdentity: 'liufaxing1978-droid/xingshantang',
        branch: 'main',
        headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        publicUrlExists: false,
        files: {}
      })),
      preview: vi.fn(async () => ({
        files: [{
          path: `content/culture/p9-${fixture.candidate.candidateKey.slice(0, 16)}.md`,
          change: 'CREATED' as const,
          oldBlobSha: null,
          newContentHash: 'preview-content-hash'
        }],
        unifiedDiff: '--- /dev/null\n+++ content/culture/new.md\n@@ -0,0 +1 @@\n+generated',
        validationResult: {
          blockingCodes: [],
          warningCodes: [],
          canCreatePlan: true
        }
      }))
    };
    const deps = { aiTaskService: taskService, targetPort };
    const service = new PublicationAutomationPreparationService(deps);
    const { request, seeded } = await materializeArticle({
      service,
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.optimizationPlan.id,
      decisionId: '22222222-2222-4222-8222-222222222222',
      briefWithGaps: false
    });

    const first = await service.prepareContentCreation(request);
    const second = await service.prepareContentCreation(request);

    expect(first).toMatchObject({
      state: 'P8_READY',
      proposalId: seeded.proposalId,
      draftId: seeded.draftId,
      planId: expect.any(String),
      previewId: expect.any(String),
      reasonCode: null
    });
    expect(second).toEqual(first);
    expect('apply' in targetPort).toBe(false);
    expect(targetPort.readTarget).toHaveBeenCalledTimes(1);
    expect(targetPort.preview).toHaveBeenCalledTimes(1);

    const plans = await prisma.publicationPlan.findMany({ where: { projectId: fixture.project.id } });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      id: first.planId,
      proposalId: seeded.proposalId,
      draftId: seeded.draftId,
      draftVersion: 2,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: `https://xingshantang.org/culture/p9-${fixture.candidate.candidateKey.slice(0, 16)}`,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      riskClass: 'LOW'
    });
    expect(plans[0]?.operations).toEqual([
      expect.objectContaining({
        type: 'CREATE_CONTENT_PAGE',
        path: `content/culture/p9-${fixture.candidate.candidateKey.slice(0, 16)}.md`,
        targetUrl: `https://xingshantang.org/culture/p9-${fixture.candidate.candidateKey.slice(0, 16)}`
      })
    ]);

    const previews = await prisma.publicationPreview.findMany({ where: { projectId: fixture.project.id } });
    expect(previews).toHaveLength(1);
    expect(previews[0]).toMatchObject({ id: first.previewId, planId: first.planId });
    expect(previews[0]?.validationResult).toMatchObject({
      blockingCodes: [],
      warningCodes: [],
      canCreatePlan: true
    });
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('keeps a clean generated V2 manual when more than one eligible Git target exists', async () => {
    const fixture = await createReadyFixture();
    await createGitTarget(fixture.project.id);
    await prisma.publicationSite.create({
      data: {
        projectId: fixture.project.id,
        displayName: 'Second Git target',
        domain: 'second.example.com',
        repositoryIdentity: 'liufaxing1978-droid/second-site',
        baseBranch: 'main',
        adapterType: 'GITHUB_GIT',
        writeCapability: 'GIT_DRAFT_PR',
        allowedPaths: ['content/'],
        enabled: true
      }
    });
    const secondSite = await prisma.publicationSite.findFirstOrThrow({
      where: { projectId: fixture.project.id, domain: 'second.example.com' }
    });
    await prisma.publicationChannel.create({
      data: {
        siteId: secondSite.id,
        pathPrefix: '/culture',
        displayName: 'Second channel',
        repositoryPathTemplate: 'content/{slug}.md',
        contentType: 'ARTICLE',
        allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
        enabled: true
      }
    });
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);
    const targetPort = {
      readTarget: vi.fn(async () => ({
        repositoryIdentity: 'should-not-be-called',
        branch: 'main',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        publicUrlExists: false,
        files: {}
      })),
      preview: vi.fn(async () => ({
        files: [],
        unifiedDiff: '',
        validationResult: { blockingCodes: [], warningCodes: [], canCreatePlan: true }
      }))
    };
    const deps = { aiTaskService: taskService, targetPort };
    const service = new PublicationAutomationPreparationService(deps);
    const { request, seeded } = await materializeArticle({
      service,
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.optimizationPlan.id,
      decisionId: '33333333-3333-4333-8333-333333333333',
      briefWithGaps: false
    });

    const result = await service.prepareContentCreation(request);

    expect(result).toMatchObject({
      state: 'MANUAL_REQUIRED',
      proposalId: seeded.proposalId,
      draftId: seeded.draftId,
      planId: null,
      previewId: null,
      reasonCode: 'P8_PUBLICATION_TARGET_AMBIGUOUS'
    });
    expect(targetPort.readTarget).not.toHaveBeenCalled();
    expect(targetPort.preview).not.toHaveBeenCalled();
    expect(await prisma.publicationPlan.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(await prisma.publicationPreview.count({ where: { projectId: fixture.project.id } })).toBe(0);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });
});
