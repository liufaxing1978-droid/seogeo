CREATE TYPE "OAuthCredentialProvider" AS ENUM ('GOOGLE_SEARCH_CONSOLE');
CREATE TYPE "SearchConsoleConnectionStatus" AS ENUM ('CONNECTED', 'TOKEN_REVOKED', 'PERMISSION_DENIED', 'DISCONNECTED');
CREATE TYPE "GscDailySnapshotStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "GscSourceCompletenessState" AS ENUM ('UNKNOWN', 'TOP_ROWS_ONLY');

CREATE TABLE "OAuthStateNonce" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "provider" "OAuthCredentialProvider" NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthStateNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OAuthCredentialRecord" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "provider" "OAuthCredentialProvider" NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "iv" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthCredentialRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchConsoleConnection" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "googleAccountRef" TEXT,
  "credentialRef" UUID NOT NULL,
  "status" "SearchConsoleConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchConsoleConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SearchConsoleProperty" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "propertyUri" TEXT NOT NULL,
  "propertyType" TEXT NOT NULL,
  "permissionState" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "lastSyncAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SearchConsoleProperty_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GscDailySnapshot" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "propertyId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "status" "GscDailySnapshotStatus" NOT NULL DEFAULT 'PENDING',
  "syncVersion" INTEGER NOT NULL,
  "inputHash" TEXT,
  "rowCount" INTEGER NOT NULL DEFAULT 0,
  "sourceFreshness" TIMESTAMP(3),
  "sourceCompletenessState" "GscSourceCompletenessState" NOT NULL DEFAULT 'UNKNOWN',
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GscDailySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GscQueryPageFact" (
  "id" UUID NOT NULL,
  "snapshotId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "factKey" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "normalizedQuery" TEXT NOT NULL,
  "normalizationVersion" TEXT NOT NULL,
  "page" TEXT NOT NULL,
  "canonicalPage" TEXT NOT NULL,
  "clicks" INTEGER NOT NULL,
  "impressions" INTEGER NOT NULL,
  "ctr" DOUBLE PRECISION NOT NULL,
  "position" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GscQueryPageFact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthStateNonce_stateHash_key" ON "OAuthStateNonce"("stateHash");
CREATE INDEX "OAuthState_project_expiry_idx" ON "OAuthStateNonce"("projectId", "expiresAt");
CREATE INDEX "OAuthState_provider_expiry_idx" ON "OAuthStateNonce"("provider", "expiresAt");
CREATE INDEX "OAuthCredential_project_provider_idx" ON "OAuthCredentialRecord"("projectId", "provider", "revokedAt");
CREATE UNIQUE INDEX "SearchConsoleConnection_credentialRef_key" ON "SearchConsoleConnection"("credentialRef");
CREATE INDEX "SearchConsoleConnection_project_status_idx" ON "SearchConsoleConnection"("projectId", "status");
CREATE UNIQUE INDEX "SearchConsoleProperty_connection_uri_key" ON "SearchConsoleProperty"("connectionId", "propertyUri");
CREATE INDEX "SearchConsoleProperty_project_active_idx" ON "SearchConsoleProperty"("projectId", "isActive");
CREATE UNIQUE INDEX "GscDailySnapshot_identity_key" ON "GscDailySnapshot"("projectId", "propertyId", "date", "syncVersion");
CREATE INDEX "GscDailySnapshot_project_date_status_idx" ON "GscDailySnapshot"("projectId", "date", "status");
CREATE INDEX "GscDailySnapshot_property_date_status_idx" ON "GscDailySnapshot"("propertyId", "date", "status");
CREATE UNIQUE INDEX "GscQueryPageFact_snapshot_fact_key" ON "GscQueryPageFact"("snapshotId", "factKey");
CREATE INDEX "GscQueryPageFact_project_date_idx" ON "GscQueryPageFact"("projectId", "date");
CREATE INDEX "GscQueryPageFact_snapshot_idx" ON "GscQueryPageFact"("snapshotId");

ALTER TABLE "SearchConsoleConnection" ADD CONSTRAINT "SearchConsoleConnection_credentialRef_fkey" FOREIGN KEY ("credentialRef") REFERENCES "OAuthCredentialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SearchConsoleProperty" ADD CONSTRAINT "SearchConsoleProperty_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SearchConsoleConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GscDailySnapshot" ADD CONSTRAINT "GscDailySnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "SearchConsoleProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GscQueryPageFact" ADD CONSTRAINT "GscQueryPageFact_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "GscDailySnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
