CREATE TABLE "VisibilityMetricComparison" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "comparisonVersion" TEXT NOT NULL,
  "currentSnapshotId" UUID NOT NULL,
  "previousSnapshotId" UUID NOT NULL,
  "windowDurationMs" BIGINT NOT NULL,
  "gapDurationMs" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisibilityMetricComparison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityMetricDeltaRow" (
  "id" UUID NOT NULL,
  "visibilityMetricComparisonId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "metricType" "VisibilityMetricType" NOT NULL,
  "dimensionType" "VisibilityMetricDimensionType" NOT NULL,
  "dimensionKey" TEXT NOT NULL,
  "actorType" "VisibilityMetricActorType" NOT NULL,
  "actorSubjectId" UUID,
  "actorKey" TEXT NOT NULL,
  "previousMetricStatus" "VisibilityMetricStatus" NOT NULL,
  "currentMetricStatus" "VisibilityMetricStatus" NOT NULL,
  "previousNumerator" INTEGER NOT NULL,
  "previousDenominator" INTEGER NOT NULL,
  "currentNumerator" INTEGER NOT NULL,
  "currentDenominator" INTEGER NOT NULL,
  "deltaBasisPoints" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisibilityMetricDeltaRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisibilityMetricComparison_projectId_comparisonVersion_currentSnapshotId_previousSnapshotId_key"
  ON "VisibilityMetricComparison"("projectId", "comparisonVersion", "currentSnapshotId", "previousSnapshotId");
CREATE INDEX "VisibilityMetricComparison_projectId_createdAt_idx"
  ON "VisibilityMetricComparison"("projectId", "createdAt");
CREATE INDEX "VisibilityMetricComparison_currentSnapshotId_idx"
  ON "VisibilityMetricComparison"("currentSnapshotId");
CREATE INDEX "VisibilityMetricComparison_previousSnapshotId_idx"
  ON "VisibilityMetricComparison"("previousSnapshotId");

CREATE UNIQUE INDEX "VisibilityMetricDeltaRow_visibilityMetricComparisonId_metricType_dimensionType_dimensionKey_actorKey_key"
  ON "VisibilityMetricDeltaRow"("visibilityMetricComparisonId", "metricType", "dimensionType", "dimensionKey", "actorKey");
CREATE INDEX "VisibilityMetricDeltaRow_projectId_createdAt_idx"
  ON "VisibilityMetricDeltaRow"("projectId", "createdAt");
CREATE INDEX "VisibilityMetricDeltaRow_visibilityMetricComparisonId_metricType_idx"
  ON "VisibilityMetricDeltaRow"("visibilityMetricComparisonId", "metricType");
CREATE INDEX "VisibilityMetricDeltaRow_actorSubjectId_idx"
  ON "VisibilityMetricDeltaRow"("actorSubjectId");

ALTER TABLE "VisibilityMetricComparison"
  ADD CONSTRAINT "VisibilityMetricComparison_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricComparison"
  ADD CONSTRAINT "VisibilityMetricComparison_currentSnapshotId_fkey"
  FOREIGN KEY ("currentSnapshotId") REFERENCES "VisibilityMetricSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricComparison"
  ADD CONSTRAINT "VisibilityMetricComparison_previousSnapshotId_fkey"
  FOREIGN KEY ("previousSnapshotId") REFERENCES "VisibilityMetricSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricDeltaRow"
  ADD CONSTRAINT "VisibilityMetricDeltaRow_visibilityMetricComparisonId_fkey"
  FOREIGN KEY ("visibilityMetricComparisonId") REFERENCES "VisibilityMetricComparison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricDeltaRow"
  ADD CONSTRAINT "VisibilityMetricDeltaRow_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityMetricDeltaRow"
  ADD CONSTRAINT "VisibilityMetricDeltaRow_actorSubjectId_fkey"
  FOREIGN KEY ("actorSubjectId") REFERENCES "VisibilitySubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
