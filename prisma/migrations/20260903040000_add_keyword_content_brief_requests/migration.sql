CREATE TYPE "KeywordContentBriefRequestStatus" AS ENUM ('PENDING', 'QUEUED', 'COMPLETED', 'FAILED');

CREATE TABLE "KeywordContentBriefRequest" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "groupId" UUID,
  "contentGapId" UUID,
  "aiTaskId" UUID,
  "contentBriefId" UUID,
  "snapshotHash" TEXT NOT NULL,
  "factsSnapshot" JSONB NOT NULL,
  "status" "KeywordContentBriefRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordContentBriefRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordContentBriefRequest_exactly_one_source_check" CHECK (
    ("contentGapId" IS NOT NULL AND "keywordId" IS NOT NULL AND "groupId" IS NULL)
    OR ("contentGapId" IS NULL AND "keywordId" IS NULL AND "groupId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "KeywordContentBriefRequest_aiTaskId_key" ON "KeywordContentBriefRequest"("aiTaskId");
CREATE UNIQUE INDEX "KeywordContentBriefRequest_contentBriefId_key" ON "KeywordContentBriefRequest"("contentBriefId");
CREATE UNIQUE INDEX "KeywordContentBriefRequest_contentGapId_snapshotHash_key" ON "KeywordContentBriefRequest"("contentGapId", "snapshotHash");
CREATE UNIQUE INDEX "KeywordContentBriefRequest_groupId_snapshotHash_key" ON "KeywordContentBriefRequest"("groupId", "snapshotHash");
CREATE INDEX "KeywordContentBriefRequest_projectId_status_createdAt_idx" ON "KeywordContentBriefRequest"("projectId", "status", "createdAt");
CREATE INDEX "KeywordContentBriefRequest_projectId_keywordId_idx" ON "KeywordContentBriefRequest"("projectId", "keywordId");
CREATE INDEX "KeywordContentBriefRequest_projectId_groupId_idx" ON "KeywordContentBriefRequest"("projectId", "groupId");

ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_contentGapId_fkey" FOREIGN KEY ("contentGapId") REFERENCES "KeywordContentGap"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_aiTaskId_fkey" FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KeywordContentBriefRequest" ADD CONSTRAINT "KeywordContentBriefRequest_contentBriefId_fkey" FOREIGN KEY ("contentBriefId") REFERENCES "ContentBrief"("id") ON DELETE SET NULL ON UPDATE CASCADE;
