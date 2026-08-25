import type {
  OptimizationFeedbackEvidence,
  OptimizationFeedbackProfile,
  PlanLevel,
  Project
} from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { projectRepository } from '../projects/project.repository.js';
import {
  feedbackValueForEffect,
  selectFeedbackObservation,
  type FeedbackEligibilityReasonCode
} from './feedback.eligibility.js';
import {
  buildFeedbackEvidenceKey,
  buildFeedbackProfileIdentity,
  buildFeedbackScopeKey
} from './feedback.identity.js';
import {
  feedbackObservability,
  type FeedbackObservabilityEvent
} from './feedback.observability.js';
import { calculateFeedbackProfile } from './feedback.profile.js';
import {
  OptimizationFeedbackRepository,
  type FeedbackMaterializationContext
} from './feedback.repository.js';
import {
  OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
  OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
  OPTIMIZATION_FEEDBACK_WINDOW_LIMIT,
  type FeedbackEffect,
  type FeedbackMarketScopeMode
} from './feedback.types.js';

export type FeedbackMaterializationResult =
  | {
    kind: 'ACCEPTED' | 'EXISTING';
    evidence: OptimizationFeedbackEvidence;
    profile: OptimizationFeedbackProfile;
  }
  | { kind: 'DEFERRED'; reasonCode: FeedbackEligibilityReasonCode };

type ProjectReadPort = {
  findById(id: string): Promise<Pick<Project, 'id' | 'planLevel'> | null>;
};

type FeedbackObservabilityPort = {
  emit(event: FeedbackObservabilityEvent): void;
};

type FeedbackScope = {
  marketScopeMode: FeedbackMarketScopeMode;
  marketCode: FeedbackMaterializationContext['optimizationPlan']['candidate']['marketCode'];
  locale: string | null;
};

function validP8Authority(context: FeedbackMaterializationContext, projectId: string): boolean {
  const { experiment, optimizationPlan, execution, verification, proposal } = context;
  const candidate = optimizationPlan.candidate;
  return (
    experiment.projectId === projectId
    && optimizationPlan.projectId === projectId
    && candidate.projectId === projectId
    && execution.projectId === projectId
    && verification.projectId === projectId
    && proposal.projectId === projectId
    && experiment.optimizationPlanId === optimizationPlan.id
    && experiment.publicationExecutionId === execution.id
    && experiment.publicationVerificationId === verification.id
    && execution.status === 'VERIFIED'
    && verification.status === 'VERIFIED'
    && verification.executionId === execution.id
    && proposal.sourceType === 'P9_OPTIMIZATION_PLAN'
    && proposal.sourceReferenceId === optimizationPlan.id
  );
}

function resolveFeedbackScope(context: FeedbackMaterializationContext): FeedbackScope | null {
  const candidate = context.optimizationPlan.candidate;
  if (candidate.marketScopeMode === 'CONFIGURED_MARKET') {
    if (
      candidate.marketCode === null
      || candidate.locale === null
      || candidate.locale.trim().length === 0
    ) {
      return null;
    }
    return {
      marketScopeMode: 'CONFIGURED_MARKET',
      marketCode: candidate.marketCode,
      locale: candidate.locale
    };
  }
  if (
    candidate.marketScopeMode === 'UNCONFIGURED_LEGACY'
    && candidate.marketCode === null
    && candidate.locale === null
  ) {
    return {
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null
    };
  }
  return null;
}

function asFeedbackEffect(value: string): FeedbackEffect {
  if (value === 'POSITIVE' || value === 'NEUTRAL' || value === 'NEGATIVE') return value;
  throw new Error('FEEDBACK_EFFECT_INVALID');
}

