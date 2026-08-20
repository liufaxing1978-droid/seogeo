import { Router } from 'express';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  VisibilityAlertsError,
  VisibilityAlertsService
} from './visibility-alerts.service.js';

const snapshotListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(180).default(30)
}).strict();

const comparisonListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

const alertListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional()
}).strict();

const seriesQuery = z.object({
  metricType: z.enum(['MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE']),
  dimensionType: z.enum(['OVERALL', 'PROVIDER', 'PROMPT_SET']),
  dimensionKey: z.string().min(1).max(200),
  actorKey: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(180).default(30)
}).strict();

const createRuleSchema = z.object({
  ruleType: z.enum([
    'OWNED_MENTION_RATE_DROP',
    'OWNED_CITATION_RATE_DROP',
    'OWNED_SOV_DROP',
    'COMPETITOR_SOV_RISE',
    'EVIDENCE_COVERAGE_DROP',
    'METRIC_BECAME_UNKNOWN'
  ]),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  thresholdBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(),
  actorSubjectId: z.string().uuid().nullable().optional()
}).strict();

const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  thresholdBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(),
  actorSubjectId: z.string().uuid().nullable().optional()
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: 'At least one field is required'
});

async function requireHistoryProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'COMPETITOR_SOV')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function ratio(metricStatus: string, numerator: number, denominator: number) {
  return metricStatus === 'CALCULATED' && denominator > 0 ? numerator / denominator : null;
}

function coverage(snapshot: { candidateObservationCount: number; completedExtractionCount: number }) {
  return snapshot.candidateObservationCount > 0
    ? snapshot.completedExtractionCount / snapshot.candidateObservationCount
    : null;
}

function snapshotSafe(snapshot: {
  id: string;
  projectId: string;
  status: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  scopeHash: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  candidateObservationCount: number;
  completedExtractionCount: number;
  missingExtractionCount: number;
  failedExtractionCount: number;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    ...snapshot,
    evidenceCoverageRatio: coverage(snapshot)
  };
}

function alertError(error: unknown): never {
  if (error instanceof VisibilityAlertsError) {
    const notFound = error.code.endsWith('_NOT_FOUND') || error.code === 'VISIBILITY_ALERT_COMPARISON_NOT_FOUND';
    throw new AppError(error.message, notFound ? 404 : 400, error.code);
  }
  throw error;
}

const snapshotSelect = {
  id: true,
  projectId: true,
  status: true,
  formulaVersion: true,
  extractorVersion: true,
  subjectSetHash: true,
  scopeHash: true,
  windowStart: true,
  windowEnd: true,
  inputCutoffAt: true,
  candidateObservationCount: true,
  completedExtractionCount: true,
  missingExtractionCount: true,
  failedExtractionCount: true,
  completedAt: true,
  createdAt: true
} as const;

