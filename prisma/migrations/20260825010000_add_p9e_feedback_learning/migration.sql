CREATE TYPE "OptimizationFeedbackEffect" AS ENUM (
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE'
);

CREATE TABLE "OptimizationFeedbackEvidence" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "experimentId" UUID NOT NULL,
  "observationId" UUID NOT NULL,
  "optimizationPlanId" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "feedbackEvidenceVersion" TEXT NOT NULL,
  "evidenceKey" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "marketScopeMode" "OptimizationMarketScopeMode" NOT NULL,
  "marketCode" "MarketCode",
  "locale" TEXT,
  "recommendedActionType" "RecommendedActionType" NOT NULL,
  "effectState" "OptimizationFeedbackEffect" NOT NULL,
  "feedbackValue" INTEGER NOT NULL,
  "terminalWindowType" TEXT NOT NULL,
  "terminalWindowDays" INTEGER NOT NULL,
  "inputCutoffAt" TIMESTAMP(3) NOT NULL,
  "sourceEvaluatorVersion" TEXT NOT NULL,
  "sourceObservationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationFeedbackEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptimizationFeedbackProfile" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "feedbackProfileVersion" TEXT NOT NULL,
  "profileKey" TEXT NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "marketScopeMode" "OptimizationMarketScopeMode" NOT NULL,
  "marketCode" "MarketCode",
  "locale" TEXT,
  "recommendedActionType" "RecommendedActionType" NOT NULL,
  "sampleCount" INTEGER NOT NULL,
  "positiveCount" INTEGER NOT NULL,
  "neutralCount" INTEGER NOT NULL,
  "negativeCount" INTEGER NOT NULL,
  "rollingEffectBalance" DOUBLE PRECISION NOT NULL,
  "historicalRankAdjustment" INTEGER NOT NULL,
  "windowLimit" INTEGER NOT NULL,
  "oldestEvidenceCutoffAt" TIMESTAMP(3) NOT NULL,
  "newestEvidenceCutoffAt" TIMESTAMP(3) NOT NULL,
  "inputEvidenceIdsJson" JSONB NOT NULL,
  "inputFingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationFeedbackProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptimizationFeedbackEvidence_experimentId_key"
  ON "OptimizationFeedbackEvidence"("experimentId");

CREATE UNIQUE INDEX "OptimizationFeedbackEvidence_observationId_key"
  ON "OptimizationFeedbackEvidence"("observationId");

CREATE UNIQUE INDEX "OptimizationFeedbackEvidence_project_key"
  ON "OptimizationFeedbackEvidence"("projectId", "evidenceKey");

CREATE INDEX "OptimizationFeedbackEvidence_scope_cutoff_idx"
  ON "OptimizationFeedbackEvidence"("projectId", "scopeKey", "inputCutoffAt");

CREATE UNIQUE INDEX "OptimizationFeedbackProfile_project_key"
  ON "OptimizationFeedbackProfile"("projectId", "profileKey");

CREATE UNIQUE INDEX "OptimizationFeedbackProfile_project_input"
  ON "OptimizationFeedbackProfile"("projectId", "inputFingerprint");

CREATE INDEX "OptimizationFeedbackProfile_scope_latest_idx"
  ON "OptimizationFeedbackProfile"("projectId", "scopeKey", "newestEvidenceCutoffAt");

ALTER TABLE "OptimizationFeedbackEvidence" ADD CONSTRAINT "OptimizationFeedbackEvidence_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "OptimizationExperiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationFeedbackEvidence" ADD CONSTRAINT "OptimizationFeedbackEvidence_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "OptimizationExperimentObservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationFeedbackEvidence" ADD CONSTRAINT "OptimizationFeedbackEvidence_optimizationPlanId_fkey"
  FOREIGN KEY ("optimizationPlanId") REFERENCES "OptimizationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OptimizationFeedbackEvidence" ADD CONSTRAINT "OptimizationFeedbackEvidence_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "OptimizationCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p9e_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-E immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationFeedbackEvidence_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationFeedbackEvidence"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9e_immutable_mutation"();

CREATE TRIGGER "OptimizationFeedbackProfile_immutable"
  BEFORE UPDATE OR DELETE ON "OptimizationFeedbackProfile"
  FOR EACH ROW EXECUTE FUNCTION "reject_p9e_immutable_mutation"();
