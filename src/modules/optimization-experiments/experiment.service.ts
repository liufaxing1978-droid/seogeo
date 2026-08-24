import { Prisma } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { buildExperimentKey, canonicalJson } from './experiment.identity.js';
import {
  OptimizationExperimentRepository,
  type ExperimentStartResult
} from './experiment.repository.js';
import { scheduleForIntervention } from './experiment.schedule.js';
import {
  normalizeExperimentHttpUrl,
  resolveExperimentMeasurementScope,
  type VisibilityExperimentScopeSourcePort
} from './experiment.scope.js';
import {
  OPTIMIZATION_EXPERIMENT_VERSION,
  type ExperimentMeasurementScope,
  type ExperimentMetricDirection
} from './experiment.types.js';

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function expectedDirectionsFor(
  interventionType: string,
  scope: ExperimentMeasurementScope
): Record<string, ExperimentMetricDirection> | null {
  switch (interventionType) {
    case 'SERP_SNIPPET_OPTIMIZATION':
      return { CTR: 'HIGHER' };
    case 'ON_PAGE_OPTIMIZATION':
    case 'CONTENT_REFRESH':
      return { CLICKS: 'HIGHER' };
    case 'CONTENT_CREATION':
      return { IMPRESSIONS: 'HIGHER' };
    case 'GEO_CITABILITY_IMPROVEMENT':
      return scope.kind === 'VISIBILITY' && scope.metricType === 'CITATION_RATE'
        ? { CITATION_RATE: 'HIGHER' }
        : null;
    case 'AI_VISIBILITY_IMPROVEMENT':
      return scope.kind === 'VISIBILITY'
        ? { [scope.metricType]: 'HIGHER' }
        : null;
    default:
      return null;
  }
}

export class OptimizationExperimentService {
  constructor(
    private readonly repository = new OptimizationExperimentRepository(),
    private readonly visibilitySource?: VisibilityExperimentScopeSourcePort
  ) {}

  async startFromVerifiedExecution(input: {
    projectId: string;
    publicationExecutionId: string;
  }): Promise<ExperimentStartResult> {
    const authority = await this.repository.inspectStartAuthority(input);
    if (!authority) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_P9_SOURCE_MISMATCH' };
    }

    if (!hasFeature(authority.project.planLevel, 'OPTIMIZATION_EXPERIMENTS')) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_FEATURE_NOT_AVAILABLE' };
    }
    if (authority.execution.status !== 'VERIFIED') {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_EXECUTION_NOT_VERIFIED' };
    }
    if (
      authority.verification === null
      || authority.verification.status !== 'VERIFIED'
      || authority.verification.observedAt === null
      || authority.verification.observedUrl === null
    ) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_VERIFICATION_NOT_VERIFIED' };
    }
    if (
      authority.proposal.sourceType !== 'P9_OPTIMIZATION_PLAN'
      || authority.proposal.sourceReferenceId === null
    ) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_P9_SOURCE_MISMATCH' };
    }

    let targetUrl: string;
    let observedUrl: string;
    try {
      targetUrl = normalizeExperimentHttpUrl(authority.publicationPlan.targetPublicUrl);
      observedUrl = normalizeExperimentHttpUrl(authority.verification.observedUrl);
    } catch {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_VERIFICATION_URL_MISMATCH' };
    }
    if (targetUrl !== observedUrl) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_VERIFICATION_URL_MISMATCH' };
    }

    const context = await this.repository.loadVerifiedStartContext(input);
    if (
      context === null
      || context.proposal.sourceType !== 'P9_OPTIMIZATION_PLAN'
      || context.proposal.sourceReferenceId !== context.optimizationPlan.id
    ) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_P9_SOURCE_MISMATCH' };
    }

    const schedule = scheduleForIntervention(context.optimizationPlan.recommendedActionType);
    if (schedule === null) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_INTERVENTION_NOT_SUPPORTED' };
    }

    const measurementScope = await resolveExperimentMeasurementScope({
      projectId: input.projectId,
      interventionType: context.optimizationPlan.recommendedActionType,
      targetUrl,
      candidate: context.optimizationPlan.candidate,
      visibilitySource: this.visibilitySource
    });
    if (measurementScope === null) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED' };
    }

    const expectedDirections = expectedDirectionsFor(
      context.optimizationPlan.recommendedActionType,
      measurementScope
    );
    if (expectedDirections === null) {
      return { kind: 'DEFERRED', reasonCode: 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED' };
    }

    const experimentKey = buildExperimentKey({
      projectId: input.projectId,
      optimizationPlanId: context.optimizationPlan.id,
      publicationExecutionId: context.execution.id,
      publicationVerificationId: context.verification.id,
      interventionType: context.optimizationPlan.recommendedActionType,
      targetUrl,
      marketCode: context.optimizationPlan.candidate.marketCode,
      locale: context.optimizationPlan.candidate.locale,
      verifiedAnchorAt: context.verification.observedAt,
      measurementScope,
      observationSchedule: schedule,
      expectedDirections
    });

    const existing = await this.repository.findExperimentForStart({
      optimizationPlanId: context.optimizationPlan.id,
      publicationExecutionId: context.execution.id,
      experimentVersion: OPTIMIZATION_EXPERIMENT_VERSION
    });

    const experiment = await this.repository.createOrGetExperiment({
      projectId: input.projectId,
      optimizationPlanId: context.optimizationPlan.id,
      publicationExecutionId: context.execution.id,
      publicationVerificationId: context.verification.id,
      experimentVersion: OPTIMIZATION_EXPERIMENT_VERSION,
      experimentKey,
      interventionType: context.optimizationPlan.recommendedActionType,
      targetUrl,
      marketCode: context.optimizationPlan.candidate.marketCode,
      locale: context.optimizationPlan.candidate.locale,
      verifiedAnchorAt: context.verification.observedAt,
      measurementScopeJson: asInputJson(measurementScope),
      observationScheduleJson: asInputJson(schedule),
      expectedDirectionJson: asInputJson(expectedDirections)
    });

    return existing === null
      ? { kind: 'STARTED', experiment }
      : { kind: 'EXISTING', experiment };
  }
}
