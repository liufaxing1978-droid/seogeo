import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { PublicationService } from '../../src/modules/publication/publication.service.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: label,
      slug: `p8-proposal-${suffix}`,
      primaryDomain: `p8-proposal-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createGrowthOpportunityFixture(projectId: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `task4-${suffix}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '六壬 伏英馆',
      canonicalPage: 'https://xingshantang.org/culture/liuren',
      identityPayload: {
        normalizedQuery: '六壬 伏英馆',
        canonicalPage: 'https://xingshantang.org/culture/liuren',
        privatePlanningNote: 'must-not-copy-from-identity-payload'
      }
    }
  });

  const older = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-06-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-06-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-05-04T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-05-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-07-01T00:00:00.000Z'),
      primaryType: 'RANKING_UPSIDE',
      secondaryTypes: [],
      score: 61,
      priority: 'MEDIUM',
      scoreState: 'KNOWN',
      evidenceQuality: 'PARTIAL',
      evidenceCoverage: 0.75,
      rankingEligible: true,
      sourceProvenance: { providerToken: 'older-private-provider-token' }
    }
  });

  const latest = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-07-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-03T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-06-30T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-07-31T00:00:00.000Z'),
      primaryType: 'SEO_GAP',
      secondaryTypes: ['GEO_CITABILITY_GAP'],
      score: 82,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 0.94,
      rankingEligible: true,
      sourceProvenance: {
        providerToken: 'latest-private-provider-token',
        rawEvidencePayload: { secret: 'must-not-copy-from-source-provenance' }
      }
    }
  });

  const lifecycle = await prisma.growthOpportunityLifecycle.create({
    data: {
      opportunityIdentityId: identity.id,
      status: 'REVIEWED',
      latestSnapshotId: latest.id,
      reviewedAt: new Date('2026-08-01T00:00:00.000Z')
    }
  });

  return { identity, older, latest, lifecycle };
}

