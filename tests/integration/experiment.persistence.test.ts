import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  OptimizationExperimentRepository,
  type CreateExperimentInput,
  type CreateExperimentObservationInput
} from '../../src/modules/optimization-experiments/experiment.repository.js';

type RegclassRow = {
  experiment: string | null;
  observation: string | null;
};

type NameRow = { name: string };

const ROLLBACK_SENTINEL = 'P9_D_TEST_ROLLBACK';

async function withRollback(
  run: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
      throw new Error(ROLLBACK_SENTINEL);
    });
  } catch (error) {
    if (error instanceof Error && error.message === ROLLBACK_SENTINEL) return;
    throw error;
  }
}

async function seedAuthorityGraph(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const project = await tx.project.create({
    data: {
      name: `P9-D ${suffix}`,
      slug: `p9-d-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const candidate = await tx.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: randomUUID(),
      growthSnapshotId: randomUUID(),
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      opportunityType: 'CTR_UNDERPERFORMANCE',
      normalizedQuery: 'p9 d experiment',
      canonicalPage: `https://${suffix}.example.com/page`,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { fixture: true },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    }
  });

  const optimizationPlan = await tx.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
      sourceFactReferences: ['source:one'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });

  const proposal = await tx.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-D repository fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });

  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-D repository fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });

  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-D fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });

  const channel = await tx.publicationChannel.create({
    data: {
      siteId: site.id,
      pathPrefix: '/page',
      displayName: 'Page'
    }
  });

  const publicationPlan = await tx.publicationPlan.create({
    data: {
      projectId: project.id,
      proposalId: proposal.id,
      draftId: draft.id,
      draftVersion: 1,
      siteId: site.id,
      channelId: channel.id,
      version: 1,
      targetPublicUrl: `https://${suffix}.example.com/page`,
      targetRepository: 'fixture/repository',
      targetBranch: 'main',
      baseSha: 'a'.repeat(40),
      operations: [{ type: 'UPDATE_CONTENT_PAGE', path: '/page' }],
      expectedOutcomes: [],
      validatorVersion: 'PUBLICATION_VALIDATOR_V1',
      riskClass: 'LOW',
      rollbackStrategy: 'REVERT_COMMIT',
      planHash: 'b'.repeat(64)
    }
  });

  const execution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      executionKey: `execution:${suffix}`,
      status: 'VERIFIED'
    }
  });

  const verification = await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: publicationPlan.targetPublicUrl,
      observedAt: new Date('2026-08-24T00:00:00.000Z')
    }
  });

  return { project, optimizationPlan, execution, verification, publicationPlan };
}

describe('P9-D experiment persistence', () => {
  it('installs the experiment and observation tables', async () => {
    const [row] = await prisma.$queryRawUnsafe<RegclassRow[]>(`
      SELECT
        to_regclass('public."OptimizationExperiment"')::text AS experiment,
        to_regclass('public."OptimizationExperimentObservation"')::text AS observation
    `);

    expect(row?.experiment).not.toBeNull();
    expect(row?.observation).not.toBeNull();
  });

  it('installs immutable update/delete triggers for both records', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND c.relname IN ('OptimizationExperiment', 'OptimizationExperimentObservation')
      ORDER BY t.tgname ASC
    `);

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'OptimizationExperiment_immutable',
      'OptimizationExperimentObservation_immutable'
    ]));
  });

  it('reuses identical immutable experiment/observation records and rejects identity collisions', async () => {
    await withRollback(async (tx) => {
      const authority = await seedAuthorityGraph(tx);
      const repository = new OptimizationExperimentRepository(tx);
      const verifiedAnchorAt = authority.verification.observedAt!;

      const experimentInput: CreateExperimentInput = {
        projectId: authority.project.id,
        optimizationPlanId: authority.optimizationPlan.id,
        publicationExecutionId: authority.execution.id,
        publicationVerificationId: authority.verification.id,
        experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1',
        experimentKey: `experiment:${randomUUID()}`,
        interventionType: 'SERP_SNIPPET_OPTIMIZATION',
        targetUrl: authority.publicationPlan.targetPublicUrl,
        marketCode: 'HK',
        locale: 'zh-Hant',
        verifiedAnchorAt,
        measurementScopeJson: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          kind: 'SEARCH',
          nested: { b: 2, a: 1 }
        },
        observationScheduleJson: [
          { windowDays: 7, windowType: '7D' },
          { windowDays: 14, windowType: '14D' }
        ],
        expectedDirectionJson: { ctr: 'HIGHER', position: 'LOWER' }
      };

      const firstExperiment = await repository.createOrGetExperiment(experimentInput);
      const sameExperiment = await repository.createOrGetExperiment({
        ...experimentInput,
        measurementScopeJson: {
          nested: { a: 1, b: 2 },
          kind: 'SEARCH',
          provider: 'GOOGLE_SEARCH_CONSOLE'
        }
      });
      expect(sameExperiment.id).toBe(firstExperiment.id);

      await expect(repository.createOrGetExperiment({
        ...experimentInput,
        targetUrl: `${experimentInput.targetUrl}?collision=1`
      })).rejects.toThrow('EXPERIMENT_IDENTITY_COLLISION');

      const observationInput: CreateExperimentObservationInput = {
        projectId: authority.project.id,
        experimentId: firstExperiment.id,
        observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
        observationKey: `observation:${randomUUID()}`,
        windowType: '7D',
        windowDays: 7,
        dueAt: new Date('2026-08-31T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-31T12:00:00.000Z'),
        baselineSearchSourceRefs: ['gsc:baseline'],
        observedSearchSourceRefs: ['gsc:observed'],
        baselineVisibilitySourceRefs: [],
        observedVisibilitySourceRefs: [],
        baselineMetricsJson: { impressions: 100, clicks: 10 },
        observedMetricsJson: { impressions: 120, clicks: 15 },
        deltaMetricsJson: { ctr: 0.025 },
        coverageState: 'SUFFICIENT',
        contaminationState: 'CLEAR',
        effectState: 'POSITIVE',
        reasonCodes: ['PRIMARY_METRIC_IMPROVED'],
        evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
      };

      const firstObservation = await repository.createOrGetObservation(observationInput);
      const sameObservation = await repository.createOrGetObservation({
        ...observationInput,
        baselineMetricsJson: { clicks: 10, impressions: 100 }
      });
      expect(sameObservation.id).toBe(firstObservation.id);

      await expect(repository.createOrGetObservation({
        ...observationInput,
        deltaMetricsJson: { ctr: -0.025 }
      })).rejects.toThrow('EXPERIMENT_OBSERVATION_IDENTITY_COLLISION');
    });
  });
});
