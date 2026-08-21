import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ManualHandoffDistributionAdapter } from '../../src/modules/distribution/manual-handoff.adapter.js';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const serviceModulePath = '../../src/modules/distribution/distribution.service.js';
const projectIds: string[] = [];

async function loadService() {
  const module = await import(serviceModulePath).catch(() => null);
  expect(module, 'distribution service must exist for P8-B Task 20').not.toBeNull();
  if (!module) throw new Error('distribution service missing');
  return module as any;
}

async function createFixture(input: {
  planLevel?: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE';
  executionStatus?: 'READY' | 'VERIFIED';
  platform?: 'MEDIUM' | 'WORDPRESS';
  mode?: 'CANONICAL_REPOST' | 'SECONDARY_SITE';
}) {
  const publication = new PublicationRepository();
  const distribution = new DistributionRepository();
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-B distribution service',
      slug: `p8b-distribution-service-${suffix}`,
      primaryDomain: `p8b-distribution-service-${suffix}.example.com`,
      planLevel: input.planLevel ?? 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'P8-B distribution service fixture',
    createdBy: 'test-user'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: 'Verified source',
    body: 'Primary source V1',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  for (let version = 2; version <= 7; version += 1) {
    await publication.appendDraftVersion(draft.id, {
      title: `Verified source V${version}`,
      body: `Primary source V${version}`,
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
    baseSha: 'distribution-service-base',
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `distribution-service-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `distribution-service-preview-${project.id}`,
    diffSummary: 'distribution service fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: 'content-v7',
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-user',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `distribution-service-${project.id}`,
    status: input.executionStatus ?? 'VERIFIED'
  });
  const target = await distribution.ensureTarget({
    projectId: project.id,
    publicationId: execution.id,
    platform: input.platform ?? 'MEDIUM',
    mode: input.mode ?? 'CANONICAL_REPOST',
    targetKey: 'default'
  });
  return { project, execution, target, distribution, originalUrl };
}

async function createPreparedArtifact(fixture: Awaited<ReturnType<typeof createFixture>>) {
  return fixture.distribution.createArtifact(fixture.target.id, {
    sourceContentVersion: 7,
    adaptationVersion: 'distribution-canonical-repost-v1',
    artifactVersion: 1,
    artifactHash: `artifact-${fixture.target.id}`,
    title: 'Prepared artifact',
    body: 'Prepared body',
    summary: 'Prepared summary',
    tags: ['兴善堂'],
    originalUrl: fixture.originalUrl,
    canonicalUrl: fixture.originalUrl,
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

describe('P8-B distribution orchestration service', () => {
  it('rejects a non-VERIFIED primary before queue, AI or adapter work', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({ executionStatus: 'READY' });
    const queue = { enqueue: vi.fn(async () => ({ id: 'job' })) };
    const adaptationTaskCreator = vi.fn(async () => ({ id: 'ai-task' }));
    const service = new DistributionService({ queue, adaptationTaskCreator });

    await expect(service.requestPreparation({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      sourceContentVersion: 7
    })).rejects.toMatchObject({ code: 'PRIMARY_PUBLICATION_NOT_VERIFIED' });
    await expect(service.prepareTargetNow({
      targetId: fixture.target.id,
      sourceContentVersion: 7
    })).rejects.toMatchObject({ code: 'PRIMARY_PUBLICATION_NOT_VERIFIED' });

    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(adaptationTaskCreator).not.toHaveBeenCalled();
  });

  it('enforces PUBLICATION_DISTRIBUTION before enqueuing and accepts the exact VERIFIED source version for Advanced+', async () => {
    const { DistributionService } = await loadService();
    const standard = await createFixture({ planLevel: 'STANDARD' });
    const advanced = await createFixture({ planLevel: 'ADVANCED' });
    const queue = { enqueue: vi.fn(async (targetId: string, sourceContentVersion: number) => ({ targetId, sourceContentVersion })) };
    const service = new DistributionService({ queue, adaptationTaskCreator: vi.fn() });

    await expect(service.requestPreparation({
      projectId: standard.project.id,
      targetId: standard.target.id,
      sourceContentVersion: 7
    })).rejects.toMatchObject({ code: 'PUBLICATION_DISTRIBUTION_NOT_AVAILABLE' });

    const queued = await service.requestPreparation({
      projectId: advanced.project.id,
      targetId: advanced.target.id,
      sourceContentVersion: 7
    });
    expect(queued).toEqual({ targetId: advanced.target.id, sourceContentVersion: 7 });
    expect(queue.enqueue).toHaveBeenCalledTimes(1);

    await expect(service.requestPreparation({
      projectId: advanced.project.id,
      targetId: advanced.target.id,
      sourceContentVersion: 8
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_SOURCE_VERSION_MISMATCH' });
  });

  it('prepares through the existing AI task creator and leaves publication authority VERIFIED', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({});
    const adaptationTaskCreator = vi.fn(async (targetId: string, version: number) => ({ id: 'ai-task-1', targetId, version }));
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator });

    const result = await service.prepareTargetNow({ targetId: fixture.target.id, sourceContentVersion: 7 });
    expect(result).toEqual({ id: 'ai-task-1', targetId: fixture.target.id, version: 7 });
    expect(adaptationTaskCreator).toHaveBeenCalledWith(fixture.target.id, 7);
    expect((await prisma.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } })).status).toBe('VERIFIED');
    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('NOT_PREPARED');
  });

  it('requires explicit approval and blocks an OUTDATED artifact before adapter/provider publish', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({ platform: 'WORDPRESS', mode: 'SECONDARY_SITE' });
    const artifact = await createPreparedArtifact(fixture);
    const publish = vi.fn(async () => ({ providerId: 'wp-1', publicUrl: 'https://secondary.example.test/post-1', status: 'published' }));
    const adapter = {
      platform: 'WORDPRESS',
      capability: 'PUBLISH_API',
      prepare: vi.fn(),
      preview: vi.fn(),
      publish,
      verify: vi.fn()
    };
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() });

    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_ARTIFACT_NOT_APPROVED' });

    await service.approveArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id
    });
    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('APPROVED');

    await fixture.distribution.markSourceVersionOutdated({
      publicationId: fixture.execution.id,
      currentSourceContentVersion: 8,
      reasonCode: 'SOURCE_CONTENT_VERSION_CHANGED'
    });
    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_ARTIFACT_OUTDATED' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not let Enterprise governance bypass a MANUAL_HANDOFF adapter', async () => {
    const { DistributionService } = await loadService();
    const fixture = await createFixture({ planLevel: 'ENTERPRISE', platform: 'MEDIUM', mode: 'CANONICAL_REPOST' });
    const artifact = await createPreparedArtifact(fixture);
    const service = new DistributionService({ queue: { enqueue: vi.fn() }, adaptationTaskCreator: vi.fn() });
    await service.approveArtifact({ projectId: fixture.project.id, targetId: fixture.target.id, artifactId: artifact.id });

    await expect(service.publishApprovedArtifact({
      projectId: fixture.project.id,
      targetId: fixture.target.id,
      artifactId: artifact.id,
      adapter: new ManualHandoffDistributionAdapter('MEDIUM')
    })).rejects.toMatchObject({ code: 'DISTRIBUTION_MANUAL_ONLY' });

    expect((await fixture.distribution.getTarget(fixture.target.id))?.status).toBe('MANUAL_ACTION_REQUIRED');
  });
});
