CREATE TYPE "GrowthIdentityType" AS ENUM ('QUERY_PAGE_GROWTH', 'KEYWORD_CANNIBALIZATION', 'NEW_CONTENT_OPPORTUNITY');
CREATE TYPE "GrowthOpportunityType" AS ENUM ('RANKING_UPSIDE', 'CTR_UNDERPERFORMANCE', 'CONTENT_GAP', 'SEO_GAP', 'GEO_CITABILITY_GAP', 'AI_VISIBILITY_GAP', 'KEYWORD_CANNIBALIZATION', 'DECLINING_PERFORMANCE', 'NEW_CONTENT_OPPORTUNITY');
CREATE TYPE "GrowthPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MONITOR', 'UNKNOWN');
CREATE TYPE "GrowthScoreState" AS ENUM ('KNOWN', 'UNKNOWN');
CREATE TYPE "GrowthEvidenceQuality" AS ENUM ('COMPLETE', 'PARTIAL', 'UNKNOWN');
CREATE TYPE "GrowthComponentState" AS ENUM ('KNOWN', 'UNKNOWN', 'NOT_APPLICABLE');
CREATE TYPE "GrowthEvidenceState" AS ENUM ('PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE');
CREATE TYPE "GrowthEvidenceSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW', 'INFO');
CREATE TYPE "GrowthEvidenceSourceModule" AS ENUM ('GSC', 'P2_SEO', 'P3_GEO', 'P3_ENTITY', 'P3_CITABILITY', 'P5_CONTENT', 'P5_COMPETITOR', 'P6_VISIBILITY', 'P6_ALERT');
CREATE TYPE "GrowthLifecycleStatus" AS ENUM ('NEW', 'REVIEWED', 'PLANNED', 'IN_PROGRESS', 'DONE', 'DISMISSED', 'RESOLVED', 'REOPENED');
CREATE TYPE "GrowthLifecycleEventType" AS ENUM ('CREATED', 'REVIEWED', 'PLANNED', 'STARTED', 'DONE', 'DISMISSED', 'AUTO_RESOLVED', 'AUTO_REOPENED');
CREATE TYPE "GrowthLifecycleActorType" AS ENUM ('USER', 'SYSTEM');

CREATE TABLE "GrowthOpportunityIdentity" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "opportunityKey" TEXT NOT NULL,
  "identityVersion" TEXT NOT NULL,
  "identityType" "GrowthIdentityType" NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "canonicalPage" TEXT,
  "identityPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunityIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthTopicCluster" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "topicKey" TEXT NOT NULL,
  "topicIdentityVersion" TEXT NOT NULL,
  "primaryEntityId" UUID,
  "primaryQuery" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthTopicCluster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthOpportunitySnapshot" (
  "id" UUID NOT NULL,
  "opportunityIdentityId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "snapshotVersion" TEXT NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "currentWindowStart" DATE NOT NULL,
  "currentWindowEnd" DATE NOT NULL,
  "previousWindowStart" DATE NOT NULL,
  "previousWindowEnd" DATE NOT NULL,
  "dataCutoffAt" TIMESTAMP(3) NOT NULL,
  "topicClusterId" UUID,
  "primaryType" "GrowthOpportunityType" NOT NULL,
  "secondaryTypes" "GrowthOpportunityType"[] NOT NULL,
  "score" INTEGER,
  "priority" "GrowthPriority" NOT NULL,
  "scoreState" "GrowthScoreState" NOT NULL,
  "evidenceQuality" "GrowthEvidenceQuality" NOT NULL,
  "evidenceCoverage" DOUBLE PRECISION NOT NULL,
  "rankingEligible" BOOLEAN NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunitySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthScoreBreakdown" (
  "snapshotId" UUID NOT NULL,
  "demandState" "GrowthComponentState" NOT NULL,
  "demandScore" INTEGER,
  "positionPotentialState" "GrowthComponentState" NOT NULL,
  "positionPotentialScore" INTEGER,
  "ctrGapState" "GrowthComponentState" NOT NULL,
  "ctrGapScore" INTEGER,
  "siteGapState" "GrowthComponentState" NOT NULL,
  "siteGapScore" INTEGER,
  "gscTrendState" "GrowthComponentState" NOT NULL,
  "gscTrendScore" INTEGER,
  "p6VisibilityState" "GrowthComponentState" NOT NULL,
  "p6VisibilityScore" INTEGER,
  "trendVisibilityDisplayState" "GrowthComponentState" NOT NULL,
  "trendVisibilityDisplayScore" INTEGER,
  "availableWeight" INTEGER NOT NULL,
  "evidenceCoverage" DOUBLE PRECISION NOT NULL,
  "weightedTotal" DOUBLE PRECISION,
  "formulaVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthScoreBreakdown_pkey" PRIMARY KEY ("snapshotId")
);

