CREATE TYPE "PublicationProposalSourceType" AS ENUM ('P7_GROWTH_OPPORTUNITY', 'MANUAL', 'SEO_ISSUE', 'GEO_GAP', 'CONTENT_REFRESH');
CREATE TYPE "PublicationAdapterType" AS ENUM ('EXPORT_ONLY', 'GITHUB_GIT');
CREATE TYPE "PublicationWriteCapability" AS ENUM ('EXPORT_ONLY', 'GIT_DRAFT_PR');
CREATE TYPE "ContentGeneratedBy" AS ENUM ('HUMAN', 'DEEPSEEK', 'DETERMINISTIC_GENERATOR');
CREATE TYPE "ContentDraftStatus" AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'ARCHIVED');
CREATE TYPE "PublicationRiskClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "PublicationExecutionStatus" AS ENUM ('PENDING', 'READY', 'EXECUTING', 'PR_CREATED', 'DEPLOYED', 'VERIFYING', 'VERIFIED', 'STALE_REVIEW_REQUIRED', 'FAILED', 'ROLLBACK_PROPOSED', 'ROLLED_BACK');
CREATE TYPE "PublicationExecutionEventType" AS ENUM ('CREATED', 'READY', 'STARTED', 'PR_CREATED', 'DEPLOYED', 'VERIFICATION_STARTED', 'VERIFIED', 'STALE_REVIEW_REQUIRED', 'FAILED', 'ROLLBACK_PROPOSED', 'ROLLED_BACK');
CREATE TYPE "PublicationVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'UNKNOWN');
CREATE TYPE "PublicationRollbackStatus" AS ENUM ('PROPOSED', 'APPROVED', 'EXECUTED', 'DISMISSED');

