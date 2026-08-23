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
  return { project, optimizationPlan, runItem };
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

function articleContent(sourceRef: string) {
  return JSON.stringify({
    title: '六壬伏英舘文化源流',
    body: '# 六壬伏英舘文化源流\n\nGenerated V2 content bounded to supplied references.',
    excerpt: '资料边界内的介绍。',
    metaDescription: '从可核资料边界介绍六壬伏英舘文化源流。',
    schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
    sourceReferences: [sourceRef],
    caveats: ['Unresolved historical claims remain omitted.']
  });
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
    const input = {
      projectId: fixture.project.id,
      runItemId: fixture.runItem.id,
      optimizationPlanId: fixture.optimizationPlan.id,
      decisionId: '11111111-1111-4111-8111-111111111111'
    };

    const seeded = await service.prepareContentCreation(input);
    const source = await prisma.contentSourceReference.findFirstOrThrow({
      where: { projectId: fixture.project.id, draftId: seeded.draftId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const sourceRef = `CONTENT_SOURCE_REFERENCE:${source.id}`;
    const briefTask = await prisma.aiTask.findFirstOrThrow({
      where: { projectId: fixture.project.id, taskType: 'PUBLICATION_CONTENT_BRIEF' }
    });
    const briefGateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-reasoner',
        responseId: 'p9c-validation-brief',
        content: briefContent(sourceRef),
        finishReason: 'stop',
        latencyMs: 10,
        usage: { promptTokens: 40, completionTokens: 30, totalTokens: 70, cacheHitTokens: 0, cacheMissTokens: 40, reasoningTokens: 10 }
      }))
    };
    await executeAiTask(briefTask.id, { repository: new AiRepository(), gateway: briefGateway });

    await service.prepareContentCreation(input);
    const articleTask = await prisma.aiTask.findFirstOrThrow({
      where: { projectId: fixture.project.id, taskType: 'PUBLICATION_ARTICLE_GENERATION' }
    });
    const articleGateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-chat',
        responseId: 'p9c-validation-article',
        content: articleContent(sourceRef),
        finishReason: 'stop',
        latencyMs: 10,
        usage: { promptTokens: 60, completionTokens: 50, totalTokens: 110, cacheHitTokens: 0, cacheMissTokens: 60, reasoningTokens: 0 }
      }))
    };
    await executeAiTask(articleTask.id, { repository: new AiRepository(), gateway: articleGateway });

    const result = await service.prepareContentCreation(input);

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
});
