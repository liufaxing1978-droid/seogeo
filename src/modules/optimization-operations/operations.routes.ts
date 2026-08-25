import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError } from '../../core/errors.js';
import {
  reviseAutopilotPolicy,
  type PolicyRevisionCommandInput,
  type PolicyRevisionCommandResult,
} from './policy-revision.command.js';
import {
  OptimizationOperationsService,
  type OperationsOverview,
} from './operations.service.js';

export interface OptimizationOperationsApiPort {
  getOverview(projectId: string): Promise<OperationsOverview | unknown>;
  listPipeline(projectId: string, limit: number, offset: number): Promise<unknown>;
  listInbox(projectId: string, limit: number, offset: number): Promise<unknown>;
  listExperiments(projectId: string, limit: number, offset: number): Promise<unknown>;
  listFeedback(projectId: string, limit: number, offset: number): Promise<unknown>;
  getPolicy(projectId: string): Promise<unknown>;
  listPolicyRevisions(projectId: string, limit: number, offset: number): Promise<unknown>;
}

export interface PolicyRevisionCommandPort {
  apply(input: PolicyRevisionCommandInput): Promise<PolicyRevisionCommandResult>;
}

export type OperationsActor = { actorId: string };

export interface OperationsActorResolver {
  resolve(req: Request): OperationsActor | null;
}

const projectIdSchema = z.string().uuid();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
const revisionPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

const policySchema = z.object({
  enabled: z.boolean(),
  dailyDraftPrLimit: z.number().int().min(1).max(10),
  maxConcurrentRuns: z.number().int().min(1).max(3),
  requireFreshEvidence: z.boolean(),
  minimumEvidenceCoverage: z.number().int().min(70).max(100),
  pauseOnVerificationFailure: z.boolean(),
  killSwitch: z.boolean(),
}).strict();

const policyRevisionBodySchema = z.object({
  requestId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().nullable(),
  policy: policySchema,
}).strict();

const validateProjectId: RequestHandler = (req, _res, next) => {
  try {
    projectIdSchema.parse(req.params.projectId);
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

function createDefaultOperationsApi(): OptimizationOperationsApiPort {
  const service = new OptimizationOperationsService();
  return {
    getOverview(projectId) {
      return service.getOverview(projectId);
    },
    listPipeline(projectId, limit, offset) {
      return service.listPipeline(projectId, { limit, offset });
    },
    listInbox(projectId, limit, offset) {
      return service.listInbox(projectId, { limit, offset });
    },
    listExperiments(projectId, limit, offset) {
      return service.listExperiments(projectId, { limit, offset });
    },
    listFeedback(projectId, limit, offset) {
      return service.listFeedback(projectId, { limit, offset });
    },
    getPolicy(projectId) {
      return service.getPolicy(projectId);
    },
    listPolicyRevisions(projectId, limit, offset) {
      return service.listPolicyRevisions(projectId, { limit, offset });
    },
  };
}

function createDefaultPolicyRevisionCommand(): PolicyRevisionCommandPort {
  return {
    apply(input) {
      return reviseAutopilotPolicy(input);
    },
  };
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object'
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, key);
}

function containsForbiddenPolicyMutationField(body: unknown): boolean {
  if (hasOwn(body, 'actorId') || hasOwn(body, 'allowedRiskClass') || hasOwn(body, 'allowedOperationClasses')) {
    return true;
  }
  if (typeof body !== 'object' || body === null || !('policy' in body)) return false;
  const policy = (body as { policy?: unknown }).policy;
  return hasOwn(policy, 'actorId')
    || hasOwn(policy, 'allowedRiskClass')
    || hasOwn(policy, 'allowedOperationClasses');
}

function forbiddenMutationError(): AppError {
  return new AppError(
    'Client may not set policy authority fields',
    400,
    'POLICY_MUTATION_FIELD_FORBIDDEN',
  );
}

function actorUnavailableError(): AppError {
  return new AppError(
    'Authenticated Operations actor is unavailable',
    503,
    'OPERATIONS_ACTOR_UNAVAILABLE',
  );
}

function mapPolicyCommandError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message === 'AUTOPILOT_POLICY_REVISION_CONFLICT') {
    return new AppError(
      'Autopilot policy changed since it was read',
      409,
      'AUTOPILOT_POLICY_CONFLICT',
    );
  }
  if (error.message === 'AUTOPILOT_POLICY_REVISION_IDEMPOTENCY_CONFLICT') {
    return new AppError(
      'Policy revision request id was already used for a different command',
      409,
      'AUTOPILOT_POLICY_REQUEST_COLLISION',
    );
  }
  if (error.message === 'AUTOPILOT_POLICY_REVISION_ACTOR_REQUIRED') {
    return actorUnavailableError();
  }
  return error;
}

export function createOptimizationOperationsRoutes(
  api: OptimizationOperationsApiPort = createDefaultOperationsApi(),
  policyRevisionCommand: PolicyRevisionCommandPort = createDefaultPolicyRevisionCommand(),
  actorResolver: OperationsActorResolver = unavailableActorResolver,
) {
  const router = Router();
  const gated = [validateProjectId, requireFeature('OPTIMIZATION_OPERATIONS_CENTER')] as const;

  router.get(
    '/projects/:projectId/optimization/operations',
    ...gated,
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const data = await api.getOverview(projectId);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  const listRoute = (
    path: string,
    read: (projectId: string, limit: number, offset: number) => Promise<unknown>,
    schema = paginationSchema,
  ) => {
    router.get(path, ...gated, async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const pagination = schema.parse(req.query);
        const data = await read(projectId, pagination.limit, pagination.offset);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    });
  };

  listRoute(
    '/projects/:projectId/optimization/operations/pipeline',
    (projectId, limit, offset) => api.listPipeline(projectId, limit, offset),
  );
  listRoute(
    '/projects/:projectId/optimization/operations/inbox',
    (projectId, limit, offset) => api.listInbox(projectId, limit, offset),
  );
  listRoute(
    '/projects/:projectId/optimization/operations/experiments',
    (projectId, limit, offset) => api.listExperiments(projectId, limit, offset),
  );
  listRoute(
    '/projects/:projectId/optimization/operations/feedback',
    (projectId, limit, offset) => api.listFeedback(projectId, limit, offset),
  );

  router.get(
    '/projects/:projectId/optimization/autopilot-policy',
    ...gated,
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        const data = await api.getPolicy(projectId);
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  listRoute(
    '/projects/:projectId/optimization/autopilot-policy/revisions',
    (projectId, limit, offset) => api.listPolicyRevisions(projectId, limit, offset),
    revisionPaginationSchema,
  );

  router.post(
    '/projects/:projectId/optimization/autopilot-policy/revisions',
    ...gated,
    async (req, res, next) => {
      try {
        const projectId = projectIdSchema.parse(req.params.projectId);
        if (containsForbiddenPolicyMutationField(req.body)) {
          throw forbiddenMutationError();
        }
        const body = policyRevisionBodySchema.parse(req.body);
        const actor = actorResolver.resolve(req);
        const actorId = actor?.actorId.trim() ?? '';
        if (actorId.length === 0) throw actorUnavailableError();

        const data = await policyRevisionCommand.apply({
          projectId,
          requestId: body.requestId,
          expectedUpdatedAt: body.expectedUpdatedAt,
          actorId,
          policy: body.policy,
        });
        res.status(data.status === 'APPLIED' ? 201 : 200).json({ data });
      } catch (error) {
        next(mapPolicyCommandError(error));
      }
    },
  );

  return router;
}