CREATE TABLE "GrowthOpportunityEvidence" (
  "id" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceModule" "GrowthEvidenceSourceModule" NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceFactVersion" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "rootCauseKey" TEXT NOT NULL,
  "evidenceState" "GrowthEvidenceState" NOT NULL,
  "severity" "GrowthEvidenceSeverity",
  "numericValue" DOUBLE PRECISION,
  "textSummary" TEXT,
  "fingerprint" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunityEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthOpportunityLifecycle" (
  "opportunityIdentityId" UUID NOT NULL,
  "status" "GrowthLifecycleStatus" NOT NULL DEFAULT 'NEW',
  "latestSnapshotId" UUID,
  "reviewedAt" TIMESTAMP(3),
  "plannedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "doneAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "reopenedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GrowthOpportunityLifecycle_pkey" PRIMARY KEY ("opportunityIdentityId")
);

CREATE TABLE "GrowthOpportunityLifecycleEvent" (
  "id" UUID NOT NULL,
  "opportunityIdentityId" UUID NOT NULL,
  "eventType" "GrowthLifecycleEventType" NOT NULL,
  "actorType" "GrowthLifecycleActorType" NOT NULL,
  "actorId" TEXT,
  "fromStatus" "GrowthLifecycleStatus",
  "toStatus" "GrowthLifecycleStatus" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunityLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GrowthTopicClusterSnapshot" (
  "id" UUID NOT NULL,
  "topicClusterId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "snapshotVersion" TEXT NOT NULL,
  "currentWindowStart" DATE NOT NULL,
  "currentWindowEnd" DATE NOT NULL,
  "previousWindowStart" DATE NOT NULL,
  "previousWindowEnd" DATE NOT NULL,
  "dataCutoffAt" TIMESTAMP(3) NOT NULL,
  "memberQueries" JSONB NOT NULL,
  "memberPages" JSONB NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "totalImpressions" INTEGER NOT NULL,
  "totalClicks" INTEGER NOT NULL,
  "ctr" DOUBLE PRECISION NOT NULL,
  "position" DOUBLE PRECISION,
  "topOpportunityScore" INTEGER,
  "topicScore" INTEGER,
  "priority" "GrowthPriority" NOT NULL,
  "scoreState" "GrowthScoreState" NOT NULL,
  "evidenceQuality" "GrowthEvidenceQuality" NOT NULL,
  "evidenceCoverage" DOUBLE PRECISION NOT NULL,
  "rankingEligible" BOOLEAN NOT NULL,
  "trendVisibilityState" "GrowthComponentState" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthTopicClusterSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GrowthOpportunityIdentity_project_key" ON "GrowthOpportunityIdentity"("projectId", "opportunityKey");
CREATE INDEX "GrowthOpportunityIdentity_project_type_idx" ON "GrowthOpportunityIdentity"("projectId", "identityType");
CREATE INDEX "GrowthOpportunityIdentity_project_query_idx" ON "GrowthOpportunityIdentity"("projectId", "normalizedQuery");
CREATE UNIQUE INDEX "GrowthTopicCluster_project_identity_key" ON "GrowthTopicCluster"("projectId", "topicIdentityVersion", "topicKey");
CREATE INDEX "GrowthTopicCluster_project_query_idx" ON "GrowthTopicCluster"("projectId", "primaryQuery");
CREATE UNIQUE INDEX "GrowthOpportunitySnapshot_identity_window_key" ON "GrowthOpportunitySnapshot"("opportunityIdentityId", "snapshotVersion", "currentWindowStart", "currentWindowEnd");
CREATE INDEX "GrowthOpportunitySnapshot_project_window_idx" ON "GrowthOpportunitySnapshot"("projectId", "currentWindowEnd", "rankingEligible");
CREATE INDEX "GrowthOpportunitySnapshot_project_priority_idx" ON "GrowthOpportunitySnapshot"("projectId", "priority", "score");
CREATE INDEX "GrowthOpportunitySnapshot_topic_window_idx" ON "GrowthOpportunitySnapshot"("topicClusterId", "currentWindowEnd");
CREATE UNIQUE INDEX "GrowthOpportunityEvidence_snapshot_fingerprint_key" ON "GrowthOpportunityEvidence"("snapshotId", "fingerprint");
CREATE INDEX "GrowthOpportunityEvidence_project_source_idx" ON "GrowthOpportunityEvidence"("projectId", "sourceModule");
CREATE INDEX "GrowthOpportunityEvidence_snapshot_root_idx" ON "GrowthOpportunityEvidence"("snapshotId", "rootCauseKey");
CREATE INDEX "GrowthOpportunityLifecycle_status_idx" ON "GrowthOpportunityLifecycle"("status", "updatedAt");
CREATE INDEX "GrowthLifecycleEvent_identity_created_idx" ON "GrowthOpportunityLifecycleEvent"("opportunityIdentityId", "createdAt");
CREATE UNIQUE INDEX "GrowthTopicSnapshot_identity_window_key" ON "GrowthTopicClusterSnapshot"("topicClusterId", "snapshotVersion", "currentWindowStart", "currentWindowEnd");
CREATE INDEX "GrowthTopicSnapshot_project_window_idx" ON "GrowthTopicClusterSnapshot"("projectId", "currentWindowEnd", "rankingEligible");
CREATE INDEX "GrowthTopicSnapshot_project_priority_idx" ON "GrowthTopicClusterSnapshot"("projectId", "priority", "topicScore");

ALTER TABLE "GrowthOpportunitySnapshot" ADD CONSTRAINT "GrowthOpportunitySnapshot_identityId_fkey" FOREIGN KEY ("opportunityIdentityId") REFERENCES "GrowthOpportunityIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthOpportunitySnapshot" ADD CONSTRAINT "GrowthOpportunitySnapshot_topicClusterId_fkey" FOREIGN KEY ("topicClusterId") REFERENCES "GrowthTopicCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GrowthScoreBreakdown" ADD CONSTRAINT "GrowthScoreBreakdown_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GrowthOpportunitySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthOpportunityEvidence" ADD CONSTRAINT "GrowthOpportunityEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GrowthOpportunitySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthOpportunityLifecycle" ADD CONSTRAINT "GrowthOpportunityLifecycle_identityId_fkey" FOREIGN KEY ("opportunityIdentityId") REFERENCES "GrowthOpportunityIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthOpportunityLifecycleEvent" ADD CONSTRAINT "GrowthLifecycleEvent_identityId_fkey" FOREIGN KEY ("opportunityIdentityId") REFERENCES "GrowthOpportunityIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GrowthTopicClusterSnapshot" ADD CONSTRAINT "GrowthTopicSnapshot_topicClusterId_fkey" FOREIGN KEY ("topicClusterId") REFERENCES "GrowthTopicCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_growth_immutable_update"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'immutable growth record cannot be updated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "GrowthOpportunitySnapshot_immutable_update"
BEFORE UPDATE ON "GrowthOpportunitySnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_growth_immutable_update"();

CREATE TRIGGER "GrowthScoreBreakdown_immutable_update"
BEFORE UPDATE ON "GrowthScoreBreakdown"
FOR EACH ROW EXECUTE FUNCTION "reject_growth_immutable_update"();

CREATE TRIGGER "GrowthOpportunityEvidence_immutable_update"
BEFORE UPDATE ON "GrowthOpportunityEvidence"
FOR EACH ROW EXECUTE FUNCTION "reject_growth_immutable_update"();

CREATE TRIGGER "GrowthTopicClusterSnapshot_immutable_update"
BEFORE UPDATE ON "GrowthTopicClusterSnapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_growth_immutable_update"();

CREATE TRIGGER "GrowthLifecycleEvent_immutable_update"
BEFORE UPDATE ON "GrowthOpportunityLifecycleEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_growth_immutable_update"();