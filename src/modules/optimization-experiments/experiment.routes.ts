import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export interface OptimizationExperimentApiPort {
  listExperiments(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  getExperiment(projectId: string, experimentId: string): Promise<unknown | null>;
}

const projectIdSchema = z.string().uuid();
const experimentIdSchema = z.string().uuid();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
}).strict();

const validateProjectId: RequestHandler = (req, _res, next) => {
  try {
    projectIdSchema.parse(req.params.projectId);
    next();
  } catch (error) {
    next(error);
  }
};

function createDefaultOptimizationExperimentApi(): OptimizationExperimentApiPort {
  return {
    async listExperiments(projectId, limit, offset) {
      return prisma.optimizationExperiment.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        select: {
          id: true,
          projectId: true,
          optimizationPlanId: true,
          publicationExecutionId: true,
          publicationVerificationId: true,
          experimentVersion: true,
          interventionType: true,
          targetUrl: true,
          marketCode: true,
          locale: true,
          verifiedAnchorAt: true,
          measurementScopeJson: true,
          observationScheduleJson: true,
          expectedDirectionJson: true,
          createdAt: true,
          optimizationPlan: {
            select: {
              id: true,
              recommendedActionType: true
            }
          }
        }
      });
    },

    async getExperiment(projectId, experimentId) {
      return prisma.optimizationExperiment.findFirst({
        where: { id: experimentId, projectId },
        select: {
          id: true,
          projectId: true,
          optimizationPlanId: true,
          publicationExecutionId: true,
          publicationVerificationId: true,
          experimentVersion: true,
          interventionType: true,
          targetUrl: true,
          marketCode: true,
          locale: true,
          verifiedAnchorAt: true,
          measurementScopeJson: true,
          observationScheduleJson: true,
          expectedDirectionJson: true,
          createdAt: true,
          optimizationPlan: {
            select: {
              id: true,
              recommendedActionType: true
            }
          },
          observations: {
            orderBy: [
              { windowDays: 'asc' },
              { inputCutoffAt: 'desc' },
              { createdAt: 'desc' },
              { id: 'asc' }
            ],
            select: {
              id: true,
              projectId: true,
              experimentId: true,
              observationVersion: true,
              windowType: true,
              windowDays: true,
              dueAt: true,
              inputCutoffAt: true,
              baselineSearchSourceRefs: true,
              observedSearchSourceRefs: true,
              baselineVisibilitySourceRefs: true,
              observedVisibilitySourceRefs: true,
              baselineMetricsJson: true,
              observedMetricsJson: true,
              deltaMetricsJson: true,
              coverageState: true,
              contaminationState: true,
              effectState: true,
              reasonCodes: true,
              evaluatorVersion: true,
              createdAt: true
            }
          }
        }
      });
    }
  };
}

export function createOptimizationExperimentRoutes(
  api: OptimizationExperimentApiPort = createDefaultOptimizationExperimentApi()
) {
  const router = Router();

  router.get(
    '/projects/:projectId/optimization/experiments',
    validateProjectId,
    requireFeature('OPTIMIZATION_EXPERIMENTS'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const pagination = paginationSchema.parse(req.query);
        const data = await api.listExperiments(projectId, pagination.limit, pagination.offset);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/projects/:projectId/optimization/experiments/:experimentId',
    validateProjectId,
    requireFeature('OPTIMIZATION_EXPERIMENTS'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const experimentId = experimentIdSchema.parse(req.params.experimentId);
        const data = await api.getExperiment(projectId, experimentId);
        if (!data) {
          throw new NotFoundError('Optimization experiment not found', 'EXPERIMENT_NOT_FOUND');
        }
        res.json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
