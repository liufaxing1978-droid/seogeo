import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import {
  createGrowthOpportunityExplanationTask
} from '../ai/growth-opportunity-explanation.js';
import type { AiTaskService } from '../ai/ai.service.js';

const emptyBodySchema = z.object({}).strict();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

export function createGrowthExplanationRoutes(
  aiService?: Pick<AiTaskService, 'createAndEnqueue'>
) {
  const router = Router();

  router.post(
    '/projects/:projectId/growth/opportunities/:opportunityId/explanation',
    requireFeature('GROWTH_AI_EXPLANATION'),
    async (req, res, next) => {
      try {
        emptyBodySchema.parse(req.body);
        const projectId = routeParam(req.params.projectId);
        const opportunityId = routeParam(req.params.opportunityId);
        const task = await createGrowthOpportunityExplanationTask(
          projectId,
          opportunityId,
          aiService
        );
        res.status(201).json({
          data: {
            id: task.id,
            projectId: task.projectId,
            taskType: task.taskType,
            status: task.status,
            promptVersion: task.promptVersion,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          }
        });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
