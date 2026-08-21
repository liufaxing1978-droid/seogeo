import { afterAll, describe, expect, it, vi } from 'vitest';
import type { DistributionMode, DistributionPlatform } from '@prisma/client';
import { prisma } from '../../src/db/prisma.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const serviceModulePath = '../../src/modules/distribution/distribution.service.js';
const projectIds: string[] = [];

async function loadService() {
  return import(serviceModulePath) as Promise<any>;
}

async function createFixture(input: {
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE';
  platform: DistributionPlatform;
  mode: DistributionMode;
  targetKey?: string;
}) {
  const publication = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-C service ${input.mode}`,
      slug: `p8c-service-${suffix}`,
      primaryDomain: `p8c-service-${suffix}.example.com`,
      planLevel: input.planLevel
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'P8-C Task 25 verified source',
    createdBy: 'test-user'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: 'Verified P8-C source',
    body: 'Bounded verified primary source.',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  const site = await publication.createSite({
    projectId: project.id,
    displayName: '兴善堂主站',
    domain: project.primaryDomain,
    adapterType: 'EXPORT_ONLY',
    writeCapability: 'EXPORT_ONLY'
  });
  const originalUrl = `https://${project.primaryDomain}/verified-source`;
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
    baseSha: `p8c-service-base-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `p8c-service-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `p8c-service-preview-${project.id}`,
    diffSummary: 'P8-C service fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: `p8c-service-content-${project.id}`,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-approver',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `p8c-service-execution-${project.id}`,
    status: 'VERIFIED'
  });
  const target = await prisma.distributionTarget.create({
    data: {
      projectId: project.id,
      publicationId: execution.id,
      platform: input.platform,
      mode: input.mode,
      targetKey: input.targetKey ?? 'default',
      sourceContentVersion: 1,
      ...(input.mode === 'COMMUNITY_DRAFT' ? {
        targetContext: {
          sourceType: 'USER',
          question: 'How should this source be understood?',
          topicUrl: 'https://www.reddit.com/r/example/comments/abc/topic',
          includeBrandLink: false
        }
      } : {})
    }
  });
  return { project, execution, target, originalUrl, repository: new DistributionRepository() };
}

