import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  MarketCode,
  OptimizationFeedbackEvidence,
  OptimizationFeedbackProfile,
  OptimizationMarketScopeMode,
  PlanLevel,
  Project,
  PublicationExecutionStatus,
  PublicationProposalSourceType,
  PublicationVerificationStatus,
  RecommendedActionType
} from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  buildFeedbackEvidenceKey,
  buildFeedbackScopeKey
} from '../../src/modules/optimization-feedback/feedback.identity.js';
import { FeedbackObservability } from '../../src/modules/optimization-feedback/feedback.observability.js';
import {
  OptimizationFeedbackRepository,
  type FeedbackMaterializationContext
} from '../../src/modules/optimization-feedback/feedback.repository.js';
import { OptimizationFeedbackService } from '../../src/modules/optimization-feedback/feedback.service.js';
import { OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION } from '../../src/modules/optimization-feedback/feedback.types.js';
import { projectRepository } from '../../src/modules/projects/project.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type ObservedEvent = {
  event: string;
  projectId: string;
  experimentId?: string;
  observationId?: string;
  feedbackEvidenceId?: string;
  feedbackProfileId?: string;
  recommendedActionType?: string;
  marketCode?: string;
  locale?: string;
  sampleCount?: number;
  historicalRankAdjustment?: number;
  reasonCode?: string;
};

type MaterializationResult =
  | { kind: 'ACCEPTED' | 'EXISTING'; evidence: OptimizationFeedbackEvidence; profile: OptimizationFeedbackProfile }
  | { kind: 'DEFERRED'; reasonCode: string };

type SeedOptions = {
  project?: Project;
  planLevel?: PlanLevel;
  marketScopeMode?: OptimizationMarketScopeMode;
  marketCode?: MarketCode | null;
  locale?: string | null;
  action?: RecommendedActionType;
  proposalSourceType?: PublicationProposalSourceType;
  proposalSourceReference?: 'PLAN' | 'WRONG';
  executionStatus?: PublicationExecutionStatus;
  verificationStatus?: PublicationVerificationStatus;
  withTerminal?: boolean;
  effectState?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';
  coverageState?: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
  contaminationState?: 'CLEAR' | 'CONFLICTING_MUTATION' | 'TARGET_REVISION_CHANGED' | 'VERIFICATION_INVALIDATED' | 'SOURCE_IDENTITY_CHANGED' | 'UNKNOWN';
  cutoffOffsetDays?: number;
};

