import { PrismaClient, type PlanLevel } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { DistributionRepository } from '../../src/modules/distribution/distribution.repository.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const prisma = new PrismaClient();
const projectIds: string[] = [];

async function seedVerifiedPrimary(planLevel: PlanLevel, label: string) {
  const publication = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P8-C ${label}`,
      slug: `p8c-${label.toLowerCase()}-${suffix}`,
      primaryDomain: `p8c-${label.toLowerCase()}-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);

  const proposal = await publication.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: `P8-C ${label} E2E fixture`,
    createdBy: 'test-user'
  });
  const draft = await publication.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: `P8-C ${label} 主站原创文章`,
    body: '这是主站唯一原创内容。',
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
  const originalUrl = `https://${project.primaryDomain}/research/original-source`;
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
    baseSha: `p8c-e2e-${project.id}`,
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `p8c-e2e-plan-${project.id}`
  });
  const preview = await publication.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `p8c-e2e-preview-${project.id}`,
    diffSummary: 'P8-C review workspace fixture'
  });
  const approval = await publication.createApproval({
    projectId: project.id,
    planId: plan.id,
    planVersion: 1,
    planHash: plan.planHash,
    contentHash: `p8c-e2e-content-${project.id}`,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: 'test-user',
    approvedRiskClass: 'LOW'
  });
  const execution = await publication.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `p8c-e2e-execution-${project.id}`,
    status: 'VERIFIED'
  });

  return { project, execution, originalUrl };
}

async function seedCommunityFixture() {
  const primary = await seedVerifiedPrimary('ADVANCED', 'Community');
  const distribution = new DistributionRepository();
  const question = '如何评价六壬文化在现代民间信仰研究中的位置？';
  const topicUrl = 'https://reddit.example.test/r/chinesehistory/topic';
  const target = await distribution.ensureTarget({
    projectId: primary.project.id,
    publicationId: primary.execution.id,
    platform: 'REDDIT',
    mode: 'COMMUNITY_DRAFT',
    targetKey: 'approved-topic',
    targetContext: {
      sourceType: 'USER',
      question,
      topicUrl,
      includeBrandLink: false
    }
  });
  const artifact = await distribution.createArtifact(target.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-community-draft-v1',
    artifactVersion: 1,
    artifactHash: `community-${target.id}`,
    title: 'Reddit Community Draft',
    body: '这是待人工审阅并发布的社区回答草稿。',
    summary: '社区回答摘要',
    tags: ['民间信仰'],
    originalUrl: primary.originalUrl,
    canonicalUrl: null,
    sourceRefs: ['PUBLICATION_EXECUTION:primary'] as any,
    platformMetadata: {
      kind: 'COMMUNITY_DRAFT',
      question,
      topicUrl,
      includeBrandLink: false,
      promotionalLanguageDetected: false,
      brandLinkIncluded: false,
      contextHash: 'a'.repeat(64),
      providerRaw: 'must-not-render'
    } as any
  });
  await distribution.appendTargetEvent(target.id, {
    artifactId: artifact.id,
    toStatus: 'APPROVED',
    reasonCode: 'ARTIFACT_APPROVED',
    sourceContentVersion: 1
  });
  await distribution.appendTargetEvent(target.id, {
    artifactId: artifact.id,
    toStatus: 'MANUAL_ACTION_REQUIRED',
    reasonCode: 'DISTRIBUTION_MANUAL_ONLY',
    sourceContentVersion: 1,
    metadata: { capability: 'MANUAL_HANDOFF' }
  });

  return { ...primary, target, artifact, question, topicUrl };
}

