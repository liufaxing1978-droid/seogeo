CREATE TYPE "GeoAuditRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "GeoDimension" AS ENUM ('CITABILITY', 'ENTITY', 'BRAND', 'AI_CRAWLER', 'CONTENT_GEO');
CREATE TYPE "GeoPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "GeoRuleOutcome" AS ENUM ('PASS', 'FAIL', 'UNKNOWN');
CREATE TYPE "EntityType" AS ENUM ('ORGANIZATION', 'PERSON', 'PRODUCT', 'SERVICE', 'PLACE', 'TOPIC', 'OTHER');
CREATE TYPE "EntityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "EntityObservationSource" AS ENUM ('SCHEMA', 'HTML_META', 'OPEN_GRAPH', 'TITLE', 'HEADING', 'INTERNAL_LINK', 'PROJECT_CONFIG');
CREATE TYPE "PageEntityRole" AS ENUM ('PRIMARY', 'MENTIONED', 'AUTHOR', 'PUBLISHER', 'ABOUT');
CREATE TYPE "AiCrawlerReadinessStatus" AS ENUM ('PASS', 'FAIL', 'UNKNOWN');

CREATE TABLE "GeoAuditRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "crawlRunId" UUID NOT NULL,
  "status" "GeoAuditRunStatus" NOT NULL DEFAULT 'QUEUED',
  "eligiblePages" INTEGER NOT NULL DEFAULT 0,
  "rulesEvaluated" INTEGER NOT NULL DEFAULT 0,
  "engineVersion" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeoAuditRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoRule" (
  "id" UUID NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeoRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoRuleVersion" (
  "id" UUID NOT NULL,
  "geoRuleId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "dimension" "GeoDimension" NOT NULL,
  "severity" "GeoPriority" NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "detectionType" TEXT NOT NULL,
  "detectionConfig" JSONB,
  "geoImpact" TEXT NOT NULL,
  "fixGuide" TEXT NOT NULL,
  "releasedAt" TIMESTAMP(3) NOT NULL,
  "deprecatedAt" TIMESTAMP(3),
  CONSTRAINT "GeoRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Entity" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "entityType" "EntityType" NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "description" TEXT,
  "officialUrl" TEXT,
  "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoRuleResult" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "pageId" UUID,
  "entityId" UUID,
  "ruleVersionId" UUID NOT NULL,
  "resultKey" TEXT NOT NULL,
  "outcome" "GeoRuleOutcome" NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeoRuleResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CitabilityResult" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "pageId" UUID NOT NULL,
  "answerFirstScore" DOUBLE PRECISION NOT NULL,
  "headingStructureScore" DOUBLE PRECISION NOT NULL,
  "factualDensityScore" DOUBLE PRECISION NOT NULL,
  "sourceSupportScore" DOUBLE PRECISION NOT NULL,
  "extractabilityScore" DOUBLE PRECISION NOT NULL,
  "definitionClarityScore" DOUBLE PRECISION NOT NULL,
  "overallScore" DOUBLE PRECISION NOT NULL,
  "evidence" JSONB,
  "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CitabilityResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityAlias" (
  "id" UUID NOT NULL,
  "entityId" UUID NOT NULL,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityRelation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceEntityId" UUID NOT NULL,
  "relationType" TEXT NOT NULL,
  "targetEntityId" UUID NOT NULL,
  "sourcePageId" UUID,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityObservation" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "entityId" UUID NOT NULL,
  "pageId" UUID,
  "sourceType" "EntityObservationSource" NOT NULL,
  "property" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EntityObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PageEntity" (
  "pageId" UUID NOT NULL,
  "entityId" UUID NOT NULL,
  "role" "PageEntityRole" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "sourceType" TEXT NOT NULL,
  CONSTRAINT "PageEntity_pkey" PRIMARY KEY ("pageId", "entityId", "role", "sourceType")
);

