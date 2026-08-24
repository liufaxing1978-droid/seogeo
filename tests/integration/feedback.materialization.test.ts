import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type {
  MarketCode,
  OptimizationFeedbackEvidence,
  OptimizationFeedbackProfile,
  OptimizationMarketScopeMode,
  PlanLevel,
  Prisma,
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
import {
  FeedbackObservability,
  type FeedbackObservabilityEvent
} from '../../src/modules/optimization-feedback/feedback.observability.js';
import {
  OptimizationFeedbackRepository,
  type FeedbackMaterializationContext
} from '../../src/modules/optimization-feedback/feedback.repository.js';
import {
  OptimizationFeedbackService,
  type FeedbackMaterializationResult
} from '../../src/modules/optimization-feedback/feedback.service.js';
import {
  OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
  OPTIMIZATION_FEEDBACK_PROFILE_VERSION
} from '../../src/modules/optimization-feedback/feedback.types.js';
import { projectRepository } from '../../src/modules/projects/project.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type TerminalState = {
  effectState?: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'INCONCLUSIVE';
  coverageState?: 'SUFFICIENT' | 'PARTIAL' | 'INSUFFICIENT' | 'UNKNOWN';
  contaminationState?: 'CLEAR' | 'CONFLICTING_MUTATION' | 'TARGET_REVISION_CHANGED' | 'VERIFICATION_INVALIDATED' | 'SOURCE_IDENTITY_CHANGED' | 'UNKNOWN';
  evaluatorVersion?: string;
  cutoffOffsetDays?: number;
};

type SeedOptions = TerminalState & {
  project?: Project;
  planLevel?: PlanLevel;
  marketScopeMode?: OptimizationMarketScopeMode;
  marketCode?: MarketCode | null;
  locale?: string | null;
  action?: RecommendedActionType;
  proposalSourceType?: PublicationProposalSourceType;
  proposalSourceReference?: 'PLAN' | 'WRONG' | 'NULL';
  executionStatus?: PublicationExecutionStatus;
  verificationStatus?: PublicationVerificationStatus;
  withDefaultTerminalObservation?: boolean;
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
  evaluatorVersion?: string;
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
      inputCutoffAt: new Date(
        input.verifiedAnchorAt.getTime() + input.cutoffOffsetDays * DAY_MS
      ),
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
      evaluatorVersion: input.evaluatorVersion ?? 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1'
    }
  });
}

