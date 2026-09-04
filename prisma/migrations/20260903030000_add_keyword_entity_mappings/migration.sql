CREATE TABLE "KeywordEntityMapping" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "groupId" UUID,
  "entityId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordEntityMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeywordEntityMapping_exactly_one_subject_check" CHECK (("keywordId" IS NOT NULL)::integer + ("groupId" IS NOT NULL)::integer = 1)
);

CREATE UNIQUE INDEX "KeywordEntityMapping_keywordId_entityId_key" ON "KeywordEntityMapping"("keywordId", "entityId");
CREATE UNIQUE INDEX "KeywordEntityMapping_groupId_entityId_key" ON "KeywordEntityMapping"("groupId", "entityId");
CREATE INDEX "KeywordEntityMapping_projectId_keywordId_idx" ON "KeywordEntityMapping"("projectId", "keywordId");
CREATE INDEX "KeywordEntityMapping_projectId_groupId_idx" ON "KeywordEntityMapping"("projectId", "groupId");
CREATE INDEX "KeywordEntityMapping_projectId_entityId_idx" ON "KeywordEntityMapping"("projectId", "entityId");

ALTER TABLE "KeywordEntityMapping" ADD CONSTRAINT "KeywordEntityMapping_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordEntityMapping" ADD CONSTRAINT "KeywordEntityMapping_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordEntityMapping" ADD CONSTRAINT "KeywordEntityMapping_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordEntityMapping" ADD CONSTRAINT "KeywordEntityMapping_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
