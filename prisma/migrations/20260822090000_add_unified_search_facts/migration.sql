CREATE TYPE "SearchFactProvider" AS ENUM (
  'GOOGLE_SEARCH_CONSOLE',
  'BING_WEBMASTER',
  'BAIDU_SEARCH_RESOURCE',
  'QIHOO_360_WEBMASTER',
  'SOGOU_WEBMASTER',
  'SHENMA_WEBMASTER'
);

CREATE TYPE "SearchFactSnapshotStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "SearchFactKind" AS ENUM ('QUERY_PAGE', 'QUERY', 'PAGE', 'SITE');
CREATE TYPE "SearchFactMetricSemantic" AS ENUM (
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION',
  'BING_AVG_CLICK_POSITION',
  'BING_AVG_IMPRESSION_POSITION'
);
CREATE TYPE "SearchFactEvidenceState" AS ENUM ('KNOWN_PRESENT', 'KNOWN_EMPTY', 'UNKNOWN', 'NOT_SUPPORTED');
CREATE TYPE "SearchFactCompleteness" AS ENUM ('COMPLETE', 'TOP_ROWS_ONLY', 'PROVIDER_UNSPECIFIED', 'UNKNOWN');
CREATE TYPE "SearchFactSourceKind" AS ENUM ('GSC_DAILY_SNAPSHOT', 'PROVIDER_OBSERVATION_BATCH');

CREATE TABLE "SearchProviderObservationBatch" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "provider" "SearchFactProvider" NOT NULL,
  "marketCode" "MarketCode" NOT NULL,
  "locale" TEXT NOT NULL,
  "propertyRef" TEXT NOT NULL,
  "propertyType" TEXT NOT NULL,
  "sourceCutoffAt" TIMESTAMP(3) NOT NULL,
  "sourceCompleteness" "SearchFactCompleteness" NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "observationCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchProviderObservationBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchProviderObservationRecord" (
  "id" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceDate" DATE NOT NULL,
  "observationKind" TEXT NOT NULL,
  "observationKey" TEXT NOT NULL,
  "completeness" "SearchFactCompleteness" NOT NULL,
  "inputHash" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchProviderObservationRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchFactSnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "provider" "SearchFactProvider" NOT NULL,
  "marketCode" "MarketCode" NOT NULL,
  "locale" TEXT NOT NULL,
  "propertyRef" TEXT NOT NULL,
  "propertyType" TEXT NOT NULL,
  "sourceKind" "SearchFactSourceKind" NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "sourceCutoffAt" TIMESTAMP(3) NOT NULL,
  "sourceCompleteness" "SearchFactCompleteness" NOT NULL,
  "normalizationVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "status" "SearchFactSnapshotStatus" NOT NULL DEFAULT 'PENDING',
  "factCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchFactSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchFact" (
  "id" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "factKey" TEXT NOT NULL,
  "factKind" "SearchFactKind" NOT NULL,
  "sourceObservationRef" TEXT NOT NULL,
  "sourceDate" DATE NOT NULL,
  "query" TEXT,
  "normalizedQuery" TEXT,
  "queryNormalizationVersion" TEXT,
  "page" TEXT,
  "canonicalPage" TEXT,
  "canonicalizationVersion" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchFactMetric" (
  "id" UUID NOT NULL,
  "factId" UUID NOT NULL,
  "metricSemantic" "SearchFactMetricSemantic" NOT NULL,
  "numericValue" DOUBLE PRECISION,
  "evidenceState" "SearchFactEvidenceState" NOT NULL,
  "sourceField" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SearchFactMetric_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchProviderObservationBatch_identity_key"
ON "SearchProviderObservationBatch"("projectId", "provider", "marketCode", "locale", "propertyRef", "sourceCutoffAt", "schemaVersion", "inputHash");

CREATE INDEX "SearchProviderObservationBatch_lookup_idx"
ON "SearchProviderObservationBatch"("projectId", "provider", "marketCode", "locale", "sourceCutoffAt");

CREATE UNIQUE INDEX "SearchProviderObservationRecord_batch_key"
ON "SearchProviderObservationRecord"("batchId", "observationKey");

CREATE INDEX "SearchProviderObservationRecord_project_date_kind_idx"
ON "SearchProviderObservationRecord"("projectId", "sourceDate", "observationKind");

CREATE UNIQUE INDEX "SearchFactSnapshot_identity_key"
ON "SearchFactSnapshot"("projectId", "provider", "marketCode", "locale", "propertyRef", "sourceKind", "sourceRef", "normalizationVersion");

CREATE INDEX "SearchFactSnapshot_lookup_idx"
ON "SearchFactSnapshot"("projectId", "provider", "marketCode", "locale", "sourceCutoffAt", "status");

CREATE UNIQUE INDEX "SearchFact_snapshot_fact_key"
ON "SearchFact"("snapshotId", "factKey");

CREATE INDEX "SearchFact_project_kind_date_idx"
ON "SearchFact"("projectId", "factKind", "sourceDate");

CREATE INDEX "SearchFact_project_page_date_idx"
ON "SearchFact"("projectId", "canonicalPage", "sourceDate");

CREATE INDEX "SearchFact_project_query_date_idx"
ON "SearchFact"("projectId", "normalizedQuery", "sourceDate");

CREATE UNIQUE INDEX "SearchFactMetric_fact_semantic_key"
ON "SearchFactMetric"("factId", "metricSemantic");

CREATE INDEX "SearchFactMetric_semantic_evidence_idx"
ON "SearchFactMetric"("metricSemantic", "evidenceState");

ALTER TABLE "SearchProviderObservationRecord"
ADD CONSTRAINT "SearchProviderObservationRecord_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "SearchProviderObservationBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchFact"
ADD CONSTRAINT "SearchFact_snapshotId_fkey"
FOREIGN KEY ("snapshotId") REFERENCES "SearchFactSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SearchFactMetric"
ADD CONSTRAINT "SearchFactMetric_factId_fkey"
FOREIGN KEY ("factId") REFERENCES "SearchFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
