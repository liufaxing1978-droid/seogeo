import { createHash } from 'node:crypto';
import type {
  VisibilityAlertEvent,
  VisibilityAlertRule,
  VisibilityAlertRuleType,
  VisibilityAlertSeverity,
  VisibilityMetricActorType,
  VisibilityMetricDimensionType,
  VisibilityMetricStatus,
  VisibilityMetricType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  VisibilityHistoryObservability,
  visibilityHistoryObservability
} from './visibility-history.observability.js';

export class VisibilityAlertsError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'VisibilityAlertsError';
  }
}

export type AlertRuleContract = {
  ruleType: VisibilityAlertRuleType;
  thresholdBasisPoints: number | null;
  actorSubjectId: string | null;
};

export type AlertDeltaContract = {
  metricType: VisibilityMetricType;
  dimensionType: VisibilityMetricDimensionType;
  dimensionKey: string;
  actorType: VisibilityMetricActorType;
  actorSubjectId: string | null;
  actorKey: string;
  previousMetricStatus: VisibilityMetricStatus;
  currentMetricStatus: VisibilityMetricStatus;
  deltaBasisPoints: number | null;
};

export type CreateVisibilityAlertRuleInput = {
  ruleType: VisibilityAlertRuleType;
  name: string;
  enabled?: boolean;
  severity?: VisibilityAlertSeverity;
  thresholdBasisPoints?: number | null;
  actorSubjectId?: string | null;
};

export type UpdateVisibilityAlertRuleInput = Partial<Pick<CreateVisibilityAlertRuleInput,
  'name' | 'enabled' | 'severity' | 'thresholdBasisPoints' | 'actorSubjectId'>>;

const NUMERIC_RULES = new Set<VisibilityAlertRuleType>([
  'OWNED_MENTION_RATE_DROP',
  'OWNED_CITATION_RATE_DROP',
  'OWNED_SOV_DROP',
  'COMPETITOR_SOV_RISE',
  'EVIDENCE_COVERAGE_DROP'
]);

export function visibilityAlertFingerprint(ruleId: string, comparisonId: string, actorKey: string | null) {
  return createHash('sha256').update(`${ruleId}:${comparisonId}:${actorKey ?? 'NONE'}`).digest('hex');
}

export function evaluateVisibilityAlertRule(rule: AlertRuleContract, row: AlertDeltaContract): boolean {
  if (row.dimensionType !== 'OVERALL' || row.dimensionKey !== 'OVERALL') return false;

  if (rule.ruleType === 'METRIC_BECAME_UNKNOWN') {
    if (rule.actorSubjectId && row.actorSubjectId !== rule.actorSubjectId) return false;
    return row.previousMetricStatus !== 'UNKNOWN' && row.currentMetricStatus === 'UNKNOWN';
  }

  if (row.previousMetricStatus !== 'CALCULATED' || row.currentMetricStatus !== 'CALCULATED') return false;
  if (row.deltaBasisPoints === null || rule.thresholdBasisPoints === null) return false;

  switch (rule.ruleType) {
    case 'OWNED_MENTION_RATE_DROP':
      return row.actorKey === 'OWNED_ROLLUP' && row.metricType === 'MENTION_RATE' && row.deltaBasisPoints <= -rule.thresholdBasisPoints;
    case 'OWNED_CITATION_RATE_DROP':
      return row.actorKey === 'OWNED_ROLLUP' && row.metricType === 'CITATION_RATE' && row.deltaBasisPoints <= -rule.thresholdBasisPoints;
    case 'OWNED_SOV_DROP':
      return row.actorKey === 'OWNED_ROLLUP' && row.metricType === 'MENTION_SHARE_OF_VOICE' && row.deltaBasisPoints <= -rule.thresholdBasisPoints;
    case 'COMPETITOR_SOV_RISE':
      return row.actorType === 'COMPETITOR'
        && row.metricType === 'MENTION_SHARE_OF_VOICE'
        && (!rule.actorSubjectId || rule.actorSubjectId === row.actorSubjectId)
        && row.deltaBasisPoints >= rule.thresholdBasisPoints;
    default:
      return false;
  }
}

function validateThreshold(ruleType: VisibilityAlertRuleType, thresholdBasisPoints: number | null | undefined) {
  if (NUMERIC_RULES.has(ruleType)) {
    if (!Number.isInteger(thresholdBasisPoints) || Number(thresholdBasisPoints) < 1 || Number(thresholdBasisPoints) > 10_000) {
      throw new VisibilityAlertsError('VISIBILITY_ALERT_THRESHOLD_INVALID', 'Numeric alert threshold must be an integer from 1 to 10000 basis points');
    }
    return Number(thresholdBasisPoints);
  }
  if (thresholdBasisPoints !== undefined && thresholdBasisPoints !== null) {
    throw new VisibilityAlertsError('VISIBILITY_ALERT_THRESHOLD_INVALID', 'State-based alert rules do not accept a numeric threshold');
  }
  return null;
}

