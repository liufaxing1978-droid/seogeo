CREATE TYPE "CompetitorStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "CompetitorCrawlStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "Competitor" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "status" "CompetitorStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorCrawl" (
  "id" UUID NOT NULL,
  "competitorId" UUID NOT NULL,
  "status" "CompetitorCrawlStatus" NOT NULL DEFAULT 'QUEUED',
  "seedUrl" TEXT NOT NULL,
  "maxPages" INTEGER NOT NULL DEFAULT 25,
  "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "crawlerVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompetitorCrawl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorPageSnapshot" (
  "id" UUID NOT NULL,
  "competitorCrawlId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "finalUrl" TEXT,
  "statusCode" INTEGER,
  "fetchError" TEXT,
  "title" TEXT,
  "metaDescription" TEXT,
  "canonicalUrl" TEXT,
  "h1" TEXT,
  "wordCount" INTEGER,
  "headingCount" INTEGER,
  "internalLinkCount" INTEGER,
  "externalLinkCount" INTEGER,
  "imageCount" INTEGER,
  "schemaCount" INTEGER,
  "indexable" BOOLEAN,
  "contentHash" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetitorPageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompetitorComparison" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "competitorId" UUID NOT NULL,
  "competitorCrawlId" UUID NOT NULL,
  "comparisonVersion" TEXT NOT NULL,
  "ownedMetrics" JSONB NOT NULL,
  "competitorMetrics" JSONB NOT NULL,
  "gaps" JSONB NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetitorComparison_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Competitor_projectId_domain_key" ON "Competitor"("projectId", "domain");
CREATE INDEX "Competitor_projectId_status_idx" ON "Competitor"("projectId", "status");
CREATE INDEX "CompetitorCrawl_competitorId_createdAt_idx" ON "CompetitorCrawl"("competitorId", "createdAt");
CREATE INDEX "CompetitorCrawl_competitorId_status_idx" ON "CompetitorCrawl"("competitorId", "status");
CREATE UNIQUE INDEX "CompetitorPageSnapshot_competitorCrawlId_normalizedUrl_key" ON "CompetitorPageSnapshot"("competitorCrawlId", "normalizedUrl");
CREATE INDEX "CompetitorPageSnapshot_competitorCrawlId_statusCode_idx" ON "CompetitorPageSnapshot"("competitorCrawlId", "statusCode");
CREATE UNIQUE INDEX "CompetitorComparison_projectId_competitorCrawlId_comparisonVersion_key" ON "CompetitorComparison"("projectId", "competitorCrawlId", "comparisonVersion");
CREATE INDEX "CompetitorComparison_projectId_createdAt_idx" ON "CompetitorComparison"("projectId", "createdAt");
CREATE INDEX "CompetitorComparison_competitorId_createdAt_idx" ON "CompetitorComparison"("competitorId", "createdAt");

ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorCrawl" ADD CONSTRAINT "CompetitorCrawl_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorPageSnapshot" ADD CONSTRAINT "CompetitorPageSnapshot_competitorCrawlId_fkey" FOREIGN KEY ("competitorCrawlId") REFERENCES "CompetitorCrawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorComparison" ADD CONSTRAINT "CompetitorComparison_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorComparison" ADD CONSTRAINT "CompetitorComparison_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompetitorComparison" ADD CONSTRAINT "CompetitorComparison_competitorCrawlId_fkey" FOREIGN KEY ("competitorCrawlId") REFERENCES "CompetitorCrawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;
