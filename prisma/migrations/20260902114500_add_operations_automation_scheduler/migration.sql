-- OL-2: project-scoped automation definitions and auditable execution runs.
CREATE TYPE "AutomationRunSource" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'SKIPPED');
CREATE TYPE "AutomationOverlapPolicy" AS ENUM ('SKIP_IF_RUNNING');

CREATE TABLE "AutomationDefinition" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "scheduleCron" TEXT,
    "overlapPolicy" "AutomationOverlapPolicy" NOT NULL DEFAULT 'SKIP_IF_RUNNING',
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationDefinition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AutomationDefinition_max_attempts_check" CHECK ("maxAttempts" >= 1 AND "maxAttempts" <= 10),
    CONSTRAINT "AutomationDefinition_timeout_ms_check" CHECK ("timeoutMs" >= 1000 AND "timeoutMs" <= 86400000)
);

CREATE TABLE "AutomationRun" (
    "id" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "source" "AutomationRunSource" NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "deadlineAt" TIMESTAMP(3),
    "blockedByRunId" UUID,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AutomationRun_attempt_check" CHECK ("attempt" >= 1)
);

CREATE UNIQUE INDEX "AutomationDefinition_project_key" ON "AutomationDefinition"("projectId", "key");
CREATE INDEX "AutomationDefinition_project_enabled_idx" ON "AutomationDefinition"("projectId", "enabled");
CREATE UNIQUE INDEX "AutomationRun_definition_request_key" ON "AutomationRun"("definitionId", "requestKey");
CREATE INDEX "AutomationRun_project_status_idx" ON "AutomationRun"("projectId", "status", "createdAt");
CREATE INDEX "AutomationRun_definition_status_idx" ON "AutomationRun"("definitionId", "status", "createdAt");
CREATE INDEX "AutomationRun_timeout_idx" ON "AutomationRun"("status", "deadlineAt");

ALTER TABLE "AutomationRun"
ADD CONSTRAINT "AutomationRun_definitionId_fkey"
FOREIGN KEY ("definitionId") REFERENCES "AutomationDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