async function seedMaterializationGraph(options: SeedOptions = {}) {
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

  const growthIdentity = await prisma.growthOpportunityIdentity.create({
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
  const growthSnapshot = await prisma.growthOpportunitySnapshot.create({
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
  const candidate = await prisma.optimizationCandidate.create({
    data: {
      projectId: project.id,
      growthOpportunityIdentityId: growthIdentity.id,
      growthSnapshotId: growthSnapshot.id,
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
      sourceReferenceId: options.proposalSourceReference === 'NULL'
        ? null
        : options.proposalSourceReference === 'WRONG'
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
      planHash: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64)
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

  const observation = options.withDefaultTerminalObservation === false
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
      contaminationState: options.contaminationState,
      evaluatorVersion: options.evaluatorVersion
    });

  return {
    project,
    candidate,
    optimizationPlan,
    proposal,
    execution,
    verification,
    experiment,
    observation,
    verifiedAnchorAt
  };
}

function observabilityCollector() {
  const events: FeedbackObservabilityEvent[] = [];
  return {
    events,
    observability: new FeedbackObservability((event) => events.push(event))
  };
}

function serviceWithEvents(events: FeedbackObservabilityEvent[]) {
  return new OptimizationFeedbackService(
    new OptimizationFeedbackRepository(),
    projectRepository,
    new FeedbackObservability((event) => events.push(event))
  );
}

function expectDeferred(
  result: FeedbackMaterializationResult,
  reasonCode: string
): void {
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
    const standardProject = {
      id: randomUUID(),
      planLevel: 'STANDARD'
    } as Project;
    const projectPort = {
      findById: async () => standardProject
    };
    const service = new OptimizationFeedbackService(
      repository,
      projectPort,
      new FeedbackObservability(() => undefined)
    );

    const result = await service.materializeObservation({
      projectId: standardProject.id,
      experimentId: randomUUID(),
      observationId: randomUUID()
    });

    expectDeferred(result, 'FEEDBACK_FEATURE_DISABLED');
    expect(restrictedRead).toBe(false);
  });

  it.each(['ADVANCED', 'ENTERPRISE'] as const)(
    '%s accepts an exact eligible terminal observation and creates one evidence plus one profile',
    async (planLevel) => {
      const fixture = await seedMaterializationGraph({ planLevel });
      const events: FeedbackObservabilityEvent[] = [];
      const service = serviceWithEvents(events);

      const result = await service.materializeObservation({
        projectId: fixture.project.id,
        experimentId: fixture.experiment.id,
        observationId: fixture.observation!.id
      });

      expect(result.kind).toBe('ACCEPTED');
      if (result.kind !== 'ACCEPTED') return;
      expect(result.evidence).toMatchObject({
        experimentId: fixture.experiment.id,
        observationId: fixture.observation!.id,
        optimizationPlanId: fixture.optimizationPlan.id,
        candidateId: fixture.candidate.id,
        effectState: 'POSITIVE',
        feedbackValue: 1,
        marketScopeMode: 'CONFIGURED_MARKET',
        marketCode: 'HK',
        locale: 'zh-Hant',
        recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
      });
      expect(result.profile).toMatchObject({
        sampleCount: 1,
        positiveCount: 1,
        neutralCount: 0,
        negativeCount: 0,
        historicalRankAdjustment: 0,
        windowLimit: 20
      });
      expect(await prisma.optimizationFeedbackEvidence.count({
        where: { experimentId: fixture.experiment.id }
      })).toBe(1);
      expect(await prisma.optimizationFeedbackProfile.count({
        where: { projectId: fixture.project.id, scopeKey: result.evidence.scopeKey }
      })).toBe(1);
      expect(events.map((event) => event.event)).toEqual([
        'optimization.feedback.accepted',
        'optimization.feedback.profile.created'
      ]);
    }
  );

  it('never uses an earlier conclusive planned window as feedback evidence', async () => {
    const fixture = await seedMaterializationGraph({
      withDefaultTerminalObservation: false
    });
    const earlier = await createObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      verifiedAnchorAt: fixture.verifiedAnchorAt,
      windowType: '14D',
      windowDays: 14,
      cutoffOffsetDays: 15,
      effectState: 'POSITIVE'
    });
    const terminal = await createObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      verifiedAnchorAt: fixture.verifiedAnchorAt,
      windowType: '28D',
      windowDays: 28,
      cutoffOffsetDays: 29,
      effectState: 'NEGATIVE'
    });
    const service = serviceWithEvents([]);

    const result = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: earlier.id
    });

    expect(result.kind).toBe('ACCEPTED');
    if (result.kind !== 'ACCEPTED') return;
    expect(result.evidence.observationId).toBe(terminal.id);
    expect(result.evidence.feedbackValue).toBe(-1);
  });

  it('accepts the earliest fully eligible terminal candidate rather than an earlier rejected one', async () => {
    const fixture = await seedMaterializationGraph({ withDefaultTerminalObservation: false });
    const rejected = await createObservation({
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
      effectState: 'POSITIVE'
    });

    const result = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: rejected.id
    });

    expect(result.kind).toBe('ACCEPTED');
    if (result.kind !== 'ACCEPTED') return;
    expect(result.evidence.observationId).toBe(eligible.id);
  });

  it.each([
    [{ effectState: 'INCONCLUSIVE' as const }, 'FEEDBACK_EFFECT_INCONCLUSIVE'],
    [{ coverageState: 'PARTIAL' as const }, 'FEEDBACK_COVERAGE_INSUFFICIENT'],
    [{ contaminationState: 'CONFLICTING_MUTATION' as const }, 'FEEDBACK_CONTAMINATED']
  ])('creates no sample for ineligible terminal state %#', async (overrides, reasonCode) => {
    const fixture = await seedMaterializationGraph(overrides);
    const result = await serviceWithEvents([]).materializeObservation({
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
  ])('fails closed when exact P8 authority/provenance is inconsistent %#', async (overrides) => {
    const fixture = await seedMaterializationGraph(overrides);
    const result = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });

    expectDeferred(result, 'FEEDBACK_P8_AUTHORITY_MISSING');
    expect(await prisma.optimizationFeedbackEvidence.count({
      where: { experimentId: fixture.experiment.id }
    })).toBe(0);
  });

  it('fails closed on mismatched frozen execution/verification identities', async () => {
    const projectId = randomUUID();
    const experimentId = randomUUID();
    const observationId = randomUUID();
    const context = {
      experiment: {
        id: experimentId,
        projectId,
        optimizationPlanId: randomUUID(),
        publicationExecutionId: randomUUID(),
        publicationVerificationId: randomUUID(),
        verifiedAnchorAt: new Date('2026-07-01T00:00:00.000Z'),
        observationScheduleJson: [{ windowType: '28D', windowDays: 28 }],
        observations: []
      },
      optimizationPlan: {
        id: randomUUID(),
        projectId,
        recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION',
        candidate: {
          id: randomUUID(),
          projectId,
          marketScopeMode: 'CONFIGURED_MARKET',
          marketCode: 'HK',
          locale: 'zh-Hant'
        }
      },
      execution: { id: randomUUID(), projectId, status: 'VERIFIED' },
      verification: {
        id: randomUUID(),
        projectId,
        executionId: randomUUID(),
        status: 'VERIFIED'
      },
      proposal: {
        id: randomUUID(),
        projectId,
        sourceType: 'P9_OPTIMIZATION_PLAN',
        sourceReferenceId: randomUUID()
      }
    } satisfies FeedbackMaterializationContext;
    const repository = {
      loadExperimentFeedbackContext: async () => context,
      findEvidenceForExperiment: async () => null
    } as unknown as OptimizationFeedbackRepository;
    const projectPort = {
      findById: async () => ({ id: projectId, planLevel: 'ADVANCED' } as Project)
    };
    const service = new OptimizationFeedbackService(
      repository,
      projectPort,
      new FeedbackObservability(() => undefined)
    );

    const result = await service.materializeObservation({ projectId, experimentId, observationId });
    expectDeferred(result, 'FEEDBACK_P8_AUTHORITY_MISSING');
  });

  it('rejects invalid/ambiguous market scope instead of inferring a configured scope', async () => {
    const fixture = await seedMaterializationGraph({
      marketScopeMode: 'INVALID_PROVENANCE',
      marketCode: null,
      locale: null
    });

    const result = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    expectDeferred(result, 'FEEDBACK_SCOPE_INVALID');
  });

  it('keeps configured and legacy feedback scopes isolated', async () => {
    const project = await createProject('ADVANCED');
    const configured = await seedMaterializationGraph({ project, cutoffOffsetDays: 29 });
    const legacy = await seedMaterializationGraph({
      project,
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      cutoffOffsetDays: 30
    });
    const service = serviceWithEvents([]);

    const configuredResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: configured.experiment.id,
      observationId: configured.observation!.id
    });
    const legacyResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: legacy.experiment.id,
      observationId: legacy.observation!.id
    });

    expect(configuredResult.kind).toBe('ACCEPTED');
    expect(legacyResult.kind).toBe('ACCEPTED');
    if (configuredResult.kind !== 'ACCEPTED' || legacyResult.kind !== 'ACCEPTED') return;
    expect(configuredResult.evidence.scopeKey).not.toBe(legacyResult.evidence.scopeKey);
    expect(configuredResult.profile.sampleCount).toBe(1);
    expect(legacyResult.profile.sampleCount).toBe(1);
    expect(configuredResult.evidence.marketScopeMode).toBe('CONFIGURED_MARKET');
    expect(legacyResult.evidence.marketScopeMode).toBe('UNCONFIGURED_LEGACY');
  });

  it('creates a new immutable profile for a second experiment in the same scope and preserves the old profile', async () => {
    const project = await createProject('ADVANCED');
    const first = await seedMaterializationGraph({ project, cutoffOffsetDays: 29 });
    const second = await seedMaterializationGraph({ project, cutoffOffsetDays: 30 });
    const service = serviceWithEvents([]);

    const firstResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: first.experiment.id,
      observationId: first.observation!.id
    });
    expect(firstResult.kind).toBe('ACCEPTED');
    if (firstResult.kind !== 'ACCEPTED') return;
    const frozenFirstProfile = await prisma.optimizationFeedbackProfile.findUniqueOrThrow({
      where: { id: firstResult.profile.id }
    });

    const secondResult = await service.materializeObservation({
      projectId: project.id,
      experimentId: second.experiment.id,
      observationId: second.observation!.id
    });
    expect(secondResult.kind).toBe('ACCEPTED');
    if (secondResult.kind !== 'ACCEPTED') return;

    expect(secondResult.profile.id).not.toBe(firstResult.profile.id);
    expect(secondResult.profile.sampleCount).toBe(2);
    expect(await prisma.optimizationFeedbackProfile.findUniqueOrThrow({
      where: { id: firstResult.profile.id }
    })).toEqual(frozenFirstProfile);
    expect(await prisma.optimizationFeedbackProfile.count({
      where: { projectId: project.id, scopeKey: firstResult.evidence.scopeKey }
    })).toBe(2);
  });

  it('repairs a missing profile when accepted evidence already exists', async () => {
    const fixture = await seedMaterializationGraph();
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
    expect(await prisma.optimizationFeedbackProfile.count({
      where: { projectId: fixture.project.id, scopeKey }
    })).toBe(0);

    const result = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });

    expect(result.kind).toBe('EXISTING');
    if (result.kind !== 'EXISTING') return;
    expect(result.evidence.id).toBe(persisted.evidence.id);
    expect(result.profile.sampleCount).toBe(1);
    expect(await prisma.optimizationFeedbackProfile.count({
      where: { projectId: fixture.project.id, scopeKey }
    })).toBe(1);
  });

  it('is idempotent after complete materialization and emits no duplicate create-specific events', async () => {
    const fixture = await seedMaterializationGraph();
    const collector = observabilityCollector();
    const service = new OptimizationFeedbackService(
      new OptimizationFeedbackRepository(),
      projectRepository,
      collector.observability
    );

    const first = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });
    const second = await service.materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });

    expect(first.kind).toBe('ACCEPTED');
    expect(second.kind).toBe('EXISTING');
    expect(collector.events.filter((event) => event.event === 'optimization.feedback.accepted')).toHaveLength(1);
    expect(collector.events.filter((event) => event.event === 'optimization.feedback.profile.created')).toHaveLength(1);
  });

  it('serializes concurrent same-scope experiments so the latest profile includes both accepted experiments', async () => {
    const project = await createProject('ADVANCED');
    const first = await seedMaterializationGraph({ project, cutoffOffsetDays: 29 });
    const second = await seedMaterializationGraph({ project, cutoffOffsetDays: 30 });
    const service = serviceWithEvents([]);

    const results = await Promise.all([
      service.materializeObservation({
        projectId: project.id,
        experimentId: first.experiment.id,
        observationId: first.observation!.id
      }),
      service.materializeObservation({
        projectId: project.id,
        experimentId: second.experiment.id,
        observationId: second.observation!.id
      })
    ]);

    expect(results.every((result) => result.kind === 'ACCEPTED')).toBe(true);
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
    expect(evidence).toHaveLength(2);
    const repository = new OptimizationFeedbackRepository();
    const latest = await repository.findLatestProfileForScope({
      projectId: project.id,
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: 'HK',
      locale: 'zh-Hant',
      recommendedActionType: 'SERP_SNIPPET_OPTIMIZATION'
    });
    expect(latest?.sampleCount).toBe(2);
    expect(latest?.inputEvidenceIdsJson).toEqual(evidence.map((item) => item.id));
  });

  it('does not expose Search, Visibility, AI, Git, provider, or publication mutation dependencies', () => {
    const source = readFileSync(
      new URL('../../src/modules/optimization-feedback/feedback.service.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toMatch(/from ['"][^'"]*\/(?:ai|search-facts|search-providers|visibility|publication)\//);
    expect(source.toLowerCase()).not.toContain('deepseek');
    expect(source.toLowerCase()).not.toContain('github');
  });

  it('freezes only bounded profile metadata and does not copy raw experiment metrics', async () => {
    const fixture = await seedMaterializationGraph();
    const result = await serviceWithEvents([]).materializeObservation({
      projectId: fixture.project.id,
      experimentId: fixture.experiment.id,
      observationId: fixture.observation!.id
    });

    expect(result.kind).toBe('ACCEPTED');
    if (result.kind !== 'ACCEPTED') return;
    const serializedEvidence = JSON.stringify(result.evidence);
    const serializedProfile = JSON.stringify(result.profile);
    expect(serializedEvidence).not.toContain('baselineMetricsJson');
    expect(serializedEvidence).not.toContain('observedMetricsJson');
    expect(serializedProfile).not.toContain('baselineMetricsJson');
    expect(serializedProfile).not.toContain('observedMetricsJson');
  });
});
