import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import { emitVisibilityEvent } from './visibility-observability.js';

export interface VisibilityJobData {
  observationId: string;
}

export interface VisibilityQueue {
  add(
    name: string,
    data: VisibilityJobData,
    options: { jobId: string; attempts: number }
  ): Promise<unknown>;
}

export interface CreateManualVisibilityRunInput {
  promptSetId: string;
  providerConfigIds: string[];
  maxObservations: number;
  budgetCeilingMicros?: number | null;
}

class LazyVisibilityQueue implements VisibilityQueue {
  private queue: Queue<VisibilityJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<VisibilityJobData>('visibility', {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  add(
    name: string,
    data: VisibilityJobData,
    options: { jobId: string; attempts: number }
  ) {
    return this.getQueue().add(name, data, options);
  }
}

function validateNonNegativeBudget(value: number | null | undefined) {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      'budgetCeilingMicros must be a non-negative integer or null',
      400,
      'INVALID_VISIBILITY_RUN_BUDGET'
    );
  }
}

function stableSamplingUnitKey(input: {
  runId: string;
  promptId: string;
  provider: string;
  model: string;
  channel: string;
  locale: string | null;
  country: string | null;
}) {
  return [
    'visibility',
    input.runId,
    input.promptId,
    input.provider,
    input.model,
    input.channel,
    input.locale ?? '',
    input.country ?? ''
  ].join(':');
}

export class VisibilityRunService {
  constructor(private readonly queue: VisibilityQueue = new LazyVisibilityQueue()) {}

  async createManualRun(projectId: string, input: CreateManualVisibilityRunInput) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, planLevel: true }
    });
    if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    if (!hasFeature(project.planLevel, 'AI_VISIBILITY')) {
      throw new AppError(
        'AI Visibility is not available for this project plan',
        403,
        'FEATURE_NOT_AVAILABLE'
      );
    }

    if (!Number.isInteger(input.maxObservations) || input.maxObservations < 1 || input.maxObservations > 500) {
      throw new AppError(
        'maxObservations must be between 1 and 500',
        400,
        'INVALID_VISIBILITY_MAX_OBSERVATIONS'
      );
    }
    validateNonNegativeBudget(input.budgetCeilingMicros);

    const settings = await prisma.visibilityProjectSettings.upsert({
      where: { projectId },
      create: { projectId },
      update: {}
    });

    const promptSet = await prisma.visibilityPromptSet.findFirst({
      where: {
        id: input.promptSetId,
        projectId,
        status: 'ACTIVE'
      }
    });
    if (!promptSet) {
      throw new NotFoundError('Visibility prompt set not found', 'VISIBILITY_PROMPT_SET_NOT_FOUND');
    }

    const prompts = await prisma.visibilityPrompt.findMany({
      where: {
        projectId,
        promptSetId: promptSet.id,
        status: 'ACTIVE'
      },
      orderBy: [
        { promptKey: 'asc' },
        { version: 'asc' },
        { id: 'asc' }
      ]
    });
    if (!prompts.length) {
      throw new AppError('At least one active visibility prompt is required', 409, 'VISIBILITY_PROMPTS_REQUIRED');
    }

    const uniqueProviderIds = [...new Set(input.providerConfigIds)];
    if (!uniqueProviderIds.length) {
      throw new AppError(
        'At least one enabled visibility provider config is required',
        400,
        'VISIBILITY_PROVIDER_CONFIG_NOT_FOUND'
      );
    }

    const providerConfigs = await prisma.visibilityProviderConfig.findMany({
      where: {
        projectId,
        id: { in: uniqueProviderIds },
        enabled: true,
        channel: 'API'
      },
      orderBy: [
        { provider: 'asc' },
        { model: 'asc' },
        { id: 'asc' }
      ]
    });
    if (providerConfigs.length !== uniqueProviderIds.length) {
      throw new NotFoundError(
        'Visibility provider config not found for project',
        'VISIBILITY_PROVIDER_CONFIG_NOT_FOUND'
      );
    }

    const matrixCount = prompts.length * providerConfigs.length;
    if (
      matrixCount > input.maxObservations ||
      matrixCount > settings.maxObservationsPerRun
    ) {
      throw new AppError(
        'Visibility sampling matrix exceeds the configured observation limit',
        400,
        'VISIBILITY_OBSERVATION_LIMIT_EXCEEDED'
      );
    }

    const requestedProviderConfigs = providerConfigs.map((config) => ({
      id: config.id,
      provider: config.provider,
      enabled: config.enabled,
      model: config.model,
      channel: config.channel,
      groundingMode: config.groundingMode,
      maxConcurrency: config.maxConcurrency,
      defaultLocale: config.defaultLocale,
      defaultCountry: config.defaultCountry,
      providerOptionsJson: config.providerOptionsJson
    })) as unknown as Prisma.InputJsonValue;

    const policySnapshotJson = {
      dailyBudgetMicros: settings.dailyBudgetMicros,
      defaultRunBudgetMicros: settings.defaultRunBudgetMicros,
      maxObservationsPerRun: settings.maxObservationsPerRun,
      defaultCurrency: settings.defaultCurrency,
      schedulingEnabled: settings.schedulingEnabled
    } as Prisma.InputJsonValue;

    const budgetCeilingMicros = input.budgetCeilingMicros === undefined
      ? settings.defaultRunBudgetMicros
      : input.budgetCeilingMicros;

    const created = await prisma.$transaction(async (tx) => {
      const run = await tx.visibilityRun.create({
        data: {
          projectId,
          promptSetId: promptSet.id,
          runType: 'MANUAL',
          requestedProviderConfigs,
          maxObservations: input.maxObservations,
          budgetCeilingMicros,
          currency: settings.defaultCurrency,
          policySnapshotJson
        }
      });

      const observations = [];
      for (const prompt of prompts) {
        for (const config of providerConfigs) {
          const locale = prompt.locale ?? config.defaultLocale ?? null;
          const country = prompt.country ?? config.defaultCountry ?? null;
          const observation = await tx.platformObservation.create({
            data: {
              projectId,
              visibilityRunId: run.id,
              visibilityPromptId: prompt.id,
              promptVersion: prompt.version,
              samplingUnitKey: stableSamplingUnitKey({
                runId: run.id,
                promptId: prompt.id,
                provider: config.provider,
                model: config.model,
                channel: config.channel,
                locale,
                country
              }),
              provider: config.provider,
              model: config.model,
              channel: config.channel,
              groundingMode: config.groundingMode,
              locale,
              country,
              citationsJson: [],
              searchMetadataJson: {}
            }
          });
          observations.push(observation);
        }
      }

      return { run, observations };
    });

    try {
      for (const observation of created.observations) {
        await this.queue.add(
          'visibility-observation',
          { observationId: observation.id },
          {
            jobId: `visibility-observation-${observation.id}`,
            attempts: 1
          }
        );
      }
    } catch (error) {
      await prisma.visibilityRun.update({
        where: { id: created.run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCode: 'VISIBILITY_QUEUE_ENQUEUE_FAILED'
        }
      });
      emitVisibilityEvent('visibility.run.failed', {
        projectId,
        runId: created.run.id,
        status: 'FAILED',
        errorCode: 'VISIBILITY_QUEUE_ENQUEUE_FAILED'
      });
      throw error;
    }

    emitVisibilityEvent('visibility.run.queued', {
      projectId,
      runId: created.run.id,
      status: 'QUEUED'
    });
    return created.run;
  }
}

export const visibilityRunService = new VisibilityRunService();
