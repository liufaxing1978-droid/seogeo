import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';
import {
  processPublicationVerificationJob,
  type PublicationVerificationWorkerDeps
} from '../../src/modules/publication/publication-verification.worker.js';
import {
  publicationContentFingerprintV1,
  type PublicationHtmlResponse
} from '../../src/modules/publication/publication-verifier.js';

const projectIds: string[] = [];
const URL = 'https://xingshantang.org/culture/verification-test';
const BASE_SHA = '1111111111111111111111111111111111111111';
const CONTENT_HASH = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PLAN_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PREVIEW_HASH = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'content/culture/verification-test.md';
const EXPECTED_TEXT = '这是已经部署到公开网站的新版本正文。';

function publicHtml(input: {
  mainText: string;
  robots?: string;
  status?: number;
}): PublicationHtmlResponse {
  return {
    status: input.status ?? 200,
    url: URL,
    body: `<!doctype html>
<html lang="zh-CN">
<head>
  <title>部署验证测试｜兴善堂</title>
  <meta name="description" content="验证公开网站上的真实部署结果。">
  <meta name="robots" content="${input.robots ?? 'index,follow'}">
  <link rel="canonical" href="${URL}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
</head>
<body>
  <main><h1>部署验证测试</h1><p>${input.mainText}</p></main>
</body>
</html>`
  };
}

async function createProject() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8 verification integration',
      slug: `p8-verification-${suffix}`,
      primaryDomain: `p8-verification-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedExecution(initialStatus: 'DEPLOYED' = 'DEPLOYED') {
  const repository = new PublicationRepository();
  const project = await createProject();
  const proposal = await repository.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'Task 12 verification fixture',
    createdBy: 'editor-1'
  });
  const draft = await repository.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '部署验证测试',
    slugCandidate: 'verification-test',
    body: `# 部署验证测试\n\n${EXPECTED_TEXT}`,
    metaTitle: '部署验证测试｜兴善堂',
    metaDescription: '验证公开网站上的真实部署结果。',
    canonicalCandidate: URL,
    schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
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
    targetPublicUrl: URL,
    targetRepository: 'liufaxing1978-droid/xingshantang',
    targetBranch: 'main',
    baseSha: BASE_SHA,
    targetBlobHashes: {},
    operations: [{
      type: 'CREATE_CONTENT_PAGE',
      path: PATH,
      targetUrl: URL,
      contentHash: CONTENT_HASH,
      content: `# 部署验证测试\n\n${EXPECTED_TEXT}`
    }],
    expectedOutcomes: {
      publicUrl: URL,
      title: '部署验证测试｜兴善堂',
      metaDescription: '验证公开网站上的真实部署结果。',
      canonical: URL,
      h1: '部署验证测试',
      indexable: true,
      schemaTypes: ['Article'],
      contentFingerprint: publicationContentFingerprintV1(EXPECTED_TEXT)
    },
    validatorVersion: 'PUBLICATION_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'REVERT_COMMIT',
    planHash: PLAN_HASH
  });
  await repository.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: PREVIEW_HASH,
    diffSummary: '1 created, 0 modified, 0 deleted',
    diffPayload: {
      unifiedDiff: `--- /dev/null\n+++ b/${PATH}\n+${EXPECTED_TEXT}`,
      filesCreated: [PATH],
      filesModified: [],
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
    executionKey: `verification-${project.id}`,
    status: initialStatus,
    branchName: 'seogeo/p8/verification-test-aaaaaaaaaaaa',
    commitSha: '2222222222222222222222222222222222222222',
    pullRequestNo: 88,
    pullRequestUrl: 'https://github.com/liufaxing1978-droid/xingshantang/pull/88'
  });
  return { project, execution };
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.publicationVerification.deleteMany({ where: { projectId } }).catch(() => undefined);
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

