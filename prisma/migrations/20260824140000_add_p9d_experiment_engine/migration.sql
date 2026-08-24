CREATE TYPE "OptimizationExperimentEffectState" AS ENUM (
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'INCONCLUSIVE'
);

CREATE TYPE "OptimizationExperimentCoverageState" AS ENUM (
  'SUFFICIENT',
  'PARTIAL',
  'INSUFFICIENT',
  'UNKNOWN'
);

CREATE TYPE "OptimizationExperimentContaminationState" AS ENUM (
  'CLEAR',
  'CONFLICTING_MUTATION',
  'TARGET_REVISION_CHANGED',
  'VERIFICATION_INVALIDATED',
  'SOURCE_IDENTITY_CHANGED',
  'UNKNOWN'
);

CREATE TABLE "OptimizationExperiment" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "optimizationPlanId" UUID NOT NULL,
  "publicationExecutionId" UUID NOT NULL,
  "publicationVerificationId" UUID NOT NULL,
  "experimentVersion" TEXT NOT NULL,
  "experimentKey" TEXT NOT NULL,
  "interventionType" "RecommendedActionType" NOT NULL,
  "targetUrl" TEXT NOT NULL,
  "marketCode" "MarketCode",
  "locale" TEXT,
  "verifiedAnchorAt" TIMESTAMP(3) NOT NULL,
  "measurementScopeJson" JSONB NOT NULL,
  "observationScheduleJson" JSONB NOT NULL,
  "expectedDirectionJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationExperiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptimizationExperimentObservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "experimentId" UUID NOT NULL,
  "observationVersion" TEXT NOT NULL,
  "observationKey" TEXT NOT NULL,
  "windowType" TEXT NOT NULL,
  "windowDays" INTEGER NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "inputCutoffAt" TIMESTAMP(3) NOT NULL,
  "baselineSearchSourceRefs" JSONB NOT NULL,
  "observedSearchSourceRefs" JSONB NOT NULL,
  "baselineVisibilitySourceRefs" JSONB NOT NULL,
  "observedVisibilitySourceRefs" JSONB NOT NULL,
  "baselineMetricsJson" JSONB NOT NULL,
  "observedMetricsJson" JSONB NOT NULL,
  "deltaMetricsJson" JSONB NOT NULL,
  "coverageState" "OptimizationExperimentCoverageState" NOT NULL,
  "contaminationState" "OptimizationExperimentContaminationState" NOT NULL,
  "effectState" "OptimizationExperimentEffectState" NOT NULL,
  "reasonCodes" JSONB NOT NULL,
  "evaluatorVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationExperimentObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptimizationExperiment_project_key"
  ON "OptimizationExperiment"("projectId", "experimentKey");

CREATE UNIQUE INDEX "OptimizationExperiment_plan_execution_version"
  ON "OptimizationExperiment"("optimizationPlanId", "publicationExecutionId", "experimentVersion");

CREATE INDEX "OptimizationExperiment_project_created_idx"
  ON "OptimizationExperiment"("projectId", "createdAt");

CREATE INDEX "OptimizationExperiment_execution_idx"
  ON "OptimizationExperiment"("publicationExecutionId");

CREATE UNIQUE INDEX "OptimizationExperimentObservation_experiment_key"
  ON "OptimizationExperimentObservation"("experimentId", "observationKey");

CREATE INDEX "OptimizationExperimentObservation_project_created_idx"
  ON "OptimizationExperimentObservation"("projectId", "createdAt");

CREATE INDEX "OptimizationExperimentObservation_window_idx"
  ON "OptimizationExperimentObservation"("experimentId", "windowType", "createdAt");

ALTER TABLE "OptimizationExperiment" ADD CONSTRAINT "OptimizationExperiment_optimizationPlanId_fkey"
  FOREIGN KEY ("optimizationPlanId") REFERENCES "OptimizationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationExperiment" ADD CONSTRAINT "OptimizationExperiment_publicationExecutionId_fkey"
  FOREIGN KEY ("publicationExecutionId") REFERENCES "PublicationExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationExperiment" ADD CONSTRAINT "OptimizationExperiment_publicationVerificationId_fkey"
  FOREIGN KEY ("publicationVerificationId") REFERENCES "PublicationVerification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationExperimentObservation" ADD CONSTRAINT "OptimizationExperimentObservation_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p9d_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-D immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationExperiment_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationExperiment"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9d_immutable_mutation"();

CREATE TRIGGER "OptimizationExperimentObservation_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationExperimentObservation"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9d_immutable_mutation"();
