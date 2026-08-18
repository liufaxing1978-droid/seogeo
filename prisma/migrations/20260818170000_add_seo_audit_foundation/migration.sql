CREATE TYPE "SeoAuditRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "SeoSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "SeoRuleOutcome" AS ENUM ('PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE');
CREATE TYPE "SeoIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'PARTIALLY_FIXED', 'RESOLVED', 'IGNORED', 'REGRESSED');
CREATE TYPE "SeoIssueComparison" AS ENUM ('NEW', 'PERSISTENT', 'REGRESSED');

CREATE TABLE "SeoAuditRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "crawlRunId" UUID NOT NULL,
  "status" "SeoAuditRunStatus" NOT NULL DEFAULT 'QUEUED',
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "engineVersion" TEXT NOT NULL,
  "eligiblePages" INTEGER NOT NULL DEFAULT 0,
  "rulesEvaluated" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeoAuditRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRule" (
  "id" UUID NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeoRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRuleVersion" (
  "id" UUID NOT NULL,
  "seoRuleId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "severity" "SeoSeverity" NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "detectionType" TEXT NOT NULL,
  "detectionConfig" JSONB,
  "seoImpact" TEXT NOT NULL,
  "fixGuide" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3) NOT NULL,
  "deprecatedAt" TIMESTAMP(3),
  CONSTRAINT "SeoRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoRuleResult" (
  "id" UUID NOT NULL,
  "auditRunId" UUID NOT NULL,
  "pageId" UUID,
  "ruleVersionId" UUID NOT NULL,
  "resultKey" TEXT NOT NULL,
  "outcome" "SeoRuleOutcome" NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoRuleResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoIssue" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "ruleId" UUID NOT NULL,
  "issueKey" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "currentSeverity" "SeoSeverity" NOT NULL,
  "status" "SeoIssueStatus" NOT NULL DEFAULT 'OPEN',
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3),
  "ignoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeoIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoIssueOccurrence" (
  "id" UUID NOT NULL,
  "seoIssueId" UUID NOT NULL,
  "auditRunId" UUID NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  "comparison" "SeoIssueComparison" NOT NULL,
  "severity" "SeoSeverity" NOT NULL,
  "affectedPagesCount" INTEGER NOT NULL,
  "evidenceSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SeoIssueOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoIssuePage" (
  "id" UUID NOT NULL,
  "issueOccurrenceId" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "ruleResultId" UUID NOT NULL,
  "evidence" JSONB,
  CONSTRAINT "SeoIssuePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoScore" (
  "id" UUID NOT NULL,
  "auditRunId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "previousScore" DOUBLE PRECISION,
  "change" DOUBLE PRECISION,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "engineVersion" TEXT NOT NULL,
  CONSTRAINT "SeoScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SeoScoreComponent" (
  "id" UUID NOT NULL,
  "seoScoreId" UUID NOT NULL,
  "componentCode" TEXT NOT NULL,
  "componentName" TEXT NOT NULL,
  "affectedPages" INTEGER NOT NULL,
  "eligiblePages" INTEGER NOT NULL,
  "pageImpactFactor" DOUBLE PRECISION NOT NULL,
  "severityMultiplier" DOUBLE PRECISION NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "importanceFactor" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "penalty" DOUBLE PRECISION NOT NULL,
  "ruleVersionId" UUID NOT NULL,
  CONSTRAINT "SeoScoreComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SeoAuditRun_projectId_crawlRunId_key" ON "SeoAuditRun"("projectId", "crawlRunId");
CREATE INDEX "SeoAuditRun_projectId_createdAt_idx" ON "SeoAuditRun"("projectId", "createdAt");
CREATE INDEX "SeoAuditRun_projectId_status_idx" ON "SeoAuditRun"("projectId", "status");

CREATE UNIQUE INDEX "SeoRule_ruleCode_key" ON "SeoRule"("ruleCode");
CREATE UNIQUE INDEX "SeoRuleVersion_seoRuleId_version_key" ON "SeoRuleVersion"("seoRuleId", "version");
CREATE INDEX "SeoRuleVersion_severity_idx" ON "SeoRuleVersion"("severity");

CREATE UNIQUE INDEX "SeoRuleResult_auditRunId_resultKey_ruleVersionId_key" ON "SeoRuleResult"("auditRunId", "resultKey", "ruleVersionId");
CREATE INDEX "SeoRuleResult_auditRunId_outcome_idx" ON "SeoRuleResult"("auditRunId", "outcome");
CREATE INDEX "SeoRuleResult_pageId_idx" ON "SeoRuleResult"("pageId");

CREATE UNIQUE INDEX "SeoIssue_projectId_issueKey_key" ON "SeoIssue"("projectId", "issueKey");
CREATE INDEX "SeoIssue_projectId_status_idx" ON "SeoIssue"("projectId", "status");
CREATE INDEX "SeoIssue_projectId_currentSeverity_idx" ON "SeoIssue"("projectId", "currentSeverity");

CREATE UNIQUE INDEX "SeoIssueOccurrence_seoIssueId_auditRunId_key" ON "SeoIssueOccurrence"("seoIssueId", "auditRunId");
CREATE INDEX "SeoIssueOccurrence_auditRunId_comparison_idx" ON "SeoIssueOccurrence"("auditRunId", "comparison");

CREATE UNIQUE INDEX "SeoIssuePage_issueOccurrenceId_pageId_key" ON "SeoIssuePage"("issueOccurrenceId", "pageId");
CREATE INDEX "SeoIssuePage_pageId_idx" ON "SeoIssuePage"("pageId");

CREATE UNIQUE INDEX "SeoScore_auditRunId_key" ON "SeoScore"("auditRunId");
CREATE INDEX "SeoScore_projectId_calculatedAt_idx" ON "SeoScore"("projectId", "calculatedAt");
CREATE UNIQUE INDEX "SeoScoreComponent_seoScoreId_ruleVersionId_key" ON "SeoScoreComponent"("seoScoreId", "ruleVersionId");

ALTER TABLE "SeoAuditRun" ADD CONSTRAINT "SeoAuditRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoAuditRun" ADD CONSTRAINT "SeoAuditRun_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoRuleVersion" ADD CONSTRAINT "SeoRuleVersion_seoRuleId_fkey" FOREIGN KEY ("seoRuleId") REFERENCES "SeoRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeoRuleResult" ADD CONSTRAINT "SeoRuleResult_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "SeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRuleResult" ADD CONSTRAINT "SeoRuleResult_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoRuleResult" ADD CONSTRAINT "SeoRuleResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "SeoRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeoIssue" ADD CONSTRAINT "SeoIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssue" ADD CONSTRAINT "SeoIssue_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "SeoRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeoIssueOccurrence" ADD CONSTRAINT "SeoIssueOccurrence_seoIssueId_fkey" FOREIGN KEY ("seoIssueId") REFERENCES "SeoIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssueOccurrence" ADD CONSTRAINT "SeoIssueOccurrence_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "SeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssueOccurrence" ADD CONSTRAINT "SeoIssueOccurrence_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "SeoRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SeoIssuePage" ADD CONSTRAINT "SeoIssuePage_issueOccurrenceId_fkey" FOREIGN KEY ("issueOccurrenceId") REFERENCES "SeoIssueOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssuePage" ADD CONSTRAINT "SeoIssuePage_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoIssuePage" ADD CONSTRAINT "SeoIssuePage_ruleResultId_fkey" FOREIGN KEY ("ruleResultId") REFERENCES "SeoRuleResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoScore" ADD CONSTRAINT "SeoScore_auditRunId_fkey" FOREIGN KEY ("auditRunId") REFERENCES "SeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoScore" ADD CONSTRAINT "SeoScore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SeoScoreComponent" ADD CONSTRAINT "SeoScoreComponent_seoScoreId_fkey" FOREIGN KEY ("seoScoreId") REFERENCES "SeoScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeoScoreComponent" ADD CONSTRAINT "SeoScoreComponent_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "SeoRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
