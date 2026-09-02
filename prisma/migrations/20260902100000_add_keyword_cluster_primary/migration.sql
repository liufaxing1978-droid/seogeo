ALTER TABLE "KeywordGroup"
  ADD COLUMN "primaryKeywordId" UUID;

CREATE INDEX "KeywordGroup_projectId_primaryKeywordId_idx"
  ON "KeywordGroup"("projectId", "primaryKeywordId");

ALTER TABLE "KeywordGroup"
  ADD CONSTRAINT "KeywordGroup_primaryKeywordId_fkey"
  FOREIGN KEY ("primaryKeywordId") REFERENCES "Keyword"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
