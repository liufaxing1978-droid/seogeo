CREATE TYPE "ReportType" AS ENUM ('PROJECT_SUMMARY');

CREATE TABLE "ReportSnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "reportType" "ReportType" NOT NULL,
  "reportVersion" TEXT NOT NULL,
  "factSnapshot" JSONB NOT NULL,
  "advisorySnapshot" JSONB NOT NULL,
  "sourceReferences" JSONB NOT NULL,
  "executiveAiTaskId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportSnapshot_executiveAiTaskId_key" ON "ReportSnapshot"("executiveAiTaskId");
CREATE INDEX "ReportSnapshot_projectId_createdAt_idx" ON "ReportSnapshot"("projectId", "createdAt");
CREATE INDEX "ReportSnapshot_projectId_reportType_createdAt_idx" ON "ReportSnapshot"("projectId", "reportType", "createdAt");

ALTER TABLE "ReportSnapshot"
  ADD CONSTRAINT "ReportSnapshot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot"
  ADD CONSTRAINT "ReportSnapshot_executiveAiTaskId_fkey"
  FOREIGN KEY ("executiveAiTaskId") REFERENCES "AiTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