function existingEvidenceMatchesContext(input: {
  evidence: OptimizationFeedbackEvidence;
  context: FeedbackMaterializationContext;
  projectId: string;
  scopeKey: string;
  scope: FeedbackScope;
}): boolean {
  const { evidence, context, projectId, scopeKey, scope } = input;
  return (
    evidence.projectId === projectId
    && evidence.experimentId === context.experiment.id
    && evidence.optimizationPlanId === context.optimizationPlan.id
    && evidence.candidateId === context.optimizationPlan.candidate.id
    && evidence.feedbackEvidenceVersion === OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION
    && evidence.scopeKey === scopeKey
    && evidence.marketScopeMode === scope.marketScopeMode
    && evidence.marketCode === scope.marketCode
    && evidence.locale === scope.locale
    && evidence.recommendedActionType === context.optimizationPlan.recommendedActionType
    && context.experiment.observations.some((observation) => (
      observation.id === evidence.observationId
      && observation.observationKey === evidence.sourceObservationKey
      && observation.inputCutoffAt.getTime() === evidence.inputCutoffAt.getTime()
      && observation.evaluatorVersion === evidence.sourceEvaluatorVersion
    ))
  );
}

export class OptimizationFeedbackService {
  constructor(
    private readonly repository = new OptimizationFeedbackRepository(),
    private readonly projects: ProjectReadPort = projectRepository,
    private readonly observability: FeedbackObservabilityPort = feedbackObservability
  ) {}

  private deferred(input: {
    projectId: string;
    experimentId: string;
    observationId: string;
    reasonCode: FeedbackEligibilityReasonCode;
  }): FeedbackMaterializationResult {
    this.observability.emit({
      event: 'optimization.feedback.deferred',
      projectId: input.projectId,
      experimentId: input.experimentId,
      observationId: input.observationId,
      reasonCode: input.reasonCode
    });
    return { kind: 'DEFERRED', reasonCode: input.reasonCode };
  }

