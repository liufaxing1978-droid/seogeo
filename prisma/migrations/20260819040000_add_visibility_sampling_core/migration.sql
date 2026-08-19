CREATE TYPE "VisibilityProvider" AS ENUM ('OPENAI', 'GEMINI', 'PERPLEXITY', 'ANTHROPIC', 'DEEPSEEK');
CREATE TYPE "VisibilityChannel" AS ENUM ('API', 'CONSUMER_UI');
CREATE TYPE "VisibilityGroundingMode" AS ENUM ('WEB_SEARCH', 'SEARCH_GROUNDING', 'SONAR', 'WEB_SEARCH_TOOL', 'UNSUPPORTED_WEB_GROUNDING');
CREATE TYPE "VisibilityConfigStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "VisibilityRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "VisibilityRunType" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "PlatformObservationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'REFUSED', 'UNSUPPORTED', 'FAILED', 'INCOMPLETE', 'BUDGET_SKIPPED');

CREATE TABLE "VisibilityProjectSettings" (
  "projectId" UUID NOT NULL,
  "dailyBudgetMicros" INTEGER,
  "defaultRunBudgetMicros" INTEGER,
  "maxObservationsPerRun" INTEGER NOT NULL DEFAULT 100,
  "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
  "schedulingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityProjectSettings_pkey" PRIMARY KEY ("projectId")
);

CREATE TABLE "VisibilityProviderConfig" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "provider" "VisibilityProvider" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "model" TEXT NOT NULL,
  "channel" "VisibilityChannel" NOT NULL DEFAULT 'API',
  "groundingMode" "VisibilityGroundingMode" NOT NULL,
  "maxConcurrency" INTEGER NOT NULL DEFAULT 2,
  "defaultLocale" TEXT,
  "defaultCountry" TEXT,
  "providerOptionsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityProviderConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityPromptSet" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "VisibilityConfigStatus" NOT NULL DEFAULT 'ACTIVE',
  "defaultLocale" TEXT,
  "defaultCountry" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityPromptSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityPrompt" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "promptSetId" UUID NOT NULL,
  "promptKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "promptText" TEXT NOT NULL,
  "locale" TEXT,
  "country" TEXT,
  "status" "VisibilityConfigStatus" NOT NULL DEFAULT 'ACTIVE',
  "promptHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityPrompt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "status" "VisibilityRunStatus" NOT NULL DEFAULT 'QUEUED',
  "runType" "VisibilityRunType" NOT NULL,
  "promptSetId" UUID NOT NULL,
  "requestedProviderConfigs" JSONB NOT NULL,
  "maxObservations" INTEGER NOT NULL,
  "budgetCeilingMicros" INTEGER,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "policySnapshotJson" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformObservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "visibilityRunId" UUID NOT NULL,
  "visibilityPromptId" UUID NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "samplingUnitKey" TEXT NOT NULL,
  "provider" "VisibilityProvider" NOT NULL,
  "model" TEXT NOT NULL,
  "channel" "VisibilityChannel" NOT NULL,
  "groundingMode" "VisibilityGroundingMode" NOT NULL,
  "locale" TEXT,
  "country" TEXT,
  "status" "PlatformObservationStatus" NOT NULL DEFAULT 'PENDING',
  "providerResponseId" TEXT,
  "answerText" TEXT,
  "answerHash" TEXT,
  "citationsJson" JSONB NOT NULL,
  "searchMetadataJson" JSONB NOT NULL,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "searchUnits" INTEGER,
  "costMicros" INTEGER,
  "costCurrency" TEXT,
  "pricingVersion" TEXT,
  "latencyMs" INTEGER,
  "errorCode" TEXT,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisibilityProviderConfig_projectId_provider_model_channel_groundingMode_key" ON "VisibilityProviderConfig"("projectId", "provider", "model", "channel", "groundingMode");
CREATE INDEX "VisibilityProviderConfig_projectId_enabled_provider_idx" ON "VisibilityProviderConfig"("projectId", "enabled", "provider");

CREATE INDEX "VisibilityPromptSet_projectId_status_idx" ON "VisibilityPromptSet"("projectId", "status");
CREATE INDEX "VisibilityPromptSet_projectId_createdAt_idx" ON "VisibilityPromptSet"("projectId", "createdAt");

CREATE UNIQUE INDEX "VisibilityPrompt_promptSetId_promptKey_version_key" ON "VisibilityPrompt"("promptSetId", "promptKey", "version");
CREATE INDEX "VisibilityPrompt_projectId_status_idx" ON "VisibilityPrompt"("projectId", "status");
CREATE INDEX "VisibilityPrompt_projectId_promptKey_version_idx" ON "VisibilityPrompt"("projectId", "promptKey", "version");

CREATE INDEX "VisibilityRun_projectId_status_idx" ON "VisibilityRun"("projectId", "status");
CREATE INDEX "VisibilityRun_projectId_createdAt_idx" ON "VisibilityRun"("projectId", "createdAt");
CREATE INDEX "VisibilityRun_promptSetId_createdAt_idx" ON "VisibilityRun"("promptSetId", "createdAt");

CREATE UNIQUE INDEX "PlatformObservation_samplingUnitKey_key" ON "PlatformObservation"("samplingUnitKey");
CREATE INDEX "PlatformObservation_projectId_observedAt_idx" ON "PlatformObservation"("projectId", "observedAt");
CREATE INDEX "PlatformObservation_visibilityRunId_status_idx" ON "PlatformObservation"("visibilityRunId", "status");
CREATE INDEX "PlatformObservation_visibilityPromptId_observedAt_idx" ON "PlatformObservation"("visibilityPromptId", "observedAt");
CREATE INDEX "PlatformObservation_projectId_provider_channel_observedAt_idx" ON "PlatformObservation"("projectId", "provider", "channel", "observedAt");

ALTER TABLE "VisibilityProjectSettings"
  ADD CONSTRAINT "VisibilityProjectSettings_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityProviderConfig"
  ADD CONSTRAINT "VisibilityProviderConfig_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityPromptSet"
  ADD CONSTRAINT "VisibilityPromptSet_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityPrompt"
  ADD CONSTRAINT "VisibilityPrompt_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilityPrompt"
  ADD CONSTRAINT "VisibilityPrompt_promptSetId_fkey"
  FOREIGN KEY ("promptSetId") REFERENCES "VisibilityPromptSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityRun"
  ADD CONSTRAINT "VisibilityRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilityRun"
  ADD CONSTRAINT "VisibilityRun_promptSetId_fkey"
  FOREIGN KEY ("promptSetId") REFERENCES "VisibilityPromptSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlatformObservation"
  ADD CONSTRAINT "PlatformObservation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformObservation"
  ADD CONSTRAINT "PlatformObservation_visibilityRunId_fkey"
  FOREIGN KEY ("visibilityRunId") REFERENCES "VisibilityRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformObservation"
  ADD CONSTRAINT "PlatformObservation_visibilityPromptId_fkey"
  FOREIGN KEY ("visibilityPromptId") REFERENCES "VisibilityPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
