ALTER TYPE "KeywordSource" ADD VALUE 'SEARCH_DISCOVERY_ACCEPTED';

CREATE TYPE "KeywordDiscoveryStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

CREATE TABLE "SearchProviderLaneBinding" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "provider" "SearchFactProvider" NOT NULL,
  "propertyRef" TEXT NOT NULL,
  "marketCode" "MarketCode" NOT NULL,
  "locale" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchProviderLaneBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeywordDiscoveryCandidate" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "representativeText" TEXT NOT NULL,
  "status" "KeywordDiscoveryStatus" NOT NULL DEFAULT 'PENDING',
  "acceptedKeywordId" UUID,
  "firstObservedAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "decidedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeywordDiscoveryCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SearchProviderLaneBinding_identity_key"
  ON "SearchProviderLaneBinding"("projectId", "provider", "propertyRef", "marketCode", "locale");
CREATE INDEX "SearchProviderLaneBinding_lookup_idx"
  ON "SearchProviderLaneBinding"("projectId", "provider", "isActive");

CREATE UNIQUE INDEX "KeywordDiscoveryCandidate_identity_key"
  ON "KeywordDiscoveryCandidate"("projectId", "normalizedQuery");
CREATE INDEX "KeywordDiscoveryCandidate_review_idx"
  ON "KeywordDiscoveryCandidate"("projectId", "status", "lastObservedAt");

ALTER TABLE "SearchProviderLaneBinding"
  ADD CONSTRAINT "SearchProviderLaneBinding_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "KeywordDiscoveryCandidate"
  ADD CONSTRAINT "KeywordDiscoveryCandidate_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KeywordDiscoveryCandidate"
  ADD CONSTRAINT "KeywordDiscoveryCandidate_acceptedKeywordId_fkey"
  FOREIGN KEY ("acceptedKeywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;
