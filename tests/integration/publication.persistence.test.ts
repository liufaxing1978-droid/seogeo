import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p8-publication-${suffix}`,
      primaryDomain: `p8-publication-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createProposalFixture(repository: PublicationRepository, projectId: string) {
  return repository.createProposal({
    projectId,
    sourceType: 'MANUAL',
    reason: 'Task 1 persistence fixture',
    createdBy: 'test-user'
  });
}

describe('P8-A publication persistence foundation', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.publicationRollbackProposal.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationVerification.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationExecutionEvent.deleteMany({ where: { execution: { projectId } } }).catch(() => undefined);
      await prisma.publicationExecution.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationApproval.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationPreview.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationPlan.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.contentSourceReference.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.contentDraftVersion.deleteMany({ where: { draft: { projectId } } }).catch(() => undefined);
      await prisma.contentDraft.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationChannel.deleteMany({ where: { site: { projectId } } }).catch(() => undefined);
      await prisma.publicationSite.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationProposal.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('stores a mutable draft head plus immutable draft versions', async () => {
    const repository = new PublicationRepository();
    const project = await createProject('P8 draft versioning');
    const proposal = await createProposalFixture(repository, project.id);

    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'A',
      body: 'V1',
      language: 'zh-CN',
      generatedBy: 'HUMAN'
    });
    const v2 = await repository.appendDraftVersion(draft.id, {
      title: 'A',
      body: 'V2',
      generatedBy: 'HUMAN'
    });

    const versions = await repository.listDraftVersions(draft.id);
    expect(versions.map((version) => version.body)).toEqual(['V1', 'V2']);
    expect(v2.version).toBe(2);

    const storedDraft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(storedDraft).toMatchObject({ title: 'A', body: 'V2', currentVersion: 2 });
  });

  it('enforces project-scoped site and channel identities', async () => {
    const repository = new PublicationRepository();
    const project = await createProject('P8 site uniqueness');

    const site = await repository.createSite({
      projectId: project.id,
      displayName: '兴善堂',
      domain: 'xingshantang.org',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      enabled: true
    });
    await expect(repository.createSite({
      projectId: project.id,
      displayName: 'Duplicate',
      domain: 'xingshantang.org',
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      enabled: true
    })).rejects.toBeTruthy();

    await repository.createChannel({
      siteId: site.id,
      pathPrefix: '/news',
      displayName: '最新消息',
      enabled: true
    });
    await expect(repository.createChannel({
      siteId: site.id,
      pathPrefix: '/news',
      displayName: 'Duplicate',
      enabled: true
    })).rejects.toBeTruthy();
  });

  it('protects immutable plans, previews, approvals, draft versions and execution events in PostgreSQL', async () => {
    const repository = new PublicationRepository();
    const project = await createProject('P8 immutable rows');
    const proposal = await createProposalFixture(repository, project.id);
    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'Immutable',
      body: 'V1',
      language: 'zh-CN',
      generatedBy: 'HUMAN'
    });
    const site = await repository.createSite({
      projectId: project.id,
      displayName: 'Fixture',
      domain: `fixture-${project.id}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      enabled: true
    });
    const plan = await repository.createPlan({
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      version: 1,
      targetPublicUrl: `https://${site.domain}/article`,
      targetRepository: 'export-only',
      targetBranch: 'main',
      baseSha: 'base-sha',
      operations: [{ type: 'CREATE_CONTENT_PAGE', path: 'content/article.md' }],
      expectedOutcomes: {},
      validatorVersion: 'P8_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'ABANDON_CHANGE',
      planHash: 'plan-hash'
    });
    const preview = await repository.createPreview({
      projectId: project.id,
      planId: plan.id,
      previewHash: 'preview-hash',
      diffSummary: 'create article'
    });
    const approval = await repository.createApproval({
      projectId: project.id,
      planId: plan.id,
      planVersion: 1,
      planHash: 'plan-hash',
      contentHash: 'content-hash',
      previewHash: preview.previewHash,
      baseSha: 'base-sha',
      approverActorId: 'test-user',
      approvedRiskClass: 'LOW'
    });
    const execution = await repository.createExecution({
      projectId: project.id,
      planId: plan.id,
      approvalId: approval.id,
      executionKey: `execution-${project.id}`,
      status: 'PENDING'
    });
    const event = await repository.appendExecutionEvent(execution.id, {
      eventType: 'CREATED',
      fromStatus: null,
      toStatus: 'PENDING',
      reasonCode: 'TEST_CREATED'
    });

    await expect(prisma.$executeRawUnsafe(`UPDATE \"PublicationPlan\" SET \"planHash\" = 'mutated' WHERE \"id\" = '${plan.id}'`)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM \"PublicationPreview\" WHERE \"id\" = '${preview.id}'`)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM \"PublicationApproval\" WHERE \"id\" = '${approval.id}'`)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`UPDATE \"ContentDraftVersion\" SET \"body\" = 'mutated' WHERE \"draftId\" = '${draft.id}' AND \"version\" = 1`)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM \"PublicationExecutionEvent\" WHERE \"id\" = '${event.id}'`)).rejects.toBeTruthy();
  });

  it('allows only one logical execution per execution key', async () => {
    const repository = new PublicationRepository();
    const project = await createProject('P8 execution uniqueness');
    const proposal = await createProposalFixture(repository, project.id);
    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'Execution',
      body: 'V1',
      language: 'zh-CN',
      generatedBy: 'HUMAN'
    });
    const site = await repository.createSite({
      projectId: project.id,
      displayName: 'Execution Fixture',
      domain: `execution-${project.id}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY',
      enabled: true
    });
    const plan = await repository.createPlan({
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      version: 1,
      targetPublicUrl: `https://${site.domain}/article`,
      targetRepository: 'export-only',
      targetBranch: 'main',
      baseSha: 'base-sha',
      operations: [],
      expectedOutcomes: {},
      validatorVersion: 'P8_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'ABANDON_CHANGE',
      planHash: 'execution-plan-hash'
    });
    const preview = await repository.createPreview({
      projectId: project.id,
      planId: plan.id,
      previewHash: 'execution-preview-hash',
      diffSummary: 'noop'
    });
    const approval = await repository.createApproval({
      projectId: project.id,
      planId: plan.id,
      planVersion: 1,
      planHash: plan.planHash,
      contentHash: 'content-hash',
      previewHash: preview.previewHash,
      baseSha: plan.baseSha,
      approverActorId: 'test-user',
      approvedRiskClass: 'LOW'
    });
    const executionKey = `logical-${project.id}`;

    await repository.createExecution({
      projectId: project.id,
      planId: plan.id,
      approvalId: approval.id,
      executionKey,
      status: 'PENDING'
    });
    await expect(repository.createExecution({
      projectId: project.id,
      planId: plan.id,
      approvalId: approval.id,
      executionKey,
      status: 'PENDING'
    })).rejects.toBeTruthy();
  });
});
