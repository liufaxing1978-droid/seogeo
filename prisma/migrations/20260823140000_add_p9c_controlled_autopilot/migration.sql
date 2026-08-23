ALTER TYPE "PublicationProposalSourceType" ADD VALUE 'P9_OPTIMIZATION_PLAN';
ALTER TYPE "PublicationExecutionStatus" ADD VALUE 'AUTOMATION_AUTHORIZED' AFTER 'APPROVED';
ALTER TYPE "PublicationExecutionEventType" ADD VALUE 'AUTOMATION_AUTHORIZED' AFTER 'APPROVED';

CREATE TYPE "OptimizationAutopilotDecisionStatus" AS ENUM (
  'AUTOPILOT_READY',
  'P8_PREPARATION_REQUIRED',
  'MANUAL_REQUIRED',
  'POLICY_BLOCKED',
  'DEFERRED_QUOTA',
  'DEFERRED_CONFLICT',
  'STALE',
  'P8_VALIDATION_BLOCKED'
);

CREATE TYPE "AutopilotReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'RELEASED');

CREATE TABLE "AutopilotPolicy" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "policyVersion" TEXT NOT NULL DEFAULT 'CONTROLLED_AUTOPILOT_POLICY_V1',
  "allowedRiskClass" "PublicationRiskClass" NOT NULL DEFAULT 'LOW',
  "allowedOperationClasses" JSONB NOT NULL DEFAULT '["CREATE_CONTENT_PAGE"]'::jsonb,
  "dailyDraftPrLimit" INTEGER NOT NULL DEFAULT 3,
  "maxConcurrentRuns" INTEGER NOT NULL DEFAULT 1,
  "requireFreshEvidence" BOOLEAN NOT NULL DEFAULT true,
  "minimumEvidenceCoverage" INTEGER NOT NULL DEFAULT 70,
  "pauseOnVerificationFailure" BOOLEAN NOT NULL DEFAULT true,
  "killSwitch" BOOLEAN NOT NULL DEFAULT false,
  "enabledBy" TEXT,
  "enabledAt" TIMESTAMP(3),
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutopilotPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutopilotPolicy_low_risk_only" CHECK ("allowedRiskClass" = 'LOW'),
  CONSTRAINT "AutopilotPolicy_daily_limit_bounds" CHECK ("dailyDraftPrLimit" BETWEEN 1 AND 10),
  CONSTRAINT "AutopilotPolicy_concurrency_bounds" CHECK ("maxConcurrentRuns" BETWEEN 1 AND 3),
  CONSTRAINT "AutopilotPolicy_coverage_bounds" CHECK ("minimumEvidenceCoverage" BETWEEN 70 AND 100)
);

CREATE TABLE "OptimizationAutopilotDecision" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "runItemId" UUID NOT NULL,
  "optimizationPlanId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policySnapshot" JSONB NOT NULL,
  "sourceSnapshot" JSONB NOT NULL,
  "status" "OptimizationAutopilotDecisionStatus" NOT NULL,
  "reasonCodes" JSONB NOT NULL,
  "p8PlanId" UUID,
  "p8PreviewId" UUID,
  "decisionKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationAutopilotDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotExecutionReservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "decisionId" UUID NOT NULL,
  "utcDate" DATE NOT NULL,
  "reservationKey" TEXT NOT NULL,
  "status" "AutopilotReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "AutopilotExecutionReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationAutomationAuthorization" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "planVersion" INTEGER NOT NULL,
  "planHash" TEXT NOT NULL,
  "contentVersion" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "previewHash" TEXT NOT NULL,
  "baseSha" TEXT NOT NULL,
  "targetRepository" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "targetBlobHashes" JSONB NOT NULL,
  "authorizedRiskClass" "PublicationRiskClass" NOT NULL,
  "automationDecisionId" UUID NOT NULL,
  "automationPolicyVersion" TEXT NOT NULL,
  "automationPolicyHash" TEXT NOT NULL,
  "automationSource" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationAutomationAuthorization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationAutomationAuthorization_low_risk_only" CHECK ("authorizedRiskClass" = 'LOW')
);

