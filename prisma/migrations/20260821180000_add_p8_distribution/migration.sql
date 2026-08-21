CREATE TYPE "DistributionPlatform" AS ENUM ('MEDIUM', 'LINKEDIN', 'SUBSTACK', 'WORDPRESS', 'BLOGGER', 'REDDIT', 'QUORA', 'ZHIHU', 'WIKIPEDIA', 'WIKIDATA', 'BAIDU_BAIKE');
CREATE TYPE "DistributionMode" AS ENUM ('CANONICAL_REPOST', 'ADAPTED_ARTICLE', 'SUMMARY', 'SECONDARY_SITE', 'COMMUNITY_DRAFT', 'ENTITY_SUGGESTION');
CREATE TYPE "DistributionStatus" AS ENUM ('NOT_PREPARED', 'DRAFT_READY', 'APPROVED', 'PUBLISHED', 'VERIFIED', 'OUTDATED', 'FAILED', 'MANUAL_ACTION_REQUIRED');

CREATE TABLE "DistributionTarget" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "publicationId" UUID NOT NULL,
  "platform" "DistributionPlatform" NOT NULL,
  "mode" "DistributionMode" NOT NULL,
  "targetKey" TEXT NOT NULL,
  "status" "DistributionStatus" NOT NULL DEFAULT 'NOT_PREPARED',
  "sourceContentVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DistributionTarget_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DistributionArtifact" (
  "id" UUID NOT NULL,
  "targetId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceContentVersion" INTEGER NOT NULL,
  "adaptationVersion" TEXT NOT NULL,
  "artifactVersion" INTEGER NOT NULL,
  "artifactHash" TEXT NOT NULL,
  "title" TEXT,
  "body" TEXT NOT NULL,
  "originalUrl" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "sourceRefs" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DistributionArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DistributionTargetEvent" (
  "id" UUID NOT NULL,
  "targetId" UUID NOT NULL,
  "artifactId" UUID,
  "fromStatus" "DistributionStatus",
  "toStatus" "DistributionStatus" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "sourceContentVersion" INTEGER,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DistributionTargetEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DistributionTarget_identity_key" ON "DistributionTarget"("publicationId", "platform", "mode", "targetKey");
CREATE INDEX "DistributionTarget_project_created_idx" ON "DistributionTarget"("projectId", "createdAt");
CREATE INDEX "DistributionTarget_publication_status_idx" ON "DistributionTarget"("publicationId", "status");
CREATE UNIQUE INDEX "DistributionArtifact_target_version_key" ON "DistributionArtifact"("targetId", "artifactVersion");
CREATE INDEX "DistributionArtifact_target_source_version_idx" ON "DistributionArtifact"("targetId", "sourceContentVersion");
CREATE INDEX "DistributionArtifact_project_created_idx" ON "DistributionArtifact"("projectId", "createdAt");
CREATE INDEX "DistributionTargetEvent_target_created_idx" ON "DistributionTargetEvent"("targetId", "createdAt");
CREATE INDEX "DistributionTargetEvent_artifact_created_idx" ON "DistributionTargetEvent"("artifactId", "createdAt");

ALTER TABLE "DistributionArtifact" ADD CONSTRAINT "DistributionArtifact_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DistributionTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistributionTargetEvent" ADD CONSTRAINT "DistributionTargetEvent_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "DistributionTarget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DistributionTargetEvent" ADD CONSTRAINT "DistributionTargetEvent_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "DistributionArtifact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_distribution_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P8-B immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "DistributionArtifact_immutable" BEFORE UPDATE OR DELETE ON "DistributionArtifact" FOR EACH ROW EXECUTE FUNCTION "reject_distribution_immutable_mutation"();
CREATE TRIGGER "DistributionTargetEvent_immutable" BEFORE UPDATE OR DELETE ON "DistributionTargetEvent" FOR EACH ROW EXECUTE FUNCTION "reject_distribution_immutable_mutation"();
