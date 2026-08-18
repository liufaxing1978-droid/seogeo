CREATE TYPE "AiTaskType" AS ENUM ('SEO_AUDIT_ANALYSIS', 'GEO_READINESS_ANALYSIS', 'ENTITY_ENRICHMENT');
CREATE TYPE "AiTaskStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiProviderName" AS ENUM ('DEEPSEEK');
CREATE TYPE "AiMode" AS ENUM ('FAST', 'REASONING');
CREATE TYPE "AiResponseFormat" AS ENUM ('TEXT', 'JSON');

CREATE TABLE "AiTask" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "taskType" "AiTaskType" NOT NULL,
  "status" "AiTaskStatus" NOT NULL DEFAULT 'QUEUED',
  "requestKey" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "factSnapshot" JSONB NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiTaskRun" (
  "id" UUID NOT NULL,
  "aiTaskId" UUID NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "provider" "AiProviderName" NOT NULL,
  "model" TEXT NOT NULL,
  "mode" "AiMode" NOT NULL,
  "responseFormat" "AiResponseFormat" NOT NULL,
  "status" "AiRunStatus" NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "AiTaskRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiProviderCall" (
  "id" UUID NOT NULL,
  "aiTaskRunId" UUID NOT NULL,
  "attemptNo" INTEGER NOT NULL,
  "httpStatus" INTEGER,
  "providerResponseId" TEXT,
  "latencyMs" INTEGER,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "cacheHitTokens" INTEGER,
  "cacheMissTokens" INTEGER,
  "reasoningTokens" INTEGER,
  "finishReason" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProviderCall_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAnalysisResult" (
  "id" UUID NOT NULL,
  "aiTaskRunId" UUID NOT NULL,
  "resultType" "AiTaskType" NOT NULL,
  "summary" TEXT NOT NULL,
  "structuredOutput" JSONB NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "provider" "AiProviderName" NOT NULL,
  "model" TEXT NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiAnalysisResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiTask_projectId_requestKey_key" ON "AiTask"("projectId", "requestKey");
CREATE INDEX "AiTask_projectId_createdAt_idx" ON "AiTask"("projectId", "createdAt");
CREATE INDEX "AiTask_projectId_status_idx" ON "AiTask"("projectId", "status");
CREATE UNIQUE INDEX "AiTaskRun_aiTaskId_attemptNo_key" ON "AiTaskRun"("aiTaskId", "attemptNo");
CREATE INDEX "AiTaskRun_aiTaskId_status_idx" ON "AiTaskRun"("aiTaskId", "status");
CREATE UNIQUE INDEX "AiProviderCall_aiTaskRunId_attemptNo_key" ON "AiProviderCall"("aiTaskRunId", "attemptNo");
CREATE INDEX "AiProviderCall_createdAt_idx" ON "AiProviderCall"("createdAt");
CREATE UNIQUE INDEX "AiAnalysisResult_aiTaskRunId_key" ON "AiAnalysisResult"("aiTaskRunId");
CREATE INDEX "AiAnalysisResult_createdAt_idx" ON "AiAnalysisResult"("createdAt");

ALTER TABLE "AiTask"
  ADD CONSTRAINT "AiTask_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiTaskRun"
  ADD CONSTRAINT "AiTaskRun_aiTaskId_fkey"
  FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiProviderCall"
  ADD CONSTRAINT "AiProviderCall_aiTaskRunId_fkey"
  FOREIGN KEY ("aiTaskRunId") REFERENCES "AiTaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiAnalysisResult"
  ADD CONSTRAINT "AiAnalysisResult_aiTaskRunId_fkey"
  FOREIGN KEY ("aiTaskRunId") REFERENCES "AiTaskRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
