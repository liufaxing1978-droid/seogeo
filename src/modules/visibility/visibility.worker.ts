import { createHash } from 'node:crypto';
import type {
  PlatformObservationStatus,
  Prisma,
  VisibilityGroundingMode,
  VisibilityRunStatus
} from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '../../db/prisma.js';
import { VisibilityBudgetService, visibilityBudgetService } from './visibility-budget.js';
import { emitVisibilityEvent } from './visibility-observability.js';
import { defaultVisibilityProviderRegistry } from './providers/default-registry.js';
import {
  VisibilityProviderError,
  type VisibilitySampleRequest
} from './providers/provider.js';
import { VisibilityProviderRegistry } from './providers/provider-registry.js';
import { VisibilityRepository, visibilityRepository } from './visibility.repository.js';

export interface VisibilityJobData { observationId: string; }
export interface ExecuteVisibilityDependencies { registry?: VisibilityProviderRegistry; repository?: VisibilityRepository; budgetService?: VisibilityBudgetService; }

const MAX_PERSISTED_ANSWER_CHARS = 100_000;
const TERMINAL_STATUSES = new Set<PlatformObservationStatus>(['COMPLETED', 'REFUSED', 'UNSUPPORTED', 'FAILED', 'INCOMPLETE', 'BUDGET_SKIPPED']);
const SENSITIVE_METADATA_KEY = /(reasoning|thought|thinking|chain|search.*plan)/i;

function boundedAnswer(value: string | null): string | null { return value === null ? null : value.slice(0, MAX_PERSISTED_ANSWER_CHARS); }
function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !SENSITIVE_METADATA_KEY.test(key)).map(([key, child]) => [key, sanitizeMetadata(child)]));
}
function asRecord(value: Prisma.JsonValue): Record<string, unknown> | null { return !value || typeof value !== 'object' || Array.isArray(value) ? null : value as Record<string, unknown>; }

function providerOptionsForObservation(requestedProviderConfigs: Prisma.JsonValue, observation: { provider: string; model: string; channel: string; groundingMode: string; }): Record<string, unknown> {
  if (!Array.isArray(requestedProviderConfigs)) return {};
  for (const entry of requestedProviderConfigs) {
    const record = asRecord(entry);
    if (!record) continue;
    if (record.provider === observation.provider && record.model === observation.model && record.channel === observation.channel && record.groundingMode === observation.groundingMode) {
      const options = record.providerOptionsJson;
      return options && typeof options === 'object' && !Array.isArray(options) ? options as Record<string, unknown> : {};
    }
  }
  return {};
}

async function markRunStarted(runId: string, projectId: string) {
  const transition = await prisma.visibilityRun.updateMany({ where: { id: runId, status: 'QUEUED' }, data: { status: 'RUNNING', startedAt: new Date() } });
  if (transition.count === 1) emitVisibilityEvent('visibility.run.started', { projectId, runId, status: 'RUNNING' });
}
function runTerminalEvent(status: VisibilityRunStatus) { return status === 'COMPLETED' ? 'visibility.run.completed' as const : status === 'PARTIAL' ? 'visibility.run.partial' as const : 'visibility.run.failed' as const; }

async function finalizeVisibilityRun(runId: string, projectId: string) {
  const observations = await prisma.platformObservation.findMany({ where: { visibilityRunId: runId }, select: { status: true } });
  if (!observations.length) return;
  if (observations.some((item) => !TERMINAL_STATUSES.has(item.status))) { await markRunStarted(runId, projectId); return; }
  const completedCount = observations.filter((item) => item.status === 'COMPLETED').length;
  const status: VisibilityRunStatus = completedCount === observations.length ? 'COMPLETED' : completedCount > 0 ? 'PARTIAL' : 'FAILED';
  const transition = await prisma.visibilityRun.updateMany({ where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status, finishedAt: new Date() } });
  if (transition.count === 1) emitVisibilityEvent(runTerminalEvent(status), { projectId, runId, status });
}
function failureCode(error: unknown): string { return error instanceof VisibilityProviderError ? error.code : 'VISIBILITY_PROVIDER_FAILED'; }
function observationFields(loaded: { id: string; projectId: string; visibilityRunId: string; visibilityPromptId: string; promptVersion: number; provider: string; model: string; channel: string; }) {
  return { projectId: loaded.projectId, runId: loaded.visibilityRunId, observationId: loaded.id, provider: loaded.provider, model: loaded.model, channel: loaded.channel, promptId: loaded.visibilityPromptId, promptVersion: loaded.promptVersion };
}