CREATE TABLE "AiCrawlerResult" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "crawlerCode" TEXT NOT NULL,
  "robotsAllowed" BOOLEAN,
  "metaRobotsAllowed" BOOLEAN,
  "xRobotsAllowed" BOOLEAN,
  "reachable" BOOLEAN,
  "status" "AiCrawlerReadinessStatus" NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCrawlerResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BrandAuthorityResult" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "officialIdentityPresent" BOOLEAN NOT NULL,
  "organizationSchemaPresent" BOOLEAN NOT NULL,
  "sameAsCount" INTEGER NOT NULL DEFAULT 0,
  "publisherConsistency" DOUBLE PRECISION NOT NULL,
  "contactIdentityConsistency" DOUBLE PRECISION NOT NULL,
  "aboutPagePresent" BOOLEAN NOT NULL,
  "overallScore" DOUBLE PRECISION NOT NULL,
  "evidence" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandAuthorityResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoScore" (
  "id" UUID NOT NULL,
  "geoAuditRunId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "scoreType" TEXT NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "previousScore" DOUBLE PRECISION,
  "change" DOUBLE PRECISION,
  "formulaVersion" TEXT NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "engineVersion" TEXT NOT NULL,
  CONSTRAINT "GeoScore_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeoScoreComponent" (
  "id" UUID NOT NULL,
  "geoScoreId" UUID NOT NULL,
  "componentCode" TEXT NOT NULL,
  "componentName" TEXT NOT NULL,
  "rawScore" DOUBLE PRECISION NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL,
  "weightedScore" DOUBLE PRECISION NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceReference" TEXT,
  CONSTRAINT "GeoScoreComponent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeoAuditRun_projectId_createdAt_idx" ON "GeoAuditRun"("projectId", "createdAt");
CREATE INDEX "GeoAuditRun_projectId_status_idx" ON "GeoAuditRun"("projectId", "status");
CREATE INDEX "GeoAuditRun_crawlRunId_idx" ON "GeoAuditRun"("crawlRunId");

CREATE UNIQUE INDEX "GeoRule_ruleCode_key" ON "GeoRule"("ruleCode");
CREATE UNIQUE INDEX "GeoRuleVersion_geoRuleId_version_key" ON "GeoRuleVersion"("geoRuleId", "version");
CREATE INDEX "GeoRuleVersion_dimension_idx" ON "GeoRuleVersion"("dimension");
CREATE INDEX "GeoRuleVersion_severity_idx" ON "GeoRuleVersion"("severity");

CREATE UNIQUE INDEX "Entity_projectId_entityType_normalizedName_key" ON "Entity"("projectId", "entityType", "normalizedName");
CREATE INDEX "Entity_projectId_status_idx" ON "Entity"("projectId", "status");
CREATE INDEX "Entity_normalizedName_idx" ON "Entity"("normalizedName");

CREATE UNIQUE INDEX "GeoRuleResult_geoAuditRunId_ruleVersionId_resultKey_key" ON "GeoRuleResult"("geoAuditRunId", "ruleVersionId", "resultKey");
CREATE INDEX "GeoRuleResult_geoAuditRunId_outcome_idx" ON "GeoRuleResult"("geoAuditRunId", "outcome");
CREATE INDEX "GeoRuleResult_pageId_idx" ON "GeoRuleResult"("pageId");
CREATE INDEX "GeoRuleResult_entityId_idx" ON "GeoRuleResult"("entityId");

CREATE UNIQUE INDEX "CitabilityResult_geoAuditRunId_pageId_key" ON "CitabilityResult"("geoAuditRunId", "pageId");
CREATE INDEX "CitabilityResult_pageId_createdAt_idx" ON "CitabilityResult"("pageId", "createdAt");

CREATE UNIQUE INDEX "EntityAlias_entityId_normalizedAlias_key" ON "EntityAlias"("entityId", "normalizedAlias");
CREATE INDEX "EntityAlias_normalizedAlias_idx" ON "EntityAlias"("normalizedAlias");

CREATE INDEX "EntityRelation_projectId_relationType_idx" ON "EntityRelation"("projectId", "relationType");
CREATE INDEX "EntityRelation_sourceEntityId_idx" ON "EntityRelation"("sourceEntityId");
CREATE INDEX "EntityRelation_targetEntityId_idx" ON "EntityRelation"("targetEntityId");

CREATE INDEX "EntityObservation_geoAuditRunId_sourceType_idx" ON "EntityObservation"("geoAuditRunId", "sourceType");
CREATE INDEX "EntityObservation_entityId_idx" ON "EntityObservation"("entityId");
CREATE INDEX "EntityObservation_pageId_idx" ON "EntityObservation"("pageId");

CREATE INDEX "PageEntity_entityId_idx" ON "PageEntity"("entityId");

CREATE UNIQUE INDEX "AiCrawlerResult_geoAuditRunId_crawlerCode_key" ON "AiCrawlerResult"("geoAuditRunId", "crawlerCode");
CREATE INDEX "AiCrawlerResult_crawlerCode_status_idx" ON "AiCrawlerResult"("crawlerCode", "status");

CREATE UNIQUE INDEX "BrandAuthorityResult_geoAuditRunId_key" ON "BrandAuthorityResult"("geoAuditRunId");

CREATE UNIQUE INDEX "GeoScore_geoAuditRunId_key" ON "GeoScore"("geoAuditRunId");
CREATE INDEX "GeoScore_projectId_calculatedAt_idx" ON "GeoScore"("projectId", "calculatedAt");
CREATE INDEX "GeoScore_projectId_scoreType_idx" ON "GeoScore"("projectId", "scoreType");
CREATE UNIQUE INDEX "GeoScoreComponent_geoScoreId_componentCode_key" ON "GeoScoreComponent"("geoScoreId", "componentCode");

ALTER TABLE "GeoAuditRun" ADD CONSTRAINT "GeoAuditRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoAuditRun" ADD CONSTRAINT "GeoAuditRun_crawlRunId_fkey" FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoRuleVersion" ADD CONSTRAINT "GeoRuleVersion_geoRuleId_fkey" FOREIGN KEY ("geoRuleId") REFERENCES "GeoRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoRuleResult" ADD CONSTRAINT "GeoRuleResult_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoRuleResult" ADD CONSTRAINT "GeoRuleResult_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoRuleResult" ADD CONSTRAINT "GeoRuleResult_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GeoRuleResult" ADD CONSTRAINT "GeoRuleResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "GeoRuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CitabilityResult" ADD CONSTRAINT "CitabilityResult_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitabilityResult" ADD CONSTRAINT "CitabilityResult_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityAlias" ADD CONSTRAINT "EntityAlias_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_sourceEntityId_fkey" FOREIGN KEY ("sourceEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_targetEntityId_fkey" FOREIGN KEY ("targetEntityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntityRelation" ADD CONSTRAINT "EntityRelation_sourcePageId_fkey" FOREIGN KEY ("sourcePageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EntityObservation" ADD CONSTRAINT "EntityObservation_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityObservation" ADD CONSTRAINT "EntityObservation_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntityObservation" ADD CONSTRAINT "EntityObservation_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PageEntity" ADD CONSTRAINT "PageEntity_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PageEntity" ADD CONSTRAINT "PageEntity_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AiCrawlerResult" ADD CONSTRAINT "AiCrawlerResult_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BrandAuthorityResult" ADD CONSTRAINT "BrandAuthorityResult_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoScore" ADD CONSTRAINT "GeoScore_geoAuditRunId_fkey" FOREIGN KEY ("geoAuditRunId") REFERENCES "GeoAuditRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeoScore" ADD CONSTRAINT "GeoScore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeoScoreComponent" ADD CONSTRAINT "GeoScoreComponent_geoScoreId_fkey" FOREIGN KEY ("geoScoreId") REFERENCES "GeoScore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
