import { Prisma, type OptimizationExperimentObservation } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { prisma } from '../../db/prisma.js';
import { SearchFactRepository } from '../search-facts/search-fact.repository.js';
import {
  detectExperimentContamination,
  type ExperimentContaminationReadPort
} from './experiment.contamination.js';
import {
  PrismaExperimentEvaluationSource,
  type ExperimentEvaluationReadPort
} from './experiment.evaluation-source.js';
import { evaluateExperimentEffect } from './experiment.evaluator.js';
import {
  buildExperimentKey,
  buildObservationKey,
  canonicalJson
} from './experiment.identity.js';
import {
  experimentObservability,
  type ExperimentObservabilityEvent
} from './experiment.observability.js';
import {
  OptimizationExperimentRepository,
  type CreateExperimentObservationInput,
  type CreateOrGetExperimentObservationResult,
  type ExperimentStartReasonCode,
  type ExperimentStartResult
} from './experiment.repository.js';
import { scheduleForIntervention } from './experiment.schedule.js';
import { resolveSearchWindowComparison } from './experiment.search-source.js';
import {
  normalizeExperimentHttpUrl,
  resolveExperimentMeasurementScope,
  type VisibilityExperimentScopeSourcePort
} from './experiment.scope.js';
import {
  OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION,
  OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION,
  OPTIMIZATION_EXPERIMENT_VERSION,
  type ExperimentMeasurementScope,
  type ExperimentMetricComparison,
  type ExperimentMetricDirection,
  type ExperimentWindowResolution,
  type ExperimentWindowType
} from './experiment.types.js';
import {
  resolveVisibilityWindowComparison,
  type VisibilityExperimentSourcePort
} from './experiment.visibility-source.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type ExperimentObservabilityPort = {
  emit(event: ExperimentObservabilityEvent): void;
};

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasMethod(value: unknown, key: string): boolean {
  return Boolean(
    value
    && typeof value === 'object'
    && key in value
    && typeof (value as Record<string, unknown>)[key] === 'function'
  );
}

function parseMeasurementScope(value: unknown): ExperimentMeasurementScope | null {
  const record = objectRecord(value);
  if (!record || (record.kind !== 'SEARCH' && record.kind !== 'VISIBILITY')) return null;

  if (record.kind === 'SEARCH') {
    const requiredStrings = [
      record.provider,
      record.marketCode,
      record.locale,
      record.propertyRef,
      record.normalizedQuery
    ];
    if (
      requiredStrings.some((item) => typeof item !== 'string' || item.trim().length === 0)
      || (record.canonicalPage !== null && typeof record.canonicalPage !== 'string')
      || (record.aggregationScope !== 'QUERY' && record.aggregationScope !== 'QUERY_PAGE')
    ) {
      return null;
    }
    if (record.aggregationScope === 'QUERY_PAGE' && (
      typeof record.canonicalPage !== 'string'
      || record.canonicalPage.trim().length === 0
    )) {
      return null;
    }
    return record as unknown as ExperimentMeasurementScope;
  }

  const requiredStrings = [
    record.metricType,
    record.dimensionType,
    record.dimensionKey,
    record.actorType,
    record.actorKey,
    record.formulaVersion,
    record.extractorVersion,
    record.subjectSetHash,
    record.scopeHash
  ];
  if (requiredStrings.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    return null;
  }
  return record as unknown as ExperimentMeasurementScope;
}

function windowFromSchedule(
  value: unknown,
  windowType: ExperimentWindowType
): { windowType: ExperimentWindowType; windowDays: 7 | 14 | 28 | 56 } | null {
  if (!Array.isArray(value)) return null;
  const expectedDays: Record<ExperimentWindowType, 7 | 14 | 28 | 56> = {
    '7D': 7,
    '14D': 14,
    '28D': 28,
    '56D': 56
  };

  const matches = value.filter((item) => {
    const record = objectRecord(item);
    return record?.windowType === windowType && record.windowDays === expectedDays[windowType];
  });
  if (matches.length !== 1) return null;
  return { windowType, windowDays: expectedDays[windowType] };
}

