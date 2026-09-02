import { Queue } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import { projectRepository } from '../projects/project.repository.js';
import { automationDefinitionManagementRepository } from './orchestration.automation-definition.repository.js';
import {
  OPTIMIZATION_AUTOMATION_QUEUE_NAME,
  OPTIMIZATION_PLANNING_QUEUE_NAME,
  OptimizationAutomationQueue,
  OptimizationPlanningQueue
} from './orchestration.queue.js';
import { optimizationOrchestrationRepository } from './orchestration.repository.js';
import {
  OptimizationOrchestrationService,
  type CreateManagedAutomationDefinitionInput,
  type UpdateManagedAutomationDefinitionInput
} from './orchestration.service.js';

export interface OptimizationOrchestrationApiPort {
  triggerManual(input: {
    projectId: string;
    manualRequestId: string;
    requestedBy: string;
  }): Promise<unknown>;
  listAutomationDefinitions?(projectId: string): Promise<unknown>;
  createAutomationDefinition?(input: CreateManagedAutomationDefinitionInput): Promise<unknown>;
  updateAutomationDefinition?(input: UpdateManagedAutomationDefinitionInput): Promise<unknown>;
  reconcileAutomationSchedules?(projectId: string): Promise<unknown>;
}

const projectIdSchema = z.string().uuid();
const definitionIdSchema = z.string().uuid();
const manualRunSchema = z.object({
  manualRequestId: z.string().uuid()
}).strict();
const actionConfigSchema = z.record(z.string(), z.unknown());
const automationDefinitionCreateSchema = z.object({
  key: z.string().trim().min(1).max(128),
  actionType: z.string().trim().min(1).max(128),
  actionConfig: actionConfigSchema,
  enabled: z.boolean(),
  scheduleCron: z.string().trim().min(1).max(256).nullable(),
  maxAttempts: z.number().int().min(1).max(10),
  timeoutMs: z.number().int().min(1_000).max(3_600_000)
}).strict();
const automationDefinitionPatchSchema = z.object({
  key: z.string().trim().min(1).max(128).optional(),
  actionType: z.string().trim().min(1).max(128).optional(),
  actionConfig: actionConfigSchema.optional(),
  enabled: z.boolean().optional(),
  scheduleCron: z.string().trim().min(1).max(256).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).optional()
}).strict().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: 'At least one automation definition field is required' }
);
const emptyBodySchema = z.object({}).strict();

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

class LazyOptimizationAutomationQueuePort {
  private queue: Queue | null = null;

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(OPTIMIZATION_AUTOMATION_QUEUE_NAME, {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  add: Queue['add'] = (name, data, options) => this.getQueue().add(name, data, options);
  upsertJobScheduler: Queue['upsertJobScheduler'] = (schedulerId, repeatOpts, jobTemplate) =>
    this.getQueue().upsertJobScheduler(schedulerId, repeatOpts, jobTemplate);
  removeJobScheduler: Queue['removeJobScheduler'] = (schedulerId) =>
    this.getQueue().removeJobScheduler(schedulerId);
}

function createDefaultOptimizationOrchestrationApi(): OptimizationOrchestrationApiPort {
  return new OptimizationOrchestrationService({
    repository: optimizationOrchestrationRepository,
    planningQueue: new OptimizationPlanningQueue(new LazyOptimizationPlanningQueuePort()),
    projects: projectRepository,
    automationDefinitions: automationDefinitionManagementRepository,
    automationSchedules: new OptimizationAutomationQueue(new LazyOptimizationAutomationQueuePort())
  });
}

function assertDefinitionManagementMethod(
  available: boolean,
  method: string
): void {
  if (!available) {
    throw new AppError(
      `Automation definition management method ${method} is unavailable`,
      503,
      'AUTOMATION_DEFINITION_MANAGEMENT_UNAVAILABLE'
    );
  }
}

export function createOptimizationOrchestrationRoutes(
  api: OptimizationOrchestrationApiPort = createDefaultOptimizationOrchestrationApi()
) {
  const router = Router();

  router.get(
    '/projects/:projectId/optimization/automation-definitions',
    requireAuthentication(),
    requireProjectMembership(),
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        assertDefinitionManagementMethod(
          typeof api.listAutomationDefinitions === 'function',
          'listAutomationDefinitions'
        );
        const data = await api.listAutomationDefinitions!(projectId);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/projects/:projectId/optimization/automation-definitions/reconcile',
    requireAuthentication(),
    requireProjectMembership(),
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
    requireCsrf(),
    async (req, res, next) => {
      try {
        emptyBodySchema.parse(req.body ?? {});
        const projectId = projectIdSchema.parse(req.params.projectId);
        assertDefinitionManagementMethod(
          typeof api.reconcileAutomationSchedules === 'function',
          'reconcileAutomationSchedules'
        );
        const data = await api.reconcileAutomationSchedules!(projectId);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/projects/:projectId/optimization/automation-definitions',
    requireAuthentication(),
    requireProjectMembership(),
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
    requireCsrf(),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const input = automationDefinitionCreateSchema.parse(req.body);
        assertDefinitionManagementMethod(
          typeof api.createAutomationDefinition === 'function',
          'createAutomationDefinition'
        );
        const data = await api.createAutomationDefinition!({
          projectId,
          ...input
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.patch(
    '/projects/:projectId/optimization/automation-definitions/:definitionId',
    requireAuthentication(),
    requireProjectMembership(),
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
    requireCsrf(),
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const definitionId = definitionIdSchema.parse(req.params.definitionId);
        const patch = automationDefinitionPatchSchema.parse(req.body);
        assertDefinitionManagementMethod(
          typeof api.updateAutomationDefinition === 'function',
          'updateAutomationDefinition'
        );
        const data = await api.updateAutomationDefinition!({
          projectId,
          definitionId,
          patch
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/projects/:projectId/optimization/runs',
    requireAuthentication(),
    requireProjectMembership(),
    requireFeature('OPTIMIZATION_ORCHESTRATION'),
    requireProjectCapability('OPTIMIZATION_RUN'),
    requireCsrf(),
    async (req, res, next) => {
      try {
        const input = manualRunSchema.parse(req.body);
        const projectId = projectIdSchema.parse(req.params.projectId);
        const data = await api.triggerManual({
          projectId,
          manualRequestId: input.manualRequestId,
          requestedBy: `user:${req.auth!.userId}`
        });
        res.status(202).json({ data });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
