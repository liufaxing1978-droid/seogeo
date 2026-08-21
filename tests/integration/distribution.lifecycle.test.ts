import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ManualHandoffDistributionAdapter } from '../../src/modules/distribution/manual-handoff.adapter.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { DistributionService } from '../../src/modules/distribution/distribution.service.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const projectIds: string[] = [];

async function createFixture(platform: 'MEDIUM' | 'WORDPRESS', mode: 'CANONICAL_REPOST' | 'SECONDARY_SITE') {
  const publication = new PublicationRepository();
  const distribution = new DistributionRepository();
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-B lifecycle',
      slug: `p8b-lifecycle-${suffix}`,
      primaryDomain: `p8b-lifecycle-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'P8-B lifecycle fixture',
    createdBy: 'test-user'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: 'Verified source V1',
    body: 'Primary source V1',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  const originalUrl = `https://${project.primaryDomain}/culture/source-v1`;
  const site = await publication.createSite({
    projectId: project.id,
    displayName: '兴善堂主站',
    domain: project.primaryDomain,
    adapterType: 'EXPORT_ONLY',
    writeCapability: 'EXPORT_ONLY'
  });
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
    baseSha: `lifecycle-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `lifecycle-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `lifecycle-preview-${project.id}`,
    diffSummary: 'lifecycle fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: draft.currentContentHash,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-user',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `lifecycle-execution-${project.id}`,
    status: 'VERIFIED'
  });
  const target = await distribution.ensureTarget({
    projectId: project.id,
    publicationId: execution.id,
    platform,
    mode,
    targetKey: 'default'
  });
  const artifact = await distribution.createArtifact(target.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-canonical-repost-v1',
    artifactVersion: 1,
    artifactHash: `lifecycle-artifact-${target.id}`,
    title: 'Prepared artifact',
    body: 'Prepared body',
    summary: 'Prepared summary',
    tags: ['兴善堂'],
    originalUrl,
    canonicalUrl: originalUrl,
    sourceRefs: [] as any,
    platformMetadata: {} as any
  });
  return { project, execution, target, artifact, distribution, originalUrl };
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.aiTask.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-B distribution manual and verification lifecycle', () => {
  it('records a user-completed manual handoff as PUBLISHED without changing primary VERIFIED authority', async () => {
    const fixture = await createFixture('MEDIUM', 'CANONICAL_REPOST');
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() }) as any;

    await service.approveArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id
    });
    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id,
      adapter: new ManualHandoffDistributionAdapter('MEDIUM')
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_MANUAL_ONLY' });

    await expect(service.recordManualPublicationResult({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id,
      publicUrl: 'javascript:alert(1)'
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_PUBLIC_URL_INVALID' });

    const result = await service.recordManualPublicationResult({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id,
      publicUrl: 'https://medium.com/example/manual-post'
    });
    expect(result).toMatchObject({ status: 'PUBLISHED', publicUrl: 'https://medium.com/example/manual-post' });
    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('PUBLISHED');
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).status).toBe('VERIFIED');
  });

  it('verifies the exact provider identity from the PUBLISHED event and keeps primary VERIFIED', async () => {
    const fixture = await createFixture('WORDPRESS', 'SECONDARY_SITE');
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() }) as any;
    const publish = vi.fn(async () => ({
      providerId: 'wp-post-7',
      publicUrl: 'https://secondary.example.test/post-7',
      status: 'published'
    }));
    const verify = vi.fn(async () => ({ verified: true, publicUrl: 'https://secondary.example.test/post-7' }));
    const adapter = {
      platform: 'WORDPRESS',
      capability: 'PUBLISH_API',
      prepare: vi.fn(),
      preview: vi.fn(),
      publish,
      verify
    };

    await service.approveArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id
    });
    await service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id,
      adapter
    });
    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('PUBLISHED');

    const result = await service.verifyPublishedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: fixture.artifact.id,
      adapter
    });
    expect(result).toMatchObject({ verified: true, publicUrl: 'https://secondary.example.test/post-7' });
    expect(verify).toHaveBeenCalledWith({
      providerId: 'wp-post-7',
      publicUrl: 'https://secondary.example.test/post-7',
      status: 'published'
    });
    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('VERIFIED');
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).status).toBe('VERIFIED');
  });
});
