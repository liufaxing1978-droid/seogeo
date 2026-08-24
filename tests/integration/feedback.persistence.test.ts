import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  OptimizationFeedbackRepository,
  type CreateFeedbackEvidenceInput,
  type CreateFeedbackProfileInput
} from '../../src/modules/optimization-feedback/feedback.repository.js';

const ROLLBACK_SENTINEL = 'P9_E_PERSISTENCE_ROLLBACK';
const DAY_MS = 24 * 60 * 60 * 1000;

async function withRollback(run: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
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

async function expectImmutableRollback(
  run: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<void> {
  let observed: unknown = null;
  try {
    await prisma.$transaction(async (tx) => {
      await run(tx);
    });
  } catch (error) {
    observed = error;
  }
  expect(observed).not.toBeNull();
  expect(String(observed)).toContain('P9-E immutable row');
}

async function seedFeedbackAuthorityGraph(tx: Prisma.TransactionClient) {
  const suffix = randomUUID();
  const targetUrl = `https://${suffix}.example.com/page`;
  const project = await tx.project.create({
    data: {
      name: `P9-E persistence ${suffix}`,
      slug: `p9-e-persistence-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });

  const growthIdentity = await tx.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: 'p9 e feedback',
      canonicalPage: targetUrl,
      identityPayload: { fixture: true }
    }
  });
  const growthSnapshot = await tx.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: growthIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_SNAPSHOT_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-06-01T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-06-28T00:00:00.000Z'),
      previousWindowStart: new Date('2026-05-04T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-05-31T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-06-29T00:00:00.000Z'),
      primaryType: 'CTR_UNDERPERFORMANCE',
      secondaryTypes: [],
      score: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: { fixture: true }
    }
  });
  const candidate = await tx.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      opportunityType: 'CTR_UNDERPERFORMANCE',
      normalizedQuery: 'p9 e feedback',
      canonicalPage: targetUrl,
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
      sourceFactReferences: ['feedback:persistence'],
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
      reason: 'P9-E persistence fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: optimizationPlan.id
    }
  });
  const draft = await tx.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-E persistence fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await tx.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-E persistence fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const channel = await tx.publicationChannel.create({
    data: { siteId: site.id, pathPrefix: '/page', displayName: 'Page' }
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
      targetPublicUrl: targetUrl,
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
  const approval = await tx.publicationApproval.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      planVersion: 1,
      planHash: publicationPlan.planHash,
      contentVersion: 1,
      contentHash: 'c'.repeat(64),
      previewHash: 'd'.repeat(64),
      baseSha: publicationPlan.baseSha,
      targetRepository: publicationPlan.targetRepository,
      targetBranch: publicationPlan.targetBranch,
      targetBlobHashes: {},
      approverActorId: 'p9-e-test',
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: []
    }
  });
  const execution = await tx.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${suffix}`,
      status: 'VERIFIED'
    }
  });
  const verifiedAnchorAt = new Date('2026-07-01T00:00:00.000Z');
  const verification = await tx.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: verifiedAnchorAt
    }
  });
  const experiment = await tx.optimizationExperiment.create({
    data: {
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      publicationExecutionId: execution.id,
      publicationVerificationId: verification.id,
      experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1',
      experimentKey: `experiment:${suffix}`,
      interventionType: 'SERP_SNIPPET_OPTIMIZATION',
      targetUrl,
      marketCode: 'HK',
      locale: 'zh-Hant',
      verifiedAnchorAt,
      measurementScopeJson: { kind: 'SEARCH', provider: 'GOOGLE_SEARCH_CONSOLE' },
      observationScheduleJson: [
        { windowType: '7D', windowDays: 7 },
        { windowType: '14D', windowDays: 14 },
        { windowType: '28D', windowDays: 28 }
      ],
      expectedDirectionJson: { CTR: 'HIGHER' }
    }
  });
  const observation = await tx.optimizationExperimentObservation.create({
    data: {
      projectId: project.id,
      experimentId: experiment.id,
      observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
      observationKey: `observation:${suffix}:1`,
      windowType: '28D',
      windowDays: 28,
      dueAt: new Date(verifiedAnchorAt.getTime() + 28 * DAY_MS),
      inputCutoffAt: new Date('2026-07-30T00:00:00.000Z'),
      baselineSearchSourceRefs: ['search:baseline'],
      observedSearchSourceRefs: ['search:observed'],
      baselineVisibilitySourceRefs: [],
      observedVisibilitySourceRefs: [],
      baselineMetricsJson: [{ metricKey: 'CTR', value: 0.1 }],
      observedMetricsJson: [{ metricKey: 'CTR', value: 0.15 }],
      deltaMetricsJson: [{ metricKey: 'CTR', delta: 0.05 }],
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      effectState: 'POSITIVE',
      reasonCodes: ['EXPERIMENT_PRIMARY_METRIC_IMPROVED'],
      evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
    }
  });

  return {
    project,
    candidate,
    optimizationPlan,
    proposal,
    publicationPlan,
    execution,
    verification,
    experiment,
    observation
  };
}

