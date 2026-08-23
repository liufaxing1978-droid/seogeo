import { Queue } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { createRedisConnection } from '../../queue/connection.js';
import {
  OPTIMIZATION_PLANNING_QUEUE_NAME,
  OptimizationPlanningQueue
} from './orchestration.queue.js';
import { optimizationOrchestrationRepository } from './orchestration.repository.js';
import { OptimizationOrchestrationService } from './orchestration.service.js';
import { projectRepository } from '../projects/project.repository.js';

export interface OptimizationOrchestrationApiPort {
  triggerManual(input: {
    projectId: string;
    manualRequestId: string;
    requestedBy: string;
  }): Promise<unknown>;
}

const manualRunSchema = z.object({
  manualRequestId: z.string().uuid()
}).strict();

class LazyOptimizationPlanningQueuePort {
  private queue: Queue | null = null;

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(OPTIMIZATION_PLANNING_QUEUE_NAME, {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  add: Queue['add'] = (name, data, options) => this.getQueue().add(name, data, options);
}

function createDefaultOptimizationOrchestrationApi(): OptimizationOrchestrationApiPort {
  return new OptimizationOrchestrationService({
    repository: optimizationOrchestrationRepository,
    planningQueue: new OptimizationPlanningQueue(new LazyOptimizationPlanningQueuePort()),
    projects: projectRepository
  });
}

export function createOptimizationOrchestrationRoutes(
  api: OptimizationOrchestrationApiPort = createDefaultOptimizationOrchestrationApi()
) {
  const router = Router();

  router.post(
    '/projects/:projectId/optimization/runs',
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    async (req, res, next) => {
      try {
        const input = manualRunSchema.parse(req.body);
        const projectId = req.params.projectId;
        const data = await api.triggerManual({
          projectId,
          manualRequestId: input.manualRequestId,
          requestedBy: `project-api:${projectId}`
        });
        res.status(202).json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
