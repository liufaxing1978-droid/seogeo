CREATE TYPE "VisibilityMetricSnapshotStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "VisibilityMetricType" AS ENUM ('MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE');
CREATE TYPE "VisibilityMetricStatus" AS ENUM ('CALCULATED', 'NO_SIGNAL', 'UNKNOWN', 'NOT_ELIGIBLE', 'NO_DATA');
CREATE TYPE "VisibilityMetricDimensionType" AS ENUM ('OVERALL', 'PROVIDER', 'PROMPT_SET');
CREATE TYPE "VisibilityMetricActorType" AS ENUM ('OWNED_ROLLUP', 'COMPETITOR');

CREATE TABLE "VisibilityMetricSnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "status" "VisibilityMetricSnapshotStatus" NOT NULL DEFAULT 'QUEUED',
  "formulaVersion" TEXT NOT NULL,
  "extractorVersion" TEXT NOT NULL,
  "subjectSetHash" TEXT NOT NULL,
  "subjectSnapshotJson" JSONB NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "inputCutoffAt" TIMESTAMP(3) NOT NULL,
  "scopeJson" JSONB NOT NULL,
  "scopeHash" TEXT NOT NULL,
  "inputFingerprint" TEXT,
  "candidateObservationCount" INTEGER NOT NULL DEFAULT 0,
  "completedExtractionCount" INTEGER NOT NULL DEFAULT 0,
  "missingExtractionCount" INTEGER NOT NULL DEFAULT 0,
  "failedExtractionCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityMetricRow" (
  "id" UUID NOT NULL,
  "visibilityMetricSnapshotId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "metricType" "VisibilityMetricType" NOT NULL,
  "metricStatus" "VisibilityMetricStatus" NOT NULL,
  "dimensionType" "VisibilityMetricDimensionType" NOT NULL,
  "dimensionKey" TEXT NOT NULL,
  "dimensionLabelSnapshot" TEXT,
  "actorType" "VisibilityMetricActorType" NOT NULL,
  "actorSubjectId" UUID,
  "actorKey" TEXT NOT NULL,
  "numerator" INTEGER NOT NULL,
  "denominator" INTEGER NOT NULL,
  "candidateObservationCount" INTEGER NOT NULL,
  "eligibleObservationCount" INTEGER NOT NULL,
  "notEligibleObservationCount" INTEGER NOT NULL,
  "unknownObservationCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisibilityMetricRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisibilityMetricSnapshot_projectId_formulaVersion_extractorVersion_subjectSetHash_windowStart_windowEnd_inputCutoffAt_scopeHash_key"
  ON "VisibilityMetricSnapshot"("projectId", "formulaVersion", "extractorVersion", "subjectSetHash", "windowStart", "windowEnd", "inputCutoffAt", "scopeHash");
CREATE INDEX "VisibilityMetricSnapshot_projectId_createdAt_idx" ON "VisibilityMetricSnapshot"("projectId", "createdAt");
CREATE INDEX "VisibilityMetricSnapshot_projectId_status_idx" ON "VisibilityMetricSnapshot"("projectId", "status");
CREATE INDEX "VisibilityMetricSnapshot_projectId_windowStart_windowEnd_idx" ON "VisibilityMetricSnapshot"("projectId", "windowStart", "windowEnd");
CREATE INDEX "VisibilityMetricSnapshot_projectId_subjectSetHash_extractorVersion_idx" ON "VisibilityMetricSnapshot"("projectId", "subjectSetHash", "extractorVersion");

CREATE UNIQUE INDEX "VisibilityMetricRow_visibilityMetricSnapshotId_metricType_dimensionType_dimensionKey_actorKey_key"
  ON "VisibilityMetricRow"("visibilityMetricSnapshotId", "metricType", "dimensionType", "dimensionKey", "actorKey");
CREATE INDEX "VisibilityMetricRow_projectId_createdAt_idx" ON "VisibilityMetricRow"("projectId", "createdAt");
CREATE INDEX "VisibilityMetricRow_visibilityMetricSnapshotId_metricType_idx" ON "VisibilityMetricRow"("visibilityMetricSnapshotId", "metricType");
CREATE INDEX "VisibilityMetricRow_projectId_metricType_dimensionType_idx" ON "VisibilityMetricRow"("projectId", "metricType", "dimensionType");
CREATE INDEX "VisibilityMetricRow_actorSubjectId_idx" ON "VisibilityMetricRow"("actorSubjectId");

ALTER TABLE "VisibilityMetricSnapshot"
  ADD CONSTRAINT "VisibilityMetricSnapshot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricRow"
  ADD CONSTRAINT "VisibilityMetricRow_visibilityMetricSnapshotId_fkey"
  FOREIGN KEY ("visibilityMetricSnapshotId") REFERENCES "VisibilityMetricSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricRow"
  ADD CONSTRAINT "VisibilityMetricRow_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricRow"
  ADD CONSTRAINT "VisibilityMetricRow_actorSubjectId_fkey"
  FOREIGN KEY ("actorSubjectId") REFERENCES "VisibilitySubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
