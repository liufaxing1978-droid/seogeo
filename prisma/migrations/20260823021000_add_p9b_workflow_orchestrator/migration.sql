CREATE TYPE "OptimizationTriggerType" AS ENUM ('EVENT', 'DAILY_RECONCILIATION', 'MANUAL');
CREATE TYPE "OptimizationTriggerSource" AS ENUM ('GROWTH_MATERIALIZATION', 'DAILY_SCHEDULER', 'MANUAL_REQUEST');
CREATE TYPE "OptimizationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "OptimizationRunItemStage" AS ENUM ('PLANNED', 'READY_FOR_POLICY');
CREATE TYPE "OptimizationRunItemStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "OptimizationRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "runVersion" TEXT NOT NULL,
  "triggerType" "OptimizationTriggerType" NOT NULL,
  "triggerSource" "OptimizationTriggerSource" NOT NULL,
  "triggerKey" TEXT NOT NULL,
  "triggerPayload" JSONB NOT NULL,
  "status" "OptimizationRunStatus" NOT NULL DEFAULT 'QUEUED',
  "candidateCount" INTEGER NOT NULL DEFAULT 0,
  "plannedCount" INTEGER NOT NULL DEFAULT 0,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "completedCount" INTEGER NOT NULL DEFAULT 0,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "planningCompletedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OptimizationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptimizationRunItem" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "optimizationPlanId" UUID NOT NULL,
  "itemKey" TEXT NOT NULL,
  "currentStage" "OptimizationRunItemStage" NOT NULL DEFAULT 'PLANNED',
  "status" "OptimizationRunItemStatus" NOT NULL DEFAULT 'PENDING',
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "OptimizationRunItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptimizationRun_project_trigger_key" ON "OptimizationRun"("projectId", "triggerKey");
CREATE INDEX "OptimizationRun_project_status_idx" ON "OptimizationRun"("projectId", "status", "createdAt");
CREATE UNIQUE INDEX "OptimizationRunItem_run_plan" ON "OptimizationRunItem"("runId", "optimizationPlanId");
CREATE UNIQUE INDEX "OptimizationRunItem_run_item_key" ON "OptimizationRunItem"("runId", "itemKey");
CREATE INDEX "OptimizationRunItem_project_status_idx" ON "OptimizationRunItem"("projectId", "status", "createdAt");

ALTER TABLE "OptimizationRun" ADD CONSTRAINT "OptimizationRun_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationRunItem" ADD CONSTRAINT "OptimizationRunItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "OptimizationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationRunItem" ADD CONSTRAINT "OptimizationRunItem_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationRunItem" ADD CONSTRAINT "OptimizationRunItem_optimizationPlanId_fkey"
  FOREIGN KEY ("optimizationPlanId") REFERENCES "OptimizationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
