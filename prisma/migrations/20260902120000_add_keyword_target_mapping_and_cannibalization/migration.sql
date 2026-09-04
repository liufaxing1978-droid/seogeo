CREATE TYPE "KeywordCannibalizationRisk" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH');

CREATE TYPE "KeywordCannibalizationAction" AS ENUM (
  'REVIEW',
  'MERGE',
  'REDIRECT',
  'REPOSITION',
  'CANONICAL_REVIEW'
);

CREATE TABLE "KeywordTargetMapping" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "groupId" UUID,
  "targetUrl" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "pageId" UUID,
  "createdByUserId" UUID,
  "updatedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordTargetMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordTargetMapping_exactly_one_subject_check"
    CHECK (("keywordId" IS NOT NULL)::integer + ("groupId" IS NOT NULL)::integer = 1)
);

CREATE UNIQUE INDEX "KeywordTargetMapping_keywordId_key"
  ON "KeywordTargetMapping"("keywordId");

CREATE UNIQUE INDEX "KeywordTargetMapping_groupId_key"
  ON "KeywordTargetMapping"("groupId");

CREATE INDEX "KeywordTargetMapping_projectId_normalizedUrl_idx"
  ON "KeywordTargetMapping"("projectId", "normalizedUrl");

CREATE INDEX "KeywordTargetMapping_projectId_pageId_idx"
  ON "KeywordTargetMapping"("projectId", "pageId");

ALTER TABLE "KeywordTargetMapping"
  ADD CONSTRAINT "KeywordTargetMapping_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordTargetMapping"
  ADD CONSTRAINT "KeywordTargetMapping_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordTargetMapping"
  ADD CONSTRAINT "KeywordTargetMapping_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordTargetMapping"
  ADD CONSTRAINT "KeywordTargetMapping_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "Page"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "KeywordCannibalizationSnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "groupId" UUID,
  "risk" "KeywordCannibalizationRisk" NOT NULL,
  "recommendedAction" "KeywordCannibalizationAction",
  "urls" JSONB NOT NULL,
  "reasons" JSONB NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "formulaVersion" TEXT NOT NULL,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordCannibalizationSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordCannibalizationSnapshot_exactly_one_subject_check"
    CHECK (("keywordId" IS NOT NULL)::integer + ("groupId" IS NOT NULL)::integer = 1),
  CONSTRAINT "KeywordCannibalizationSnapshot_confidence_check"
    CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
);

CREATE INDEX "KeywordCannibalizationSnapshot_projectId_keywordId_createdAt_idx"
  ON "KeywordCannibalizationSnapshot"("projectId", "keywordId", "createdAt");

CREATE INDEX "KeywordCannibalizationSnapshot_projectId_groupId_createdAt_idx"
  ON "KeywordCannibalizationSnapshot"("projectId", "groupId", "createdAt");

ALTER TABLE "KeywordCannibalizationSnapshot"
  ADD CONSTRAINT "KeywordCannibalizationSnapshot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordCannibalizationSnapshot"
  ADD CONSTRAINT "KeywordCannibalizationSnapshot_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordCannibalizationSnapshot"
  ADD CONSTRAINT "KeywordCannibalizationSnapshot_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