describe('P8-A proposal intake and versioned draft workspace', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.contentSourceReference.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.contentDraftVersion.deleteMany({ where: { draft: { projectId } } }).catch(() => undefined);
      await prisma.contentDraft.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.publicationProposal.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthOpportunityLifecycle.deleteMany({
        where: { identity: { projectId } }
      }).catch(() => undefined);
      await prisma.growthOpportunitySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('creates a proposal from the latest persisted P7 snapshot without copying private provenance or mutating Growth state', async () => {
    const project = await createProject('P8 P7 intake');
    const fixture = await createGrowthOpportunityFixture(project.id);
    const service = new PublicationService();

    const identityBefore = await prisma.growthOpportunityIdentity.findUniqueOrThrow({
      where: { id: fixture.identity.id }
    });
    const snapshotBefore = await prisma.growthOpportunitySnapshot.findUniqueOrThrow({
      where: { id: fixture.latest.id }
    });
    const lifecycleBefore = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({
      where: { opportunityIdentityId: fixture.identity.id }
    });

    const proposal = await service.createProposalFromGrowthOpportunity(
      project.id,
      fixture.identity.id,
      'editor-1'
    );

    expect(proposal).toMatchObject({
      projectId: project.id,
      sourceType: 'P7_GROWTH_OPPORTUNITY',
      sourceReferenceId: fixture.identity.id,
      sourceSnapshotId: fixture.latest.id,
      createdBy: 'editor-1'
    });
    expect(proposal.sourceSnapshotId).not.toBe(fixture.older.id);
    expect(proposal.sourceMetadata).toEqual({
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: '六壬 伏英馆',
      canonicalPage: 'https://xingshantang.org/culture/liuren',
      opportunityType: 'SEO_GAP',
      priority: 'HIGH',
      score: 82,
      evidenceQuality: 'COMPLETE',
      rankingEligible: true,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1'
    });

    const serializedMetadata = JSON.stringify(proposal.sourceMetadata);
    expect(serializedMetadata).not.toContain('sourceProvenance');
    expect(serializedMetadata).not.toContain('identityPayload');
    expect(serializedMetadata).not.toContain('private-provider-token');
    expect(serializedMetadata).not.toContain('must-not-copy');

    const identityAfter = await prisma.growthOpportunityIdentity.findUniqueOrThrow({
      where: { id: fixture.identity.id }
    });
    const snapshotAfter = await prisma.growthOpportunitySnapshot.findUniqueOrThrow({
      where: { id: fixture.latest.id }
    });
    const lifecycleAfter = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({
      where: { opportunityIdentityId: fixture.identity.id }
    });

    expect(identityAfter).toEqual(identityBefore);
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(lifecycleAfter).toEqual(lifecycleBefore);
  });

  it('requires an explicit reason for manual proposals and preserves the human actor', async () => {
    const project = await createProject('P8 manual proposal');
    const service = new PublicationService();

    await expect(service.createManualProposal(project.id, { reason: '   ' }, 'editor-2'))
      .rejects.toThrow(/reason/i);

    const proposal = await service.createManualProposal(
      project.id,
      { reason: '  Publish a source-backed 六壬 culture article.  ' },
      'editor-2'
    );

    expect(proposal).toMatchObject({
      projectId: project.id,
      sourceType: 'MANUAL',
      reason: 'Publish a source-backed 六壬 culture article.',
      createdBy: 'editor-2',
      sourceReferenceId: null,
      sourceSnapshotId: null
    });
  });

  it('creates immutable draft versions and rejects stale optimistic writes with DRAFT_VERSION_CONFLICT', async () => {
    const project = await createProject('P8 draft optimistic version');
    const service = new PublicationService();
    const proposal = await service.createManualProposal(
      project.id,
      { reason: 'Draft workspace test' },
      'editor-3'
    );

    const draft = await service.createDraftFromProposal(proposal.id, {
      title: '六壬文化测试稿',
      slugCandidate: 'liuren-test',
      body: 'V1 body',
      language: 'zh-CN',
      generatedBy: 'HUMAN'
    });

    expect(draft.currentVersion).toBe(1);
    expect(draft.currentContentHash).toMatch(/^[a-f0-9]{64}$/);

    const v2 = await service.saveDraftVersion(
      draft.id,
      1,
      { body: 'human edit' },
      'HUMAN'
    );
    expect(v2).toMatchObject({ version: 2, body: 'human edit', generatedBy: 'HUMAN' });
    expect(v2.contentHash).toMatch(/^[a-f0-9]{64}$/);

    await expect(service.saveDraftVersion(
      draft.id,
      1,
      { body: 'stale edit' },
      'HUMAN'
    )).rejects.toMatchObject({ code: 'DRAFT_VERSION_CONFLICT' });

    const storedDraft = await prisma.contentDraft.findUniqueOrThrow({ where: { id: draft.id } });
    const versions = await prisma.contentDraftVersion.findMany({
      where: { draftId: draft.id },
      orderBy: { version: 'asc' }
    });
    expect(storedDraft).toMatchObject({ currentVersion: 2, body: 'human edit' });
    expect(versions.map((version) => [version.version, version.body])).toEqual([
      [1, 'V1 body'],
      [2, 'human edit']
    ]);
  });

  it('keeps source references bounded and explicitly unverified-by-schema even for AI-suggested sources', async () => {
    const project = await createProject('P8 source references');
    const service = new PublicationService();
    const proposal = await service.createManualProposal(project.id, { reason: 'Sources' }, 'editor-4');
    const draft = await service.createDraftFromProposal(proposal.id, {
      title: '来源测试',
      body: 'body',
      language: 'zh-CN',
      generatedBy: 'DEEPSEEK'
    });

    const reference = await service.addSourceReference(draft.id, {
      title: '民间信仰研究资料',
      author: '研究者',
      publisher: '资料馆',
      sourceUrl: 'https://example.org/source',
      publishedAt: new Date('2025-01-01T00:00:00.000Z'),
      sourceType: 'AI_SUGGESTED_WEB',
      accessedAt: new Date('2026-08-21T00:00:00.000Z'),
      userProvided: false,
      internalRef: false
    });

    expect(reference).toMatchObject({
      projectId: project.id,
      draftId: draft.id,
      title: '民间信仰研究资料',
      sourceType: 'AI_SUGGESTED_WEB',
      userProvided: false,
      internalRef: false
    });
    expect('verified' in reference).toBe(false);

    const updated = await service.updateSourceReference(reference.id, {
      title: '民间信仰研究资料（人工复核标题）'
    });
    expect(updated.title).toBe('民间信仰研究资料（人工复核标题）');

    const listed = await service.listSourceReferences(draft.id);
    expect(listed.map((row) => row.id)).toEqual([reference.id]);

    await expect(service.addSourceReference(draft.id, {
      title: 'x'.repeat(501),
      sourceType: 'WEB'
    })).rejects.toThrow(/title/i);
    await expect(service.addSourceReference(draft.id, {
      title: 'Bad URL',
      sourceType: 'WEB',
      sourceUrl: 'javascript:alert(1)'
    })).rejects.toThrow(/url/i);

    await service.deleteSourceReference(reference.id);
    expect(await service.listSourceReferences(draft.id)).toEqual([]);
  });
});
