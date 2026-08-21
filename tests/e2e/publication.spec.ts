import { PrismaClient, type PlanLevel } from '@prisma/client';
import { expect, test } from '@playwright/test';

const prisma = new PrismaClient();
const projectIds: string[] = [];

async function cleanupProject(projectId: string) {
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

test.afterAll(async () => {
  for (const projectId of projectIds) await cleanupProject(projectId);
  await prisma.$disconnect();
});

async function createProject(label: string, planLevel: PlanLevel) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-A ${label}`,
      slug: `p8a-publication-${suffix}`,
      primaryDomain: `p8a-publication-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedWorkflow(input: {
  label: string;
  planLevel: PlanLevel;
  executionStatus?: 'VERIFIED' | 'STALE_REVIEW_REQUIRED';
  canonicalBlocked?: boolean;
}) {
  const project = await createProject(input.label, input.planLevel);
  const gitEnabled = input.planLevel !== 'STANDARD';
  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: '兴善堂主站',
      domain: project.primaryDomain,
      repositoryIdentity: gitEnabled ? 'liufaxing1978-droid/xingshantang' : 'export-only',
      baseBranch: 'main',
      adapterType: gitEnabled ? 'GITHUB_GIT' : 'EXPORT_ONLY',
      writeCapability: gitEnabled ? 'GIT_DRAFT_PR' : 'EXPORT_ONLY',
      allowedPaths: ['content/culture/'],
      enabled: true
    }
  });
  const channel = await prisma.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/culture',
      displayName: '六壬文化',
      repositoryPathTemplate: 'content/culture/{slug}.md',
      contentType: 'ARTICLE',
      defaultSchemaTypes: ['Article'],
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      enabled: true
    }
  });
  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P7_GROWTH_OPPORTUNITY',
      reason: 'P7 Growth：六壬文化存在 NEW_CONTENT_OPPORTUNITY',
      createdBy: 'growth-materialization',
      sourceReferenceId: `growth-${project.id}`,
      sourceSnapshotId: `snapshot-${project.id}`,
      sourceMetadata: {
        normalizedQuery: '六壬文化',
        opportunityType: 'NEW_CONTENT_OPPORTUNITY',
        priority: 'HIGH',
        score: 82
      }
    }
  });

  const contentHash = 'c'.repeat(64);
  const targetUrl = `https://${project.primaryDomain}/culture/liuren-history`;
  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: '六壬文化历史与传承',
      slugCandidate: 'liuren-history',
      body: '# 六壬文化历史与传承\n\n这是 P8-A 浏览器测试内容。',
      excerpt: '六壬文化历史与传承测试摘要',
      metaTitle: '六壬文化历史与传承｜兴善堂',
      metaDescription: '六壬文化历史与传承的测试页面。',
      canonicalCandidate: input.canonicalBlocked ? `https://${project.primaryDomain}/wrong` : targetUrl,
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
      author: '兴善堂',
      language: 'zh-CN',
      currentVersion: 1,
      currentContentHash: contentHash,
      status: 'READY_FOR_REVIEW',
      generatedBy: 'HUMAN'
    }
  });
  await prisma.contentDraftVersion.create({
    data: {
      draftId: draft.id,
      version: 1,
      title: draft.title,
      slugCandidate: draft.slugCandidate,
      body: draft.body,
      excerpt: draft.excerpt,
      metaTitle: draft.metaTitle,
      metaDescription: draft.metaDescription,
      canonicalCandidate: draft.canonicalCandidate,
      schemaJson: draft.schemaJson ?? undefined,
      author: draft.author,
      language: draft.language,
      contentHash,
      generatedBy: 'HUMAN'
    }
  });
  await prisma.contentSourceReference.create({
    data: {
      projectId: project.id,
      draftId: draft.id,
      title: '六壬文化研究资料',
      sourceUrl: 'https://example.com/source',
      sourceType: 'WEB_SOURCE',
      userProvided: true
    }
  });

  const baseSha = 'b'.repeat(40);
  const targetPath = 'content/culture/liuren-history.md';
  const planHash = 'a'.repeat(64);
  const plan = await prisma.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: targetUrl,
      targetRepository: site.repositoryIdentity ?? 'export-only',
      targetBranch: 'main',
      baseSha,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: targetPath,
        targetUrl,
        contentHash,
        content: draft.body,
        title: draft.title,
        canonicalCandidate: draft.canonicalCandidate
      }],
      expectedOutcomes: {
        publicUrl: targetUrl,
        title: draft.title,
        metaDescription: draft.metaDescription,
        canonical: targetUrl,
        h1: draft.title,
        indexable: true,
        schemaTypes: ['Article'],
        contentFingerprint: contentHash
      },
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: input.canonicalBlocked ? 'MEDIUM' : 'LOW',
      rollbackStrategy: 'REVERT_PR',
      planHash
    }
  });

  const blockingCodes = input.canonicalBlocked ? ['CANONICAL_MISMATCH'] : [];
  const previewHash = 'e'.repeat(64);
  const preview = await prisma.publicationPreview.create({
    data: {
      projectId: project.id,
      planId: plan.id,
      previewHash,
      diffSummary: '1 created, 0 modified, 0 deleted',
      diffPayload: {
        filesCreated: [targetPath],
        filesModified: [],
        filesDeleted: [],
        unifiedDiff: `--- /dev/null\n+++ b/${targetPath}\n+${draft.title}`,
        baseSha,
        riskClass: input.canonicalBlocked ? 'MEDIUM' : 'LOW',
        planHash
      },
      validationResult: {
        validatorVersion: 'PUBLICATION_VALIDATOR_V1',
        findings: input.canonicalBlocked
          ? [{ severity: 'BLOCKING', code: 'CANONICAL_MISMATCH', message: 'Canonical mismatch' }]
          : [],
        blockingCodes,
        warningCodes: [],
        infoCodes: [],
        unconfirmedWarningCodes: [],
        canCreatePlan: !input.canonicalBlocked
      }
    }
  });

  let execution: { id: string } | null = null;
  let verification: { id: string } | null = null;
  if (input.executionStatus) {
    const approval = await prisma.publicationApproval.create({
      data: {
        projectId: project.id,
        planId: plan.id,
        planVersion: 1,
        planHash,
        contentVersion: 1,
        contentHash,
        previewHash,
        baseSha,
        targetRepository: site.repositoryIdentity ?? 'export-only',
        targetBranch: 'main',
        targetBlobHashes: {},
        approverActorId: `project-api:${project.id}`,
        approvedRiskClass: input.canonicalBlocked ? 'MEDIUM' : 'LOW',
        confirmedWarningCodes: []
      }
    });
    execution = await prisma.publicationExecution.create({
      data: {
        projectId: project.id,
        planId: plan.id,
        approvalId: approval.id,
        executionKey: `e2e-${project.id}-${input.executionStatus}`,
        status: input.executionStatus,
        branchName: gitEnabled ? `seogeo/p8/article-${plan.id}` : null,
        commitSha: gitEnabled ? 'f'.repeat(40) : null,
        pullRequestNo: gitEnabled ? 321 : null,
        pullRequestUrl: gitEnabled ? 'https://github.com/example/repo/pull/321' : null,
        errorCode: input.executionStatus === 'STALE_REVIEW_REQUIRED' ? 'TARGET_REVISION_CHANGED' : null
      }
    });
    await prisma.publicationExecutionEvent.create({
      data: {
        executionId: execution.id,
        eventType: input.executionStatus === 'VERIFIED' ? 'VERIFIED' : 'STALE_REVIEW_REQUIRED',
        fromStatus: input.executionStatus === 'VERIFIED' ? 'VERIFYING' : 'APPROVED',
        toStatus: input.executionStatus,
        reasonCode: input.executionStatus === 'VERIFIED' ? 'VERIFICATION_PASSED' : 'TARGET_REVISION_CHANGED'
      }
    });
    verification = await prisma.publicationVerification.create({
      data: {
        projectId: project.id,
        executionId: execution.id,
        status: input.executionStatus === 'VERIFIED' ? 'VERIFIED' : 'FAILED',
        observedUrl: targetUrl,
        observedAt: new Date(),
        httpStatus: 200,
        titleMatches: input.executionStatus === 'VERIFIED',
        descriptionMatches: input.executionStatus === 'VERIFIED',
        canonicalMatches: input.executionStatus === 'VERIFIED',
        h1Matches: input.executionStatus === 'VERIFIED',
        indexable: true,
        schemaValid: true,
        contentFingerprintOk: input.executionStatus === 'VERIFIED',
        regressionFindings: input.executionStatus === 'VERIFIED' ? [] : ['TARGET_REVISION_CHANGED'],
        reasonCode: input.executionStatus === 'VERIFIED' ? null : 'TARGET_REVISION_CHANGED'
      }
    });
  }

  return { project, site, channel, proposal, draft, plan, preview, execution, verification };
}