async function createProject(planLevel: PlanLevel = 'ADVANCED'): Promise<Project> {
  const suffix = randomUUID();
  return prisma.project.create({
    data: {
      name: `P9-E materialization ${suffix}`,
      slug: `p9-e-materialization-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel
    }
  });
}

async function createObservation(input: {
  projectId: string;
  experimentId: string;
  verifiedAnchorAt: Date;
  windowType: '14D' | '28D';
  windowDays: 14 | 28;
  cutoffOffsetDays: number;
  effectState: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';
  coverageState?: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
  contaminationState?: 'CLEAR' | 'CONFLICTING_MUTATION' | 'TARGET_REVISION_CHANGED' | 'VERIFICATION_INVALIDATED' | 'SOURCE_IDENTITY_CHANGED' | 'UNKNOWN';
}) {
  const suffix = randomUUID();
  return prisma.optimizationExperimentObservation.create({
    data: {
      projectId: input.projectId,
      experimentId: input.experimentId,
      observationVersion: 'OPTIMIZATION_EXPERIMENT_OBSERVATION_V1',
      observationKey: `observation:${suffix}`,
      windowType: input.windowType,
      windowDays: input.windowDays,
      dueAt: new Date(input.verifiedAnchorAt.getTime() + input.windowDays * DAY_MS),
      inputCutoffAt: new Date(input.verifiedAnchorAt.getTime() + input.cutoffOffsetDays * DAY_MS),
      baselineSearchSourceRefs: ['search:baseline'],
      observedSearchSourceRefs: ['search:observed'],
      baselineVisibilitySourceRefs: [],
      observedVisibilitySourceRefs: [],
      baselineMetricsJson: [{ metricKey: 'CTR', value: 0.1 }],
      observedMetricsJson: [{ metricKey: 'CTR', value: 0.15 }],
      deltaMetricsJson: [{ metricKey: 'CTR', delta: 0.05 }],
      coverageState: input.coverageState ?? 'SUFFICIENT',
      contaminationState: input.contaminationState ?? 'CLEAR',
      effectState: input.effectState,
      reasonCodes: [],
      evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
    }
  });
}

async function seedGraph(options: SeedOptions = {}) {
  const suffix = randomUUID();
  const project = options.project ?? await createProject(options.planLevel ?? 'ADVANCED');
  const targetUrl = `https://${suffix}.example.com/page`;
  const action = options.action ?? 'SERP_SNIPPET_OPTIMIZATION';
  const marketScopeMode = options.marketScopeMode ?? 'CONFIGURED_MARKET';
  const marketCode = options.marketCode === undefined
    ? (marketScopeMode === 'CONFIGURED_MARKET' ? 'HK' : null)
    : options.marketCode;
  const locale = options.locale === undefined
    ? (marketScopeMode === 'CONFIGURED_MARKET' ? 'zh-Hant' : null)
    : options.locale;

  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId: project.id,
      opportunityKey: `growth:${suffix}`,
      identityVersion: 'GROWTH_OPPORTUNITY_IDENTITY_V1',
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `feedback ${suffix}`,
      canonicalPage: targetUrl,
      identityPayload: { fixture: true }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
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
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: snapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: `candidate:${suffix}`,
      marketScopeMode,
      marketCode,
      locale,
      opportunityType: 'CTR_UNDERPERFORMANCE',
      normalizedQuery: `feedback ${suffix}`,
      canonicalPage: targetUrl,
      growthScore: 80,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { fixture: true },
      eligibilityState: marketScopeMode === 'INVALID_PROVENANCE' ? 'INELIGIBLE' : 'ELIGIBLE',
      eligibilityReasonCodes: marketScopeMode === 'INVALID_PROVENANCE'
        ? ['INVALID_MARKET_PROVENANCE']
        : []
    }
  });
  const optimizationPlan = await prisma.optimizationPlan.create({
    data: {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: action,
      sourceFactReferences: ['feedback:materialization'],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: {},
      automationEligibility: false,
      explanation: { fixture: true }
    }
  });
  const proposal = await prisma.publicationProposal.create({
    data: {
      projectId: project.id,
      sourceType: options.proposalSourceType ?? 'P9_OPTIMIZATION_PLAN',
      reason: 'P9-E materialization fixture',
      createdBy: 'SYSTEM',
      sourceReferenceId: options.proposalSourceReference === 'WRONG'
        ? randomUUID()
        : optimizationPlan.id
    }
  });
  const draft = await prisma.contentDraft.create({
    data: {
      projectId: project.id,
      sourceProposalId: proposal.id,
      title: 'P9-E materialization fixture',
      body: 'fixture',
      language: 'zh-Hant',
      generatedBy: 'DETERMINISTIC_GENERATOR'
    }
  });
  const site = await prisma.publicationSite.create({
    data: {
      projectId: project.id,
      displayName: 'P9-E materialization fixture',
      domain: `${suffix}.example.com`,
      adapterType: 'EXPORT_ONLY',
      writeCapability: 'EXPORT_ONLY'
    }
  });
  const channel = await prisma.publicationChannel.create({
    data: { siteId: site.id, pathPrefix: '/page', displayName: 'Page' }
  });
  const publicationPlan = await prisma.publicationPlan.create({
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
      planHash: `${randomUUID().replaceAll('-', '')}${'0'.repeat(32)}`.slice(0, 64)
    }
  });
  const approval = await prisma.publicationApproval.create({
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
  const execution = await prisma.publicationExecution.create({
    data: {
      projectId: project.id,
      planId: publicationPlan.id,
      approvalId: approval.id,
      executionKey: `execution:${suffix}`,
      status: options.executionStatus ?? 'VERIFIED'
    }
  });
  const verifiedAnchorAt = new Date('2026-07-01T00:00:00.000Z');
  const verification = await prisma.publicationVerification.create({
    data: {
      projectId: project.id,
      executionId: execution.id,
      status: options.verificationStatus ?? 'VERIFIED',
      observedUrl: targetUrl,
      observedAt: verifiedAnchorAt
    }
  });
  const experiment = await prisma.optimizationExperiment.create({
    data: {
      projectId: project.id,
      optimizationPlanId: optimizationPlan.id,
      publicationExecutionId: execution.id,
      publicationVerificationId: verification.id,
      experimentVersion: 'OPTIMIZATION_EXPERIMENT_V1',
      experimentKey: `experiment:${suffix}`,
      interventionType: action,
      targetUrl,
      marketCode,
      locale,
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
  const observation = options.withTerminal === false
    ? null
    : await createObservation({
      projectId: project.id,
      experimentId: experiment.id,
      verifiedAnchorAt,
      windowType: '28D',
      windowDays: 28,
      cutoffOffsetDays: options.cutoffOffsetDays ?? 29,
      effectState: options.effectState ?? 'POSITIVE',
      coverageState: options.coverageState,
      contaminationState: options.contaminationState
    });

  return { project, candidate, optimizationPlan, experiment, observation, verifiedAnchorAt };
}

function serviceWithEvents(events: ObservedEvent[]) {
  return new OptimizationFeedbackService(
    new OptimizationFeedbackRepository(),
    projectRepository,
    new FeedbackObservability((event: ObservedEvent) => events.push(event))
  );
}

function expectDeferred(result: MaterializationResult, reasonCode: string): void {
  expect(result).toEqual({ kind: 'DEFERRED', reasonCode });
}

describe('P9-E feedback materialization', () => {
  it('denies Standard before any restricted feedback context read', async () => {
    let restrictedRead = false;
    const repository = {
      loadExperimentFeedbackContext: async () => {
        restrictedRead = true;
        throw new Error('restricted read must not happen');
      }
    } as unknown as OptimizationFeedbackRepository;
    const project = { id: randomUUID(), planLevel: 'STANDARD' } as Project;
    const service = new OptimizationFeedbackService(
      repository,
      { findById: async () => project },
      new FeedbackObservability(() => undefined)
    );

    const result: MaterializationResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: randomUUID(),
      observationId: randomUUID()
    });
    expectDeferred(result, 'FEEDBACK_FEATURE_DISABLED');
    expect(restrictedRead).toBe(false);
  });

  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    '%s creates exact feedback evidence and one profile',
    async (planLevel) => {
      const fixture = await seedGraph({ planLevel });
      const events: ObservedEvent[] = [];
      const result: MaterializationResult = await serviceWithEvents(events).materializeObservation({
        projectId: fixture.project.id,
        experimentId: fixture.experiment.id,
        observationId: fixture.observation!.id
      });

      expect(result.kind).toBe('ACCEPTED');
      if (result.kind === 'DEFERRED') return;
      expect(result.evidence).toMatchObject({
        experimentId: fixture.experiment.id,
        observationId: fixture.observation!.id,
        optimizationPlanId: fixture.optimizationPlan.id,
        candidateId: fixture.candidate.id,
        effectState: 'POSITIVE',
        feedbackValue: 1,
        marketScopeMode: 'CONFIGURED_MARKET',
        marketCode: 'HK',
        locale: 'zh-Hant'
      });
      expect(result.profile).toMatchObject({
        sampleCount: 1,
        positiveCount: 1,
        historicalRankAdjustment: 0,
        windowLimit: 20
      });
      expect(events.map((event) => event.event)).toEqual([
        'optimization.feedback.accepted',
        'optimization.feedback.profile.created'
      ]);
    }
  );

  it('ignores earlier conclusive windows and accepts the earliest fully eligible terminal candidate', async () => {
    const fixture = await seedGraph({ withTerminal: false });
    const earlier = await createObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      verifiedAnchorAt: fixture.verifiedAnchorAt,
      windowType: '14D',
      windowDays: 14,
      cutoffOffsetDays: 15,
      effectState: 'POSITIVE'
    });
    await createObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      verifiedAnchorAt: fixture.verifiedAnchorAt,
      windowType: '28D',
      windowDays: 28,
      cutoffOffsetDays: 29,
      effectState: 'INCONCLUSIVE'
    });
    const eligible = await createObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      verifiedAnchorAt: fixture.verifiedAnchorAt,
      windowType: '28D',
      windowDays: 28,
      cutoffOffsetDays: 30,
      effectState: 'NEGATIVE'
    });

    const result: MaterializationResult = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: earlier.id
    });
    expect(result.kind).toBe('ACCEPTED');
    if (result.kind === 'DEFERRED') return;
    expect(result.evidence.observationId).toBe(eligible.id);
    expect(result.evidence.feedbackValue).toBe(-1);
  });

  it.each([
    [{ effectState: 'INCONCLUSIVE' as const }, 'FEEDBACK_EFFECT_INCONCLUSIVE'],
    [{ coverageState: 'PARTIAL' as const }, 'FEEDBACK_COVERAGE_INSUFFICIENT'],
    [{ contaminationState: 'CONFLICTING_MUTATION' as const }, 'FEEDBACK_CONTAMINATED']
  ])('creates no sample for rejected terminal state %#', async (overrides, reasonCode) => {
    const fixture = await seedGraph(overrides);
    const result: MaterializationResult = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    expectDeferred(result, reasonCode);
    expect(await prisma.optimizationFeedbackEvidence.count({
      where: { experimentId: fixture.experiment.id }
    })).toBe(0);
  });

  it.each([
    { executionStatus: 'DEPLOYED' as const },
    { verificationStatus: 'FAILED' as const },
    { proposalSourceType: 'MANUAL' as const },
    { proposalSourceReference: 'WRONG' as const }
  ])('fails closed when exact P8 authority is invalid %#', async (overrides) => {
    const fixture = await seedGraph(overrides);
    const result: MaterializationResult = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    expectDeferred(result, 'FEEDBACK_P8_AUTHORITY_MISSING');
  });

  it('fails closed on mismatched frozen P8 identities before evidence creation', async () => {
    const projectId = randomUUID();
    const experimentId = randomUUID();
    const planId = randomUUID();
    const context = {
      experiment: {
        id: experimentId,
        projectId,
        optimizationPlanId: planId,
        publicationExecutionId: randomUUID(),
        publicationVerificationId: randomUUID(),
        verifiedAnchorAt: new Date('2026-07-01T00:00:00.000Z'),
        observationScheduleJson: [{ windowType: '28D', windowDays: 28 }],
        observations: []
      },
      optimizationPlan: {
        id: planId,
        projectId,
        recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
        candidate: {
          id: randomUUID(), projectId, marketScopeMode: 'CONFIGURED_MARKET', marketCode: 'HK', locale: 'zh-Hant'
        }
      },
      execution: { id: randomUUID(), projectId, status: 'VERIFIED' },
      verification: { id: randomUUID(), projectId, executionId: randomUUID(), status: 'VERIFIED' },
      proposal: { id: randomUUID(), projectId, sourceType: 'P9_OPTIMIZATION_PLAN', sourceReferenceId: planId }
    } satisfies FeedbackMaterializationContext;
    const repository = {
      loadExperimentFeedbackContext: async () => context,
      findEvidenceForExperiment: async () => null
    } as unknown as OptimizationFeedbackRepository;
    const service = new OptimizationFeedbackService(
      repository,
      { findById: async () => ({ id: projectId, planLevel: 'ADVANCED' } as Project) },
      new FeedbackObservability(() => undefined)
    );
    const result: MaterializationResult = await service.materializeObservation({
      projectId,
      experimentId,
      observationId: randomUUID()
    });
    expectDeferred(result, 'FEEDBACK_P8_AUTHORITY_MISSING');
  });

  it('fails closed on INVALID_PROVENANCE instead of inferring market scope', async () => {
    const fixture = await seedGraph({
      marketScopeMode: 'INVALID_PROVENANCE',
      marketCode: null,
      locale: null
    });
    const result: MaterializationResult = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    expectDeferred(result, 'FEEDBACK_SCOPE_INVALID');
  });

  it('keeps configured and legacy scopes separate', async () => {
    const project = await createProject();
    const configured = await seedGraph({ project, cutoffOffsetDays: 29 });
    const legacy = await seedGraph({
      project,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      cutoffOffsetDays: 30
    });
    const service = serviceWithEvents([]);
    const configuredResult: MaterializationResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: configured.experiment.id,
      observationId: configured.observation!.id
    });
    const legacyResult: MaterializationResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: legacy.experiment.id,
      observationId: legacy.observation!.id
    });
    expect(configuredResult.kind).toBe('ACCEPTED');
    expect(legacyResult.kind).toBe('ACCEPTED');
    if (configuredResult.kind === 'DEFERRED' || legacyResult.kind === 'DEFERRED') return;
    expect(configuredResult.evidence.scopeKey).not.toBe(legacyResult.evidence.scopeKey);
    expect(configuredResult.profile.sampleCount).toBe(1);
    expect(legacyResult.profile.sampleCount).toBe(1);
  });

  it('creates a new profile for second same-scope evidence and preserves the old profile', async () => {
    const project = await createProject();
    const first = await seedGraph({ project, cutoffOffsetDays: 29 });
    const second = await seedGraph({ project, cutoffOffsetDays: 30 });
    const service = serviceWithEvents([]);
    const firstResult: MaterializationResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: first.experiment.id,
      observationId: first.observation!.id
    });
    expect(firstResult.kind).toBe('ACCEPTED');
    if (firstResult.kind === 'DEFERRED') return;
    const frozen = await prisma.optimizationFeedbackProfile.findUniqueOrThrow({
      where: { id: firstResult.profile.id }
    });
    const secondResult: MaterializationResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: second.experiment.id,
      observationId: second.observation!.id
    });
    expect(secondResult.kind).toBe('ACCEPTED');
    if (secondResult.kind === 'DEFERRED') return;
    expect(secondResult.profile.sampleCount).toBe(2);
    expect(secondResult.profile.id).not.toBe(firstResult.profile.id);
    expect(await prisma.optimizationFeedbackProfile.findUniqueOrThrow({
      where: { id: firstResult.profile.id }
    })).toEqual(frozen);
  });

  it('repairs a missing profile when evidence already exists and remains idempotent', async () => {
    const fixture = await seedGraph();
    const repository = new OptimizationFeedbackRepository();
    const scopeKey = buildFeedbackScopeKey({
      projectId: fixture.project.id,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
    });
    const evidenceKey = buildFeedbackEvidenceKey({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id,
      scopeKey
    });
    const persisted = await repository.createOrGetEvidence({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id,
      optimizationPlanId: fixture.optimizationPlan.id,
      candidateId: fixture.candidate.id,
      feedbackEvidenceVersion: OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
      evidenceKey,
      scopeKey,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
      effectState: 'POSITIVE',
      feedbackValue: 1,
      terminalWindowType: '28D',
      terminalWindowDays: 28,
      inputCutoffAt: fixture.observation!.inputCutoffAt,
      sourceEvaluatorVersion: fixture.observation!.evaluatorVersion,
      sourceObservationKey: fixture.observation!.observationKey
    });
    expect(persisted.kind).toBe('CREATED');

    const events: ObservedEvent[] = [];
    const service = serviceWithEvents(events);
    const repaired: MaterializationResult = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    const retry: MaterializationResult = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });

    expect(repaired.kind).toBe('EXISTING');
    expect(retry.kind).toBe('EXISTING');
    if (repaired.kind === 'DEFERRED') return;
    expect(repaired.profile.sampleCount).toBe(1);
    expect(events.filter((event) => event.event === 'optimization.feedback.accepted')).toHaveLength(0);
    expect(events.filter((event) => event.event === 'optimization.feedback.profile.created')).toHaveLength(1);
  });

  it('emits create-specific events only once for repeated complete materialization', async () => {
    const fixture = await seedGraph();
    const events: ObservedEvent[] = [];
    const service = serviceWithEvents(events);
    const first: MaterializationResult = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    const second: MaterializationResult = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    expect(first.kind).toBe('ACCEPTED');
    expect(second.kind).toBe('EXISTING');
    expect(events.filter((event) => event.event === 'optimization.feedback.accepted')).toHaveLength(1);
    expect(events.filter((event) => event.event === 'optimization.feedback.profile.created')).toHaveLength(1);
  });

  it('serializes concurrent same-scope materialization so latest profile contains both experiments', async () => {
    const project = await createProject();
    const first = await seedGraph({ project, cutoffOffsetDays: 29 });
    const second = await seedGraph({ project, cutoffOffsetDays: 30 });
    const service = serviceWithEvents([]);
    const results: MaterializationResult[] = await Promise.all([
      service.materializeObservation({ projectId: project.id, experimentId: first.experiment.id, observationId: first.observation!.id }),
      service.materializeObservation({ projectId: project.id, experimentId: second.experiment.id, observationId: second.observation!.id })
    ]);
    expect(results.every((result: MaterializationResult) => result.kind === 'ACCEPTED')).toBe(true);

    const evidence = await prisma.optimizationFeedbackEvidence.findMany({
      where: {
        projectId: project.id,
        marketScopeMode: 'CONFIGURED_MARKET',
        marketCode: 'HK',
        locale: 'zh-Hant',
        recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
      },
      orderBy: [{ inputCutoffAt: 'asc' }, { observationId: 'asc' }]
    });
    const latest = await new OptimizationFeedbackRepository().findLatestProfileForScope({
      projectId: project.id,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
    });
    expect(evidence).toHaveLength(2);
    expect(latest?.sampleCount).toBe(2);
    expect(latest?.inputEvidenceIdsJson).toEqual(evidence.map((item) => item.id));
  });

  it('exposes no Search, Visibility, AI, Git, provider, or publication mutation dependency', () => {
    const source = readFileSync(
      new URL('../../src/modules/optimization-feedback/feedback.service.ts', import.meta.url),
      'utf8'
    );
    expect(source).not.toMatch(/from ['"][^'"]*\/(?:ai|search-facts|search-providers|visibility|publication)\//);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source.toLowerCase()).not.toContain('github');
  });
});
