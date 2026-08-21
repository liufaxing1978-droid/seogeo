import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const modulePath = '../../src/modules/distribution/distribution-ai.js';
const projectIds: string[] = [];

async function loadDistributionAi() {
  return import(modulePath) as Promise<any>;
}

async function createEntityFixture() {
  const publication = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-C Entity AI',
      slug: `p8c-entity-ai-${suffix}`,
      primaryDomain: `p8c-entity-ai-${suffix}.example.com`,
      planLevel: 'ENTERPRISE'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'Prepare a verified primary source for an entity suggestion.',
    createdBy: 'test-editor'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '兴善堂',
    body: 'Primary source body with bounded factual material about 兴善堂.',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  const source = await publication.createSourceReference({
    projectId: project.id,
    draftId: draft.id,
    title: 'Reliable independent source',
    publisher: 'Example Archive',
    sourceUrl: 'https://archive.example/xingshantang',
    sourceType: 'WEB',
    userProvided: true
  });
  const site = await publication.createSite({
    projectId: project.id,
    displayName: '兴善堂主站',
    domain: project.primaryDomain,
    adapterType: 'EXPORT_ONLY',
    writeCapability: 'EXPORT_ONLY'
  });
  const originalUrl = `https://${project.primaryDomain}/about`;
  const plan = await publication.createPlan({
    projectId: project.id,
    proposalId: proposal.id,
    draftId: draft.id,
    draftVersion: 1,
    siteId: site.id,
    version: 1,
    targetPublicUrl: originalUrl,
    targetRepository: 'export-only',
    targetBranch: 'main',
    baseSha: `p8c-entity-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `p8c-entity-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `p8c-entity-preview-${project.id}`,
    diffSummary: 'P8-C entity fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: `p8c-entity-content-${project.id}`,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-approver',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `p8c-entity-execution-${project.id}`,
    status: 'VERIFIED'
  });
  const target = await prisma.distributionTarget.create({
    data: {
      projectId: project.id,
      publicationId: execution.id,
      platform: 'WIKIDATA',
      mode: 'ENTITY_SUGGESTION',
      targetKey: 'xingshantang'
    }
  });
  return { project, draft, source, execution, target, originalUrl };
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-C entity suggestion through the existing P4 AI gateway', () => {
  it('supplies reliable persisted sources and materializes one immutable DRAFT_READY entity artifact without publishing', async () => {
    const module = await loadDistributionAi();
    const fixture = await createEntityFixture();
    const input = await module.buildDistributionAdaptationTaskInput(fixture.target.id, 1);

    expect(input).toMatchObject({
      projectId: fixture.project.id,
      taskType: 'PUBLICATION_CONTENT_ADAPTATION',
      promptVersion: 'distribution-entity-suggestion-v1'
    });
    expect(input.factSnapshot).toMatchObject({
      target: {
        id: fixture.target.id,
        platform: 'WIKIDATA',
        mode: 'ENTITY_SUGGESTION'
      },
      primary: {
        sourceContentVersion: 1,
        originalUrl: fixture.originalUrl,
        title: '兴善堂'
      }
    });
    expect(input.requestKey).toContain(':1:WIKIDATA:ENTITY_SUGGESTION:distribution-entity-suggestion-v1');
    const suppliedRefs = input.sourceReferences as Array<{ type: string; id: string }>;
    expect(suppliedRefs).toContainEqual({ type: 'CONTENT_SOURCE_REFERENCE', id: fixture.source.id });

    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);
    const task = await taskService.createAndEnqueue(input);
    const refId = `CONTENT_SOURCE_REFERENCE:${fixture.source.id}`;
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-reasoner',
        responseId: 'p8c-entity-fixture',
        content: JSON.stringify({
          entityName: '兴善堂',
          labels: [{ language: 'zh-CN', value: '兴善堂' }],
          descriptions: [{ language: 'zh-CN', value: '传统文化资料整理项目。' }],
          attributes: [{ property: 'officialWebsite', value: fixture.originalUrl, sourceRefs: [refId] }],
          sameAs: [],
          relationships: [],
          reliableSourceRefs: [refId],
          missingData: ['foundingDate'],
          policyReminders: ['Human review required; avoid promotional or conflict-of-interest editing.'],
          humanChecklist: ['Verify every factual claim against the cited reliable source before editing.']
        }),
        finishReason: 'stop',
        latencyMs: 12,
        usage: {
          promptTokens: 50,
          completionTokens: 40,
          totalTokens: 90,
          cacheHitTokens: 0,
          cacheMissTokens: 50,
          reasoningTokens: 10
        }
      }))
    };

    await executeAiTask(task.id, { repository: new AiRepository(), gateway });
    await executeAiTask(task.id, { repository: new AiRepository(), gateway });

    expect(gateway.complete).toHaveBeenCalledTimes(1);
    const artifacts = await new DistributionRepository().listArtifacts(fixture.target.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      sourceContentVersion: 1,
      adaptationVersion: 'distribution-entity-suggestion-v1',
      title: '兴善堂',
      summary: '传统文化资料整理项目。',
      tags: [],
      originalUrl: fixture.originalUrl,
      canonicalUrl: null,
      sourceRefs: [refId],
      effectiveStatus: 'DRAFT_READY',
      platformMetadata: {
        kind: 'ENTITY_SUGGESTION',
        entityName: '兴善堂',
        reliableSourceRefs: [refId],
        missingData: ['foundingDate']
      }
    });
    expect(artifacts[0]?.body).toContain('兴善堂');
    expect(artifacts[0]?.body).toContain('officialWebsite');
    expect(artifacts[0]?.body).toContain('foundingDate');
    expect(await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).toMatchObject({ status: 'VERIFIED' });
    expect(await prisma.distributionTarget.findUniqueOrThrow({ where: { id: fixture.target.id } })).toMatchObject({ status: 'DRAFT_READY' });
  });
});
