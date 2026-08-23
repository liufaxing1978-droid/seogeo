import { createHash } from 'node:crypto';
import {
  OPTIMIZATION_RUN_ITEM_VERSION,
  OPTIMIZATION_RUN_VERSION,
  type GrowthTriggerInput
} from './orchestration.types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function hashIdentity(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function buildGrowthTriggerKey(input: GrowthTriggerInput): string {
  return hashIdentity({
    runVersion: OPTIMIZATION_RUN_VERSION,
    projectId: input.projectId,
    triggerType: 'EVENT',
    triggerSource: 'GROWTH_MATERIALIZATION',
    asOfDate: input.asOfDate,
    materializationVersion: input.materializationVersion,
    formulaVersion: input.formulaVersion,
    state: input.state,
    selectedGscSnapshotIds: [...new Set(input.selectedGscSnapshotIds)].sort()
  });
}

export function buildDailyTriggerKey(input: {
  projectId: string;
  utcDate: string;
  plannerVersion: string;
}): string {
  return hashIdentity({
    runVersion: OPTIMIZATION_RUN_VERSION,
    projectId: input.projectId,
    triggerType: 'DAILY_RECONCILIATION',
    triggerSource: 'DAILY_SCHEDULER',
    utcDate: input.utcDate,
    plannerVersion: input.plannerVersion
  });
}

export function buildManualTriggerKey(input: {
  projectId: string;
  manualRequestId: string;
}): string {
  return hashIdentity({
    runVersion: OPTIMIZATION_RUN_VERSION,
    projectId: input.projectId,
    triggerType: 'MANUAL',
    triggerSource: 'MANUAL_REQUEST',
    manualRequestId: input.manualRequestId
  });
}

export function buildRunItemKey(input: {
  runId: string;
  optimizationPlanId: string;
}): string {
  return hashIdentity({
    itemVersion: OPTIMIZATION_RUN_ITEM_VERSION,
    runId: input.runId,
    optimizationPlanId: input.optimizationPlanId
  });
}