CREATE TABLE "PublicationSite" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "displayName" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "repositoryIdentity" TEXT,
  "baseBranch" TEXT,
  "adapterType" "PublicationAdapterType" NOT NULL,
  "writeCapability" "PublicationWriteCapability" NOT NULL,
  "allowedPaths" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationSite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationChannel" (
  "id" UUID NOT NULL,
  "siteId" UUID NOT NULL,
  "pathPrefix" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "repositoryPathTemplate" TEXT,
  "contentType" TEXT,
  "defaultSchemaTypes" JSONB,
  "allowedOperationClasses" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationChannel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationProposal" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceType" "PublicationProposalSourceType" NOT NULL,
  "reason" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "sourceReferenceId" TEXT,
  "sourceSnapshotId" TEXT,
  "sourceMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentDraft" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "sourceProposalId" UUID,
  "title" TEXT NOT NULL,
  "slugCandidate" TEXT,
  "body" TEXT NOT NULL,
  "excerpt" TEXT,
  "metaTitle" TEXT,
  "metaDescription" TEXT,
  "canonicalCandidate" TEXT,
  "schemaJson" JSONB,
  "author" TEXT,
  "language" TEXT NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 1,
  "currentContentHash" TEXT,
  "status" "ContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "generatedBy" "ContentGeneratedBy" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentDraftVersion" (
  "id" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "slugCandidate" TEXT,
  "body" TEXT NOT NULL,
  "excerpt" TEXT,
  "metaTitle" TEXT,
  "metaDescription" TEXT,
  "canonicalCandidate" TEXT,
  "schemaJson" JSONB,
  "author" TEXT,
  "language" TEXT NOT NULL,
  "contentHash" TEXT,
  "generatedBy" "ContentGeneratedBy" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentDraftVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContentSourceReference" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "draftId" UUID,
  "title" TEXT NOT NULL,
  "author" TEXT,
  "publisher" TEXT,
  "sourceUrl" TEXT,
  "publishedAt" TIMESTAMP(3),
  "sourceType" TEXT NOT NULL,
  "accessedAt" TIMESTAMP(3),
  "userProvided" BOOLEAN NOT NULL DEFAULT false,
  "internalRef" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentSourceReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationPlan" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "proposalId" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "draftVersion" INTEGER NOT NULL,
  "siteId" UUID NOT NULL,
  "channelId" UUID,
  "version" INTEGER NOT NULL,
  "targetPublicUrl" TEXT NOT NULL,
  "targetRepository" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "baseSha" TEXT NOT NULL,
  "targetBlobHashes" JSONB,
  "operations" JSONB NOT NULL,
  "expectedOutcomes" JSONB NOT NULL,
  "validatorVersion" TEXT NOT NULL,
  "riskClass" "PublicationRiskClass" NOT NULL,
  "rollbackStrategy" TEXT NOT NULL,
  "planHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationPreview" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "previewHash" TEXT NOT NULL,
  "diffSummary" TEXT NOT NULL,
  "diffPayload" JSONB,
  "validationResult" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationPreview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationApproval" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "planVersion" INTEGER NOT NULL,
  "planHash" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "previewHash" TEXT NOT NULL,
  "baseSha" TEXT NOT NULL,
  "approverActorId" TEXT NOT NULL,
  "approvedRiskClass" "PublicationRiskClass" NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationApproval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationExecution" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "approvalId" UUID NOT NULL,
  "executionKey" TEXT NOT NULL,
  "status" "PublicationExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "branchName" TEXT,
  "commitSha" TEXT,
  "pullRequestNo" INTEGER,
  "pullRequestUrl" TEXT,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationExecutionEvent" (
  "id" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "eventType" "PublicationExecutionEventType" NOT NULL,
  "fromStatus" "PublicationExecutionStatus",
  "toStatus" "PublicationExecutionStatus" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "actorId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationExecutionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationVerification" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "status" "PublicationVerificationStatus" NOT NULL DEFAULT 'PENDING',
  "observedUrl" TEXT,
  "observedAt" TIMESTAMP(3),
  "httpStatus" INTEGER,
  "titleMatches" BOOLEAN,
  "descriptionMatches" BOOLEAN,
  "canonicalMatches" BOOLEAN,
  "h1Matches" BOOLEAN,
  "indexable" BOOLEAN,
  "schemaValid" BOOLEAN,
  "contentFingerprintOk" BOOLEAN,
  "regressionFindings" JSONB,
  "reasonCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationVerification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationRollbackProposal" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" "PublicationRollbackStatus" NOT NULL DEFAULT 'PROPOSED',
  "reasonCode" TEXT NOT NULL,
  "proposedBy" TEXT,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublicationRollbackProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicationSite_project_domain_key" ON "PublicationSite"("projectId", "domain");
CREATE INDEX "PublicationSite_project_enabled_idx" ON "PublicationSite"("projectId", "enabled");
CREATE UNIQUE INDEX "PublicationChannel_site_path_key" ON "PublicationChannel"("siteId", "pathPrefix");
CREATE INDEX "PublicationChannel_site_enabled_idx" ON "PublicationChannel"("siteId", "enabled");
CREATE INDEX "PublicationProposal_project_created_idx" ON "PublicationProposal"("projectId", "createdAt");
CREATE INDEX "PublicationProposal_project_source_idx" ON "PublicationProposal"("projectId", "sourceType");
CREATE INDEX "ContentDraft_project_updated_idx" ON "ContentDraft"("projectId", "updatedAt");
CREATE INDEX "ContentDraft_proposal_idx" ON "ContentDraft"("sourceProposalId");
CREATE UNIQUE INDEX "ContentDraftVersion_draft_version_key" ON "ContentDraftVersion"("draftId", "version");
CREATE INDEX "ContentDraftVersion_draft_created_idx" ON "ContentDraftVersion"("draftId", "createdAt");
CREATE INDEX "ContentSourceReference_project_created_idx" ON "ContentSourceReference"("projectId", "createdAt");
CREATE INDEX "ContentSourceReference_draft_idx" ON "ContentSourceReference"("draftId");
CREATE UNIQUE INDEX "PublicationPlan_proposal_version_key" ON "PublicationPlan"("proposalId", "version");
CREATE INDEX "PublicationPlan_project_created_idx" ON "PublicationPlan"("projectId", "createdAt");
CREATE INDEX "PublicationPlan_draft_version_idx" ON "PublicationPlan"("draftId", "draftVersion");
CREATE UNIQUE INDEX "PublicationPreview_planId_key" ON "PublicationPreview"("planId");
CREATE INDEX "PublicationPreview_project_created_idx" ON "PublicationPreview"("projectId", "createdAt");
CREATE INDEX "PublicationApproval_project_created_idx" ON "PublicationApproval"("projectId", "createdAt");
CREATE INDEX "PublicationApproval_plan_created_idx" ON "PublicationApproval"("planId", "createdAt");
CREATE UNIQUE INDEX "PublicationExecution_executionKey_key" ON "PublicationExecution"("executionKey");
CREATE INDEX "PublicationExecution_project_created_idx" ON "PublicationExecution"("projectId", "createdAt");
CREATE INDEX "PublicationExecution_plan_status_idx" ON "PublicationExecution"("planId", "status");
CREATE INDEX "PublicationExecutionEvent_execution_created_idx" ON "PublicationExecutionEvent"("executionId", "createdAt");
CREATE INDEX "PublicationVerification_project_created_idx" ON "PublicationVerification"("projectId", "createdAt");
CREATE INDEX "PublicationVerification_execution_created_idx" ON "PublicationVerification"("executionId", "createdAt");
CREATE INDEX "PublicationRollback_project_created_idx" ON "PublicationRollbackProposal"("projectId", "createdAt");
CREATE INDEX "PublicationRollback_execution_status_idx" ON "PublicationRollbackProposal"("executionId", "status");

ALTER TABLE "PublicationChannel" ADD CONSTRAINT "PublicationChannel_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PublicationSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentDraft" ADD CONSTRAINT "ContentDraft_sourceProposalId_fkey" FOREIGN KEY ("sourceProposalId") REFERENCES "PublicationProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentDraftVersion" ADD CONSTRAINT "ContentDraftVersion_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentSourceReference" ADD CONSTRAINT "ContentSourceReference_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationPlan" ADD CONSTRAINT "PublicationPlan_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "PublicationProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationPlan" ADD CONSTRAINT "PublicationPlan_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ContentDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationPlan" ADD CONSTRAINT "PublicationPlan_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "PublicationSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationPlan" ADD CONSTRAINT "PublicationPlan_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "PublicationChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationPreview" ADD CONSTRAINT "PublicationPreview_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PublicationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationApproval" ADD CONSTRAINT "PublicationApproval_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PublicationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationExecution" ADD CONSTRAINT "PublicationExecution_planId_fkey" FOREIGN KEY ("planId") REFERENCES "PublicationPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationExecution" ADD CONSTRAINT "PublicationExecution_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "PublicationApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicationExecutionEvent" ADD CONSTRAINT "PublicationExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PublicationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationVerification" ADD CONSTRAINT "PublicationVerification_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PublicationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationRollbackProposal" ADD CONSTRAINT "PublicationRollbackProposal_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PublicationExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p8_immutable_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P8 immutable row % cannot be updated or deleted', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PublicationPlan_immutable" BEFORE UPDATE OR DELETE ON "PublicationPlan" FOR EACH ROW EXECUTE FUNCTION "reject_p8_immutable_mutation"();
CREATE TRIGGER "PublicationPreview_immutable" BEFORE UPDATE OR DELETE ON "PublicationPreview" FOR EACH ROW EXECUTE FUNCTION "reject_p8_immutable_mutation"();
CREATE TRIGGER "PublicationApproval_immutable" BEFORE UPDATE OR DELETE ON "PublicationApproval" FOR EACH ROW EXECUTE FUNCTION "reject_p8_immutable_mutation"();
CREATE TRIGGER "ContentDraftVersion_immutable" BEFORE UPDATE OR DELETE ON "ContentDraftVersion" FOR EACH ROW EXECUTE FUNCTION "reject_p8_immutable_mutation"();
CREATE TRIGGER "PublicationExecutionEvent_immutable" BEFORE UPDATE OR DELETE ON "PublicationExecutionEvent" FOR EACH ROW EXECUTE FUNCTION "reject_p8_immutable_mutation"();