export async function executeVisibilityObservation(observationId: string, dependencies: ExecuteVisibilityDependencies = {}): Promise<void> {
  const repository = dependencies.repository ?? visibilityRepository;
  const budgetService = dependencies.budgetService ?? visibilityBudgetService;
  const registry = dependencies.registry ?? defaultVisibilityProviderRegistry;
  const loaded = await prisma.platformObservation.findUnique({ where: { id: observationId }, include: { run: true, prompt: true } });
  if (!loaded) throw new Error(`Visibility observation not found: ${observationId}`);
  const claimed = await repository.claimPendingObservation(observationId);
  if (!claimed) return;

  await markRunStarted(loaded.visibilityRunId, loaded.projectId);
  emitVisibilityEvent('visibility.observation.started', { ...observationFields(loaded), status: 'RUNNING' });

  try {
    const adapter = registry.get(loaded.provider, loaded.model, loaded.channel);
    if (!adapter.supportsWebGrounding(loaded.groundingMode)) {
      await prisma.platformObservation.update({ where: { id: loaded.id }, data: { status: 'UNSUPPORTED', citationEvidenceState: 'NOT_APPLICABLE', errorCode: 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED', observedAt: new Date() } });
      emitVisibilityEvent('visibility.observation.unsupported', { ...observationFields(loaded), status: 'UNSUPPORTED', errorCode: 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED' });
      await finalizeVisibilityRun(loaded.visibilityRunId, loaded.projectId);
      return;
    }

    const request: VisibilitySampleRequest = { prompt: loaded.prompt.promptText, model: loaded.model, locale: loaded.locale, country: loaded.country, groundingMode: loaded.groundingMode as VisibilityGroundingMode, providerOptions: providerOptionsForObservation(loaded.run.requestedProviderConfigs, loaded) };
    const budgetDecision = await budgetService.preflightObservation(loaded.id, adapter.estimateCostMicros(request));
    if (!budgetDecision.allowed) { await budgetService.markBudgetSkipped(loaded.id, budgetDecision.reason); await finalizeVisibilityRun(loaded.visibilityRunId, loaded.projectId); return; }

    const response = await adapter.sample(request);
    const answerText = boundedAnswer(response.answerText);
    const answerHash = answerText === null ? null : createHash('sha256').update(answerText).digest('hex');
    const searchMetadata = sanitizeMetadata(response.searchMetadata) as Prisma.InputJsonValue;
    const citations = response.citations as unknown as Prisma.InputJsonValue;

    await prisma.platformObservation.update({
      where: { id: loaded.id },
      data: {
        status: response.status,
        providerResponseId: response.providerResponseId,
        answerText,
        answerHash,
        citationsJson: citations,
        searchMetadataJson: searchMetadata,
        citationEvidenceState: response.citationEvidenceState,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.totalTokens,
        searchUnits: response.searchUnits,
        costMicros: response.costMicros,
        costCurrency: response.costCurrency,
        pricingVersion: response.pricingVersion,
        latencyMs: response.latencyMs,
        errorCode: response.status === 'UNSUPPORTED' ? 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED' : null,
        observedAt: new Date()
      }
    });

    if (response.status === 'COMPLETED') emitVisibilityEvent('visibility.observation.completed', { ...observationFields(loaded), status: response.status, latencyMs: response.latencyMs, promptTokens: response.promptTokens, completionTokens: response.completionTokens, totalTokens: response.totalTokens, searchUnits: response.searchUnits, costMicros: response.costMicros });
    else if (response.status === 'UNSUPPORTED') emitVisibilityEvent('visibility.observation.unsupported', { ...observationFields(loaded), status: response.status, errorCode: 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED' });
    else emitVisibilityEvent('visibility.observation.failed', { ...observationFields(loaded), status: response.status });
    await finalizeVisibilityRun(loaded.visibilityRunId, loaded.projectId);
  } catch (error) {
    const errorCode = failureCode(error);
    await prisma.platformObservation.update({ where: { id: loaded.id }, data: { status: 'FAILED', citationEvidenceState: 'UNKNOWN', errorCode, answerText: null, answerHash: null, observedAt: new Date() } });
    emitVisibilityEvent('visibility.observation.failed', { ...observationFields(loaded), status: 'FAILED', errorCode });
    await finalizeVisibilityRun(loaded.visibilityRunId, loaded.projectId);
    throw error;
  }
}

export async function processVisibilityJob(job: Job<VisibilityJobData>) {
  const observationId = job.data?.observationId;
  if (!observationId) throw new Error('observationId is required for visibility jobs');
  await executeVisibilityObservation(observationId);
}
