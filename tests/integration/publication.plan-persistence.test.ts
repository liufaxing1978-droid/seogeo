import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  buildPublicationPlan,
  createPublicationPreview
} from '../../src/modules/publication/publication-plan.js';
import { PublicationRepository } from '../../src/modules/publication/publication.repository.js';
import { contentHashV1 } from '../../src/modules/publication/publication.hash.js';
import { validatePublicationDraft } from '../../src/modules/publication/publication-validation.js';

const projectIds: string[] = [];

async function createProject() {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: 'P8 immutable plan persistence',
      slug: `p8-plan-${suffix}`,
      primaryDomain: `p8-plan-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

function contentHash(body: string) {
  return contentHashV1({ body });
}

afterAll(async () => {
  for (const projectId of projectIds) {
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

describe('P8-A immutable publication plan persistence', () => {
  it('builds from a requested immutable draft version and regenerates by inserting plan version + 1', async () => {
    const repository = new PublicationRepository();
    const project = await createProject();
    const proposal = await repository.createProposal({
      projectId: project.id,
      sourceType: 'MANUAL',
      reason: 'Task 7 plan fixture',
      createdBy: 'editor-plan'
    });
    const draft = await repository.createDraft({
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'V1 title',
      slugCandidate: 'liuren-plan',
      body: '# V1 title\n\nImmutable V1 body.',
      excerpt: 'V1 excerpt',
      metaDescription: 'V1 description',
      canonicalCandidate: 'https://xingshantang.org/culture/liuren-plan',
      schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
      language: 'zh-CN',
      contentHash: contentHash('Immutable V1 body.'),
      generatedBy: 'HUMAN'
    });
    await repository.appendDraftVersion(draft.id, {
      title: 'V2 title',
      body: '# V2 title\n\nMutable head moved to V2.',
      contentHash: contentHash('Mutable head moved to V2.'),
      generatedBy: 'HUMAN'
    });

    const immutableV1 = await repository.getDraftVersion(draft.id, 1);
    const immutableV2 = await repository.getDraftVersion(draft.id, 2);
    expect(immutableV1).toMatchObject({ version: 1, title: 'V1 title' });
    expect(immutableV2).toMatchObject({ version: 2, title: 'V2 title' });
    expect((await repository.getDraft(draft.id))?.currentVersion).toBe(2);

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
      repositoryPathTemplate: 'content/culture/{slug}.md',
      contentType: 'ARTICLE'
    });

    const validation = validatePublicationDraft({
      draft: {
        title: immutableV1!.title,
        body: immutableV1!.body,
        slugCandidate: immutableV1!.slugCandidate,
        canonicalCandidate: immutableV1!.canonicalCandidate,
        schemaJson: immutableV1!.schemaJson,
        language: immutableV1!.language
      },
      target: {
        publicUrl: 'https://xingshantang.org/culture/liuren-plan',
        primaryHost: 'xingshantang.org',
        channelPathPrefix: '/culture',
        repositoryPath: 'content/culture/liuren-plan.md',
        allowedRepositoryPaths: ['content/culture/']
      },
      resolvedFacts: { urlConflict: false, sourceGaps: [] },
      confirmedWarningCodes: []
    });
    expect(validation.canCreatePlan).toBe(true);

    const firstVersion = await repository.getNextPlanVersion(proposal.id);
    expect(firstVersion).toBe(1);
    const firstPayload = buildPublicationPlan({
      projectId: project.id,
      proposalId: proposal.id,
      planVersion: firstVersion,
      draftVersion: {
        draftId: draft.id,
        version: immutableV1!.version,
        title: immutableV1!.title,
        slugCandidate: immutableV1!.slugCandidate,
        body: immutableV1!.body,
        excerpt: immutableV1!.excerpt,
        metaTitle: immutableV1!.metaTitle,
        metaDescription: immutableV1!.metaDescription,
        canonicalCandidate: immutableV1!.canonicalCandidate,
        schemaJson: immutableV1!.schemaJson,
        author: immutableV1!.author,
        language: immutableV1!.language,
        contentHash: immutableV1!.contentHash!
      },
      site: {
        id: site.id,
        domain: site.domain,
        repositoryIdentity: site.repositoryIdentity!,
        baseBranch: site.baseBranch!
      },
      channel: {
        id: channel.id,
        pathPrefix: channel.pathPrefix,
        repositoryPathTemplate: channel.repositoryPathTemplate!
      },
      intent: 'CREATE',
      validatorVersion: validation.validatorVersion,
      validationResult: validation,
      expectedOutcomes: { publish: true },
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT'
    }, {
      repositoryIdentity: site.repositoryIdentity!,
      branch: site.baseBranch!,
      headSha: '1111111111111111111111111111111111111111',
      publicUrlExists: false,
      files: {}
    });
    const first = await repository.createPlan(firstPayload);
    expect(first).toMatchObject({ version: 1, draftVersion: 1 });
    expect(JSON.stringify(first.operations)).toContain('Immutable V1 body.');
    expect(JSON.stringify(first.operations)).not.toContain('Mutable head moved to V2.');

    const previewPayload = createPublicationPreview({ id: first.id, ...firstPayload }, {
      files: [{
        path: 'content/culture/liuren-plan.md',
        change: 'CREATED',
        oldBlobSha: null,
        newContentHash: immutableV1!.contentHash
      }],
      unifiedDiff: '--- /dev/null\n+++ content/culture/liuren-plan.md\n+# V1 title',
      validationResult: validation
    });
    const preview = await repository.createPreview(previewPayload);
    expect(preview.planId).toBe(first.id);
    expect(preview.previewHash).toMatch(/^[a-f0-9]{64}$/);

    const secondVersion = await repository.getNextPlanVersion(proposal.id);
    expect(secondVersion).toBe(2);
    const secondPayload = buildPublicationPlan({
      projectId: project.id,
      proposalId: proposal.id,
      planVersion: secondVersion,
      draftVersion: {
        draftId: draft.id,
        version: immutableV2!.version,
        title: immutableV2!.title,
        slugCandidate: immutableV2!.slugCandidate,
        body: immutableV2!.body,
        excerpt: immutableV2!.excerpt,
        metaTitle: immutableV2!.metaTitle,
        metaDescription: immutableV2!.metaDescription,
        canonicalCandidate: immutableV2!.canonicalCandidate,
        schemaJson: immutableV2!.schemaJson,
        author: immutableV2!.author,
        language: immutableV2!.language,
        contentHash: immutableV2!.contentHash!
      },
      site: {
        id: site.id,
        domain: site.domain,
        repositoryIdentity: site.repositoryIdentity!,
        baseBranch: site.baseBranch!
      },
      channel: {
        id: channel.id,
        pathPrefix: channel.pathPrefix,
        repositoryPathTemplate: channel.repositoryPathTemplate!
      },
      intent: 'CREATE',
      validatorVersion: validation.validatorVersion,
      validationResult: validation,
      expectedOutcomes: { publish: true },
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT'
    }, {
      repositoryIdentity: site.repositoryIdentity!,
      branch: site.baseBranch!,
      headSha: '2222222222222222222222222222222222222222',
      publicUrlExists: false,
      files: {}
    });
    const second = await repository.createPlan(secondPayload);

    const storedPlans = await prisma.publicationPlan.findMany({
      where: { proposalId: proposal.id },
      orderBy: { version: 'asc' }
    });
    expect(storedPlans.map((plan) => plan.version)).toEqual([1, 2]);
    expect(storedPlans[0]).toEqual(first);
    expect(second).toMatchObject({ version: 2, draftVersion: 2 });
    expect(second.planHash).not.toBe(first.planHash);
  });
});