async function createArtifact(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.repository.createArtifact(fixture.target.id, {
    sourceContentVersion: 1,
    adaptationVersion: fixture.target.mode === 'ENTITY_SUGGESTION'
      ? 'distribution-entity-suggestion-v1'
      : 'distribution-community-draft-v1',
    artifactVersion: 1,
    artifactHash: `artifact-${fixture.target.id}`,
    title: 'Prepared P8-C artifact',
    body: 'Prepared body',
    summary: 'Prepared summary',
    tags: [] as any,
    originalUrl: fixture.originalUrl,
    canonicalUrl: null,
    sourceRefs: [] as any,
    platformMetadata: {} as any
  });
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-C distribution service gates and human-operated lifecycle', () => {
  it('applies mode-level plan gates before queue work and hides cross-project targets', async () => {
    const { DistributionService } = await loadService();
    const standardCommunity = await createFixture({ planLevel: 'STANDARD', platform: 'REDDIT', mode: 'COMMUNITY_DRAFT' });
    const advancedCommunity = await createFixture({ planLevel: 'ADVANCED', platform: 'REDDIT', mode: 'COMMUNITY_DRAFT' });
    const advancedEntity = await createFixture({ planLevel: 'ADVANCED', platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION' });
    const enterpriseEntity = await createFixture({ planLevel: 'ENTERPRISE', platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION' });
    const otherProject = await createFixture({ planLevel: 'ADVANCED', platform: 'REDDIT', mode: 'COMMUNITY_DRAFT', targetKey: 'other' });
    const queue = { enqueue: vi.fn(async () => ({ queued: true })) };
    const service = new DistributionService({ queue, adaptationTaskCreator: vi.fn() });

    await expect(service.requestPreparation({
      projectId: standardCommunity.project.id,
      targetId: standardCommunity.target.id,
      sourceContentVersion: 1
    })).rejects.toMatchObject({ code: 'PUBLICATION_DISTRIBUTION_NOT_AVAILABLE' });
    expect(queue.enqueue).not.toHaveBeenCalled();

    await expect(service.requestPreparation({
      projectId: advancedCommunity.project.id,
      targetId: advancedCommunity.target.id,
      sourceContentVersion: 1
    })).resolves.toEqual({ queued: true });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);

    await expect(service.requestPreparation({
      projectId: advancedEntity.project.id,
      targetId: advancedEntity.target.id,
      sourceContentVersion: 1
    })).rejects.toMatchObject({ code: 'PUBLICATION_ENTERPRISE_GOVERNANCE_NOT_AVAILABLE' });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);

    await expect(service.requestPreparation({
      projectId: enterpriseEntity.project.id,
      targetId: enterpriseEntity.target.id,
      sourceContentVersion: 1
    })).resolves.toEqual({ queued: true });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);

    await expect(service.requestPreparation({
      projectId: otherProject.project.id,
      targetId: advancedCommunity.target.id,
      sourceContentVersion: 1
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_TARGET_NOT_FOUND' });
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it('keeps community publishing human-operated from approval through recorded public URL', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({ planLevel: 'ADVANCED', platform: 'REDDIT', mode: 'COMMUNITY_DRAFT' });
    const artifact = await createArtifact(fixture);
    const providerPublish = vi.fn(async () => ({ providerId: 'must-not-run', status: 'published' }));
    const manualAdapter = {
      platform: 'REDDIT' as const,
      capability: 'MANUAL_HANDOFF' as const,
      prepare: vi.fn(),
      preview: vi.fn(),
      publish: providerPublish
    };
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() });

    await service.approveArtifact({ projectId: fixture.project.id, targetId: fixture.target.id, artifactId: artifact.id });
    expect((await fixture.repository.getTarget(fixture.target.id))?.status).toBe('APPROVED');

    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter: manualAdapter
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_MANUAL_ONLY' });
    expect(providerPublish).not.toHaveBeenCalled();
    expect((await fixture.repository.getTarget(fixture.target.id))?.status).toBe('MANUAL_ACTION_REQUIRED');

    await expect(service.recordManualPublicationResult({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      publicUrl: 'https://www.reddit.com/r/example/comments/posted/result'
    })).resolves.toEqual({
      status: 'PUBLISHED',
      publicUrl: 'https://www.reddit.com/r/example/comments/posted/result'
    });
    expect((await fixture.repository.getTarget(fixture.target.id))?.status).toBe('PUBLISHED');
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).status).toBe('VERIFIED');
  });

  it('allows entity review approval but rejects publish/manual-result/verify before provider work', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({ planLevel: 'ENTERPRISE', platform: 'WIKIDATA', mode: 'ENTITY_SUGGESTION' });
    const artifact = await createArtifact(fixture);
    const providerPublish = vi.fn(async () => ({ providerId: 'forbidden', status: 'published' }));
    const providerVerify = vi.fn(async () => ({ verified: true }));
    const adapter = {
      platform: 'WIKIDATA' as const,
      capability: 'PREPARE_ONLY' as const,
      prepare: vi.fn(),
      preview: vi.fn(),
      publish: providerPublish,
      verify: providerVerify
    };
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() });

    await service.approveArtifact({ projectId: fixture.project.id, targetId: fixture.target.id, artifactId: artifact.id });
    expect((await fixture.repository.getTarget(fixture.target.id))?.status).toBe('APPROVED');

    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_NOT_SUPPORTED' });
    await expect(service.recordManualPublicationResult({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      publicUrl: 'https://www.wikidata.org/wiki/Q123'
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_NOT_SUPPORTED' });
    await expect(service.verifyPublishedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_VERIFY_NOT_SUPPORTED' });

    expect(providerPublish).not.toHaveBeenCalled();
    expect(providerVerify).not.toHaveBeenCalled();
    expect((await fixture.repository.getTarget(fixture.target.id))?.status).toBe('APPROVED');
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).status).toBe('VERIFIED');
  });
});
