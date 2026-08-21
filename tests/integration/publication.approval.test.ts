import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { approvePublicationPlan } from '../../src/modules/publication/publication-approval.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';
import { contentHashV1 } from '../../src/modules/publication/publication.hash.js';

const projectIds: string[] = [];

async function createProject() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8 approval persistence',
      slug: `p8-approval-${suffix}`,
      primaryDomain: `p8-approval-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

function draftHash(input: {
  title: string;
  slugCandidate: string;
  body: string;
  canonicalCandidate: string;
}) {
  return contentHashV1({
    title: input.title,
    slugCandidate: input.slugCandidate,
    body: input.body,
    excerpt: null,
    metaTitle: null,
    metaDescription: null,
    canonicalCandidate: input.canonicalCandidate,
    schemaJson: null,
    author: null,
    language: 'zh-CN'
  });
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.publicationApproval.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.publicationPreview.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.publicationPlan.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.contentDraftVersion.deleteMany({ where: { draft: { projectId } } }).catch(() => undefined);
    await prisma.contentDraft.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.publicationChannel.deleteMany({ where: { site: { projectId } } }).catch(() => undefined);
    await prisma.publicationSite.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.publicationProposal.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P8-A publication approval persistence', () => {
  it('binds approval facts server-side, ignores a spoofed request actor, and appends approvals without overwriting prior rows', async () => {
    const repository = new PublicationRepository();
    const project = await createProject();
    const proposal = await repository.createProposal({
      projectId: project.id,
      sourceType: 'MANUAL',
      reason: 'Task 8 approval fixture',
      createdBy: 'editor-1'
    });
    const title = '六壬文化审批测试';
    const slugCandidate = 'approval-test';
    const body = '# 六壬文化审批测试\n\nImmutable approval body.';
    const canonicalCandidate = 'https://xingshantang.org/culture/approval-test';
    const contentHash = draftHash({ title, slugCandidate, body, canonicalCandidate });
    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title,
      slugCandidate,
      body,
      canonicalCandidate,
      language: 'zh-CN',
      contentHash,
      generatedBy: 'HUMAN'
    });
    const site = await repository.createSite({
      projectId: project.id,
      displayName: '兴善堂',
      domain: 'xingshantang.org',
      repositoryIdentity: 'liufaxing1978-droid/xingshantang',
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/culture/']
    });
    const channel = await repository.createChannel({
      siteId: site.id,
      pathPrefix: '/culture',
      displayName: '六壬文化',
      repositoryPathTemplate: 'content/culture/{slug}.md'
    });
    const plan = await repository.createPlan({
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: canonicalCandidate,
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: '1111111111111111111111111111111111111111',
      targetBlobHashes: { 'content/culture/approval-test.md': 'blob-a' },
      operations: [{
        type: 'UPDATE_CONTENT_PAGE',
        path: 'content/culture/approval-test.md',
        targetUrl: canonicalCandidate,
        contentHash
      }],
      expectedOutcomes: { publicUrl: canonicalCandidate },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'plan-hash-approval-1'
    });
    const preview = await repository.createPreview({
      projectId: project.id,
      planId: plan.id,
      previewHash: 'preview-hash-approval-1',
      diffSummary: '0 created, 1 modified, 0 deleted',
      diffPayload: {
        filesCreated: [],
        filesModified: ['content/culture/approval-test.md'],
        filesDeleted: [],
        baseSha: plan.baseSha,
        targetBlobHashes: { 'content/culture/approval-test.md': 'blob-a' }
      },
      validationResult: {
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        findings: [],
        blockingCodes: [],
        warningCodes: [],
        infoCodes: [],
        unconfirmedWarningCodes: [],
        canCreatePlan: true
      }
    });

    const requestWithSpoofedActor = {
      projectId: project.id,
      planId: plan.id,
      expectedPlanHash: plan.planHash,
      expectedContentHash: contentHash,
      expectedPreviewHash: preview.previewHash,
      approverActorId: 'spoofed-request-actor'
    } as Parameters<typeof approvePublicationPlan>[0] & { approverActorId: string };

    const first = await approvePublicationPlan(
      requestWithSpoofedActor,
      { actorId: 'authenticated-approver-1' },
      repository
    );
    expect(first).toMatchObject({
      projectId: project.id,
      planId: plan.id,
      planVersion: 1,
      planHash: plan.planHash,
      contentVersion: 1,
      contentHash,
      previewHash: preview.previewHash,
      baseSha: plan.baseSha,
      targetRepository: plan.targetRepository,
      targetBranch: plan.targetBranch,
      approverActorId: 'authenticated-approver-1',
      approvedRiskClass: 'LOW'
    });
    expect(first.targetBlobHashes).toEqual({ 'content/culture/approval-test.md': 'blob-a' });

    const second = await approvePublicationPlan({
      projectId: project.id,
      planId: plan.id,
      expectedPlanHash: plan.planHash,
      expectedContentHash: contentHash,
      expectedPreviewHash: preview.previewHash
    }, { actorId: 'authenticated-approver-2' }, repository);

    const stored = await prisma.publicationApproval.findMany({
      where: { planId: plan.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.approverActorId)).toEqual([
      'authenticated-approver-1',
      'authenticated-approver-2'
    ]);
    expect(stored[0]).toEqual(first);
    expect(stored[1]).toEqual(second);
    expect(stored[0]?.id).not.toBe(stored[1]?.id);
  });
});
