CREATE TYPE "KeywordType" AS ENUM ('CORE', 'LONG_TAIL', 'BRAND', 'QUESTION', 'LOCAL', 'COMMERCIAL');
CREATE TYPE "KeywordIntent" AS ENUM ('INFORMATIONAL', 'NAVIGATIONAL', 'COMMERCIAL_INVESTIGATION', 'TRANSACTIONAL', 'LOCAL', 'UNKNOWN');
CREATE TYPE "KeywordPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "KeywordStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ARCHIVED');
CREATE TYPE "KeywordSource" AS ENUM ('MANUAL', 'AI_ACCEPTED');
CREATE TYPE "KeywordSuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');

CREATE TABLE "Keyword" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "type" "KeywordType" NOT NULL,
  "intent" "KeywordIntent",
  "priority" "KeywordPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "KeywordStatus" NOT NULL DEFAULT 'ACTIVE',
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "source" "KeywordSource" NOT NULL,
  "language" TEXT,
  "targetCountry" TEXT,
  "notes" TEXT,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordRelation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "parentKeywordId" UUID NOT NULL,
  "childKeywordId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordRelation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordGroup" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordGroupMembership" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "keywordId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordGroupMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordSuggestion" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "seedKeywordId" UUID NOT NULL,
  "acceptedKeywordId" UUID,
  "suggestedText" TEXT NOT NULL,
  "normalizedText" TEXT NOT NULL,
  "suggestedType" "KeywordType",
  "suggestedIntent" "KeywordIntent",
  "rationale" TEXT,
  "status" "KeywordSuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "aiTaskId" UUID NOT NULL,
  "responseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" UUID,
  CONSTRAINT "KeywordSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordAuditEvent" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "keywordId" UUID,
  "actorUserId" UUID,
  "eventType" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeywordAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Keyword_projectId_normalizedText_key" ON "Keyword"("projectId", "normalizedText");
CREATE INDEX "Keyword_projectId_status_idx" ON "Keyword"("projectId", "status");
CREATE INDEX "Keyword_projectId_type_idx" ON "Keyword"("projectId", "type");
CREATE INDEX "Keyword_projectId_priority_idx" ON "Keyword"("projectId", "priority");

CREATE UNIQUE INDEX "KeywordRelation_childKeywordId_key" ON "KeywordRelation"("childKeywordId");
CREATE UNIQUE INDEX "KeywordRelation_parentKeywordId_childKeywordId_key" ON "KeywordRelation"("parentKeywordId", "childKeywordId");
CREATE INDEX "KeywordRelation_projectId_parentKeywordId_idx" ON "KeywordRelation"("projectId", "parentKeywordId");

CREATE UNIQUE INDEX "KeywordGroup_projectId_name_key" ON "KeywordGroup"("projectId", "name");
CREATE INDEX "KeywordGroup_projectId_idx" ON "KeywordGroup"("projectId");

CREATE UNIQUE INDEX "KeywordGroupMembership_groupId_keywordId_key" ON "KeywordGroupMembership"("groupId", "keywordId");
CREATE INDEX "KeywordGroupMembership_projectId_keywordId_idx" ON "KeywordGroupMembership"("projectId", "keywordId");

CREATE UNIQUE INDEX "KeywordSuggestion_projectId_seedKeywordId_normalizedText_key" ON "KeywordSuggestion"("projectId", "seedKeywordId", "normalizedText");
CREATE INDEX "KeywordSuggestion_projectId_status_createdAt_idx" ON "KeywordSuggestion"("projectId", "status", "createdAt");
CREATE INDEX "KeywordSuggestion_aiTaskId_idx" ON "KeywordSuggestion"("aiTaskId");

CREATE INDEX "KeywordAuditEvent_projectId_createdAt_idx" ON "KeywordAuditEvent"("projectId", "createdAt");
CREATE INDEX "KeywordAuditEvent_keywordId_createdAt_idx" ON "KeywordAuditEvent"("keywordId", "createdAt");

ALTER TABLE "Keyword"
  ADD CONSTRAINT "Keyword_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordRelation"
  ADD CONSTRAINT "KeywordRelation_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordRelation"
  ADD CONSTRAINT "KeywordRelation_parentKeywordId_fkey"
  FOREIGN KEY ("parentKeywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordRelation"
  ADD CONSTRAINT "KeywordRelation_childKeywordId_fkey"
  FOREIGN KEY ("childKeywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordGroup"
  ADD CONSTRAINT "KeywordGroup_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordGroupMembership"
  ADD CONSTRAINT "KeywordGroupMembership_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordGroupMembership"
  ADD CONSTRAINT "KeywordGroupMembership_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "KeywordGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordGroupMembership"
  ADD CONSTRAINT "KeywordGroupMembership_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordSuggestion"
  ADD CONSTRAINT "KeywordSuggestion_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordSuggestion"
  ADD CONSTRAINT "KeywordSuggestion_seedKeywordId_fkey"
  FOREIGN KEY ("seedKeywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordSuggestion"
  ADD CONSTRAINT "KeywordSuggestion_acceptedKeywordId_fkey"
  FOREIGN KEY ("acceptedKeywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "KeywordAuditEvent"
  ADD CONSTRAINT "KeywordAuditEvent_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordAuditEvent"
  ADD CONSTRAINT "KeywordAuditEvent_keywordId_fkey"
  FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
