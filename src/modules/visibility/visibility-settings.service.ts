import { Prisma, type VisibilityProvider } from '@prisma/client';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import type {
  UpdateVisibilitySettingsInput,
  UpsertVisibilityProviderConfigInput
} from './visibility.types.js';

const PROVIDER_OPTION_ALLOWLIST: Record<VisibilityProvider, ReadonlySet<string>> = {
  OPENAI: new Set(['searchContextSize']),
  GEMINI: new Set(),
  PERPLEXITY: new Set(['searchDomainFilter', 'searchRecencyFilter']),
  ANTHROPIC: new Set(['maxUses']),
  DEEPSEEK: new Set(),
  MICROSOFT: new Set(['timeZone'])
};

const SECRET_KEY_PATTERN = /(key|token|secret|authorization|cookie)/i;

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return project;
}

function validateIntegerRange(value: number, min: number, max: number, code: string, message: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(message, 400, code);
  }
}

function validateOptionalBudget(value: number | null | undefined, code: string, message: string) {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0) throw new AppError(message, 400, code);
}

function assertNoSecretLikeKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertNoSecretLikeKeys(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new AppError(
        'Provider options must not contain secrets or authentication material',
        400,
        'VISIBILITY_PROVIDER_OPTIONS_CONTAIN_SECRET'
      );
    }
    assertNoSecretLikeKeys(child);
  }
}

function validateProviderOptions(provider: VisibilityProvider, options: Record<string, unknown>) {
  assertNoSecretLikeKeys(options);
  const allowed = PROVIDER_OPTION_ALLOWLIST[provider];
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new AppError(
        `Provider option is not allowed: ${key}`,
        400,
        'VISIBILITY_PROVIDER_OPTION_NOT_ALLOWED'
      );
    }
  }
}

export class VisibilitySettingsService {
  async getOrCreate(projectId: string) {
    await requireProject(projectId);
    return prisma.visibilityProjectSettings.upsert({
      where: { projectId },
      create: { projectId },
      update: {}
    });
  }

  async update(projectId: string, input: UpdateVisibilitySettingsInput) {
    await this.getOrCreate(projectId);

    if (input.maxObservationsPerRun !== undefined) {
      validateIntegerRange(
        input.maxObservationsPerRun,
        1,
        500,
        'INVALID_VISIBILITY_MAX_OBSERVATIONS',
        'maxObservationsPerRun must be between 1 and 500'
      );
    }
    validateOptionalBudget(
      input.dailyBudgetMicros,
      'INVALID_VISIBILITY_DAILY_BUDGET',
      'dailyBudgetMicros must be a non-negative integer or null'
    );
    validateOptionalBudget(
      input.defaultRunBudgetMicros,
      'INVALID_VISIBILITY_RUN_BUDGET',
      'defaultRunBudgetMicros must be a non-negative integer or null'
    );
    if (input.defaultCurrency !== undefined && !/^[A-Z]{3}$/.test(input.defaultCurrency)) {
      throw new AppError('defaultCurrency must be an uppercase ISO-style currency code', 400, 'INVALID_VISIBILITY_CURRENCY');
    }

    return prisma.visibilityProjectSettings.update({
      where: { projectId },
      data: {
        ...(input.dailyBudgetMicros !== undefined ? { dailyBudgetMicros: input.dailyBudgetMicros } : {}),
        ...(input.defaultRunBudgetMicros !== undefined ? { defaultRunBudgetMicros: input.defaultRunBudgetMicros } : {}),
        ...(input.maxObservationsPerRun !== undefined ? { maxObservationsPerRun: input.maxObservationsPerRun } : {}),
        ...(input.defaultCurrency !== undefined ? { defaultCurrency: input.defaultCurrency } : {}),
        ...(input.schedulingEnabled !== undefined ? { schedulingEnabled: input.schedulingEnabled } : {})
      }
    });
  }

  async upsertProviderConfig(projectId: string, input: UpsertVisibilityProviderConfigInput) {
    await requireProject(projectId);

    if (input.channel !== 'API') {
      throw new AppError('P6-A supports API sampling only', 400, 'UNSUPPORTED_VISIBILITY_CHANNEL');
    }
    validateIntegerRange(
      input.maxConcurrency,
      1,
      10,
      'INVALID_VISIBILITY_PROVIDER_CONCURRENCY',
      'maxConcurrency must be between 1 and 10'
    );
    if (!input.model.trim()) {
      throw new AppError('model is required', 400, 'INVALID_VISIBILITY_PROVIDER_MODEL');
    }
    validateProviderOptions(input.provider, input.providerOptionsJson);

    const providerOptionsJson = input.providerOptionsJson as Prisma.InputJsonValue;
    return prisma.visibilityProviderConfig.upsert({
      where: {
        projectId_provider_model_channel_groundingMode: {
          projectId,
          provider: input.provider,
          model: input.model.trim(),
          channel: input.channel,
          groundingMode: input.groundingMode
        }
      },
      create: {
        projectId,
        provider: input.provider,
        enabled: input.enabled,
        model: input.model.trim(),
        channel: input.channel,
        groundingMode: input.groundingMode,
        maxConcurrency: input.maxConcurrency,
        defaultLocale: input.defaultLocale ?? null,
        defaultCountry: input.defaultCountry ?? null,
        providerOptionsJson
      },
      update: {
        enabled: input.enabled,
        maxConcurrency: input.maxConcurrency,
        defaultLocale: input.defaultLocale ?? null,
        defaultCountry: input.defaultCountry ?? null,
        providerOptionsJson
      }
    });
  }
}

export const visibilitySettingsService = new VisibilitySettingsService();