test('renders the persisted P8-A publication workflow from opportunity to VERIFIED', async ({ page }) => {
  const fixture = await seedWorkflow({
    label: 'verified workspace',
    planLevel: 'ADVANCED',
    executionStatus: 'VERIFIED'
  });

  await page.goto(`/projects/${fixture.project.id}/publication`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '内容与发布' })).toBeVisible();
  await expect(page.getByRole('link', { name: '内容与发布', exact: true })).toHaveClass(/active/);
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('P7 Growth：六壬文化存在 NEW_CONTENT_OPPORTUNITY')).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/opportunities`);
  await expect(page.getByRole('heading', { level: 1, name: '内容机会' })).toBeVisible();
  await expect(page.getByText('NEW_CONTENT_OPPORTUNITY')).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/drafts`);
  await expect(page.getByRole('heading', { level: 1, name: '内容草稿' })).toBeVisible();
  await expect(page.getByRole('link', { name: '六壬文化历史与传承' })).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/drafts/${fixture.draft.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '六壬文化历史与传承' })).toBeVisible();
  await expect(page.getByText('确定性验证', { exact: true })).toBeVisible();
  await expect(page.getByText('DeepSeek 建议', { exact: true })).toBeVisible();
  await expect(page.getByText('AI 推荐，人来决定')).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/plans/${fixture.plan.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '发布预览' })).toBeVisible();
  await expect(page.getByText(fixture.plan.targetPublicUrl, { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.plan.baseSha, { exact: true })).toBeVisible();
  await expect(page.getByText('content/culture/liuren-history.md', { exact: true })).toBeVisible();
  await expect(page.getByText('1 created, 0 modified, 0 deleted')).toBeVisible();
  await expect(page.getByText('LOW', { exact: true })).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/executions/${fixture.execution!.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '发布执行' })).toBeVisible();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('Draft PR #321')).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/verifications/${fixture.verification!.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '发布验证' })).toBeVisible();
  await expect(page.getByText('技术验证', { exact: true })).toBeVisible();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('canonical')).toBeVisible();
});

