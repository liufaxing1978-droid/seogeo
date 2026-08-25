import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export interface OptimizationFeedbackApiPort {
  listProfiles(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getProfile(projectId: string, profileId: string): Promise<unknown | null>;
  listEvidence(projectId: string, limit: number, offset: number): Promise<unknown[]>;
}

const projectIdSchema = z.string().uuid();
const profileIdSchema = z.string().uuid();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

const validateProjectId: RequestHandler = (req, _res, next) => {
  try {
    projectIdSchema.parse(req.params.projectId);
    next();
  } catch (error) {
    next(error);
  }
};

const profileSelect = {
  id: true,
  projectId: true,
  feedbackProfileVersion: true,
  profileKey: true,
  scopeKey: true,
  marketScopeMode: true,
  marketCode: true,
  locale: true,
  recommendedActionType: true,
  sampleCount: true,
  positiveCount: true,
  neutralCount: true,
  negativeCount: true,
  rollingEffectBalance: true,
  historicalRankAdjustment: true,
  windowLimit: true,
  oldestEvidenceCutoffAt: true,
  newestEvidenceCutoffAt: true,
  inputEvidenceIdsJson: true,
  inputFingerprint: true,
  createdAt: true,
} as const;

const evidenceSelect = {
  id: true,
  projectId: true,
  experimentId: true,
  observationId: true,
  optimizationPlanId: true,
  candidateId: true,
  feedbackEvidenceVersion: true,
  evidenceKey: true,
  scopeKey: true,
  marketScopeMode: true,
  marketCode: true,
  locale: true,
  recommendedActionType: true,
  effectState: true,
  feedbackValue: true,
  terminalWindowType: true,
  terminalWindowDays: true,
  inputCutoffAt: true,
  sourceEvaluatorVersion: true,
  sourceObservationKey: true,
  createdAt: true,
} as const;

function createDefaultOptimizationFeedbackApi(): OptimizationFeedbackApiPort {
  return {
    async listProfiles(projectId, limit, offset) {
      return prisma.optimizationFeedbackProfile.findMany({
        where: { projectId },
        orderBy: [
          { newestEvidenceCutoffAt: 'desc' },
          { inputFingerprint: 'desc' },
        ],
        take: limit,
        skip: offset,
        select: profileSelect,
      });
    },

    async getProfile(projectId, profileId) {
      return prisma.optimizationFeedbackProfile.findFirst({
        where: { id: profileId, projectId },
        select: profileSelect,
      });
    },

    async listEvidence(projectId, limit, offset) {
      return prisma.optimizationFeedbackEvidence.findMany({
        where: { projectId },
        orderBy: [
          { inputCutoffAt: 'desc' },
          { id: 'asc' },
        ],
        take: limit,
        skip: offset,
        select: evidenceSelect,
      });
    },
  };
}

export function createOptimizationFeedbackRoutes(
  api: OptimizationFeedbackApiPort = createDefaultOptimizationFeedbackApi(),
) {
  const router = Router();

  router.get(
    '/projects/:projectId/optimization-feedback/profiles',
    validateProjectId,
    requireFeature('OPTIMIZATION_FEEDBACK'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const pagination = paginationSchema.parse(req.query);
        const data = await api.listProfiles(projectId, pagination.limit, pagination.offset);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId/optimization-feedback/profiles/:profileId',
    validateProjectId,
    requireFeature('OPTIMIZATION_FEEDBACK'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const profileId = profileIdSchema.parse(req.params.profileId);
        const data = await api.getProfile(projectId, profileId);
        if (!data) {
          throw new NotFoundError(
            'Optimization feedback profile not found',
            'FEEDBACK_PROFILE_NOT_FOUND',
          );
        }
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId/optimization-feedback/evidence',
    validateProjectId,
    requireFeature('OPTIMIZATION_FEEDBACK'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const pagination = paginationSchema.parse(req.query);
        const data = await api.listEvidence(projectId, pagination.limit, pagination.offset);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
