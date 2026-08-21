import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';
import { processPublicationExecutionJob } from '../../src/modules/publication/publication-execution.worker.js';
import type {
  MutationAdapter,
  TargetRef
} from '../../src/modules/publication/mutation-adapter.js';

const projectIds: string[] = [];
const BASE_SHA = '1111111111111111111111111111111111111111';
const COMMIT_SHA = '2222222222222222222222222222222222222222';
const CONTENT_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'content/culture/execution-test.md';

class IntegrationAdapter implements MutationAdapter {
  readonly capability = 'DRAFT_PR' as const;
  reads = 0;
  applies = 0;

  async readTargetSnapshot(input: TargetRef) {
    this.reads += 1;
    return {
      repositoryIdentity: input.repositoryIdentity,
      branch: input.branch,
      headSha: BASE_SHA,
      touchedBlobShas: { [PATH]: 'blob-a' }
    };
  }

  async preview() {
    throw new Error('not used');
  }

  async apply() {
    this.applies += 1;
    return {
      capability: 'DRAFT_PR' as const,
      status: 'APPLIED' as const,
      remoteWritePerformed: true,
      branchName: 'seogeo/p8/execution-test-aaaaaaaaaaaa',
      commitSha: COMMIT_SHA,
      pullRequestNo: 77,
      pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/77'
    };
  }

  async readExecutionState() {
    return { status: 'PENDING' as const, remoteStateKnown: false };
  }

  async rollback() {
    return { status: 'READY' as const, strategy: 'REVERT_COMMIT', remoteWritePerformed: false };
  }
}

async function createProject() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8 execution integration',
      slug: `p8-execution-${suffix}`,
      primaryDomain: `p8-execution-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.publicationExecutionEvent.deleteMany({ where: { execution: { projectId } } }).catch(() => undefined);
    await prisma.publicationExecution.deleteMany({ where: { projectId } }).catch(() => undefined);
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

describe('P8-A publication execution persistence', () => {
  it('persists APPROVED -> QUEUED -> EXECUTING -> PR_CREATED once and ignores duplicate delivery', async () => {
    const repository = new PublicationRepository();
    const project = await createProject();
    const proposal = await repository.createProposal({
      projectId: project.id,
      sourceType: 'MANUAL',
      reason: 'Task 11 integration fixture',
      createdBy: 'editor-1'
    });
    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: '执行队列测试',
      slugCandidate: 'execution-test',
      body: '# 执行队列测试\n\nnew body',
      canonicalCandidate: 'https://xingshantang.org/culture/execution-test',
      language: 'zh-CN',
      contentHash: CONTENT_HASH,
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
      targetPublicUrl: 'https://xingshantang.org/culture/execution-test',
      targetRepository: 'liufaxing1978-droid/xingshantang',
      targetBranch: 'main',
      baseSha: BASE_SHA,
      targetBlobHashes: { [PATH]: 'blob-a' },
      operations: [{
        type: 'UPDATE_CONTENT_PAGE',
        path: PATH,
        targetUrl: 'https://xingshantang.org/culture/execution-test',
        contentHash: CONTENT_HASH,
        content: '# 执行队列测试\n\nnew body'
      }],
      expectedOutcomes: { publicUrl: 'https://xingshantang.org/culture/execution-test' },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: PLAN_HASH
    });
    await repository.createPreview({
      projectId: project.id,
      planId: plan.id,
      previewHash: PREVIEW_HASH,
      diffSummary: '0 created, 1 modified, 0 deleted',
      diffPayload: {
        unifiedDiff: `--- a/${PATH}\n+++ b/${PATH}\n-old\n+new`,
        filesCreated: [],
        filesModified: [PATH],
        filesDeleted: []
      },
      validationResult: {
        canCreatePlan: true,
        warningCodes: [],
        blockingCodes: [],
        unconfirmedWarningCodes: []
      }
    });
    const approval = await repository.createApproval({
      projectId: project.id,
      planId: plan.id,
      planVersion: 1,
      planHash: PLAN_HASH,
      contentHash: CONTENT_HASH,
      previewHash: PREVIEW_HASH,
      baseSha: BASE_SHA,
      approverActorId: 'approver-1',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    });
    const execution = await repository.createExecution({
      projectId: project.id,
      planId: plan.id,
      approvalId: approval.id,
      executionKey: 'execution-key-task-11',
      status: 'APPROVED'
    });

    const adapter = new IntegrationAdapter();
    const job = { name: 'execute', data: { executionId: execution.id } };
    const deps = {
      resolveAdapter: () => adapter,
      emit: () => undefined
    };

    await processPublicationExecutionJob(job, deps);

    const stored = await prisma.publicationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(stored).toMatchObject({
      status: 'PR_CREATED',
      branchName: 'seogeo/p8/execution-test-aaaaaaaaaaaa',
      commitSha: COMMIT_SHA,
      pullRequestNo: 77,
      pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/77',
      errorCode: null
    });
    expect(stored.startedAt).toBeInstanceOf(Date);
    expect(stored.completedAt).toBeInstanceOf(Date);

    const firstEvents = await prisma.publicationExecutionEvent.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(firstEvents.map((event) => [event.fromStatus, event.toStatus, event.eventType, event.reasonCode])).toEqual([
      ['APPROVED', 'QUEUED', 'QUEUED', 'EXECUTION_QUEUED'],
      ['QUEUED', 'EXECUTING', 'STARTED', 'EXECUTION_STARTED'],
      ['EXECUTING', 'PR_CREATED', 'PR_CREATED', 'DRAFT_PR_CREATED']
    ]);
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);

    await processPublicationExecutionJob(job, deps);

    const secondEvents = await prisma.publicationExecutionEvent.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(secondEvents).toEqual(firstEvents);
    expect(adapter.reads).toBe(1);
    expect(adapter.applies).toBe(1);
  });
});
