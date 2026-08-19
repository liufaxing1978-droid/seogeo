import type {
  VisibilityChannel,
  VisibilityGroundingMode,
  VisibilityProvider
} from '@prisma/client';

export interface UpdateVisibilitySettingsInput {
  dailyBudgetMicros?: number | null;
  defaultRunBudgetMicros?: number | null;
  maxObservationsPerRun?: number;
  defaultCurrency?: string;
  schedulingEnabled?: boolean;
}

export interface UpsertVisibilityProviderConfigInput {
  provider: VisibilityProvider;
  enabled: boolean;
  model: string;
  channel: VisibilityChannel;
  groundingMode: VisibilityGroundingMode;
  maxConcurrency: number;
  defaultLocale?: string | null;
  defaultCountry?: string | null;
  providerOptionsJson: Record<string, unknown>;
}

export interface CreateVisibilityPromptSetInput {
  name: string;
  description?: string | null;
  defaultLocale?: string | null;
  defaultCountry?: string | null;
}

export interface CreateVisibilityPromptVersionInput {
  promptSetId: string;
  promptKey: string;
  promptText: string;
  locale?: string | null;
  country?: string | null;
}