  async materializeObservation(input: {
    projectId: string;
    experimentId: string;
    observationId: string;
  }): Promise<FeedbackMaterializationResult> {
    const project = await this.projects.findById(input.projectId);
    if (!project || !hasFeature(project.planLevel as PlanLevel, 'OPTIMIZATION_FEEDBACK')) {
      return this.deferred({ ...input, reasonCode: 'FEEDBACK_FEATURE_DISABLED' });
    }

    const context = await this.repository.loadExperimentFeedbackContext({
      projectId: input.projectId,
      experimentId: input.experimentId
    });
    if (!context || !validP8Authority(context, input.projectId)) {
      return this.deferred({ ...input, reasonCode: 'FEEDBACK_P8_AUTHORITY_MISSING' });
    }

    if (!context.experiment.observations.some((observation) => observation.id === input.observationId)) {
      return this.deferred({ ...input, reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING' });
    }

    const scope = resolveFeedbackScope(context);
    if (!scope) {
      return this.deferred({ ...input, reasonCode: 'FEEDBACK_SCOPE_INVALID' });
    }

    const scopeKey = buildFeedbackScopeKey({
      projectId: input.projectId,
      marketScopeMode: scope.marketScopeMode,
      marketCode: scope.marketCode,
      locale: scope.locale,
      recommendedActionType: context.optimizationPlan.recommendedActionType
    });

    const locked = await this.repository.withScopeLock(scopeKey, async (repository) => {
      const existing = await repository.findEvidenceForExperiment(context.experiment.id);
      let evidenceResult:
        | { kind: 'CREATED'; evidence: OptimizationFeedbackEvidence }
        | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence };

      if (existing) {
        if (!existingEvidenceMatchesContext({
          evidence: existing,
          context,
          projectId: input.projectId,
          scopeKey,
          scope
        })) {
          throw new Error('FEEDBACK_EVIDENCE_IDENTITY_COLLISION');
        }
        evidenceResult = { kind: 'EXISTING', evidence: existing };
      } else {
        const selection = selectFeedbackObservation({
          experimentId: context.experiment.id,
          verifiedAnchorAt: context.experiment.verifiedAnchorAt,
          observationScheduleJson: context.experiment.observationScheduleJson,
          observations: context.experiment.observations,
          acceptedExperimentId: null,
          p8AuthorityValid: true,
          scopeValid: true
        });
        if (selection.kind === 'DEFER') {
          return { kind: 'DEFERRED' as const, reasonCode: selection.reasonCode };
        }

        const observation = selection.observation;
        const effect = asFeedbackEffect(observation.effectState);
        const evidenceKey = buildFeedbackEvidenceKey({
          projectId: input.projectId,
          experimentId: context.experiment.id,
          observationId: observation.id,
          scopeKey
        });
        evidenceResult = await repository.createOrGetEvidence({
          projectId: input.projectId,
          experimentId: context.experiment.id,
          observationId: observation.id,
          optimizationPlanId: context.optimizationPlan.id,
          candidateId: context.optimizationPlan.candidate.id,
          feedbackEvidenceVersion: OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
          evidenceKey,
          scopeKey,
          marketScopeMode: scope.marketScopeMode,
          marketCode: scope.marketCode,
          locale: scope.locale,
          recommendedActionType: context.optimizationPlan.recommendedActionType,
          effectState: effect,
          feedbackValue: feedbackValueForEffect(effect),
          terminalWindowType: observation.windowType,
          terminalWindowDays: observation.windowDays,
          inputCutoffAt: observation.inputCutoffAt,
          sourceEvaluatorVersion: observation.evaluatorVersion,
          sourceObservationKey: observation.observationKey
        });
      }

      const evidence = await repository.listEvidenceForScope({
        projectId: input.projectId,
        scopeKey
      });
      const calculation = calculateFeedbackProfile(evidence);
      const identity = buildFeedbackProfileIdentity({
        projectId: input.projectId,
        scopeKey,
        orderedEvidenceIds: calculation.orderedEvidenceIds
      });
      const profileResult = await repository.createOrGetProfile({
        projectId: input.projectId,
        feedbackProfileVersion: OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
        profileKey: identity.profileKey,
        scopeKey,
        marketScopeMode: scope.marketScopeMode,
        marketCode: scope.marketCode,
        locale: scope.locale,
        recommendedActionType: context.optimizationPlan.recommendedActionType,
        sampleCount: calculation.sampleCount,
        positiveCount: calculation.positiveCount,
        neutralCount: calculation.neutralCount,
        negativeCount: calculation.negativeCount,
        rollingEffectBalance: calculation.rollingEffectBalance,
        historicalRankAdjustment: calculation.historicalRankAdjustment,
        windowLimit: OPTIMIZATION_FEEDBACK_WINDOW_LIMIT,
        oldestEvidenceCutoffAt: calculation.oldestEvidenceCutoffAt,
        newestEvidenceCutoffAt: calculation.newestEvidenceCutoffAt,
        inputEvidenceIdsJson: calculation.orderedEvidenceIds,
        inputFingerprint: identity.inputFingerprint
      });

      return {
        kind: 'MATERIALIZED' as const,
        evidenceResult,
        profileResult
      };
    });

    if (locked.kind === 'DEFERRED') {
      return this.deferred({ ...input, reasonCode: locked.reasonCode });
    }

    const { evidenceResult, profileResult } = locked;
    if (evidenceResult.kind === 'CREATED') {
      this.observability.emit({
        event: 'optimization.feedback.accepted',
        projectId: input.projectId,
        experimentId: context.experiment.id,
        observationId: evidenceResult.evidence.observationId,
        feedbackEvidenceId: evidenceResult.evidence.id,
        recommendedActionType: context.optimizationPlan.recommendedActionType,
        ...(scope.marketCode ? { marketCode: scope.marketCode } : {}),
        ...(scope.locale ? { locale: scope.locale } : {})
      });
    }
    if (profileResult.kind === 'CREATED') {
      this.observability.emit({
        event: 'optimization.feedback.profile.created',
        projectId: input.projectId,
        experimentId: context.experiment.id,
        observationId: evidenceResult.evidence.observationId,
        feedbackEvidenceId: evidenceResult.evidence.id,
        feedbackProfileId: profileResult.profile.id,
        recommendedActionType: context.optimizationPlan.recommendedActionType,
        ...(scope.marketCode ? { marketCode: scope.marketCode } : {}),
        ...(scope.locale ? { locale: scope.locale } : {}),
        sampleCount: profileResult.profile.sampleCount,
        historicalRankAdjustment: profileResult.profile.historicalRankAdjustment
      });
    }

    return {
      kind: evidenceResult.kind === 'CREATED' ? 'ACCEPTED' : 'EXISTING',
      evidence: evidenceResult.evidence,
      profile: profileResult.profile
    };
  }
}

export const optimizationFeedbackService = new OptimizationFeedbackService();
