CREATE TYPE "MarketCode" AS ENUM ('CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY');

CREATE TABLE "ProjectMarket" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "marketCode" "MarketCode" NOT NULL,
  "locale" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMarket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectMarket_project_market_locale_key" ON "ProjectMarket"("projectId", "marketCode", "locale");
CREATE INDEX "ProjectMarket_project_enabled_idx" ON "ProjectMarket"("projectId", "enabled");
CREATE INDEX "ProjectMarket_market_locale_idx" ON "ProjectMarket"("marketCode", "locale");

ALTER TABLE "ProjectMarket" ADD CONSTRAINT "ProjectMarket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
