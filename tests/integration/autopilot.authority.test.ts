import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationAutopilotRepository } from '../../src/modules/optimization-autopilot/autopilot.repository.js';

type TestDb = typeof prisma | Prisma.TransactionClient;
const ROLLBACK_SENTINEL = 'P9_C_AUTHORITY_TEST_ROLLBACK';

async function withRollback(run: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK_SENTINEL) throw error;
  }
}

async function createProject(db: TestDb) {
  const suffix = randomUUID();
  return db.project.create({
    data: {
      name: `P9-C authority ${suffix}`,
      slug: `p9-c-authority-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
}

async function createGrowthFacts(db: TestDb, projectId: string) {
  const identity = await db.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `authority:${randomUUID()}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'authority test',
      canonicalPage: null,
      identityPayload: {}
    }
  });

  const older = await db.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-07-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-24T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-06-30T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-07-08T00:00:00.000Z'),
      primaryType: 'CONTENT_GAP',
      secondaryTypes: [],
      score: 70,
      priority: 'MEDIUM',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 75,
      rankingEligible: true,
      sourceProvenance: {}
    }
  });

  const latest = await db.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
      previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
      primaryType: 'CONTENT_GAP',
      secondaryTypes: [],
      score: 82,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 90,
      rankingEligible: true,
      sourceProvenance: {}
    }
  });

  await db.growthOpportunityLifecycle.create({
    data: {
      opportunityIdentityId: identity.id,
      status: 'NEW',
      latestSnapshotId: latest.id
    }
  });

  return { identity, older, latest };
}

async function createPublicationExecution(
  db: TestDb,
  projectId: string,
  input: {
    status: 'EXECUTING' | 'VERIFICATION_FAILED' | 'VERIFIED';
    targetPublicUrl: string;
    repositoryPath: string;
  }
) {
  const site = await db.publicationSite.create({
    data: {
      projectId,
      displayName: `site-${randomUUID()}`,
      domain: new URL(input.targetPublicUrl).hostname,
      repositoryIdentity: `owner/repo-${randomUUID()}`,
      baseBranch: 'main',
      adapterType: 'GITHUB_GIT',
      writeCapability: 'GIT_DRAFT_PR',
      allowedPaths: ['content/'],
      enabled: true
    }
  });
  const channel = await db.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/articles',
      displayName: 'Articles',
      repositoryPathTemplate: 'content/{slug}.md',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      enabled: true
    }
  });
  const proposal = await db.publicationProposal.create({
    data: {
      projectId,
      sourceType: 'MANUAL',
      reason: 'authority test',
      createdBy: 'test'
    }
  });
  const contentHash = `content-${randomUUID()}`;
  const draft = await db.contentDraft.create({
    data: {
      projectId,
      sourceProposalId: proposal.id,
      title: 'Authority test',
      slugCandidate: 'authority-test',
      body: '# Authority test',
      language: 'en',
      currentVersion: 1,
      currentContentHash: contentHash,
      generatedBy: 'HUMAN'
    }
  });
  const planHash = `plan-${randomUUID()}`;
  const targetRepository = site.repositoryIdentity!;
  const plan = await db.publicationPlan.create({
    data: {
      projectId,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: input.targetPublicUrl,
      targetRepository,
      targetBranch: 'main',
      baseSha: `base-${randomUUID()}`,
      targetBlobHashes: {},
      operations: [{
        type: 'CREATE_CONTENT_PAGE',
        path: input.repositoryPath,
        targetUrl: input.targetPublicUrl,
        contentHash,
        content: '# Authority test',
        title: 'Authority test',
        excerpt: null,
        metaTitle: null,
        metaDescription: null,
        canonicalCandidate: null,
        schemaJson: null,
        author: null,
        language: 'en'
      }],
      expectedOutcomes: {},
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'draft-pr-only',
      planHash
    }
  });
  const approval = await db.publicationApproval.create({
    data: {
      projectId,
      planId: plan.id,
      planVersion: 1,
      planHash,
      contentVersion: 1,
      contentHash,
      previewHash: `preview-${randomUUID()}`,
      baseSha: plan.baseSha,
      targetRepository,
      targetBranch: 'main',
      targetBlobHashes: {},
      approverActorId: 'actor:test',
      approvedRiskClass: 'LOW'
    }
  });
  const execution = await db.publicationExecution.create({
    data: {
      projectId,
      planId: plan.id,
      approvalId: approval.id,
      executionKey: `execution-${randomUUID()}`,
      status: input.status
    }
  });
  return { site, channel, plan, execution };
}

describe('P9-C persisted authority readers', () => {
  it('loads only the latest Growth snapshot and lifecycle inside the owning project', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const otherProject = await createProject(db);
      const growth = await createGrowthFacts(db, project.id);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);

      expect(await repository.loadGrowthAuthorityFacts(project.id, growth.identity.id)).toEqual({
        latestGrowthSnapshotId: growth.latest.id,
        growthScoreState: 'KNOWN',
        growthRankingEligible: true,
        growthLifecycleStatus: 'NEW'
      });
      expect(await repository.loadGrowthAuthorityFacts(otherProject.id, growth.identity.id)).toBeNull();
    });
  });

  it('reads the latest authoritative verification state without rewriting P8 facts', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);

      await createPublicationExecution(db, project.id, {
        status: 'VERIFICATION_FAILED',
        targetPublicUrl: `https://${project.primaryDomain}/articles/failed`,
        repositoryPath: 'content/failed.md'
      });
      expect(await repository.loadLatestVerificationState(project.id)).toBe('VERIFICATION_FAILED');

      await createPublicationExecution(db, project.id, {
        status: 'VERIFIED',
        targetPublicUrl: `https://${project.primaryDomain}/articles/verified`,
        repositoryPath: 'content/verified.md'
      });
      expect(await repository.loadLatestVerificationState(project.id)).toBe('VERIFIED');
    });
  });

  it('detects active URL or repository-path conflicts only inside the project', async () => {
    await withRollback(async (db) => {
      const project = await createProject(db);
      const otherProject = await createProject(db);
      const repository = new OptimizationAutopilotRepository(db as typeof prisma);
      const targetPublicUrl = `https://${project.primaryDomain}/articles/conflict`;
      const repositoryPath = 'content/conflict.md';
      const fixture = await createPublicationExecution(db, project.id, {
        status: 'EXECUTING',
        targetPublicUrl,
        repositoryPath
      });

      expect(await repository.hasActivePublicationConflict({
        projectId: project.id,
        targetPublicUrl,
        targetRepository: fixture.plan.targetRepository,
        repositoryPath
      })).toBe(true);

      expect(await repository.hasActivePublicationConflict({
        projectId: otherProject.id,
        targetPublicUrl,
        targetRepository: fixture.plan.targetRepository,
        repositoryPath
      })).toBe(false);
    });
  });
});