async function assertCompetitorSubject(projectId: string, actorSubjectId: string | null | undefined) {
  if (!actorSubjectId) return;
  const subject = await prisma.visibilitySubject.findFirst({
    where: { id: actorSubjectId, projectId, subjectType: 'COMPETITOR', status: 'ACTIVE' },
    select: { id: true }
  });
  if (!subject) {
    throw new VisibilityAlertsError('VISIBILITY_ALERT_COMPETITOR_INVALID', 'Competitor subject must be active and belong to the project');
  }
}

export class VisibilityAlertsService {
  constructor(
    private readonly observability: VisibilityHistoryObservability = visibilityHistoryObservability
  ) {}

  async createRule(projectId: string, input: CreateVisibilityAlertRuleInput): Promise<VisibilityAlertRule> {
    const thresholdBasisPoints = validateThreshold(input.ruleType, input.thresholdBasisPoints);
    await assertCompetitorSubject(projectId, input.actorSubjectId);
    const enabled = input.enabled ?? true;
    if (enabled) {
      const active = await prisma.visibilityAlertRule.count({ where: { projectId, enabled: true } });
      if (active >= 50) throw new VisibilityAlertsError('VISIBILITY_ALERT_RULE_LIMIT', 'A project may have at most 50 enabled visibility alert rules');
    }
    if (!input.name?.trim()) throw new VisibilityAlertsError('VISIBILITY_ALERT_NAME_REQUIRED', 'Alert rule name is required');
    return prisma.visibilityAlertRule.create({
      data: {
        projectId,
        ruleType: input.ruleType,
        name: input.name.trim(),
        enabled,
        severity: input.severity ?? 'WARNING',
        thresholdBasisPoints,
        actorSubjectId: input.actorSubjectId ?? null
      }
    });
  }