test('shows stale approval and deterministic canonical blockers without claiming success', async ({ page }) => {
  const fixture = await seedWorkflow({
    label: 'stale workspace',
    planLevel: 'ADVANCED',
    executionStatus: 'STALE_REVIEW_REQUIRED',
    canonicalBlocked: true
  });

  await page.goto(`/projects/${fixture.project.id}/publication/plans/${fixture.plan.id}`);
  await expect(page.getByText('CANONICAL_MISMATCH', { exact: true })).toBeVisible();
  await expect(page.getByText('审批不可用')).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/publication/executions/${fixture.execution!.id}`);
  await expect(page.getByText('STALE_REVIEW_REQUIRED', { exact: true })).toBeVisible();
  await expect(page.getByText('审批已失效，需要重新审核')).toBeVisible();
  await expect(page.getByText('VERIFIED', { exact: true })).toHaveCount(0);
});

test('keeps STANDARD publication workspace export-only and hides Git execution controls', async ({ page }) => {
  const fixture = await seedWorkflow({
    label: 'standard export workspace',
    planLevel: 'STANDARD'
  });

  await page.goto(`/projects/${fixture.project.id}/publication`);
  await expect(page.getByRole('heading', { level: 1, name: '内容与发布' })).toBeVisible();
  await expect(page.getByText('EXPORT_ONLY', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '执行 Draft PR' })).toHaveCount(0);
  await expect(page.getByText('Standard 套餐仅提供导出补丁，不执行 Git 写入。')).toBeVisible();
});
