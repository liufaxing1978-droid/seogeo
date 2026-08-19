CREATE TYPE "VisibilitySubjectType" AS ENUM ('OWNED_BRAND', 'OWNED_DOMAIN', 'OWNED_ENTITY', 'COMPETITOR');
CREATE TYPE "VisibilitySubjectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "VisibilitySubjectSource" AS ENUM ('PROJECT_CONFIG', 'PRIMARY_DOMAIN', 'P3_ENTITY', 'P5_COMPETITOR');
CREATE TYPE "VisibilityAliasType" AS ENUM ('NAME', 'DOMAIN', 'ENTITY_ALIAS');
CREATE TYPE "VisibilityAliasSource" AS ENUM ('PROJECT_CONFIG', 'P3_ENTITY_ALIAS', 'PRIMARY_DOMAIN', 'P5_COMPETITOR');
CREATE TYPE "VisibilityExtractionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "VisibilityEvidenceStatus" AS ENUM ('EXTRACTED', 'KNOWN_EMPTY', 'UNKNOWN', 'NOT_ELIGIBLE');
CREATE TYPE "VisibilityMentionType" AS ENUM ('EXACT', 'NORMALIZED_ALIAS', 'DOMAIN');
CREATE TYPE "CitationEvidenceState" AS ENUM ('KNOWN_PRESENT', 'KNOWN_EMPTY', 'UNKNOWN', 'NOT_APPLICABLE');

ALTER TABLE "PlatformObservation"
  ADD COLUMN "citationEvidenceState" "CitationEvidenceState" NOT NULL DEFAULT 'UNKNOWN';

CREATE TABLE "VisibilitySubject" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "subjectType" "VisibilitySubjectType" NOT NULL,
  "canonicalValue" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "status" "VisibilitySubjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "entityId" UUID,
  "competitorId" UUID,
  "sourceType" "VisibilitySubjectSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilitySubject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilitySubjectAlias" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "alias" TEXT NOT NULL,
  "normalizedAlias" TEXT NOT NULL,
  "aliasType" "VisibilityAliasType" NOT NULL,
  "sourceType" "VisibilityAliasSource" NOT NULL,
  "status" "VisibilitySubjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilitySubjectAlias_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityExtraction" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "platformObservationId" UUID NOT NULL,
  "status" "VisibilityExtractionStatus" NOT NULL DEFAULT 'QUEUED',
  "extractorVersion" TEXT NOT NULL,
  "subjectSetHash" TEXT NOT NULL,
  "subjectSnapshotJson" JSONB NOT NULL,
  "answerHash" TEXT,
  "mentionStatus" "VisibilityEvidenceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "citationStatus" "VisibilityEvidenceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "mentionCount" INTEGER NOT NULL DEFAULT 0,
  "citationCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityExtraction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MentionObservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "visibilityExtractionId" UUID NOT NULL,
  "platformObservationId" UUID NOT NULL,
  "subjectId" UUID NOT NULL,
  "subjectType" "VisibilitySubjectType" NOT NULL,
  "subjectValue" TEXT NOT NULL,
  "matchedValue" TEXT NOT NULL,
  "mentionType" "VisibilityMentionType" NOT NULL,
  "occurrenceCount" INTEGER NOT NULL,
  "firstPosition" INTEGER,
  "extractorVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MentionObservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CitationObservation" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "visibilityExtractionId" UUID NOT NULL,
  "platformObservationId" UUID NOT NULL,
  "citationKey" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "normalizedUrl" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "position" INTEGER,
  "title" TEXT,
  "sourceType" TEXT,
  "occurrenceCount" INTEGER NOT NULL,
  "isOwnedDomain" BOOLEAN NOT NULL DEFAULT false,
  "ownedSubjectId" UUID,
  "competitorId" UUID,
  "competitorSubjectId" UUID,
  "extractorVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CitationObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisibilitySubject_projectId_subjectType_normalizedValue_key" ON "VisibilitySubject"("projectId", "subjectType", "normalizedValue");
CREATE INDEX "VisibilitySubject_projectId_status_idx" ON "VisibilitySubject"("projectId", "status");
CREATE INDEX "VisibilitySubject_projectId_subjectType_idx" ON "VisibilitySubject"("projectId", "subjectType");
CREATE INDEX "VisibilitySubject_entityId_idx" ON "VisibilitySubject"("entityId");
CREATE INDEX "VisibilitySubject_competitorId_idx" ON "VisibilitySubject"("competitorId");