function evidenceInput(
  fixture: Awaited<ReturnType<typeof seedFeedbackAuthorityGraph>>,
  overrides: Partial<CreateFeedbackEvidenceInput> = {}
): CreateFeedbackEvidenceInput {
  return {
    projectId: fixture.project.id,
    experimentId: fixture.experiment.id,
    observationId: fixture.observation.id,
    optimizationPlanId: fixture.optimizationPlan.id,
    candidateId: fixture.candidate.id,
    feedbackEvidenceVersion: 'OPTIMIZATION_FEEDBACK_EVIDENCE_V1',
    evidenceKey: `evidence:${fixture.observation.id}`,
    scopeKey: 'f'.repeat(64),
    marketScopeMode: 'CONFIGURED_MARKET',
    marketCode: 'HK',
    locale: 'zh-Hant',
    recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
    effectState: 'POSITIVE',
    feedbackValue: 1,
    terminalWindowType: '28D',
    terminalWindowDays: 28,
    inputCutoffAt: fixture.observation.inputCutoffAt,
    sourceEvaluatorVersion: fixture.observation.evaluatorVersion,
    sourceObservationKey: fixture.observation.observationKey,
    ...overrides
  };
}

function profileInput(
  fixture: Awaited<ReturnType<typeof seedFeedbackAuthorityGraph>>,
  evidenceId: string,
  overrides: Partial<CreateFeedbackProfileInput> = {}
): CreateFeedbackProfileInput {
  return {
    projectId: fixture.project.id,
    feedbackProfileVersion: 'OPTIMIZATION_FEEDBACK_PROFILE_V1',
    profileKey: `profile:${fixture.experiment.id}`,
    scopeKey: 'f'.repeat(64),
    marketScopeMode: 'CONFIGURED_MARKET',
    marketCode: 'HK',
    locale: 'zh-Hant',
    recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
    sampleCount: 1,
    positiveCount: 1,
    neutralCount: 0,
    negativeCount: 0,
    rollingEffectBalance: 0,
    historicalRankAdjustment: 0,
    windowLimit: 20,
    oldestEvidenceCutoffAt: fixture.observation.inputCutoffAt,
    newestEvidenceCutoffAt: fixture.observation.inputCutoffAt,
    inputEvidenceIdsJson: [evidenceId],
    inputFingerprint: 'a'.repeat(64),
    ...overrides
  };
}

