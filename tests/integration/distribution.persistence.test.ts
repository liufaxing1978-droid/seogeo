import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';

const projectIds: string[] = [];
const distributionRepositoryModule = '../../src/modules/distribution/distribution.repository.js';

async function loadDistributionRepository() {
  const module = await import(distributionRepositoryModule).catch(() => null);
  expect(module, 'DistributionRepository must exist for P8-B Task 16').not.toBeNull();
  if (!module) throw new Error('DistributionRepository missing');
  return new module.DistributionRepository();
}

async function createVerifiedPublication(label: string) {
  const repository = new PublicationRepository();
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p8b-distribution-${suffix}`,
      primaryDomain: `p8b-distribution-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const proposal = await repository.createProposal({
    projectId: project.id,
    sourceType: 'MANUAL',
    reason: 'P8-B persistence fixture',
    createdBy: 'test-user'
  });
  const draft = await repository.createDraft({
    projectId: project.id,
    sourceProposalId: proposal.id,
    title: 'Verified primary source',
    body: 'Primary V7',
    language: 'zh-CN',
    generatedBy: 'HUMAN'
  });
  for (let version = 2; version <= 7; version += 1) {
    await repository.appendDraftVersion(draft.id, {
      title: 'Verified primary source',
      body: `Primary V${version}`,
      generatedBy: 'HUMAN'
    });
  }

  const site = await repository.createSite({
    projectId: project.id,
    displayName: '兴善堂主站',
    domain: project.primaryDomain,
    adapterType: 'EXPORT_ONLY',
    writeCapability: 'EXPORT_ONLY',
    enabled: true
  });
  const originalUrl = `https://${project.primaryDomain}/culture/verified-primary`;
  const plan = await repository.createPlan({
    projectId: project.id,
    proposalId: proposal.id,
    draftId: draft.id,
    draftVersion: 7,
    siteId: site.id,
    version: 1,
    targetPublicUrl: originalUrl,
    targetRepository: 'export-only',
    targetBranch: 'main',
    baseSha: 'p8b-base-sha',
    operations: [],
    expectedOutcomes: {},
    validatorVersion: 'P8_VALIDATOR_V1',
    riskClass: 'LOW',
    rollbackStrategy: 'ABANDON_CHANGE',
    planHash: `plan-${project.id}`
  });
  const preview = await repository.createPreview({
    projectId: project.id,
    planId: plan.id,
    previewHash: `preview-${project.id}`,
    diffSummary: 'verified publication fixture'
  });
  const approval = await repository.createApproval({
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
  const execution = await repository.createExecution({
    projectId: project.id,
    planId: plan.id,
    approvalId: approval.id,
    executionKey: `verified-${project.id}`,
    status: 'VERIFIED'
  });

  return { project, draft, execution, originalUrl };
}

describe('P8-B distribution persistence, identity and source-version staleness', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('upserts one target for the same publication, platform, mode and target key', async () => {
    const repository = await loadDistributionRepository();
    const fixture = await createVerifiedPublication('P8-B target identity');

    const first = await repository.ensureTarget({
      projectId: fixture.project.id,
      publicationId: fixture.execution.id,
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      targetKey: 'default'
    });
    const second = await repository.ensureTarget({
      projectId: fixture.project.id,
      publicationId: fixture.execution.id,
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      targetKey: 'default'
    });

    expect(second.id).toBe(first.id);
    const targets = await repository.listTargetsForPublication(fixture.execution.id);
    expect(targets).toHaveLength(1);
  });

  it('stores immutable artifact versions bound to the exact primary source version', async () => {
    const repository = await loadDistributionRepository();
    const fixture = await createVerifiedPublication('P8-B immutable artifacts');
    const target = await repository.ensureTarget({
      projectId: fixture.project.id,
      publicationId: fixture.execution.id,
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      targetKey: 'default'
    });

    const artifact = await repository.createArtifact(target.id, {
      sourceContentVersion: 7,
      adaptationVersion: 'distribution-canonical-repost-v1',
      artifactVersion: 1,
      artifactHash: 'artifact-v1-hash',
      title: 'Medium canonical repost',
      body: 'v1 body',
      originalUrl: fixture.originalUrl,
      canonicalUrl: fixture.originalUrl,
      sourceRefs: ['source-1']
    });

    expect(artifact).toMatchObject({ sourceContentVersion: 7, artifactVersion: 1, body: 'v1 body' });
    await expect(prisma.$executeRawUnsafe(
      `UPDATE \"DistributionArtifact\" SET \"body\" = 'mutated' WHERE \"id\" = '${artifact.id}'`
    )).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM \"DistributionArtifact\" WHERE \"id\" = '${artifact.id}'`
    )).rejects.toBeTruthy();
  });

  it('marks older artifacts effectively OUTDATED when the primary source advances without rewriting them', async () => {
    const repository = await loadDistributionRepository();
    const fixture = await createVerifiedPublication('P8-B source drift');
    const target = await repository.ensureTarget({
      projectId: fixture.project.id,
      publicationId: fixture.execution.id,
      platform: 'MEDIUM',
      mode: 'CANONICAL_REPOST',
      targetKey: 'default'
    });
    const artifact = await repository.createArtifact(target.id, {
      sourceContentVersion: 7,
      adaptationVersion: 'distribution-canonical-repost-v1',
      artifactVersion: 1,
      artifactHash: 'frozen-v7-hash',
      title: 'Frozen V7',
      body: 'Frozen V7 body',
      originalUrl: fixture.originalUrl,
      canonicalUrl: fixture.originalUrl,
      sourceRefs: []
    });

    await repository.markSourceVersionOutdated({
      publicationId: fixture.execution.id,
      currentSourceContentVersion: 8,
      reasonCode: 'SOURCE_CONTENT_VERSION_CHANGED'
    });

    const refreshedTarget = await repository.getTarget(target.id);
    expect(refreshedTarget?.status).toBe('OUTDATED');
    expect(refreshedTarget?.sourceContentVersion).toBe(8);

    const artifacts = await repository.listArtifacts(target.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: artifact.id,
      sourceContentVersion: 7,
      artifactHash: 'frozen-v7-hash',
      body: 'Frozen V7 body',
      effectiveStatus: 'OUTDATED'
    });

    const events = await repository.listTargetEvents(target.id);
    expect(events.map((event: { toStatus: string; reasonCode: string }) => [event.toStatus, event.reasonCode])).toContainEqual([
      'OUTDATED',
      'SOURCE_CONTENT_VERSION_CHANGED'
    ]);
  });

  it('keeps target status history append-only', async () => {
    const repository = await loadDistributionRepository();
    const fixture = await createVerifiedPublication('P8-B append-only events');
    const target = await repository.ensureTarget({
      projectId: fixture.project.id,
      publicationId: fixture.execution.id,
      platform: 'SUBSTACK',
      mode: 'SUMMARY',
      targetKey: 'newsletter'
    });

    const event = await repository.appendTargetEvent(target.id, {
      fromStatus: 'NOT_PREPARED',
      toStatus: 'DRAFT_READY',
      reasonCode: 'ARTIFACT_PREPARED',
      sourceContentVersion: 7
    });

    await expect(prisma.$executeRawUnsafe(
      `UPDATE \"DistributionTargetEvent\" SET \"reasonCode\" = 'mutated' WHERE \"id\" = '${event.id}'`
    )).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(
      `DELETE FROM \"DistributionTargetEvent\" WHERE \"id\" = '${event.id}'`
    )).rejects.toBeTruthy();
  });
});
