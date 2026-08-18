CREATE TABLE "PageStructuredSignal" (
  "id" UUID NOT NULL,
  "pageSnapshotId" UUID NOT NULL,
  "openGraphSiteName" TEXT,
  "entitySignals" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PageStructuredSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PageStructuredSignal_pageSnapshotId_key" ON "PageStructuredSignal"("pageSnapshotId");
CREATE INDEX "PageStructuredSignal_createdAt_idx" ON "PageStructuredSignal"("createdAt");

ALTER TABLE "PageStructuredSignal"
  ADD CONSTRAINT "PageStructuredSignal_pageSnapshotId_fkey"
  FOREIGN KEY ("pageSnapshotId") REFERENCES "PageSnapshot"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
