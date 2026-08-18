CREATE TYPE "CrawlRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CrawlRunType" AS ENUM ('FULL', 'INCREMENTAL', 'MANUAL', 'SCHEDULED', 'SINGLE_PAGE');
CREATE TYPE "FetchMethod" AS ENUM ('HTTP', 'BROWSER');
CREATE TYPE "SitemapType" AS ENUM ('INDEX', 'URLSET');

CREATE TABLE "CrawlRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "runType" "CrawlRunType" NOT NULL,
  "status" "CrawlRunStatus" NOT NULL DEFAULT 'QUEUED',
  "seedUrl" TEXT NOT NULL,
  "maxPages" INTEGER NOT NULL DEFAULT 500,
  "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
  "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
  "pagesSucceeded" INTEGER NOT NULL DEFAULT 0,
  "pagesFailed" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "crawlerVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrawlRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Page" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "pageType" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageSnapshot" (
  "id" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "crawlRunId" UUID NOT NULL,
  "finalUrl" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "contentType" TEXT,
  "title" TEXT,
  "metaDescription" TEXT,
  "canonicalUrl" TEXT,
  "metaRobots" TEXT,
  "h1" TEXT,
  "h1Count" INTEGER NOT NULL DEFAULT 0,
  "h2Count" INTEGER NOT NULL DEFAULT 0,
  "h3Count" INTEGER NOT NULL DEFAULT 0,
  "wordCount" INTEGER NOT NULL DEFAULT 0,
  "language" TEXT,
  "internalLinksCount" INTEGER NOT NULL DEFAULT 0,
  "externalLinksCount" INTEGER NOT NULL DEFAULT 0,
  "imagesCount" INTEGER NOT NULL DEFAULT 0,
  "imagesWithoutAlt" INTEGER NOT NULL DEFAULT 0,
  "schemaCount" INTEGER NOT NULL DEFAULT 0,
  "htmlHash" TEXT,
  "contentHash" TEXT,
  "responseTimeMs" INTEGER,
  "htmlSizeBytes" INTEGER,
  "rendered" BOOLEAN NOT NULL DEFAULT false,
  "indexable" BOOLEAN NOT NULL DEFAULT true,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "parserVersion" TEXT NOT NULL,
  CONSTRAINT "PageSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HttpResult" (
  "id" UUID NOT NULL,
  "pageSnapshotId" UUID NOT NULL,
  "requestUrl" TEXT NOT NULL,
  "finalUrl" TEXT NOT NULL,
  "statusCode" INTEGER,
  "fetchMethod" "FetchMethod" NOT NULL DEFAULT 'HTTP',
  "redirectChain" JSONB,
  "headers" JSONB,
  "responseBytes" INTEGER,
  "latencyMs" INTEGER,
  "fetchError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HttpResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RenderResult" (
  "id" UUID NOT NULL,
  "pageSnapshotId" UUID NOT NULL,
  "attempted" BOOLEAN NOT NULL DEFAULT false,
  "succeeded" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "renderTimeMs" INTEGER,
  "browserVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RenderResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RobotsResult" (
  "id" UUID NOT NULL,
  "crawlRunId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "statusCode" INTEGER,
  "contentHash" TEXT,
  "rawText" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "parseError" TEXT,
  CONSTRAINT "RobotsResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SitemapSource" (
  "id" UUID NOT NULL,
  "crawlRunId" UUID NOT NULL,
  "url" TEXT NOT NULL,
  "statusCode" INTEGER,
  "type" "SitemapType",
  "parseError" TEXT,
  "discoveredUrlCount" INTEGER NOT NULL DEFAULT 0,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SitemapSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SitemapUrl" (
  "id" UUID NOT NULL,
  "sitemapSourceId" UUID NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "lastmod" TIMESTAMP(3),
  "changefreq" TEXT,
  "priority" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SitemapUrl_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CrawlRun_projectId_createdAt_idx" ON "CrawlRun"("projectId", "createdAt");
CREATE INDEX "CrawlRun_projectId_status_idx" ON "CrawlRun"("projectId", "status");
CREATE UNIQUE INDEX "Page_projectId_normalizedUrl_key" ON "Page"("projectId", "normalizedUrl");
CREATE INDEX "Page_projectId_host_idx" ON "Page"("projectId", "host");
CREATE INDEX "Page_projectId_isActive_idx" ON "Page"("projectId", "isActive");
CREATE INDEX "PageSnapshot_pageId_capturedAt_idx" ON "PageSnapshot"("pageId", "capturedAt");
CREATE INDEX "PageSnapshot_crawlRunId_idx" ON "PageSnapshot"("crawlRunId");
CREATE INDEX "PageSnapshot_statusCode_idx" ON "PageSnapshot"("statusCode");
CREATE UNIQUE INDEX "HttpResult_pageSnapshotId_key" ON "HttpResult"("pageSnapshotId");
CREATE UNIQUE INDEX "RenderResult_pageSnapshotId_key" ON "RenderResult"("pageSnapshotId");
CREATE INDEX "RobotsResult_crawlRunId_fetchedAt_idx" ON "RobotsResult"("crawlRunId", "fetchedAt");
CREATE INDEX "SitemapSource_crawlRunId_fetchedAt_idx" ON "SitemapSource"("crawlRunId", "fetchedAt");
CREATE UNIQUE INDEX "SitemapUrl_sitemapSourceId_normalizedUrl_key" ON "SitemapUrl"("sitemapSourceId", "normalizedUrl");
CREATE INDEX "SitemapUrl_normalizedUrl_idx" ON "SitemapUrl"("normalizedUrl");

ALTER TABLE "CrawlRun" ADD CONSTRAINT "CrawlRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Page" ADD CONSTRAINT "Page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageSnapshot" ADD CONSTRAINT "PageSnapshot_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HttpResult" ADD CONSTRAINT "HttpResult_pageSnapshotId_fkey" FOREIGN KEY ("pageSnapshotId") REFERENCES "PageSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RenderResult" ADD CONSTRAINT "RenderResult_pageSnapshotId_fkey" FOREIGN KEY ("pageSnapshotId") REFERENCES "PageSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RobotsResult" ADD CONSTRAINT "RobotsResult_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitemapSource" ADD CONSTRAINT "SitemapSource_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitemapUrl" ADD CONSTRAINT "SitemapUrl_sitemapSourceId_fkey" FOREIGN KEY ("sitemapSourceId") REFERENCES "SitemapSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