describe('P9-E feedback persistence', () => {
  it('loads the exact persisted experiment/P9/P8 authority graph without raw metric payloads', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);

      const context = await repository.loadExperimentFeedbackContext({
        projectId: fixture.project.id,
        experimentId: fixture.experiment.id
      });

      expect(context).not.toBeNull();
      expect(context).toMatchObject({
        experiment: {
          id: fixture.experiment.id,
          projectId: fixture.project.id,
          optimizationPlanId: fixture.optimizationPlan.id,
          publicationExecutionId: fixture.execution.id,
          publicationVerificationId: fixture.verification.id
        },
        optimizationPlan: {
          id: fixture.optimizationPlan.id,
          projectId: fixture.project.id,
          recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
          candidate: {
            id: fixture.candidate.id,
            marketScopeMode: 'CONFIGURED_MARKET',
            marketCode: 'HK',
            locale: 'zh-Hant'
          }
        },
        execution: { id: fixture.execution.id, projectId: fixture.project.id, status: 'VERIFIED' },
        verification: {
          id: fixture.verification.id,
          projectId: fixture.project.id,
          executionId: fixture.execution.id,
          status: 'VERIFIED'
        },
        proposal: {
          id: fixture.proposal.id,
          projectId: fixture.project.id,
          sourceType: 'P9_OPTIMIZATION_PLAN',
          sourceReferenceId: fixture.optimizationPlan.id
        }
      });
      expect(context?.experiment.observations.map((item) => item.id)).toEqual([
        fixture.observation.id
      ]);
      expect(JSON.stringify(context)).not.toContain('baselineMetricsJson');
      expect(JSON.stringify(context)).not.toContain('observedMetricsJson');
      expect(JSON.stringify(context)).not.toContain('deltaMetricsJson');
    });
  });

  it('creates exact immutable evidence/profile once and fails closed on identity collisions', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);

      const before = {
        plan: await tx.optimizationPlan.findUniqueOrThrow({ where: { id: fixture.optimizationPlan.id } }),
        experiment: await tx.optimizationExperiment.findUniqueOrThrow({ where: { id: fixture.experiment.id } }),
        observation: await tx.optimizationExperimentObservation.findUniqueOrThrow({ where: { id: fixture.observation.id } }),
        execution: await tx.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } }),
        verification: await tx.publicationVerification.findUniqueOrThrow({ where: { id: fixture.verification.id } })
      };

      const createdEvidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      expect(createdEvidence.kind).toBe('CREATED');
      expect(createdEvidence.evidence).toMatchObject({
        experimentId: fixture.experiment.id,
        observationId: fixture.observation.id,
        optimizationPlanId: fixture.optimizationPlan.id,
        candidateId: fixture.candidate.id,
        feedbackValue: 1,
        effectState: 'POSITIVE',
        marketCode: 'HK',
        locale: 'zh-Hant'
      });

      const sameEvidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      expect(sameEvidence.kind).toBe('EXISTING');
      expect(sameEvidence.evidence.id).toBe(createdEvidence.evidence.id);
      expect(await tx.optimizationFeedbackEvidence.count({
        where: { experimentId: fixture.experiment.id }
      })).toBe(1);

      await expect(repository.createOrGetEvidence(evidenceInput(fixture, { feedbackValue: -1 })))
        .rejects.toThrow('FEEDBACK_EVIDENCE_IDENTITY_COLLISION');

      const secondObservation = await tx.optimizationExperimentObservation.create({
        data: {
          projectId: fixture.project.id,
          experimentId: fixture.experiment.id,
          observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
          observationKey: `observation:${randomUUID()}:2`,
          windowType: '28D',
          windowDays: 28,
          dueAt: fixture.observation.dueAt,
          inputCutoffAt: new Date(fixture.observation.inputCutoffAt.getTime() + DAY_MS),
          baselineSearchSourceRefs: ['search:baseline:2'],
          observedSearchSourceRefs: ['search:observed:2'],
          baselineVisibilitySourceRefs: [],
          observedVisibilitySourceRefs: [],
          baselineMetricsJson: [],
          observedMetricsJson: [],
          deltaMetricsJson: [],
          coverageState: 'SUFFICIENT',
          contaminationState: 'CLEAR',
          effectState: 'POSITIVE',
          reasonCodes: [],
          evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
        }
      });
      await expect(repository.createOrGetEvidence(evidenceInput(fixture, {
        observationId: secondObservation.id,
        evidenceKey: `evidence:${secondObservation.id}`,
        inputCutoffAt: secondObservation.inputCutoffAt,
        sourceObservationKey: secondObservation.observationKey
      }))).rejects.toThrow('FEEDBACK_EVIDENCE_IDENTITY_COLLISION');

      const createdProfile = await repository.createOrGetProfile(profileInput(
        fixture,
        createdEvidence.evidence.id
      ));
      expect(createdProfile.kind).toBe('CREATED');
      const sameProfile = await repository.createOrGetProfile(profileInput(
        fixture,
        createdEvidence.evidence.id
      ));
      expect(sameProfile.kind).toBe('EXISTING');
      expect(sameProfile.profile.id).toBe(createdProfile.profile.id);
      await expect(repository.createOrGetProfile(profileInput(
        fixture,
        createdEvidence.evidence.id,
        { historicalRankAdjustment: -4 }
      ))).rejects.toThrow('FEEDBACK_PROFILE_IDENTITY_COLLISION');

      const after = {
        plan: await tx.optimizationPlan.findUniqueOrThrow({ where: { id: fixture.optimizationPlan.id } }),
        experiment: await tx.optimizationExperiment.findUniqueOrThrow({ where: { id: fixture.experiment.id } }),
        observation: await tx.optimizationExperimentObservation.findUniqueOrThrow({ where: { id: fixture.observation.id } }),
        execution: await tx.publicationExecution.findUniqueOrThrow({ where: { id: fixture.execution.id } }),
        verification: await tx.publicationVerification.findUniqueOrThrow({ where: { id: fixture.verification.id } })
      };
      expect(after).toEqual(before);
    });
  });

  it('selects the latest exact-scope profile deterministically', async () => {
    await withRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);
      const evidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      const first = await repository.createOrGetProfile(profileInput(fixture, evidence.evidence.id));
      const newerCutoff = new Date(fixture.observation.inputCutoffAt.getTime() + DAY_MS);
      const second = await repository.createOrGetProfile(profileInput(fixture, evidence.evidence.id, {
        profileKey: `profile:newer:${fixture.experiment.id}`,
        inputFingerprint: 'b'.repeat(64),
        newestEvidenceCutoffAt: newerCutoff
      }));

      const latest = await repository.findLatestProfileForScope({
        projectId: fixture.project.id,
        marketScopeMode: 'CONFIGURED_MARKET',
        marketCode: 'HK',
        locale: 'zh-Hant',
        recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
      });
      expect(latest?.id).toBe(second.profile.id);
      expect(latest?.id).not.toBe(first.profile.id);
    });
  });

  it('rejects update and delete mutations at the database boundary', async () => {
    await expectImmutableRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);
      const evidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      await tx.optimizationFeedbackEvidence.update({
        where: { id: evidence.evidence.id },
        data: { feedbackValue: -1 }
      });
    });

    await expectImmutableRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);
      const evidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      await tx.optimizationFeedbackEvidence.delete({ where: { id: evidence.evidence.id } });
    });

    await expectImmutableRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);
      const evidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      const profile = await repository.createOrGetProfile(profileInput(fixture, evidence.evidence.id));
      await tx.optimizationFeedbackProfile.update({
        where: { id: profile.profile.id },
        data: { historicalRankAdjustment: -4 }
      });
    });

    await expectImmutableRollback(async (tx) => {
      const fixture = await seedFeedbackAuthorityGraph(tx);
      const repository = new OptimizationFeedbackRepository(tx);
      const evidence = await repository.createOrGetEvidence(evidenceInput(fixture));
      const profile = await repository.createOrGetProfile(profileInput(fixture, evidence.evidence.id));
      await tx.optimizationFeedbackProfile.delete({ where: { id: profile.profile.id } });
    });
  });

  it('serializes concurrent materialization for the same scope key', async () => {
    const repository = new OptimizationFeedbackRepository();
    const scopeKey = 'c'.repeat(64);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstEntered!: () => void;
    const firstEnteredPromise = new Promise<void>((resolve) => { firstEntered = resolve; });
    let secondEntered = false;

    const first = repository.withScopeLock(scopeKey, async () => {
      events.push('first-start');
      firstEntered();
      await firstGate;
      events.push('first-end');
    });
    await firstEnteredPromise;

    const second = repository.withScopeLock(scopeKey, async () => {
      secondEntered = true;
      events.push('second-start');
      events.push('second-end');
    });

    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(secondEntered).toBe(false);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });
});
