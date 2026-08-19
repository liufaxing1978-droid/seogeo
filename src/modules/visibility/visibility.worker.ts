import { createHash } from 'node:crypto';
import type {
  PlatformObservationStatus,
  Prisma,
  VisibilityGroundingMode
} from '@prisma/client';
import type { Job } from 'bullmq';
import { prisma } from '../../db/prisma.js';
import { VisibilityBudgetService, visibilityBudgetService } from './visibility-budget.js';
import {
  VisibilityProviderError,
  type VisibilitySampleRequest
} from './providers/provider.js';
import { VisibilityProviderRegistry } from './providers/provider-registry.js';
import { VisibilityRepository, visibilityRepository } from './visibility.repository.js';

export interface VisibilityJobData {
  observationId: string;
}

export interface ExecuteVisibilityDependencies {
  registry?: VisibilityProviderRegistry;
  repository?: VisibilityRepository;
  budgetService?: VisibilityBudgetService;
}

const DEFAULT_VISIBILITY_REGISTRY = new VisibilityProviderRegistry([]);
const MAX_PERSISTED_ANSWER_CHARS = 100_000;
const TERMINAL_STATUSES = new Set<PlatformObservationStatus>([
  'COMPLETED',
  'REFUSED',
  'UNSUPPORTED',
  'FAILED',
  'INCOMPLETE',
  'BUDGET_SKIPPED'
]);
const SENSITIVE_METADATA_KEY = /(reasoning|thought|thinking|chain|search.*plan)/i;

function boundedAnswer(value: string | null): string | null {
  if (value === null) return null;
  return value.slice(0, MAX_PERSISTED_ANSWER_CHARS);
}

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
      .map(([key, child]) => [key, sanitizeMetadata(child)])
  );
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function providerOptionsForObservation(
  requestedProviderConfigs: Prisma.JsonValue,
  observation: {
    provider: string;
    model: string;
    channel: string;
    groundingMode: string;
  }
): Record<string, unknown> {
  if (!Array.isArray(requestedProviderConfigs)) return {};
  for (const entry of requestedProviderConfigs) {
    const record = asRecord(entry);
    if (!record) continue;
    if (
      record.provider === observation.provider &&
      record.model === observation.model &&
      record.channel === observation.channel &&
      record.groundingMode === observation.groundingMode
    ) {
      const options = record.providerOptionsJson;
      if (options && typeof options === 'object' && !Array.isArray(options)) {
        return options as Record<string, unknown>;
      }
      return {};
    }
  }
  return {};
}

async function markRunStarted(runId: string) {
  await prisma.visibilityRun.updateMany({
    where: { id: runId, status: 'QUEUED' },
    data: { status: 'RUNNING', startedAt: new Date() }
  });
}

async function finalizeVisibilityRun(runId: string) {
  const observations = await prisma.platformObservation.findMany({
    where: { visibilityRunId: runId },
    select: { status: true }
  });
  if (!observations.length) return;
  if (observations.some((item) => !TERMINAL_STATUSES.has(item.status))) {
    await prisma.visibilityRun.updateMany({
      where: { id: runId, status: 'QUEUED' },
      data: { status: 'RUNNING', startedAt: new Date() }
    });
    return;
  }

  const completedCount = observations.filter((item) => item.status === 'COMPLETED').length;
  const status = completedCount === observations.length
    ? 'COMPLETED'
    : completedCount > 0
      ? 'PARTIAL'
      : 'FAILED';

  await prisma.visibilityRun.update({
    where: { id: runId },
    data: { status, finishedAt: new Date() }
  });
}

function failureCode(error: unknown): string {
  return error instanceof VisibilityProviderError
    ? error.code
    : 'VISIBILITY_PROVIDER_FAILED';
}

export async function executeVisibilityObservation(
  observationId: string,
  dependencies: ExecuteVisibilityDependencies = {}
): Promise<void> {
  const repository = dependencies.repository ?? visibilityRepository;
  const budgetService = dependencies.budgetService ?? visibilityBudgetService;
  const registry = dependencies.registry ?? DEFAULT_VISIBILITY_REGISTRY;

  const loaded = await prisma.platformObservation.findUnique({
    where: { id: observationId },
    include: {
      run: true,
      prompt: true
    }
  });
  if (!loaded) throw new Error(`Visibility observation not found: ${observationId}`);

  const claimed = await repository.claimPendingObservation(observationId);
  if (!claimed) return;
  await markRunStarted(loaded.visibilityRunId);

  try {
    const adapter = registry.get(loaded.provider, loaded.model, loaded.channel);
    if (!adapter.supportsWebGrounding(loaded.groundingMode)) {
      await prisma.platformObservation.update({
        where: { id: loaded.id },
        data: {
          status: 'UNSUPPORTED',
          errorCode: 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED',
          observedAt: new Date()
        }
      });
      await finalizeVisibilityRun(loaded.visibilityRunId);
      return;
    }

    const request: VisibilitySampleRequest = {
      prompt: loaded.prompt.promptText,
      model: loaded.model,
      locale: loaded.locale,
      country: loaded.country,
      groundingMode: loaded.groundingMode as VisibilityGroundingMode,
      providerOptions: providerOptionsForObservation(loaded.run.requestedProviderConfigs, loaded)
    };

    const estimate = adapter.estimateCostMicros(request);
    const budgetDecision = await budgetService.preflightObservation(loaded.id, estimate);
    if (!budgetDecision.allowed) {
      await budgetService.markBudgetSkipped(loaded.id, budgetDecision.reason);
      await finalizeVisibilityRun(loaded.visibilityRunId);
      return;
    }

    const response = await adapter.sample(request);
    const answerText = boundedAnswer(response.answerText);
    const answerHash = answerText === null
      ? null
      : createHash('sha256').update(answerText).digest('hex');
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
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: response.totalTokens,
        searchUnits: response.searchUnits,
        costMicros: response.costMicros,
        costCurrency: response.costCurrency,
        pricingVersion: response.pricingVersion,
        latencyMs: response.latencyMs,
        errorCode: response.status === 'UNSUPPORTED'
          ? 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED'
          : null,
        observedAt: new Date()
      }
    });
    await finalizeVisibilityRun(loaded.visibilityRunId);
  } catch (error) {
    await prisma.platformObservation.update({
      where: { id: loaded.id },
      data: {
        status: 'FAILED',
        errorCode: failureCode(error),
        answerText: null,
        answerHash: null,
        observedAt: new Date()
      }
    });
    await finalizeVisibilityRun(loaded.visibilityRunId);
    throw error;
  }
}

export async function processVisibilityJob(job: Job<VisibilityJobData>) {
  const observationId = job.data?.observationId;
  if (!observationId) throw new Error('observationId is required for visibility jobs');
  await executeVisibilityObservation(observationId);
}
