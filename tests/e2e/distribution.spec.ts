import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const prisma = new PrismaClient();
const projectIds: string[] = [];

async function seedVerifiedPrimary() {
  const publication = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8-B 多渠道分发',
      slug: `p8b-distribution-e2e-${suffix}`,
      primaryDomain: `p8b-distribution-e2e-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'P8-B distribution E2E fixture',
    createdBy: 'test-user'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: '六壬文化主站原创文章',
    body: '这是主站原创内容。',
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
  const originalUrl = `https://${project.primaryDomain}/culture/original-article`;
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
    baseSha: `distribution-e2e-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `distribution-e2e-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `distribution-e2e-preview-${project.id}`,
    diffSummary: 'distribution e2e fixture'
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
    executionKey: `distribution-e2e-execution-${project.id}`,
    status: 'VERIFIED'
  });
  return { project, execution, originalUrl };
}

async function seedDistributionStates() {
  const primary = await seedVerifiedPrimary();
  const distribution = new DistributionRepository();

  const medium = await distribution.ensureTarget({
    projectId: primary.project.id,
    publicationId: primary.execution.id,
    platform: 'MEDIUM',
    mode: 'CANONICAL_REPOST',
    targetKey: 'default'
  });
  const mediumArtifact = await distribution.createArtifact(medium.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-canonical-repost-v1',
    artifactVersion: 1,
    artifactHash: `medium-${medium.id}`,
    title: 'Medium Canonical Repost',
    body: 'Medium 手工分发正文',
    summary: 'Medium 摘要',
    tags: ['兴善堂'],
    originalUrl: primary.originalUrl,
    canonicalUrl: primary.originalUrl,
    sourceRefs: [] as any,
    platformMetadata: {} as any
  });
  await distribution.appendTargetEvent(medium.id, {
    artifactId: mediumArtifact.id,
    toStatus: 'APPROVED',
    reasonCode: 'ARTIFACT_APPROVED',
    sourceContentVersion: 1
  });
  await distribution.appendTargetEvent(medium.id, {
    artifactId: mediumArtifact.id,
    toStatus: 'MANUAL_ACTION_REQUIRED',
    reasonCode: 'DISTRIBUTION_MANUAL_ONLY',
    sourceContentVersion: 1
  });

  const wordpress = await distribution.ensureTarget({
    projectId: primary.project.id,
    publicationId: primary.execution.id,
    platform: 'WORDPRESS',
    mode: 'SECONDARY_SITE',
    targetKey: 'secondary-site'
  });
  const wordpressArtifact = await distribution.createArtifact(wordpress.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-adapted-article-v1',
    artifactVersion: 1,
    artifactHash: `wordpress-${wordpress.id}`,
    title: 'WordPress Secondary Article',
    body: 'WordPress 已验证分发正文',
    summary: 'WordPress 摘要',
    tags: ['兴善堂'],
    originalUrl: primary.originalUrl,
    canonicalUrl: primary.originalUrl,
    sourceRefs: [] as any,
    platformMetadata: {} as any
  });
  await distribution.appendTargetEvent(wordpress.id, {
    artifactId: wordpressArtifact.id,
    toStatus: 'APPROVED',
    reasonCode: 'ARTIFACT_APPROVED',
    sourceContentVersion: 1
  });
  await distribution.appendTargetEvent(wordpress.id, {
    artifactId: wordpressArtifact.id,
    toStatus: 'PUBLISHED',
    reasonCode: 'DISTRIBUTION_PUBLISH_COMPLETED',
    sourceContentVersion: 1,
    metadata: {
      capability: 'PUBLISH_API',
      providerId: 'wp-1',
      publicUrl: 'https://secondary.example.test/article',
      status: 'published'
    }
  });
  await distribution.appendTargetEvent(wordpress.id, {
    artifactId: wordpressArtifact.id,
    toStatus: 'VERIFIED',
    reasonCode: 'DISTRIBUTION_VERIFY_COMPLETED',
    sourceContentVersion: 1,
    metadata: { capability: 'PUBLISH_API', publicUrl: 'https://secondary.example.test/article' }
  });

  const outdated = await distribution.ensureTarget({
    projectId: primary.project.id,
    publicationId: primary.execution.id,
    platform: 'SUBSTACK',
    mode: 'SUMMARY',
    targetKey: 'newsletter'
  });
  const outdatedArtifact = await distribution.createArtifact(outdated.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-summary-v1',
    artifactVersion: 1,
    artifactHash: `substack-${outdated.id}`,
    title: 'Outdated Summary',
    body: '旧 V1 摘要',
    summary: '旧 V1 摘要',
    tags: ['兴善堂'],
    originalUrl: primary.originalUrl,
    canonicalUrl: null,
    sourceRefs: [] as any,
    platformMetadata: {} as any
  });
  await distribution.appendTargetEvent(outdated.id, {
    artifactId: outdatedArtifact.id,
    toStatus: 'OUTDATED',
    reasonCode: 'SOURCE_CONTENT_VERSION_CHANGED',
    sourceContentVersion: 2
  });

  return { ...primary, medium, mediumArtifact, wordpress, wordpressArtifact, outdated, outdatedArtifact };
}

test.afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test('renders ORIGINAL ownership, platform capability and independent distribution lifecycle states', async ({ page }) => {
  const fixture = await seedDistributionStates();

  await page.goto(`/projects/${fixture.project.id}/distribution`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: '多渠道分发' })).toBeVisible();
  await expect(page.getByRole('link', { name: '多渠道分发', exact: true })).toHaveClass(/active/);
  await expect(page.getByText('ORIGINAL', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.originalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText('MEDIUM', { exact: true })).toBeVisible();
  await expect(page.getByText('MANUAL_ACTION_REQUIRED', { exact: true })).toBeVisible();
  await expect(page.getByText('WORDPRESS', { exact: true })).toBeVisible();
  await expect(page.getByText('PUBLISH_API', { exact: true })).toBeVisible();
  await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('OUTDATED', { exact: true })).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/distribution/targets/${fixture.medium.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '分发目标' })).toBeVisible();
  await expect(page.getByText('MANUAL_HANDOFF', { exact: true })).toBeVisible();
  await expect(page.getByText('人工发布 / 回填结果')).toBeVisible();
  await expect(page.getByRole('button', { name: '自动发布' })).toHaveCount(0);

  await page.goto(`/projects/${fixture.project.id}/distribution/targets/${fixture.wordpress.id}/artifacts/${fixture.wordpressArtifact.id}`);
  await expect(page.getByRole('heading', { level: 1, name: '分发产物' })).toBeVisible();
  await expect(page.getByText('WordPress Secondary Article', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.originalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText('https://secondary.example.test/article', { exact: true })).toBeVisible();
});
