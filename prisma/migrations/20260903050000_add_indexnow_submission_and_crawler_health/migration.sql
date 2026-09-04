CREATE TYPE "IndexNowSubmissionStatus" AS ENUM ('PENDING', 'QUEUED', 'COMPLETED', 'FAILED');
CREATE TYPE "CrawlerHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN');

CREATE TABLE "IndexNowSubmissionBatch" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "status" "IndexNowSubmissionStatus" NOT NULL DEFAULT 'PENDING', "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT, "errorMessage" TEXT, "createdByUserId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndexNowSubmissionBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "IndexNowSubmissionUrl" (
  "id" UUID NOT NULL, "batchId" UUID NOT NULL, "url" TEXT NOT NULL, "status" "IndexNowSubmissionStatus" NOT NULL DEFAULT 'PENDING', "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IndexNowSubmissionUrl_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "CrawlerHealthSnapshot" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "crawlRunId" UUID NOT NULL, "status" "CrawlerHealthStatus" NOT NULL, "calculationVersion" TEXT NOT NULL,
  "factsSnapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrawlerHealthSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IndexNowSubmissionUrl_batchId_url_key" ON "IndexNowSubmissionUrl"("batchId", "url");
CREATE INDEX "IndexNowSubmissionBatch_projectId_status_createdAt_idx" ON "IndexNowSubmissionBatch"("projectId", "status", "createdAt");
CREATE INDEX "IndexNowSubmissionUrl_status_createdAt_idx" ON "IndexNowSubmissionUrl"("status", "createdAt");
CREATE UNIQUE INDEX "CrawlerHealthSnapshot_crawlRunId_calculationVersion_key" ON "CrawlerHealthSnapshot"("crawlRunId", "calculationVersion");
CREATE INDEX "CrawlerHealthSnapshot_projectId_createdAt_idx" ON "CrawlerHealthSnapshot"("projectId", "createdAt");
ALTER TABLE "IndexNowSubmissionBatch" ADD CONSTRAINT "IndexNowSubmissionBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IndexNowSubmissionUrl" ADD CONSTRAINT "IndexNowSubmissionUrl_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "IndexNowSubmissionBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlerHealthSnapshot" ADD CONSTRAINT "CrawlerHealthSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrawlerHealthSnapshot" ADD CONSTRAINT "CrawlerHealthSnapshot_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