export function createVisibilityHistoryRoutes(alertsService = new VisibilityAlertsService()) {
  const router = Router();

  router.get('/projects/:projectId/visibility/history/snapshots', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const { limit } = snapshotListQuery.parse(req.query);
      const snapshots = await prisma.visibilityMetricSnapshot.findMany({
        where: { projectId: req.params.projectId, status: 'COMPLETED' },
        select: snapshotSelect,
        orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }],
        take: limit
      });
      res.json({ data: snapshots.map(snapshotSafe) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/history/series', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const input = seriesQuery.parse(req.query);
      const rows = await prisma.visibilityMetricRow.findMany({
        where: {
          projectId: req.params.projectId,
          metricType: input.metricType,
          dimensionType: input.dimensionType,
          dimensionKey: input.dimensionKey,
          actorKey: input.actorKey,
          snapshot: { status: 'COMPLETED' }
        },
        select: {
          visibilityMetricSnapshotId: true,
          metricType: true,
          metricStatus: true,
          dimensionType: true,
          dimensionKey: true,
          actorType: true,
          actorSubjectId: true,
          actorKey: true,
          numerator: true,
          denominator: true,
          candidateObservationCount: true,
          eligibleObservationCount: true,
          notEligibleObservationCount: true,
          unknownObservationCount: true,
          snapshot: {
            select: {
              formulaVersion: true,
              extractorVersion: true,
              subjectSetHash: true,
              scopeHash: true,
              windowStart: true,
              windowEnd: true,
              inputCutoffAt: true,
              completedAt: true
            }
          }
        },
        orderBy: [{ snapshot: { windowEnd: 'desc' } }, { createdAt: 'desc' }],
        take: input.limit
      });
      res.json({
        data: rows.map((row) => ({
          ...row,
          ratio: ratio(row.metricStatus, row.numerator, row.denominator)
        }))
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/history/comparisons', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const { limit } = comparisonListQuery.parse(req.query);
      const comparisons = await prisma.visibilityMetricComparison.findMany({
        where: { projectId: req.params.projectId },
        select: {
          id: true,
          projectId: true,
          comparisonVersion: true,
          currentSnapshotId: true,
          previousSnapshotId: true,
          windowDurationMs: true,
          gapDurationMs: true,
          createdAt: true
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit
      });
      const snapshotIds = [...new Set(comparisons.flatMap((item) => [item.currentSnapshotId, item.previousSnapshotId]))];
      const snapshots = snapshotIds.length
        ? await prisma.visibilityMetricSnapshot.findMany({ where: { projectId: req.params.projectId, id: { in: snapshotIds } }, select: snapshotSelect })
        : [];
      const byId = new Map(snapshots.map((item) => [item.id, snapshotSafe(item)]));
      res.json({
        data: comparisons.map((item) => ({
          ...item,
          windowDurationMs: item.windowDurationMs.toString(),
          gapDurationMs: item.gapDurationMs.toString(),
          currentSnapshot: byId.get(item.currentSnapshotId) ?? null,
          previousSnapshot: byId.get(item.previousSnapshotId) ?? null
        }))
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/history/comparisons/:comparisonId', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const comparison = await prisma.visibilityMetricComparison.findFirst({
        where: { id: req.params.comparisonId, projectId: req.params.projectId },
        select: {
          id: true,
          projectId: true,
          comparisonVersion: true,
          currentSnapshotId: true,
          previousSnapshotId: true,
          windowDurationMs: true,
          gapDurationMs: true,
          createdAt: true,
          rows: {
            orderBy: [{ metricType: 'asc' }, { dimensionType: 'asc' }, { dimensionKey: 'asc' }, { actorKey: 'asc' }],
            select: {
              id: true,
              metricType: true,
              dimensionType: true,
              dimensionKey: true,
              actorType: true,
              actorSubjectId: true,
              actorKey: true,
              previousMetricStatus: true,
              currentMetricStatus: true,
              previousNumerator: true,
              previousDenominator: true,
              currentNumerator: true,
              currentDenominator: true,
              deltaBasisPoints: true
            }
          }
        }
      });
      if (!comparison) throw new NotFoundError('Visibility comparison not found', 'VISIBILITY_HISTORY_COMPARISON_NOT_FOUND');
      const snapshots = await prisma.visibilityMetricSnapshot.findMany({
        where: { projectId: req.params.projectId, id: { in: [comparison.currentSnapshotId, comparison.previousSnapshotId] } },
        select: snapshotSelect
      });
      const byId = new Map(snapshots.map((item) => [item.id, snapshotSafe(item)]));
      res.json({
        data: {
          ...comparison,
          windowDurationMs: comparison.windowDurationMs.toString(),
          gapDurationMs: comparison.gapDurationMs.toString(),
          currentSnapshot: byId.get(comparison.currentSnapshotId) ?? null,
          previousSnapshot: byId.get(comparison.previousSnapshotId) ?? null
        }
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/history/alerts', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const input = alertListQuery.parse(req.query);
      const data = await prisma.visibilityAlertEvent.findMany({
        where: {
          projectId: req.params.projectId,
          ...(input.status ? { status: input.status } : {})
        },
        select: {
          id: true,
          projectId: true,
          alertRuleId: true,
          comparisonId: true,
          actorKey: true,
          status: true,
          severity: true,
          reasonCode: true,
          deltaBasisPoints: true,
          previousMetricStatus: true,
          currentMetricStatus: true,
          triggeredAt: true,
          acknowledgedAt: true,
          resolvedAt: true,
          createdAt: true,
          updatedAt: true,
          rule: { select: { name: true, ruleType: true } }
        },
        orderBy: [{ triggeredAt: 'desc' }, { id: 'asc' }],
        take: input.limit
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/history/alert-rules', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const data = await prisma.visibilityAlertRule.findMany({
        where: { projectId: req.params.projectId },
        select: {
          id: true,
          projectId: true,
          ruleType: true,
          name: true,
          enabled: true,
          severity: true,
          thresholdBasisPoints: true,
          actorSubjectId: true,
          createdAt: true,
          updatedAt: true
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/visibility/history/alert-rules', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const input = createRuleSchema.parse(req.body);
      try {
        const data = await alertsService.createRule(req.params.projectId, input);
        res.status(201).json({ data });
      } catch (error) { alertError(error); }
    } catch (error) { next(error); }
  });

  router.patch('/projects/:projectId/visibility/history/alert-rules/:ruleId', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      const input = updateRuleSchema.parse(req.body);
      try {
        const data = await alertsService.updateRule(req.params.projectId, req.params.ruleId, input);
        res.json({ data });
      } catch (error) { alertError(error); }
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/visibility/history/alerts/:alertId/acknowledge', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.projectId);
      z.object({}).strict().parse(req.body ?? {});
      try {
        const data = await alertsService.acknowledge(req.params.projectId, req.params.alertId);
        res.json({ data });
      } catch (error) { alertError(error); }
    } catch (error) { next(error); }
  });

  return router;
}

export const visibilityHistoryRoutes = createVisibilityHistoryRoutes();
