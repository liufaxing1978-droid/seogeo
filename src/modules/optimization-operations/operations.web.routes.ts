import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import type { OperationsActorResolver } from './operations.routes.js';
import {
  OptimizationOperationsService,
  type OperationsOverview,
} from './operations.service.js';

export interface OptimizationOperationsWebReadPort {
  getOverview(projectId: string): Promise<OperationsOverview>;
  listInbox(projectId: string, limit: number, offset: number): Promise<unknown>;
  getPolicy(projectId: string): Promise<unknown>;
}

export type OperationsWebInboxItem = {
  id: string;
  category: string;
  severity: string;
  reasonCode: string;
  targetUrl: string | null;
  updatedAt: string;
  authorityUrl: string | null;
};

export type OperationsWebPolicy = {
  enabled: boolean;
  dailyDraftPrLimit: number;
  maxConcurrentRuns: number;
  requireFreshEvidence: boolean;
  minimumEvidenceCoverage: number;
  pauseOnVerificationFailure: boolean;
  killSwitch: boolean;
  updatedAt: string;
};

const projectIdSchema = z.string().uuid();

const validateProjectId: RequestHandler = (req, _res, next) => {
  try {
    projectIdSchema.parse(req.params.id);
    next();
  } catch (error) {
    next(error);
  }
};

const unavailableActorResolver: OperationsActorResolver = {
  resolve() {
    return null;
  },
};

function createDefaultOperationsWebReadPort(): OptimizationOperationsWebReadPort {
  const service = new OptimizationOperationsService();
  return {
    getOverview(projectId) {
      return service.getOverview(projectId);
    },
    listInbox(projectId, limit, offset) {
      return service.listInbox(projectId, { limit, offset });
    },
    getPolicy(projectId) {
      return service.getPolicy(projectId);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : null;
}

function asIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeInbox(value: unknown): OperationsWebInboxItem[] {
  if (!Array.isArray(value)) return [];
  const rows: OperationsWebInboxItem[] = [];
  for (const raw of value.slice(0, 8)) {
    const item = asRecord(raw);
    if (!item) continue;
    const id = asString(item.id);
    const category = asString(item.category);
    const severity = asString(item.severity);
    const reasonCode = asString(item.reasonCode);
    const updatedAt = asIso(item.updatedAt);
    if (!id || !category || !severity || !reasonCode || !updatedAt) continue;
    rows.push({
      id,
      category,
      severity,
      reasonCode,
      targetUrl: asString(item.targetUrl),
      updatedAt,
      authorityUrl: asString(item.authorityUrl),
    });
  }
  return rows;
}

function normalizePolicy(value: unknown): OperationsWebPolicy | null {
  const policy = asRecord(value);
  if (!policy) return null;
  const updatedAt = asIso(policy.updatedAt);
  if (
    typeof policy.enabled !== 'boolean'
    || typeof policy.dailyDraftPrLimit !== 'number'
    || typeof policy.maxConcurrentRuns !== 'number'
    || typeof policy.requireFreshEvidence !== 'boolean'
    || typeof policy.minimumEvidenceCoverage !== 'number'
    || typeof policy.pauseOnVerificationFailure !== 'boolean'
    || typeof policy.killSwitch !== 'boolean'
    || !updatedAt
  ) {
    return null;
  }
  return {
    enabled: policy.enabled,
    dailyDraftPrLimit: policy.dailyDraftPrLimit,
    maxConcurrentRuns: policy.maxConcurrentRuns,
    requireFreshEvidence: policy.requireFreshEvidence,
    minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
    pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
    killSwitch: policy.killSwitch,
    updatedAt,
  };
}

export function createOptimizationOperationsWebRoutes(
  api: OptimizationOperationsWebReadPort = createDefaultOperationsWebReadPort(),
  actorResolver: OperationsActorResolver = unavailableActorResolver,
) {
  const router = Router();

  router.get(
    '/projects/:id/optimization',
    validateProjectId,
    requireFeature('OPTIMIZATION_OPERATIONS_CENTER'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.id);
        const [overview, rawInbox, rawPolicy] = await Promise.all([
          api.getOverview(projectId),
          api.listInbox(projectId, 8, 0),
          api.getPolicy(projectId),
        ]);
        const actor = actorResolver.resolve(req);
        const policyMutationAvailable = Boolean(actor?.actorId.trim());

        res.render('layout', {
          title: '自动优化中心',
          activeNav: 'optimization-operations',
          project: res.locals.project,
          contentTemplate: 'optimization-operations/index',
          contentData: {
            project: res.locals.project,
            overview,
            inbox: normalizeInbox(rawInbox),
            policy: normalizePolicy(rawPolicy),
            policyMutationAvailable,
          },
          pageScripts: ['/assets/js/optimization-operations.js'],
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
