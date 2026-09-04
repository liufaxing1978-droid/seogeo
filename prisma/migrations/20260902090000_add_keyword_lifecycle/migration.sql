CREATE TYPE "KeywordLifecycleStatus" AS ENUM (
  'DISCOVERED',
  'EVALUATING',
  'APPROVED',
  'MAPPED',
  'CONTENT_PLANNED',
  'CONTENT_IN_PROGRESS',
  'PUBLISHED',
  'INDEXED',
  'RANKING',
  'AI_CITED',
  'NEEDS_OPTIMIZATION',
  'RETIRED'
);

ALTER TABLE "Keyword"
  ADD COLUMN "lifecycleStatus" "KeywordLifecycleStatus";

UPDATE "Keyword"
SET "lifecycleStatus" = CASE
  WHEN "status" IN ('DISABLED', 'ARCHIVED') THEN 'RETIRED'::"KeywordLifecycleStatus"
  ELSE 'DISCOVERED'::"KeywordLifecycleStatus"
END
WHERE "lifecycleStatus" IS NULL;

ALTER TABLE "Keyword"
  ALTER COLUMN "lifecycleStatus" SET DEFAULT 'DISCOVERED',
  ALTER COLUMN "lifecycleStatus" SET NOT NULL;

CREATE INDEX "Keyword_projectId_lifecycleStatus_idx"
  ON "Keyword"("projectId", "lifecycleStatus");