  async updateRule(projectId: string, ruleId: string, input: UpdateVisibilityAlertRuleInput): Promise<VisibilityAlertRule> {
    const current = await prisma.visibilityAlertRule.findFirst({ where: { id: ruleId, projectId } });
    if (!current) throw new VisibilityAlertsError('VISIBILITY_ALERT_RULE_NOT_FOUND', 'Visibility alert rule was not found');
    const thresholdBasisPoints = input.thresholdBasisPoints === undefined
      ? current.thresholdBasisPoints
      : validateThreshold(current.ruleType, input.thresholdBasisPoints);
    const actorSubjectId = input.actorSubjectId === undefined ? current.actorSubjectId : input.actorSubjectId;
    await assertCompetitorSubject(projectId, actorSubjectId);
    if (input.enabled === true && !current.enabled) {
      const active = await prisma.visibilityAlertRule.count({ where: { projectId, enabled: true } });
      if (active >= 50) throw new VisibilityAlertsError('VISIBILITY_ALERT_RULE_LIMIT', 'A project may have at most 50 enabled visibility alert rules');
    }
    if (input.name !== undefined && !input.name.trim()) throw new VisibilityAlertsError('VISIBILITY_ALERT_NAME_REQUIRED', 'Alert rule name is required');
    return prisma.visibilityAlertRule.update({
      where: { id: current.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.severity !== undefined ? { severity: input.severity } : {}),
        thresholdBasisPoints,
        actorSubjectId
      }
    });
  }

  async evaluateComparison(projectId: string, comparisonId: string): Promise<{ triggered: number; resolved: number }> {
    const comparison = await prisma.visibilityMetricComparison.findFirst({
      where: { id: comparisonId, projectId },
      include: { rows: true }
    });
    if (!comparison) throw new VisibilityAlertsError('VISIBILITY_ALERT_COMPARISON_NOT_FOUND', 'Visibility comparison was not found');

    const rules = await prisma.visibilityAlertRule.findMany({ where: { projectId, enabled: true }, orderBy: { createdAt: 'asc' } });
    if (rules.length === 0) return { triggered: 0, resolved: 0 };

    const [previousSnapshot, currentSnapshot] = await Promise.all([
      prisma.visibilityMetricSnapshot.findFirst({ where: { id: comparison.previousSnapshotId, projectId } }),
      prisma.visibilityMetricSnapshot.findFirst({ where: { id: comparison.currentSnapshotId, projectId } })
    ]);
    const triggeredAt = comparison.createdAt;
    let triggered = 0;
    let resolved = 0;

    for (const rule of rules) {
      const matches: Array<{ actorKey: string | null; deltaBasisPoints: number | null; previousMetricStatus: VisibilityMetricStatus | null; currentMetricStatus: VisibilityMetricStatus | null }> = [];
      if (rule.ruleType === 'EVIDENCE_COVERAGE_DROP') {
        if (previousSnapshot && currentSnapshot && previousSnapshot.candidateObservationCount > 0 && currentSnapshot.candidateObservationCount > 0 && rule.thresholdBasisPoints !== null) {
          const previousBp = Math.round(previousSnapshot.completedExtractionCount * 10_000 / previousSnapshot.candidateObservationCount);
          const currentBp = Math.round(currentSnapshot.completedExtractionCount * 10_000 / currentSnapshot.candidateObservationCount);
          const delta = currentBp - previousBp;
          if (delta <= -rule.thresholdBasisPoints) matches.push({ actorKey: null, deltaBasisPoints: delta, previousMetricStatus: null, currentMetricStatus: null });
        }
      } else {
        for (const row of comparison.rows) {
          if (evaluateVisibilityAlertRule(rule, row)) {
            matches.push({ actorKey: row.actorKey, deltaBasisPoints: row.deltaBasisPoints, previousMetricStatus: row.previousMetricStatus, currentMetricStatus: row.currentMetricStatus });
          }
        }
      }

      const activeKeys = new Set(matches.map((match) => match.actorKey ?? 'NONE'));
      for (const match of matches) {
        const fingerprint = visibilityAlertFingerprint(rule.id, comparison.id, match.actorKey);
        const existing = await prisma.visibilityAlertEvent.findUnique({ where: { eventFingerprint: fingerprint }, select: { id: true } });
        if (!existing) {
          const created = await prisma.visibilityAlertEvent.create({
            data: {
              projectId,
              alertRuleId: rule.id,
              comparisonId: comparison.id,
              actorKey: match.actorKey,
              eventFingerprint: fingerprint,
              status: 'OPEN',
              severity: rule.severity,
              reasonCode: rule.ruleType,
              deltaBasisPoints: match.deltaBasisPoints,
              previousMetricStatus: match.previousMetricStatus,
              currentMetricStatus: match.currentMetricStatus,
              triggeredAt
            }
          });
          this.observability.emit({
            event: 'visibility.alert.triggered',
            projectId,
            comparisonId: comparison.id,
            ruleId: rule.id,
            alertId: created.id,
            actorKey: match.actorKey ?? undefined,
            status: created.status,
            reasonCode: rule.ruleType,
            deltaBasisPoints: match.deltaBasisPoints ?? undefined,
            alertCount: 1
          });
          triggered += 1;
        }
      }

      const unresolved = await prisma.visibilityAlertEvent.findMany({
        where: { projectId, alertRuleId: rule.id, status: { in: ['OPEN', 'ACKNOWLEDGED'] }, comparisonId: { not: comparison.id } },
        select: { id: true, actorKey: true, comparisonId: true, reasonCode: true, deltaBasisPoints: true }
      });
      for (const event of unresolved) {
        if (activeKeys.has(event.actorKey ?? 'NONE')) continue;
        const updated = await prisma.visibilityAlertEvent.update({ where: { id: event.id }, data: { status: 'RESOLVED', resolvedAt: triggeredAt } });
        this.observability.emit({
          event: 'visibility.alert.resolved',
          projectId,
          comparisonId: event.comparisonId,
          ruleId: rule.id,
          alertId: updated.id,
          actorKey: event.actorKey ?? undefined,
          status: updated.status,
          reasonCode: event.reasonCode,
          deltaBasisPoints: event.deltaBasisPoints ?? undefined,
          alertCount: 1
        });
        resolved += 1;
      }
    }
    return { triggered, resolved };
  }

  async acknowledge(projectId: string, alertId: string): Promise<VisibilityAlertEvent> {
    const alert = await prisma.visibilityAlertEvent.findFirst({ where: { id: alertId, projectId } });
    if (!alert) throw new VisibilityAlertsError('VISIBILITY_ALERT_NOT_FOUND', 'Visibility alert was not found');
    if (alert.status === 'RESOLVED') return alert;
    if (alert.status === 'ACKNOWLEDGED') return alert;
    const updated = await prisma.visibilityAlertEvent.update({
      where: { id: alert.id },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() }
    });
    this.observability.emit({
      event: 'visibility.alert.acknowledged',
      projectId,
      comparisonId: updated.comparisonId,
      ruleId: updated.alertRuleId,
      alertId: updated.id,
      actorKey: updated.actorKey ?? undefined,
      status: updated.status,
      reasonCode: updated.reasonCode,
      deltaBasisPoints: updated.deltaBasisPoints ?? undefined,
      alertCount: 1
    });
    return updated;
  }
}
