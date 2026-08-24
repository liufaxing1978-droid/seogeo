import { createHash } from 'node:crypto';
import type { ExperimentWindow } from './experiment.schedule.js';
import {
  OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION,
  OPTIMIZATION_EXPERIMENT_VERSION,
  type ExperimentMeasurementScope,
  type ExperimentMetricDirection,
  type ExperimentWindowType
} from './experiment.types.js';

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('P9-D identity date is invalid');
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new Error('P9-D identity payload is invalid');
  return serialized;
}

function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function normalizeSourceRefs(refs: readonly string[]): string[] {
  const normalized = refs.map((ref) => ref.trim());
  if (normalized.some((ref) => ref.length === 0)) {
    throw new Error('P9-D observation source ref must not be empty');
  }
  return [...new Set(normalized)].sort((left, right) => left.localeCompare(right));
}

export function buildExperimentKey(input: {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  interventionType: string;
  targetUrl: string;
  marketCode: string | null;
  locale: string | null;
  verifiedAnchorAt: Date;
  measurementScope: ExperimentMeasurementScope;
  observationSchedule: readonly ExperimentWindow[];
  expectedDirections: Record<string, ExperimentMetricDirection>;
}): string {
  return hashCanonicalJson({
    experimentVersion: OPTIMIZATION_EXPERIMENT_VERSION,
    projectId: input.projectId,
    optimizationPlanId: input.optimizationPlanId,
    publicationExecutionId: input.publicationExecutionId,
    publicationVerificationId: input.publicationVerificationId,
    interventionType: input.interventionType,
    targetUrl: input.targetUrl,
    marketCode: input.marketCode,
    locale: input.locale,
    verifiedAnchorAt: input.verifiedAnchorAt,
    measurementScope: input.measurementScope,
    observationSchedule: input.observationSchedule,
    expectedDirections: input.expectedDirections
  });
}

export function buildObservationKey(input: {
  experimentId: string;
  windowType: ExperimentWindowType;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: readonly string[];
  observedSearchSourceRefs: readonly string[];
  baselineVisibilitySourceRefs: readonly string[];
  observedVisibilitySourceRefs: readonly string[];
  evaluatorVersion: string;
}): string {
  return hashCanonicalJson({
    observationVersion: OPTIMIZATION_EXPERIMENT_OBSERVATION_VERSION,
    experimentId: input.experimentId,
    windowType: input.windowType,
    windowDays: input.windowDays,
    dueAt: input.dueAt,
    inputCutoffAt: input.inputCutoffAt,
    baselineSearchSourceRefs: normalizeSourceRefs(input.baselineSearchSourceRefs),
    observedSearchSourceRefs: normalizeSourceRefs(input.observedSearchSourceRefs),
    baselineVisibilitySourceRefs: normalizeSourceRefs(input.baselineVisibilitySourceRefs),
    observedVisibilitySourceRefs: normalizeSourceRefs(input.observedVisibilitySourceRefs),
    evaluatorVersion: input.evaluatorVersion
  });
}
