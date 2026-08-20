CREATE TYPE "VisibilityAlertRuleType" AS ENUM ('OWNED_MENTION_RATE_DROP', 'OWNED_CITATION_RATE_DROP', 'OWNED_SOV_DROP', 'COMPETITOR_SOV_RISE', 'EVIDENCE_COVERAGE_DROP', 'METRIC_BECAME_UNKNOWN');
CREATE TYPE "VisibilityAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');
CREATE TYPE "VisibilityAlertEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

CREATE TABLE "VisibilityAlertRule" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "ruleType" "VisibilityAlertRuleType" NOT NULL,
  "name" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "severity" "VisibilityAlertSeverity" NOT NULL DEFAULT 'WARNING',
  "thresholdBasisPoints" INTEGER,
  "actorSubjectId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityAlertRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisibilityAlertEvent" (
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "alertRuleId" UUID NOT NULL,
  "comparisonId" UUID NOT NULL,
  "actorKey" TEXT,
  "eventFingerprint" TEXT NOT NULL,
  "status" "VisibilityAlertEventStatus" NOT NULL DEFAULT 'OPEN',
  "severity" "VisibilityAlertSeverity" NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "deltaBasisPoints" INTEGER,
  "previousMetricStatus" "VisibilityMetricStatus",
  "currentMetricStatus" "VisibilityMetricStatus",
  "triggeredAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisibilityAlertEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisibilityAlertEvent_eventFingerprint_key" ON "VisibilityAlertEvent"("eventFingerprint");
CREATE INDEX "VAlertRule_project_enabled_idx" ON "VisibilityAlertRule"("projectId", "enabled");
CREATE INDEX "VAlertRule_actor_subject_idx" ON "VisibilityAlertRule"("actorSubjectId");
CREATE INDEX "VAlertEvent_project_status_time_idx" ON "VisibilityAlertEvent"("projectId", "status", "triggeredAt");
CREATE INDEX "VAlertEvent_rule_actor_time_idx" ON "VisibilityAlertEvent"("alertRuleId", "actorKey", "triggeredAt");
CREATE INDEX "VAlertEvent_comparison_idx" ON "VisibilityAlertEvent"("comparisonId");

ALTER TABLE "VisibilityAlertEvent" ADD CONSTRAINT "VisibilityAlertEvent_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "VisibilityAlertRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisibilityAlertEvent" ADD CONSTRAINT "VisibilityAlertEvent_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "VisibilityMetricComparison"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
