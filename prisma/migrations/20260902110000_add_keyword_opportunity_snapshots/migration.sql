CREATE TABLE "KeywordOpportunitySnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID NOT NULL,
  "score" DOUBLE PRECISION,
  "dataConfidence" DOUBLE PRECISION NOT NULL,
  "breakdown" JSONB NOT NULL,
  "sourceProvenance" JSONB NOT NULL,
  "formulaVersion" TEXT NOT NULL,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordOpportunitySnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordOpportunitySnapshot_score_check"
    CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
  CONSTRAINT "KeywordOpportunitySnapshot_confidence_check"
    CHECK ("dataConfidence" >= 0 AND "dataConfidence" <= 1)
);

ALTER TABLE "KeywordOpportunitySnapshot"
  ADD CONSTRAINT "KeywordOpportunitySnapshot_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordOpportunitySnapshot"
  ADD CONSTRAINT "KeywordOpportunitySnapshot_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "KeywordOpportunitySnapshot_projectId_keywordId_createdAt_idx"
  ON "KeywordOpportunitySnapshot"("projectId", "keywordId", "createdAt");

CREATE INDEX "KeywordOpportunitySnapshot_projectId_createdAt_idx"
  ON "KeywordOpportunitySnapshot"("projectId", "createdAt");
