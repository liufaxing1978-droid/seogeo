CREATE TYPE "OptimizationMarketScopeMode" AS ENUM ('CONFIGURED_MARKET', 'UNCONFIGURED_LEGACY', 'INVALID_PROVENANCE');
CREATE TYPE "OptimizationEligibilityState" AS ENUM ('ELIGIBLE', 'INELIGIBLE');
CREATE TYPE "RecommendedActionType" AS ENUM (
  'ON_PAGE_OPTIMIZATION',
  'SERP_SNIPPET_OPTIMIZATION',
  'CONTENT_CREATION',
  'TECHNICAL_SEO_REMEDIATION',
  'GEO_CITABILITY_IMPROVEMENT',
  'AI_VISIBILITY_IMPROVEMENT',
  'CANNIBALIZATION_REMEDIATION',
  'CONTENT_REFRESH'
);

CREATE TABLE "OptimizationCandidate" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "growthOpportunityIdentityId" UUID NOT NULL,
  "growthSnapshotId" UUID NOT NULL,
  "candidateVersion" TEXT NOT NULL,
  "candidateKey" TEXT NOT NULL,
  "marketScopeMode" "OptimizationMarketScopeMode" NOT NULL,
  "marketCode" "MarketCode",
  "locale" TEXT,
  "opportunityType" "GrowthOpportunityType" NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "canonicalPage" TEXT,
  "growthScore" INTEGER,
  "growthScoreState" "GrowthScoreState" NOT NULL,
  "growthPriority" "GrowthPriority" NOT NULL,
  "growthEvidenceQuality" "GrowthEvidenceQuality" NOT NULL,
  "growthEvidenceCoverage" DOUBLE PRECISION NOT NULL,
  "growthRankingEligible" BOOLEAN NOT NULL,
  "growthLifecycleStatus" "GrowthLifecycleStatus" NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "eligibilityState" "OptimizationEligibilityState" NOT NULL,
  "eligibilityReasonCodes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OptimizationPlan" (
  "id" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "planVersion" TEXT NOT NULL,
  "recommendedActionType" "RecommendedActionType" NOT NULL,
  "sourceFactReferences" JSONB NOT NULL,
  "deterministicRank" INTEGER NOT NULL,
  "aiRankAdjustment" INTEGER NOT NULL,
  "historicalRankAdjustment" INTEGER NOT NULL,
  "finalRank" INTEGER NOT NULL,
  "advisoryContext" JSONB NOT NULL,
  "automationEligibility" BOOLEAN NOT NULL DEFAULT false,
  "explanation" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OptimizationPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OptimizationCandidate_project_key" ON "OptimizationCandidate"("projectId", "candidateKey");
CREATE INDEX "OptimizationCandidate_project_eligibility_idx" ON "OptimizationCandidate"("projectId", "eligibilityState", "createdAt");
CREATE INDEX "OptimizationCandidate_growth_source_idx" ON "OptimizationCandidate"("growthOpportunityIdentityId", "growthSnapshotId");
CREATE UNIQUE INDEX "OptimizationPlan_candidate_version" ON "OptimizationPlan"("candidateId", "planVersion");
CREATE INDEX "OptimizationPlan_project_rank_idx" ON "OptimizationPlan"("projectId", "finalRank", "createdAt");

ALTER TABLE "OptimizationCandidate" ADD CONSTRAINT "OptimizationCandidate_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationCandidate" ADD CONSTRAINT "OptimizationCandidate_growthOpportunityIdentityId_fkey"
  FOREIGN KEY ("growthOpportunityIdentityId") REFERENCES "GrowthOpportunityIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationCandidate" ADD CONSTRAINT "OptimizationCandidate_growthSnapshotId_fkey"
  FOREIGN KEY ("growthSnapshotId") REFERENCES "GrowthOpportunitySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationPlan" ADD CONSTRAINT "OptimizationPlan_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "OptimizationCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OptimizationPlan" ADD CONSTRAINT "OptimizationPlan_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p9a_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-A immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OptimizationCandidate_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationCandidate"
FOR EACH ROW EXECUTE FUNCTION "reject_p9a_immutable_mutation"();

CREATE TRIGGER "OptimizationPlan_immutable"
BEFORE UPDATE OR DELETE ON "OptimizationPlan"
FOR EACH ROW EXECUTE FUNCTION "reject_p9a_immutable_mutation"();
