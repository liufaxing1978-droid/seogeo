CREATE TYPE "KeywordContentGapStatus" AS ENUM ('OPEN', 'CONTENT_PLANNED', 'IN_PROGRESS', 'RESOLVED', 'IGNORED');

CREATE TABLE "KeywordContentGap" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "groupId" UUID,
  "coverageStatus" TEXT NOT NULL,
  "status" "KeywordContentGapStatus" NOT NULL DEFAULT 'OPEN',
  "targetUrl" TEXT,
  "reasonCodes" JSONB NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordContentGap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordContentGap_exactly_one_subject_check" CHECK (("keywordId" IS NOT NULL)::integer + ("groupId" IS NOT NULL)::integer = 1)
);
CREATE UNIQUE INDEX "KeywordContentGap_keywordId_key" ON "KeywordContentGap"("keywordId");
CREATE UNIQUE INDEX "KeywordContentGap_groupId_key" ON "KeywordContentGap"("groupId");
CREATE INDEX "KeywordContentGap_projectId_status_idx" ON "KeywordContentGap"("projectId", "status");
ALTER TABLE "KeywordContentGap" ADD CONSTRAINT "KeywordContentGap_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentGap" ADD CONSTRAINT "KeywordContentGap_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordContentGap" ADD CONSTRAINT "KeywordContentGap_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
