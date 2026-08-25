CREATE TABLE "AutopilotPolicyRevision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "revisionVersion" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "revisionKey" TEXT NOT NULL,
    "previousPolicyUpdatedAt" TIMESTAMP(3),
    "appliedPolicyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "beforeSnapshotJson" JSONB,
    "afterSnapshotJson" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotPolicyRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutopilotPolicyRevision_projectId_requestId_key"
ON "AutopilotPolicyRevision"("projectId", "requestId");

CREATE UNIQUE INDEX "AutopilotPolicyRevision_projectId_revisionKey_key"
ON "AutopilotPolicyRevision"("projectId", "revisionKey");

CREATE INDEX "AutopilotPolicyRevision_projectId_createdAt_idx"
ON "AutopilotPolicyRevision"("projectId", "createdAt");

ALTER TABLE "AutopilotPolicyRevision"
ADD CONSTRAINT "AutopilotPolicyRevision_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AutopilotPolicyRevision"
ADD CONSTRAINT "AutopilotPolicyRevision_policyId_fkey"
FOREIGN KEY ("policyId") REFERENCES "AutopilotPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p9f_policy_revision_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P9-F immutable row % cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AutopilotPolicyRevision_immutable"
BEFORE UPDATE OR DELETE ON "AutopilotPolicyRevision"
FOR EACH ROW
EXECUTE FUNCTION "reject_p9f_policy_revision_mutation"();