async function seedEntityFixture() {
  const primary = await seedVerifiedPrimary('ENTERPRISE', 'Entity');
  const distribution = new DistributionRepository();
  const target = await distribution.ensureTarget({
    projectId: primary.project.id,
    publicationId: primary.execution.id,
    platform: 'WIKIDATA',
    mode: 'ENTITY_SUGGESTION',
    targetKey: 'xingshantang-entity'
  });
  const artifact = await distribution.createArtifact(target.id, {
    sourceContentVersion: 1,
    adaptationVersion: 'distribution-entity-suggestion-v1',
    artifactVersion: 1,
    artifactHash: `entity-${target.id}`,
    title: '兴善堂',
    body: '仅用于人工编辑参考的结构化实体建议。',
    summary: '兴善堂实体建议',
    tags: [],
    originalUrl: primary.originalUrl,
    canonicalUrl: null,
    sourceRefs: [
      'CONTENT_SOURCE_REFERENCE:source-1',
      'CONTENT_SOURCE_REFERENCE:source-2'
    ] as any,
    platformMetadata: {
      kind: 'ENTITY_SUGGESTION',
      entityName: '兴善堂',
      labels: [{ language: 'zh', value: '兴善堂' }],
      descriptions: [{ language: 'zh', value: '传统文化研究与内容平台' }],
      attributes: [{
        property: '领域',
        value: '民间信仰研究',
        sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-1']
      }],
      sameAs: [{
        url: primary.originalUrl,
        sourceRefs: ['CONTENT_SOURCE_REFERENCE:source-2']
      }],
      relationships: [],
      reliableSourceRefs: [
        'CONTENT_SOURCE_REFERENCE:source-1',
        'CONTENT_SOURCE_REFERENCE:source-2'
      ],
      missingData: ['权威成立时间仍缺乏可靠来源'],
      policyReminders: ['提交前检查平台利益冲突与显著性规则'],
      humanChecklist: ['逐项核对可靠来源', '人工编辑确认后再提交'],
      providerRaw: 'must-not-render'
    } as any
  });

  return { ...primary, target, artifact };
}

test.afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test('renders Community GEO as an explicit manual-review workflow without automatic publishing', async ({ page }) => {
  const fixture = await seedCommunityFixture();

  await page.goto(`/projects/${fixture.project.id}/distribution`);
  await expect(page.getByText('ORIGINAL', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.originalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText('Community GEO · 人工发布', { exact: true })).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/distribution/targets/${fixture.target.id}`);
  await expect(page.getByText('MANUAL_HANDOFF', { exact: true })).toBeVisible();
  await expect(page.getByText('Community GEO · 人工发布', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.question, { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.topicUrl, { exact: true })).toBeVisible();
  await expect(page.getByText('品牌链接：未包含', { exact: true })).toBeVisible();
  await expect(page.getByText('推广性语言：未检测', { exact: true })).toBeVisible();
  await expect(page.getByText('人工发布 / 回填结果', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '自动发布' })).toHaveCount(0);
  await expect(page.getByText('must-not-render', { exact: true })).toHaveCount(0);
});

test('renders Entity Suggestion as source-backed prepare-only review with no publish or manual-result controls', async ({ page }) => {
  const fixture = await seedEntityFixture();

  await page.goto(`/projects/${fixture.project.id}/distribution`);
  await expect(page.getByText('ORIGINAL', { exact: true })).toBeVisible();
  await expect(page.getByText(fixture.originalUrl, { exact: true })).toBeVisible();
  await expect(page.getByText('Entity Suggestion · 人工编辑清单', { exact: true })).toBeVisible();

  await page.goto(`/projects/${fixture.project.id}/distribution/targets/${fixture.target.id}`);
  await expect(page.getByText('PREPARE_ONLY', { exact: true })).toBeVisible();
  await expect(page.getByText('Entity Suggestion · 人工编辑清单', { exact: true })).toBeVisible();
  await expect(page.getByText('CONTENT_SOURCE_REFERENCE:source-1', { exact: true })).toBeVisible();
  await expect(page.getByText('权威成立时间仍缺乏可靠来源', { exact: true })).toBeVisible();
  await expect(page.getByText('提交前检查平台利益冲突与显著性规则', { exact: true })).toBeVisible();
  await expect(page.getByText('逐项核对可靠来源', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '自动发布' })).toHaveCount(0);
  await expect(page.getByText('人工发布 / 回填结果')).toHaveCount(0);

  await page.goto(`/projects/${fixture.project.id}/distribution/targets/${fixture.target.id}/artifacts/${fixture.artifact.id}`);
  await expect(page.getByText('Entity Suggestion · 人工编辑清单', { exact: true })).toBeVisible();
  await expect(page.getByText('民间信仰研究', { exact: true })).toBeVisible();
  await expect(page.getByText('CONTENT_SOURCE_REFERENCE:source-2', { exact: true })).toBeVisible();
  await expect(page.getByText('人工编辑确认后再提交', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '自动发布' })).toHaveCount(0);
  await expect(page.getByText('人工发布 / 回填结果')).toHaveCount(0);
  await expect(page.getByText('must-not-render', { exact: true })).toHaveCount(0);
});