CREATE UNIQUE INDEX "VisibilitySubjectAlias_subjectId_normalizedAlias_key" ON "VisibilitySubjectAlias"("subjectId", "normalizedAlias");
CREATE INDEX "VisibilitySubjectAlias_projectId_status_idx" ON "VisibilitySubjectAlias"("projectId", "status");
CREATE INDEX "VisibilitySubjectAlias_projectId_normalizedAlias_idx" ON "VisibilitySubjectAlias"("projectId", "normalizedAlias");
CREATE INDEX "VisibilitySubjectAlias_subjectId_status_idx" ON "VisibilitySubjectAlias"("subjectId", "status");

CREATE UNIQUE INDEX "VisibilityExtraction_platformObservationId_extractorVersion_subjectSetHash_key" ON "VisibilityExtraction"("platformObservationId", "extractorVersion", "subjectSetHash");
CREATE INDEX "VisibilityExtraction_projectId_createdAt_idx" ON "VisibilityExtraction"("projectId", "createdAt");
CREATE INDEX "VisibilityExtraction_projectId_status_idx" ON "VisibilityExtraction"("projectId", "status");
CREATE INDEX "VisibilityExtraction_platformObservationId_idx" ON "VisibilityExtraction"("platformObservationId");

CREATE UNIQUE INDEX "MentionObservation_visibilityExtractionId_subjectId_matchedValue_mentionType_key" ON "MentionObservation"("visibilityExtractionId", "subjectId", "matchedValue", "mentionType");
CREATE INDEX "MentionObservation_projectId_createdAt_idx" ON "MentionObservation"("projectId", "createdAt");
CREATE INDEX "MentionObservation_platformObservationId_idx" ON "MentionObservation"("platformObservationId");
CREATE INDEX "MentionObservation_subjectId_idx" ON "MentionObservation"("subjectId");

CREATE UNIQUE INDEX "CitationObservation_visibilityExtractionId_citationKey_key" ON "CitationObservation"("visibilityExtractionId", "citationKey");
CREATE INDEX "CitationObservation_projectId_createdAt_idx" ON "CitationObservation"("projectId", "createdAt");
CREATE INDEX "CitationObservation_platformObservationId_idx" ON "CitationObservation"("platformObservationId");
CREATE INDEX "CitationObservation_domain_idx" ON "CitationObservation"("domain");
CREATE INDEX "CitationObservation_ownedSubjectId_idx" ON "CitationObservation"("ownedSubjectId");
CREATE INDEX "CitationObservation_competitorId_idx" ON "CitationObservation"("competitorId");
CREATE INDEX "CitationObservation_competitorSubjectId_idx" ON "CitationObservation"("competitorSubjectId");

ALTER TABLE "VisibilitySubject" ADD CONSTRAINT "VisibilitySubject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilitySubject" ADD CONSTRAINT "VisibilitySubject_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisibilitySubject" ADD CONSTRAINT "VisibilitySubject_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisibilitySubjectAlias" ADD CONSTRAINT "VisibilitySubjectAlias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilitySubjectAlias" ADD CONSTRAINT "VisibilitySubjectAlias_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "VisibilitySubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisibilityExtraction" ADD CONSTRAINT "VisibilityExtraction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisibilityExtraction" ADD CONSTRAINT "VisibilityExtraction_platformObservationId_fkey" FOREIGN KEY ("platformObservationId") REFERENCES "PlatformObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MentionObservation" ADD CONSTRAINT "MentionObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MentionObservation" ADD CONSTRAINT "MentionObservation_visibilityExtractionId_fkey" FOREIGN KEY ("visibilityExtractionId") REFERENCES "VisibilityExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MentionObservation" ADD CONSTRAINT "MentionObservation_platformObservationId_fkey" FOREIGN KEY ("platformObservationId") REFERENCES "PlatformObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MentionObservation" ADD CONSTRAINT "MentionObservation_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "VisibilitySubject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_visibilityExtractionId_fkey" FOREIGN KEY ("visibilityExtractionId") REFERENCES "VisibilityExtraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_platformObservationId_fkey" FOREIGN KEY ("platformObservationId") REFERENCES "PlatformObservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_ownedSubjectId_fkey" FOREIGN KEY ("ownedSubjectId") REFERENCES "VisibilitySubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CitationObservation" ADD CONSTRAINT "CitationObservation_competitorSubjectId_fkey" FOREIGN KEY ("competitorSubjectId") REFERENCES "VisibilitySubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
