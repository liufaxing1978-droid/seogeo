ALTER TABLE "IndexNowSubmissionBatch" ADD COLUMN "requestFingerprint" TEXT;
CREATE UNIQUE INDEX "IndexNowSubmissionBatch_projectId_requestFingerprint_key"
  ON "IndexNowSubmissionBatch"("projectId", "requestFingerprint");
