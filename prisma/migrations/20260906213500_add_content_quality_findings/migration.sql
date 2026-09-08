CREATE TYPE "ContentQualityRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "ContentQualityFindingStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'ACCEPTED', 'DISMISSED');
CREATE TYPE "ContentQualityCategory" AS ENUM ('INTERNAL_LINK_SUPPORT', 'CONTENT_DECAY', 'CONTENT_QA');

CREATE TABLE "ContentQualityRun" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "rulesetVersion" INTEGER NOT NULL,
  "status" "ContentQualityRunStatus" NOT NULL DEFAULT 'QUEUED',
  "inputSnapshotCutoffAt" TIMESTAMP(3),
  "inputDocumentCount" INTEGER NOT NULL DEFAULT 0,
  "findingCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "requestedByActorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentQualityRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentQualityFinding" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "contentDocumentId" UUID NOT NULL,
  "latestRunId" UUID,
  "findingKey" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "category" "ContentQualityCategory" NOT NULL,
  "priority" "ContentPriority" NOT NULL,
  "status" "ContentQualityFindingStatus" NOT NULL DEFAULT 'OPEN',
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "firstDetectedAt" TIMESTAMP(3) NOT NULL,
  "lastDetectedAt" TIMESTAMP(3) NOT NULL,
  "acceptedPublicationProposalId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentQualityFinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentQualityFindingHistory" (
  "id" UUID NOT NULL,
  "findingId" UUID NOT NULL,
  "fromStatus" "ContentQualityFindingStatus" NOT NULL,
  "toStatus" "ContentQualityFindingStatus" NOT NULL,
  "actorId" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentQualityFindingHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContentQualityFinding_contentDocumentId_findingKey_ruleVersion_key" ON "ContentQualityFinding"("contentDocumentId", "findingKey", "ruleVersion");
CREATE UNIQUE INDEX "ContentQualityFinding_acceptedPublicationProposalId_key" ON "ContentQualityFinding"("acceptedPublicationProposalId");
CREATE INDEX "ContentQualityRun_projectId_status_idx" ON "ContentQualityRun"("projectId", "status");
CREATE INDEX "ContentQualityRun_projectId_createdAt_idx" ON "ContentQualityRun"("projectId", "createdAt");
CREATE INDEX "ContentQualityFinding_projectId_status_idx" ON "ContentQualityFinding"("projectId", "status");
CREATE INDEX "ContentQualityFinding_projectId_category_idx" ON "ContentQualityFinding"("projectId", "category");
CREATE INDEX "ContentQualityFinding_projectId_priority_idx" ON "ContentQualityFinding"("projectId", "priority");
CREATE INDEX "ContentQualityFindingHistory_findingId_createdAt_idx" ON "ContentQualityFindingHistory"("findingId", "createdAt");

ALTER TABLE "ContentQualityRun" ADD CONSTRAINT "ContentQualityRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentQualityFinding" ADD CONSTRAINT "ContentQualityFinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentQualityFinding" ADD CONSTRAINT "ContentQualityFinding_contentDocumentId_fkey" FOREIGN KEY ("contentDocumentId") REFERENCES "ContentDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentQualityFinding" ADD CONSTRAINT "ContentQualityFinding_latestRunId_fkey" FOREIGN KEY ("latestRunId") REFERENCES "ContentQualityRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentQualityFinding" ADD CONSTRAINT "ContentQualityFinding_acceptedPublicationProposalId_fkey" FOREIGN KEY ("acceptedPublicationProposalId") REFERENCES "PublicationProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentQualityFindingHistory" ADD CONSTRAINT "ContentQualityFindingHistory_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "ContentQualityFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
