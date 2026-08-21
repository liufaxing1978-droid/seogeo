import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const modulePath = '../../src/modules/distribution/distribution-ai.js';
const projectIds: string[] = [];

async function loadModule() {
  return import(modulePath) as Promise<any>;
}

async function createCommunityFixture() {
  const publication = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-C Community AI',
      slug: `p8c-community-ai-${suffix}`,
      primaryDomain: `p8c-community-ai-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'Prepare a verified primary source for a community-native draft.',
    createdBy: 'test-editor'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '兴善堂原始资料',
    body: 'Primary source body with bounded factual material.',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  const source = await publication.createSourceReference({
    projectId: project.id,
    draftId: draft.id,
    title: '可靠资料来源',
    publisher: 'Example Archive',
    sourceUrl: 'https://archive.example/source',
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
  const originalUrl = `https://${project.primaryDomain}/culture/original`;
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
    baseSha: `p8c-community-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `p8c-community-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `p8c-community-preview-${project.id}`,
    diffSummary: 'P8-C community fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: `p8c-community-content-${project.id}`,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-approver',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `p8c-community-execution-${project.id}`,
    status: 'VERIFIED'
  });
  const target = await prisma.distributionTarget.create({
    data: {
      projectId: project.id,
      publicationId: execution.id,
      platform: 'REDDIT',
      mode: 'COMMUNITY_DRAFT',
      targetKey: 'question-1',
      targetContext: {
        sourceType: 'USER',
        question: 'How should readers interpret this primary source?',
        topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
        includeBrandLink: false
      }
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

describe('P8-C community adaptation through the existing P4 AI gateway', () => {
  it('includes target context + persisted sources in identity and materializes one DRAFT_READY community artifact', async () => {
    const module = await loadModule();
    const fixture = await createCommunityFixture();
    const input = await module.buildDistributionAdaptationTaskInput(fixture.target.id, 1);

    expect(input).toMatchObject({
      projectId: fixture.project.id,
      taskType: 'PUBLICATION_CONTENT_ADAPTATION',
      promptVersion: 'distribution-community-draft-v1'
    });
    expect(input.factSnapshot).toMatchObject({
      target: {
        id: fixture.target.id,
        platform: 'REDDIT',
        mode: 'COMMUNITY_DRAFT',
        context: {
          sourceType: 'USER',
          question: 'How should readers interpret this primary source?',
          topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
          includeBrandLink: false
        }
      },
      primary: {
        sourceContentVersion: 1,
        originalUrl: fixture.originalUrl
      }
    });
    expect(input.requestKey).toMatch(/distribution-adaptation:.*:1:REDDIT:COMMUNITY_DRAFT:distribution-community-draft-v1:/);

    const suppliedRefs = input.sourceReferences as Array<{ type: string; id: string }>;
    expect(suppliedRefs).toContainEqual({ type: 'CONTENT_SOURCE_REFERENCE', id: fixture.source.id });

    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);
    const task = await taskService.createAndEnqueue(input);
    const refs = (task.sourceReferences as Array<{ type: string; id: string }>).map((item) => `${item.type}:${item.id}`);
    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-chat',
        responseId: 'p8c-community-fixture',
        content: JSON.stringify({
          title: '如何理解这份原始资料？',
          body: '先从资料自身可核实的内容出发，再区分后来的解释。',
          summary: '社区原生回答草稿。',
          tags: ['资料阅读'],
          sourceRefs: [`CONTENT_SOURCE_REFERENCE:${fixture.source.id}`],
          promotionalLanguageDetected: false,
          brandLinkIncluded: false,
          originalUrl: fixture.originalUrl,
          canonicalUrl: null
        }),
        finishReason: 'stop',
        latencyMs: 10,
        usage: {
          promptTokens: 40,
          completionTokens: 30,
          totalTokens: 70,
          cacheHitTokens: 0,
          cacheMissTokens: 40,
          reasoningTokens: 0
        }
      }))
    };

    expect(refs).toContain(`CONTENT_SOURCE_REFERENCE:${fixture.source.id}`);
    await executeAiTask(task.id, { repository: new AiRepository(), gateway });

    expect(gateway.complete).toHaveBeenCalledTimes(1);
    const artifacts = await new DistributionRepository().listArtifacts(fixture.target.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      sourceContentVersion: 1,
      adaptationVersion: 'distribution-community-draft-v1',
      title: '如何理解这份原始资料？',
      canonicalUrl: null,
      originalUrl: fixture.originalUrl,
      effectiveStatus: 'DRAFT_READY',
      platformMetadata: {
        kind: 'COMMUNITY_DRAFT',
        question: 'How should readers interpret this primary source?',
        topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
        includeBrandLink: false,
        promotionalLanguageDetected: false,
        brandLinkIncluded: false
      }
    });
    expect((artifacts[0]?.platformMetadata as Record<string, unknown>).contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).toMatchObject({ status: 'VERIFIED' });
  });
});
