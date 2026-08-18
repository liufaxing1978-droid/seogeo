import { Prisma, type GeoAuditRunStatus, type GeoRuleOutcome } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logGeoEvent, sanitizeGeoError } from './geo-observability.js';

export interface GeoRuleResultWrite {
  pageId?: string | null;
  entityId?: string | null;
  ruleVersionId: string;
  resultKey: string;
  outcome: GeoRuleOutcome;
  evidence?: Record<string, unknown> | null;
}

export async function getGeoAuditContext(geoAuditRunId: string) {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    include: {
      project: true,
      crawlRun: true
    }
  });
  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);
  return audit;
}

export async function updateGeoAuditStatus(
  geoAuditRunId: string,
  status: GeoAuditRunStatus,
  data: {
    eligiblePages?: number;
    rulesEvaluated?: number;
    errorMessage?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  } = {}
) {
  const updated = await prisma.geoAuditRun.update({
    where: { id: geoAuditRunId },
    data: { status, ...data }
  });

  if (status === 'RUNNING' && data.startedAt) {
    logGeoEvent('geo.audit.started', {
      geoAuditRunId,
      projectId: updated.projectId,
      crawlRunId: updated.crawlRunId,
      engineVersion: updated.engineVersion
    });
  } else if (status === 'COMPLETED') {
    logGeoEvent('geo.audit.completed', {
      geoAuditRunId,
      projectId: updated.projectId,
      crawlRunId: updated.crawlRunId,
      engineVersion: updated.engineVersion,
      eligiblePages: updated.eligiblePages,
      rulesEvaluated: updated.rulesEvaluated
    });
  } else if (status === 'FAILED') {
    logGeoEvent('geo.audit.failed', {
      geoAuditRunId,
      projectId: updated.projectId,
      crawlRunId: updated.crawlRunId,
      engineVersion: updated.engineVersion,
      error: sanitizeGeoError(updated.errorMessage)
    });
  }

  return updated;
}

export async function replaceGeoRuleResults(
  geoAuditRunId: string,
  results: readonly GeoRuleResultWrite[]
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.geoRuleResult.deleteMany({ where: { geoAuditRunId } });
    for (const result of results) {
      await tx.geoRuleResult.create({
        data: {
          geoAuditRunId,
          pageId: result.pageId ?? null,
          entityId: result.entityId ?? null,
          ruleVersionId: result.ruleVersionId,
          resultKey: result.resultKey,
          outcome: result.outcome,
          ...(result.evidence
            ? { evidence: result.evidence as Prisma.InputJsonValue }
            : {})
        }
      });
    }
  });
}
