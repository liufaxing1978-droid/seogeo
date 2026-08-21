import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';
import { PublicationRollbackPlanner } from '../../src/modules/publication/publication-rollback.js';

const ORIGINAL_BASE = '1111111111111111111111111111111111111111';
const CURRENT_BASE = '2222222222222222222222222222222222222222';
const COMMIT_SHA = '3333333333333333333333333333333333333333';
const PATH = 'content/culture/rollback-integration.md';

async function seedFailedPublication() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8 rollback integration',
      slug: `p8-rollback-${suffix}`,
      primaryDomain: `p8-rollback-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  const repository = new PublicationRepository();
  const proposal = await repository.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'Task 13 rollback fixture',
    createdBy: 'editor-1'
  });
  const draft = await repository.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '回滚集成测试',
    slugCandidate: 'rollback-integration',
    body: '# 回滚集成测试\n\n批准版本',
    language: 'zh-CN',
    contentHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
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
    targetPublicUrl: 'https://xingshantang.org/culture/rollback-integration',
    targetRepository: 'liufaxing1978-droid/xingshantang',
    targetBranch: 'main',
    baseSha: ORIGINAL_BASE,
    targetBlobHashes: { [PATH]: 'old-blob' },
    operations: [{ type: 'UPDATE_CONTENT_PAGE', path: PATH, content: '# 回滚集成测试\n\n批准版本' }],
    expectedOutcomes: { publicUrl: 'https://xingshantang.org/culture/rollback-integration' },
    validatorVersion: 'PUBLICATION_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'REVERT_COMMIT',
    planHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
  const preview = await repository.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    diffSummary: '0 created, 1 modified, 0 deleted',
    diffPayload: { unifiedDiff: '--- a/file\n+++ b/file\n-old\n+approved' }
  });
  const approval = await repository.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    previewHash: preview.previewHash,
    baseSha: ORIGINAL_BASE,
    approverActorId: 'approver-1',
    approvedRiskClass: 'LOW'
  });
  const execution = await repository.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `rollback-${project.id}`,
    status: 'VERIFICATION_FAILED',
    branchName: 'seogeo/p8/rollback-integration',
    commitSha: COMMIT_SHA,
    pullRequestNo: 99,
    pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/99'
  });
  const verification = await repository.createVerification({
    projectId: project.id,
    executionId: execution.id,
    status: 'FAILED',
    observedUrl: plan.targetPublicUrl,
    observedAt: new Date(),
    httpStatus: 200,
    indexable: false,
    reasonCode: 'NOINDEX_DETECTED'
  });
  return { project, repository, plan, preview, execution, verification };
}

describe('P8-A repair/rollback persistence', () => {
  it('stores a fresh-review rollback proposal against the current repo base without creating an approval or remote write', async () => {
    const seeded = await seedFailedPublication();
    const rollback = vi.fn(async () => ({
      status: 'READY' as const,
      strategy: 'REVERT_COMMIT',
      remoteWritePerformed: false,
      artifactSha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    }));
    const adapter = {
      capability: 'DRAFT_PR' as const,
      readTargetSnapshot: vi.fn(async () => ({
        repositoryIdentity: 'liufaxing1978-droid/xingshantang',
        branch: 'main',
        headSha: CURRENT_BASE,
        touchedBlobShas: { [PATH]: 'current-blob' }
      })),
      rollback
    };
    const approvalsBefore = await prisma.publicationApproval.count({
      where: { projectId: seeded.project.id }
    });
    const planner = new PublicationRollbackPlanner({
      repository: seeded.repository,
      adapter: adapter as never
    });

    const created = await planner.createRollbackProposal(seeded.execution.id, 'approver-2');
    const stored = await prisma.publicationRollbackProposal.findUniqueOrThrow({
      where: { id: created.id }
    });
    const payload = stored.payload as any;

    expect(stored).toMatchObject({
      projectId: seeded.project.id,
      executionId: seeded.execution.id,
      strategy: 'REVERT_COMMIT',
      status: 'PROPOSED',
      proposedBy: 'approver-2'
    });
    expect(payload).toMatchObject({
      kind: 'ROLLBACK',
      requiresFreshApproval: true,
      remoteWritePerformed: false,
      source: {
        executionId: seeded.execution.id,
        commitSha: COMMIT_SHA,
        planId: seeded.plan.id,
        planHash: seeded.plan.planHash,
        previewHash: seeded.preview.previewHash
      },
      plan: {
        baseSha: CURRENT_BASE,
        originalBaseSha: ORIGINAL_BASE,
        touchedBlobShas: { [PATH]: 'current-blob' },
        forceReset: false,
        autoMerge: false
      }
    });
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(await prisma.publicationApproval.count({ where: { projectId: seeded.project.id } }))
      .toBe(approvalsBefore);
  });

  it('turns failed verification into a repair proposal without invoking rollback', async () => {
    const seeded = await seedFailedPublication();
    const rollback = vi.fn(async () => {
      throw new Error('repair must not invoke rollback');
    });
    const adapter = {
      capability: 'DRAFT_PR' as const,
      readTargetSnapshot: vi.fn(async () => ({
        repositoryIdentity: 'liufaxing1978-droid/xingshantang',
        branch: 'main',
        headSha: CURRENT_BASE,
        touchedBlobShas: { [PATH]: 'current-blob' }
      })),
      rollback
    };
    const planner = new PublicationRollbackPlanner({
      repository: seeded.repository,
      adapter: adapter as never
    });

    const created = await planner.createRepairProposal(seeded.verification.id, 'editor-2');
    const stored = await prisma.publicationRollbackProposal.findUniqueOrThrow({
      where: { id: created.id }
    });

    expect(stored).toMatchObject({
      executionId: seeded.execution.id,
      strategy: 'REPAIR_VERIFICATION_FAILURE',
      status: 'PROPOSED',
      reasonCode: 'NOINDEX_DETECTED',
      proposedBy: 'editor-2'
    });
    expect(stored.payload).toMatchObject({
      kind: 'REPAIR',
      verificationId: seeded.verification.id,
      requiresFreshApproval: true,
      remoteWritePerformed: false
    });
    expect(rollback).not.toHaveBeenCalled();
  });
});
