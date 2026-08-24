import { createHash } from 'node:crypto';
import { OPTIMIZATION_AUTOPILOT_DECISION_VERSION } from './autopilot.types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

export function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new Error('AUTOPILOT_CANONICAL_JSON_INVALID');
  return serialized;
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function buildOptimizationAutopilotDecisionKey(input: {
  projectId: string;
  runItemId: string;
  optimizationPlanId: string;
  policyVersion: string;
  policySnapshot: unknown;
  sourceSnapshot: unknown;
  p8PlanId: string | null;
  p8PreviewId: string | null;
}): string {
  return hashCanonicalJson({
    decisionVersion: OPTIMIZATION_AUTOPILOT_DECISION_VERSION,
    projectId: input.projectId,
    runItemId: input.runItemId,
    optimizationPlanId: input.optimizationPlanId,
    policyVersion: input.policyVersion,
    policySnapshotHash: hashCanonicalJson(input.policySnapshot),
    sourceSnapshotHash: hashCanonicalJson(input.sourceSnapshot),
    p8PlanId: input.p8PlanId,
    p8PreviewId: input.p8PreviewId
  });
}
