import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { AiRepository } from '../../src/modules/ai/ai.repository.js';
import { AiTaskService } from '../../src/modules/ai/ai.service.js';
import { executeAiTask, type AiCompletionGateway } from '../../src/modules/ai/ai.worker.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const distributionAiModulePath = '../../src/modules/distribution/distribution-ai.js';
const projectIds: string[] = [];

async function loadDistributionAi() {
  const module = await import(distributionAiModulePath).catch(() => null);
  expect(module, 'distribution-ai module must exist for P8-B Task 18').not.toBeNull();
  if (!module) throw new Error('distribution AI module missing');
  return module as any;
}

async function createVerifiedTarget() {
  const publication = new PublicationRepository();
  const distribution = new DistributionRepository();
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-B distribution AI',
      slug: `p8b-distribution-ai-${suffix}`,
      primaryDomain: `p8b-distribution-ai-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'Prepare a verified primary source for distribution AI.',
    createdBy: 'test-editor'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '兴善堂主站 V1',
    body: 'Primary V1 body.',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  for (let version = 2; version <= 7; version += 1) {
    await publication.appendDraftVersion(draft.id, {
      title: `兴善堂主站 V${version}`,
      body: `Primary V${version} body.`,
      generatedBy: 'HUMAN'
    });
  }

  const site = await publication.createSite({
    projectId: project.id,
    displayName: '兴善堂主站',
    domain: project.primaryDomain,
    adapterType: 'EXPORT_ONLY',
    writeCapability: 'EXPORT_ONLY'
  });
  const originalUrl = `https://${project.primaryDomain}/culture/source-v7`;
  const plan = await publication.createPlan({
    projectId: project.id,
    proposalId: proposal.id,
    draftId: draft.id,
    draftVersion: 7,
    siteId: site.id,
    version: 1,
    targetPublicUrl: originalUrl,
    targetRepository: 'export-only',
    targetBranch: 'main',
    baseSha: 'distribution-ai-base',
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `distribution-ai-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `distribution-ai-preview-${project.id}`,
    diffSummary: 'verified primary fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: 'content-v7',
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-approver',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `distribution-ai-verified-${project.id}`,
    status: 'VERIFIED'
  });
  const target = await distribution.ensureTarget({
    projectId: project.id,
    publicationId: execution.id,
    platform: 'MEDIUM',
    mode: 'CANONICAL_REPOST',
    targetKey: 'default'
  });

  return { project, draft, execution, target, originalUrl, distribution };
}

function adaptationContent(originalUrl: string, sourceRefs: string[]) {
  return JSON.stringify({
    title: 'Medium 转载标题',
    body: 'Medium 平台版本正文。',
    summary: 'Medium 平台摘要。',
    tags: ['六壬文化', '兴善堂'],
    originalUrl,
    canonicalUrl: originalUrl,
    sourceRefs,
    platformMetadata: { subtitle: 'Canonical repost' }
  });
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-B distribution adaptation through the existing P4 AI gateway', () => {
  it('deduplicates the exact request and atomically materializes one immutable DRAFT_READY artifact', async () => {
    const module = await loadDistributionAi();
    const fixture = await createVerifiedTarget();
    const queue = { add: vi.fn(async () => undefined) };
    const taskService = new AiTaskService(new AiRepository(), queue);

    const input = await module.buildDistributionAdaptationTaskInput(fixture.target.id, 7);
    expect(input).toMatchObject({
      projectId: fixture.project.id,
      taskType: 'PUBLICATION_CONTENT_ADAPTATION',
      promptVersion: 'distribution-canonical-repost-v1'
    });
    expect(input.requestKey).toContain(fixture.execution.id);
    expect(input.requestKey).toContain(':7:MEDIUM:CANONICAL_REPOST:');
    expect(input.factSnapshot).toMatchObject({
      target: {
        id: fixture.target.id,
        publicationId: fixture.execution.id,
        platform: 'MEDIUM',
        mode: 'CANONICAL_REPOST'
      },
      primary: {
        sourceContentVersion: 7,
        originalUrl: fixture.originalUrl,
        title: '兴善堂主站 V7',
        body: 'Primary V7 body.'
      }
    });

    const first = await module.createDistributionAdaptationTask(fixture.target.id, 7, taskService);
    const second = await module.createDistributionAdaptationTask(fixture.target.id, 7, taskService);
    expect(second.id).toBe(first.id);
    expect(first.taskType).toBe('PUBLICATION_CONTENT_ADAPTATION');
    expect(queue.add).toHaveBeenCalledTimes(1);

    const refs = (first.sourceReferences as Array<{ type: string; id: string }>).map((item) => `${item.type}:${item.id}`);
    expect(refs).toContain(`PUBLICATION_EXECUTION:${fixture.execution.id}`);
    expect(refs).toContain(`CONTENT_DRAFT_VERSION:${fixture.draft.id}:v7`);

    const gateway: AiCompletionGateway = {
      complete: vi.fn(async () => ({
        provider: 'DEEPSEEK' as const,
        model: 'deepseek-chat',
        responseId: 'distribution-adaptation-fixture',
        content: adaptationContent(fixture.originalUrl, refs),
        finishReason: 'stop',
        latencyMs: 20,
        usage: {
          promptTokens: 60,
          completionTokens: 40,
          totalTokens: 100,
          cacheHitTokens: 0,
          cacheMissTokens: 60,
          reasoningTokens: 0
        }
      }))
    };

    await executeAiTask(first.id, { repository: new AiRepository(), gateway });
    await executeAiTask(first.id, { repository: new AiRepository(), gateway });

    expect(gateway.complete).toHaveBeenCalledTimes(1);
    expect((await prisma.aiTask.findUniqueOrThrow({ where: { id: first.id } }))).toMatchObject({
      status: 'COMPLETED',
      taskType: 'PUBLICATION_CONTENT_ADAPTATION'
    });

    const artifacts = await fixture.distribution.listArtifacts(fixture.target.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      sourceContentVersion: 7,
      adaptationVersion: 'distribution-canonical-repost-v1',
      artifactVersion: 1,
      title: 'Medium 转载标题',
      body: 'Medium 平台版本正文。',
      summary: 'Medium 平台摘要。',
      tags: ['六壬文化', '兴善堂'],
      originalUrl: fixture.originalUrl,
      canonicalUrl: fixture.originalUrl,
      platformMetadata: { subtitle: 'Canonical repost' },
      effectiveStatus: 'DRAFT_READY'
    });
    expect(artifacts[0]?.artifactHash).toMatch(/^[a-f0-9]{64}$/);

    expect(await fixture.distribution.getTarget(fixture.target.id)).toMatchObject({
      status: 'DRAFT_READY',
      sourceContentVersion: 7
    });
    expect(await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).toMatchObject({
      status: 'VERIFIED'
    });
  });
});