ALTER TABLE "PublicationExecution" ALTER COLUMN "approvalId" DROP NOT NULL;
ALTER TABLE "PublicationExecution" ADD COLUMN "automationAuthorizationId" UUID;
ALTER TABLE "PublicationExecution" ADD CONSTRAINT "PublicationExecution_one_authorization_source" CHECK (
  ("approvalId" IS NOT NULL AND "automationAuthorizationId" IS NULL)
  OR
  ("approvalId" IS NULL AND "automationAuthorizationId" IS NOT NULL)
);

CREATE UNIQUE INDEX "AutopilotPolicy_projectId_key" ON "AutopilotPolicy"("projectId");
CREATE INDEX "AutopilotPolicy_project_enabled_idx" ON "AutopilotPolicy"("projectId", "enabled");

CREATE UNIQUE INDEX "OptimizationAutopilotDecision_decisionKey_key" ON "OptimizationAutopilotDecision"("decisionKey");
CREATE INDEX "OptimizationAutopilotDecision_project_status_created_idx" ON "OptimizationAutopilotDecision"("projectId", "status", "createdAt");
CREATE INDEX "OptimizationAutopilotDecision_run_item_created_idx" ON "OptimizationAutopilotDecision"("runItemId", "createdAt");

CREATE UNIQUE INDEX "AutopilotExecutionReservation_decisionId_key" ON "AutopilotExecutionReservation"("decisionId");
CREATE UNIQUE INDEX "AutopilotExecutionReservation_project_key_key" ON "AutopilotExecutionReservation"("projectId", "reservationKey");
CREATE INDEX "AutopilotExecutionReservation_project_date_status_idx" ON "AutopilotExecutionReservation"("projectId", "utcDate", "status");

CREATE UNIQUE INDEX "PublicationAutomationAuthorization_automationDecisionId_key" ON "PublicationAutomationAuthorization"("automationDecisionId");
CREATE INDEX "PublicationAutomationAuthorization_project_created_idx" ON "PublicationAutomationAuthorization"("projectId", "createdAt");
CREATE INDEX "PublicationAutomationAuthorization_plan_created_idx" ON "PublicationAutomationAuthorization"("planId", "createdAt");

CREATE INDEX "PublicationExecution_automation_authorization_idx" ON "PublicationExecution"("automationAuthorizationId");

CREATE UNIQUE INDEX "PublicationProposal_p9_source_identity_key"
  ON "PublicationProposal"("projectId", "sourceType", "sourceReferenceId", "sourceSnapshotId")
  WHERE "sourceType" = 'P9_OPTIMIZATION_PLAN';

ALTER TABLE "AutopilotPolicy" ADD CONSTRAINT "AutopilotPolicy_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "OptimizationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_runItemId_fkey"
  FOREIGN KEY ("runItemId") REFERENCES "OptimizationRunItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_optimizationPlanId_fkey"
  FOREIGN KEY ("optimizationPlanId") REFERENCES "OptimizationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "AutopilotPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_p8PlanId_fkey"
  FOREIGN KEY ("p8PlanId") REFERENCES "PublicationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationAutopilotDecision" ADD CONSTRAINT "OptimizationAutopilotDecision_p8PreviewId_fkey"
  FOREIGN KEY ("p8PreviewId") REFERENCES "PublicationPreview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutopilotExecutionReservation" ADD CONSTRAINT "AutopilotExecutionReservation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutopilotExecutionReservation" ADD CONSTRAINT "AutopilotExecutionReservation_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "OptimizationAutopilotDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationAutomationAuthorization" ADD CONSTRAINT "PublicationAutomationAuthorization_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationAutomationAuthorization" ADD CONSTRAINT "PublicationAutomationAuthorization_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "PublicationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationAutomationAuthorization" ADD CONSTRAINT "PublicationAutomationAuthorization_automationDecisionId_fkey"
  FOREIGN KEY ("automationDecisionId") REFERENCES "OptimizationAutopilotDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PublicationExecution" ADD CONSTRAINT "PublicationExecution_automationAuthorizationId_fkey"
  FOREIGN KEY ("automationAuthorizationId") REFERENCES "PublicationAutomationAuthorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p9c_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-C immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationAutopilotDecision_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationAutopilotDecision"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9c_immutable_mutation"();

CREATE TRIGGER "PublicationAutomationAuthorization_immutable"
  BEFORE UPDATE OR DELETE ON "PublicationAutomationAuthorization"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9c_immutable_mutation"();
