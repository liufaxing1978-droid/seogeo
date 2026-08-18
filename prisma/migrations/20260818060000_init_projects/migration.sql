CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "PlanLevel" AS ENUM ('STANDARD', 'ADVANCED', 'ENTERPRISE');

CREATE TABLE "Project" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "primaryDomain" TEXT NOT NULL,
  "industry" TEXT,
  "defaultLanguage" TEXT NOT NULL DEFAULT 'zh-CN',
  "targetCountry" TEXT NOT NULL DEFAULT 'CN',
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "planLevel" "PlanLevel" NOT NULL DEFAULT 'STANDARD',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE INDEX "Project_primaryDomain_idx" ON "Project"("primaryDomain");
CREATE INDEX "Project_status_idx" ON "Project"("status");
