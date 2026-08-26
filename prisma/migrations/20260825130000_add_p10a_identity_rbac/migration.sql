CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "SecurityAuditEventType" AS ENUM (
  'USER_PROVISIONED',
  'USER_DISABLED',
  'USER_ENABLED',
  'PASSWORD_CHANGED',
  'SESSION_CREATED',
  'SESSION_REVOKED',
  'SESSIONS_REVOKED_ALL',
  'MEMBERSHIP_CREATED',
  'MEMBERSHIP_REACTIVATED',
  'MEMBERSHIP_ROLE_CHANGED',
  'MEMBERSHIP_REVOKED'
);

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "normalizedEmail" TEXT NOT NULL,
  "displayName" TEXT,
  "passwordHash" TEXT NOT NULL,
  "passwordHashVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSession" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectMembership" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "ProjectRole" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityAuditEvent" (
  "id" UUID NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'SECURITY_AUDIT_V1',
  "eventType" "SecurityAuditEventType" NOT NULL,
  "actorUserId" UUID,
  "targetUserId" UUID,
  "projectId" UUID,
  "roleBefore" "ProjectRole",
  "roleAfter" "ProjectRole",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");
CREATE INDEX "UserSession_userId_expiresAt_idx" ON "UserSession"("userId", "expiresAt");
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");
CREATE INDEX "ProjectMembership_userId_status_idx" ON "ProjectMembership"("userId", "status");
CREATE INDEX "ProjectMembership_projectId_status_role_idx" ON "ProjectMembership"("projectId", "status", "role");
CREATE INDEX "SecurityAuditEvent_projectId_createdAt_idx" ON "SecurityAuditEvent"("projectId", "createdAt");
CREATE INDEX "SecurityAuditEvent_targetUserId_createdAt_idx" ON "SecurityAuditEvent"("targetUserId", "createdAt");

ALTER TABLE "UserSession"
ADD CONSTRAINT "UserSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMembership"
ADD CONSTRAINT "ProjectMembership_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectMembership"
ADD CONSTRAINT "ProjectMembership_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "reject_p10a_security_audit_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'P10-A immutable security audit row % cannot be updated or deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SecurityAuditEvent_immutable"
BEFORE UPDATE OR DELETE ON "SecurityAuditEvent"
FOR EACH ROW
EXECUTE FUNCTION "reject_p10a_security_audit_mutation"();