describe('P8-A real-site verification lifecycle', () => {
  it('keeps a reliably supplied DEPLOYED execution unverified until the public content is actually observed', async () => {
    const { execution } = await seedExecution();
    let fetchCalls = 0;
    let response = publicHtml({ mainText: '公开网站仍然是旧版本正文。' });
    const deps: PublicationVerificationWorkerDeps = {
      fetchTarget: async () => {
        fetchCalls += 1;
        return response;
      },
      emit: () => undefined
    };
    const job = { name: 'verify', data: { executionId: execution.id } };

    await processPublicationVerificationJob(job, deps);

    const afterOldPage = await prisma.publicationExecution.findUniqueOrThrow({
      where: { id: execution.id }
    });
    expect(afterOldPage.status).toBe('DEPLOYED');

    const firstVerification = await prisma.publicationVerification.findFirstOrThrow({
      where: { executionId: execution.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(firstVerification).toMatchObject({
      status: 'UNKNOWN',
      reasonCode: 'DEPLOYMENT_NOT_OBSERVED',
      observedUrl: URL,
      httpStatus: 200,
      contentFingerprintOk: false
    });
    expect(fetchCalls).toBe(1);

    const firstEvents = await prisma.publicationExecutionEvent.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(firstEvents.map((event) => [event.fromStatus, event.toStatus, event.eventType, event.reasonCode])).toEqual([
      ['DEPLOYED', 'VERIFYING', 'VERIFICATION_STARTED', 'VERIFICATION_STARTED'],
      ['VERIFYING', 'DEPLOYED', 'DEPLOYED', 'DEPLOYMENT_NOT_OBSERVED']
    ]);

    response = publicHtml({ mainText: EXPECTED_TEXT });
    await processPublicationVerificationJob(job, deps);

    const verified = await prisma.publicationExecution.findUniqueOrThrow({
      where: { id: execution.id }
    });
    expect(verified.status).toBe('VERIFIED');

    const verifications = await prisma.publicationVerification.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(verifications.map((row) => [row.status, row.reasonCode])).toEqual([
      ['UNKNOWN', 'DEPLOYMENT_NOT_OBSERVED'],
      ['VERIFIED', null]
    ]);
    expect(fetchCalls).toBe(2);

    const eventsBeforeDuplicate = await prisma.publicationExecutionEvent.count({
      where: { executionId: execution.id }
    });
    await processPublicationVerificationJob(job, deps);
    expect(fetchCalls).toBe(2);
    expect(await prisma.publicationVerification.count({ where: { executionId: execution.id } })).toBe(2);
    expect(await prisma.publicationExecutionEvent.count({ where: { executionId: execution.id } }))
      .toBe(eventsBeforeDuplicate);
  });

  it('persists a deterministic regression and blocks VERIFIED after deployment was observed', async () => {
    const { execution } = await seedExecution();
    const deps: PublicationVerificationWorkerDeps = {
      fetchTarget: async () => publicHtml({ mainText: EXPECTED_TEXT, robots: 'noindex,follow' }),
      emit: () => undefined
    };

    await processPublicationVerificationJob(
      { name: 'verify', data: { executionId: execution.id } },
      deps
    );

    const stored = await prisma.publicationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    expect(stored.status).toBe('VERIFICATION_FAILED');

    const verification = await prisma.publicationVerification.findFirstOrThrow({
      where: { executionId: execution.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(verification).toMatchObject({
      status: 'FAILED',
      reasonCode: 'NOINDEX_DETECTED',
      httpStatus: 200,
      contentFingerprintOk: true,
      indexable: false
    });

    const events = await prisma.publicationExecutionEvent.findMany({
      where: { executionId: execution.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    expect(events.map((event) => [event.fromStatus, event.toStatus, event.eventType, event.reasonCode])).toEqual([
      ['DEPLOYED', 'VERIFYING', 'VERIFICATION_STARTED', 'VERIFICATION_STARTED'],
      ['VERIFYING', 'VERIFICATION_FAILED', 'VERIFICATION_FAILED', 'NOINDEX_DETECTED']
    ]);
  });
});
