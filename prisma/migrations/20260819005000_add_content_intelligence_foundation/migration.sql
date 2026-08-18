CREATE TYPE "ContentSignalStatus" AS ENUM ('PASS', 'FAIL', 'UNKNOWN');
CREATE TYPE "ContentPriority" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ContentOpportunityStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'IGNORED', 'VERIFIED_FIXED');

CREATE TABLE "ContentDocument" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "latestPageSnapshotId" UUID NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT,
  "metaDescription" TEXT,
  "h1" TEXT,
  "language" TEXT,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "paragraphCount" INTEGER NOT NULL DEFAULT 0,
  "headingCount" INTEGER NOT NULL DEFAULT 0,
  "listCount" INTEGER NOT NULL DEFAULT 0,
  "tableCount" INTEGER NOT NULL DEFAULT 0,
  "imageCount" INTEGER NOT NULL DEFAULT 0,
  "internalLinkCount" INTEGER NOT NULL DEFAULT 0,
  "externalLinkCount" INTEGER NOT NULL DEFAULT 0,
  "schemaTypes" JSONB NOT NULL,
  "entityIds" JSONB,
  "contentHash" TEXT NOT NULL,
  "extractedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentSignal" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "contentDocumentId" UUID NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "status" "ContentSignalStatus" NOT NULL,
  "priority" "ContentPriority" NOT NULL,
  "numericValue" DOUBLE PRECISION,
  "textValue" TEXT,
  "sourceReferences" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentOpportunity" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "contentDocumentId" UUID NOT NULL,
  "opportunityKey" TEXT NOT NULL,
  "opportunityVersion" INTEGER NOT NULL,
  "category" TEXT NOT NULL,
  "priority" "ContentPriority" NOT NULL,
  "status" "ContentOpportunityStatus" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL,
  "verifiedFixedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentBrief" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "contentDocumentId" UUID,
  "aiTaskId" UUID NOT NULL,
  "promptVersion" TEXT NOT NULL,
  "factSnapshotHash" TEXT NOT NULL,
  "briefJson" JSONB NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentBrief_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentDocument_projectId_pageId_key" ON "ContentDocument"("projectId", "pageId");
CREATE INDEX "ContentDocument_projectId_extractedAt_idx" ON "ContentDocument"("projectId", "extractedAt");
CREATE INDEX "ContentDocument_latestPageSnapshotId_idx" ON "ContentDocument"("latestPageSnapshotId");
CREATE INDEX "ContentDocument_contentHash_idx" ON "ContentDocument"("contentHash");

CREATE UNIQUE INDEX "ContentSignal_contentDocumentId_ruleKey_ruleVersion_key" ON "ContentSignal"("contentDocumentId", "ruleKey", "ruleVersion");
CREATE INDEX "ContentSignal_projectId_status_idx" ON "ContentSignal"("projectId", "status");
CREATE INDEX "ContentSignal_projectId_ruleKey_idx" ON "ContentSignal"("projectId", "ruleKey");

CREATE UNIQUE INDEX "ContentOpportunity_contentDocumentId_opportunityKey_opportunityVersion_key" ON "ContentOpportunity"("contentDocumentId", "opportunityKey", "opportunityVersion");
CREATE INDEX "ContentOpportunity_projectId_status_idx" ON "ContentOpportunity"("projectId", "status");
CREATE INDEX "ContentOpportunity_projectId_priority_idx" ON "ContentOpportunity"("projectId", "priority");
CREATE INDEX "ContentOpportunity_projectId_category_idx" ON "ContentOpportunity"("projectId", "category");

CREATE UNIQUE INDEX "ContentBrief_aiTaskId_key" ON "ContentBrief"("aiTaskId");
CREATE INDEX "ContentBrief_projectId_createdAt_idx" ON "ContentBrief"("projectId", "createdAt");
CREATE INDEX "ContentBrief_contentDocumentId_createdAt_idx" ON "ContentBrief"("contentDocumentId", "createdAt");

ALTER TABLE "ContentDocument"
  ADD CONSTRAINT "ContentDocument_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDocument"
  ADD CONSTRAINT "ContentDocument_pageId_fkey"
  FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDocument"
  ADD CONSTRAINT "ContentDocument_latestPageSnapshotId_fkey"
  FOREIGN KEY ("latestPageSnapshotId") REFERENCES "PageSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContentSignal"
  ADD CONSTRAINT "ContentSignal_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentSignal"
  ADD CONSTRAINT "ContentSignal_contentDocumentId_fkey"
  FOREIGN KEY ("contentDocumentId") REFERENCES "ContentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentOpportunity"
  ADD CONSTRAINT "ContentOpportunity_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentOpportunity"
  ADD CONSTRAINT "ContentOpportunity_contentDocumentId_fkey"
  FOREIGN KEY ("contentDocumentId") REFERENCES "ContentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContentBrief"
  ADD CONSTRAINT "ContentBrief_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentBrief"
  ADD CONSTRAINT "ContentBrief_contentDocumentId_fkey"
  FOREIGN KEY ("contentDocumentId") REFERENCES "ContentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentBrief"
  ADD CONSTRAINT "ContentBrief_aiTaskId_fkey"
  FOREIGN KEY ("aiTaskId") REFERENCES "AiTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