function expectedDirection(value: unknown): {
  metricKey: string;
  direction: ExperimentMetricDirection;
} | null {
  const record = objectRecord(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (entries.length !== 1) return null;
  const [metricKey, direction] = entries[0];
  if (
    metricKey.trim().length === 0
    || (direction !== 'HIGHER' && direction !== 'LOWER')
  ) {
    return null;
  }
  return { metricKey, direction };
}

function withFrozenPrimary(
  resolution: ExperimentWindowResolution,
  primary: { metricKey: string; direction: ExperimentMetricDirection }
): ExperimentWindowResolution {
  return {
    ...resolution,
    comparisons: resolution.comparisons.map((comparison) => ({
      ...comparison,
      role: comparison.metricKey === primary.metricKey ? 'PRIMARY' : 'SECONDARY',
      direction: comparison.metricKey === primary.metricKey
        ? primary.direction
        : comparison.direction
    }))
  };
}

function metricsJson(
  comparisons: readonly ExperimentMetricComparison[],
  side: 'baseline' | 'observed'
): readonly Record<string, unknown>[] {
  return comparisons.map((comparison) => ({
    family: comparison.family,
    metricKey: comparison.metricKey,
    role: comparison.role,
    direction: comparison.direction,
    value: side === 'baseline' ? comparison.baselineValue : comparison.observedValue,
    ...(side === 'baseline'
      ? {
        zeroIsExplicit: comparison.baselineZeroIsExplicit,
        ...(comparison.baselineNumerator !== undefined
          ? { numerator: comparison.baselineNumerator }
          : {}),
        ...(comparison.baselineDenominator !== undefined
          ? { denominator: comparison.baselineDenominator }
          : {})
      }
      : {
        ...(comparison.observedNumerator !== undefined
          ? { numerator: comparison.observedNumerator }
          : {}),
        ...(comparison.observedDenominator !== undefined
          ? { denominator: comparison.observedDenominator }
          : {})
      })
  }));
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
  private readonly evaluationSource: ExperimentEvaluationReadPort;
  private readonly contaminationSource: ExperimentContaminationReadPort;
  private readonly visibilityMetricSource: VisibilityExperimentSourcePort;
  private searchSource: Pick<SearchFactRepository, 'listCompletedFacts'>;
  private now: () => Date;
  private observability: ExperimentObservabilityPort;

  constructor(
    private readonly repository = new OptimizationExperimentRepository(),
    private readonly visibilitySource?: VisibilityExperimentScopeSourcePort,
    observability: ExperimentObservabilityPort = experimentObservability
  ) {
    const defaultEvaluationSource = new PrismaExperimentEvaluationSource();
    this.evaluationSource = hasMethod(repository, 'findExperimentForEvaluation')
      ? repository as unknown as ExperimentEvaluationReadPort
      : defaultEvaluationSource;
    this.contaminationSource = hasMethod(repository, 'listPublicationEvents')
      ? repository as unknown as ExperimentContaminationReadPort
      : defaultEvaluationSource;
    this.visibilityMetricSource = hasMethod(repository, 'listCompatibleSnapshots')
      ? repository as unknown as VisibilityExperimentSourcePort
      : defaultEvaluationSource;
    this.searchSource = new SearchFactRepository(prisma);
    this.now = () => new Date();
    this.observability = observability;
  }

  private deferredStart(
    input: { projectId: string; publicationExecutionId: string },
    reasonCode: ExperimentStartReasonCode
  ): ExperimentStartResult {
    this.observability.emit({
      event: 'optimization.experiment.deferred',
      projectId: input.projectId,
      publicationExecutionId: input.publicationExecutionId,
      reasonCode
    });
    return { kind: 'DEFERRED', reasonCode };
  }

  private async persistObservation(
    input: CreateExperimentObservationInput
  ): Promise<CreateOrGetExperimentObservationResult> {
    if (hasMethod(this.repository, 'createOrGetObservationWithOutcome')) {
      return (this.repository as unknown as {
        createOrGetObservationWithOutcome(
          value: CreateExperimentObservationInput
        ): Promise<CreateOrGetExperimentObservationResult>;
      }).createOrGetObservationWithOutcome(input);
    }

    return {
      kind: 'EXISTING',
      observation: await this.repository.createOrGetObservation(input)
    };
  }

  async startFromVerifiedExecution(input: {
    projectId: string;
    publicationExecutionId: string;
  }): Promise<ExperimentStartResult> {
    const authority = await this.repository.inspectStartAuthority(input);
    if (!authority) {
      return this.deferredStart(input, 'EXPERIMENT_P9_SOURCE_MISMATCH');
    }

    if (!hasFeature(authority.project.planLevel, 'OPTIMIZATION_EXPERIMENTS')) {
      return this.deferredStart(input, 'EXPERIMENT_FEATURE_NOT_AVAILABLE');
    }
    if (authority.execution.status !== 'VERIFIED') {
      return this.deferredStart(input, 'EXPERIMENT_EXECUTION_NOT_VERIFIED');
    }
    if (
      authority.verification === null
      || authority.verification.status !== 'VERIFIED'
      || authority.verification.observedAt === null
      || authority.verification.observedUrl === null
    ) {
      return this.deferredStart(input, 'EXPERIMENT_VERIFICATION_NOT_VERIFIED');
    }
    if (
      authority.proposal.sourceType !== 'P9_OPTIMIZATION_PLAN'
      || authority.proposal.sourceReferenceId === null
    ) {
      return this.deferredStart(input, 'EXPERIMENT_P9_SOURCE_MISMATCH');
    }

    let targetUrl: string;
    let observedUrl: string;
    try {
      targetUrl = normalizeExperimentHttpUrl(authority.publicationPlan.targetPublicUrl);
      observedUrl = normalizeExperimentHttpUrl(authority.verification.observedUrl);
    } catch {
      return this.deferredStart(input, 'EXPERIMENT_VERIFICATION_URL_MISMATCH');
    }
    if (targetUrl !== observedUrl) {
      return this.deferredStart(input, 'EXPERIMENT_VERIFICATION_URL_MISMATCH');
    }

    const context = await this.repository.loadVerifiedStartContext(input);
    if (
      context === null
      || context.proposal.sourceType !== 'P9_OPTIMIZATION_PLAN'
      || context.proposal.sourceReferenceId !== context.optimizationPlan.id
    ) {
      return this.deferredStart(input, 'EXPERIMENT_P9_SOURCE_MISMATCH');
    }

    const schedule = scheduleForIntervention(context.optimizationPlan.recommendedActionType);
    if (schedule === null) {
      return this.deferredStart(input, 'EXPERIMENT_INTERVENTION_NOT_SUPPORTED');
    }

    const measurementScope = await resolveExperimentMeasurementScope({
      projectId: input.projectId,
      interventionType: context.optimizationPlan.recommendedActionType,
      targetUrl,
      candidate: context.optimizationPlan.candidate,
      visibilitySource: this.visibilitySource ?? this.repository
    });
    if (measurementScope === null) {
      return this.deferredStart(input, 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED');
    }

    const expectedDirections = expectedDirectionsFor(
      context.optimizationPlan.recommendedActionType,
      measurementScope
    );
    if (expectedDirections === null) {
      return this.deferredStart(input, 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED');
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

    if (existing === null) {
      this.observability.emit({
        event: 'optimization.experiment.started',
        projectId: input.projectId,
        optimizationPlanId: context.optimizationPlan.id,
        publicationExecutionId: context.execution.id,
        experimentId: experiment.id,
        ...(context.optimizationPlan.candidate.marketCode
          ? { marketCode: context.optimizationPlan.candidate.marketCode }
          : {}),
        ...(measurementScope.kind === 'SEARCH'
          ? { provider: measurementScope.provider }
          : {})
      });
      return { kind: 'STARTED', experiment };
    }

    return { kind: 'EXISTING', experiment };
  }

  async evaluateWindow(input: {
    projectId: string;
    experimentId: string;
    windowType: ExperimentWindowType;
  }): Promise<OptimizationExperimentObservation | null> {
    if (input.projectId.trim().length === 0 || input.experimentId.trim().length === 0) {
      return null;
    }

    const experiment = await this.evaluationSource.findExperimentForEvaluation({
      projectId: input.projectId,
      experimentId: input.experimentId
    });
    if (!experiment || experiment.projectId !== input.projectId) return null;

    const scope = parseMeasurementScope(experiment.measurementScopeJson);
    const window = windowFromSchedule(experiment.observationScheduleJson, input.windowType);
    const primary = expectedDirection(experiment.expectedDirectionJson);
    if (!scope || !window || !primary) return null;

    const dueAt = new Date(
      experiment.verifiedAnchorAt.getTime() + window.windowDays * DAY_MS
    );
    if (!Number.isFinite(dueAt.getTime()) || this.now().getTime() < dueAt.getTime()) {
      return null;
    }

    const rawResolution = scope.kind === 'SEARCH'
      ? await resolveSearchWindowComparison({
        projectId: input.projectId,
        scope,
        verifiedAnchorAt: experiment.verifiedAnchorAt,
        windowType: window.windowType,
        windowDays: window.windowDays,
        source: this.searchSource
      })
      : await resolveVisibilityWindowComparison({
        projectId: input.projectId,
        scope,
        verifiedAnchorAt: experiment.verifiedAnchorAt,
        dueAt,
        windowType: window.windowType,
        source: this.visibilityMetricSource
      });
    const resolution = withFrozenPrimary(rawResolution, primary);

    const contamination = await detectExperimentContamination({
      experimentId: experiment.id,
      projectId: input.projectId,
      publicationExecutionId: experiment.publicationExecutionId,
      targetUrl: experiment.targetUrl,
      verifiedAnchorAt: experiment.verifiedAnchorAt,
      observedWindowEnd: dueAt,
      repository: this.contaminationSource
    });

    const evaluation = evaluateExperimentEffect({
      resolution,
      contaminationState: contamination.state,
      contaminationReasonCodes: contamination.reasonCodes
    });
    const observationKey = buildObservationKey({
      experimentId: experiment.id,
      windowType: window.windowType,
      windowDays: window.windowDays,
      dueAt,
      inputCutoffAt: resolution.inputCutoffAt,
      baselineSearchSourceRefs: resolution.baselineSearchSourceRefs,
      observedSearchSourceRefs: resolution.observedSearchSourceRefs,
      baselineVisibilitySourceRefs: resolution.baselineVisibilitySourceRefs,
      observedVisibilitySourceRefs: resolution.observedVisibilitySourceRefs,
      evaluatorVersion: OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION
    });

    const persistence = await this.persistObservation({
      projectId: input.projectId,
      experimentId: experiment.id,
      observationVersion: OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION,
      observationKey,
      windowType: window.windowType,
      windowDays: window.windowDays,
      dueAt,
      inputCutoffAt: resolution.inputCutoffAt,
      baselineSearchSourceRefs: asInputJson(resolution.baselineSearchSourceRefs),
      observedSearchSourceRefs: asInputJson(resolution.observedSearchSourceRefs),
      baselineVisibilitySourceRefs: asInputJson(resolution.baselineVisibilitySourceRefs),
      observedVisibilitySourceRefs: asInputJson(resolution.observedVisibilitySourceRefs),
      baselineMetricsJson: asInputJson(metricsJson(resolution.comparisons, 'baseline')),
      observedMetricsJson: asInputJson(metricsJson(resolution.comparisons, 'observed')),
      deltaMetricsJson: asInputJson(evaluation.deltaMetrics.map((delta, index) => ({
        family: resolution.comparisons[index]?.family ?? 'UNKNOWN',
        ...delta
      }))),
      coverageState: evaluation.coverageState,
      contaminationState: evaluation.contaminationState,
      effectState: evaluation.effectState,
      reasonCodes: asInputJson(evaluation.reasonCodes),
      evaluatorVersion: OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION
    });
    const observation = persistence.observation;

    if (persistence.kind === 'CREATED') {
      this.observability.emit({
        event: 'optimization.experiment.observation.created',
        projectId: input.projectId,
        experimentId: experiment.id,
        observationId: observation.id,
        windowType: window.windowType
      });
    }

    const terminalReasonCode = evaluation.reasonCodes.at(-1);
    this.observability.emit({
      event: evaluation.effectState === 'INCONCLUSIVE'
        ? 'optimization.experiment.inconclusive'
        : 'optimization.experiment.evaluated',
      projectId: input.projectId,
      experimentId: experiment.id,
      observationId: observation.id,
      windowType: window.windowType,
      effectState: evaluation.effectState,
      coverageState: evaluation.coverageState,
      contaminationState: evaluation.contaminationState,
      ...(evaluation.effectState === 'INCONCLUSIVE' && terminalReasonCode
        ? { reasonCode: terminalReasonCode }
        : {}),
      ...(scope.kind === 'SEARCH'
        ? {
          marketCode: scope.marketCode,
          provider: scope.provider
        }
        : {})
    });

    return observation;
  }
}
