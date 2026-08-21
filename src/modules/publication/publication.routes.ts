import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { Queue, type JobsOptions } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import { approvePublicationPlan } from './publication-approval.js';
import {
  buildPublicationExecutionJobOptions,
  PUBLICATION_EXECUTION_QUEUE_NAME
} from './publication-execution.queue.js';
import { publicationService } from './publication.service.js';
import {
  buildPublicationVerificationJobOptions,
  PUBLICATION_VERIFICATION_QUEUE_NAME
} from './publication-verification.queue.js';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
}).strict();

const sourceReferenceSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(300).nullable().optional(),
  publisher: z.string().trim().max(300).nullable().optional(),
  sourceUrl: z.string().url().max(2_048).nullable().optional(),
  publishedAt: z.coerce.date().nullable().optional(),
  sourceType: z.string().trim().min(1).max(80),
  accessedAt: z.coerce.date().nullable().optional(),
  userProvided: z.boolean().optional(),
  internalRef: z.boolean().optional()
}).strict();

const manualProposalSchema = z.object({
  sourceType: z.literal('MANUAL'),
  reason: z.string().trim().min(1).max(1_000)
}).strict();

const growthProposalSchema = z.object({
  sourceType: z.literal('P7_GROWTH_OPPORTUNITY'),
  opportunityIdentityId: z.string().uuid()
}).strict();

const createProposalSchema = z.discriminatedUnion('sourceType', [
  manualProposalSchema,
  growthProposalSchema
]);

const createDraftSchema = z.object({
  proposalId: z.string().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  slugCandidate: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(200_000),
  excerpt: z.string().max(2_000).nullable().optional(),
  metaTitle: z.string().max(300).nullable().optional(),
  metaDescription: z.string().max(1_000).nullable().optional(),
  canonicalCandidate: z.string().url().max(2_048).nullable().optional(),
  schemaJson: z.unknown().nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  language: z.string().trim().min(2).max(32),
  sourceReferences: z.array(sourceReferenceSchema).max(50).optional()
}).strict();

const createDraftVersionSchema = z.object({
  expectedVersion: z.number().int().min(1),
  title: z.string().trim().min(1).max(300).optional(),
  slugCandidate: z.string().trim().max(200).nullable().optional(),
  body: z.string().min(1).max(200_000).optional(),
  excerpt: z.string().max(2_000).nullable().optional(),
  metaTitle: z.string().max(300).nullable().optional(),
  metaDescription: z.string().max(1_000).nullable().optional(),
  canonicalCandidate: z.string().url().max(2_048).nullable().optional(),
  schemaJson: z.unknown().nullable().optional(),
  author: z.string().max(300).nullable().optional(),
  language: z.string().trim().min(2).max(32).optional(),
  sourceReferences: z.array(sourceReferenceSchema).max(50).optional()
}).strict();

const createPlanSchema = z.object({
  proposalId: z.string().min(1).max(120),
  draftId: z.string().min(1).max(120),
  draftVersion: z.number().int().min(1),
  siteId: z.string().min(1).max(120),
  channelId: z.string().min(1).max(120).optional(),
  intent: z.enum(['CREATE', 'UPDATE'])
}).strict();

const approvalSchema = z.object({
  expectedPlanHash: z.string().regex(/^[a-f0-9]{64}$/i),
  expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/i),
  expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/i),
  confirmedRisk: z.literal('MEDIUM').optional(),
  confirmedWarningCodes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  expiresAt: z.coerce.date().optional()
}).strict();

const emptyMutationSchema = z.object({}).strict();

type ProposalBody = z.infer<typeof createProposalSchema>;
type DraftBody = z.infer<typeof createDraftSchema>;
type DraftVersionBody = z.infer<typeof createDraftVersionSchema>;
type PlanBody = z.infer<typeof createPlanSchema>;
type ApprovalBody = z.infer<typeof approvalSchema>;

export interface PublicationApiPort {
  listProposals(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  createProposal(projectId: string, body: ProposalBody, actorId: string): Promise<unknown>;
  listDrafts(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  createDraft(projectId: string, body: DraftBody): Promise<unknown>;
  createDraftVersion(projectId: string, draftId: string, body: DraftVersionBody): Promise<unknown>;
  listPlans(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  createPlan(projectId: string, body: PlanBody): Promise<unknown>;
  getPlan(projectId: string, planId: string): Promise<unknown | null>;
  approvePlan(projectId: string, planId: string, body: ApprovalBody, actorId: string): Promise<unknown>;
  executePlan(projectId: string, planId: string, actorId: string): Promise<unknown>;
  getExecution(projectId: string, executionId: string): Promise<unknown | null>;
  verifyExecution(projectId: string, executionId: string, actorId: string): Promise<unknown>;
  getDraft?(projectId: string, draftId: string): Promise<unknown | null>;
}

interface JobQueue {
  add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
}

class LazyPublicationQueue implements JobQueue {
  private queue: Queue<any, any, string> | null = null;

  constructor(private readonly queueName: string) {}

  add(name: string, data: unknown, options: JobsOptions) {
    if (!this.queue) {
      this.queue = new Queue<any, any, string>(this.queueName, {
        connection: createRedisConnection()
      });
    }
    return this.queue.add(name, data, options);
  }
}

const executionQueue = new LazyPublicationQueue(PUBLICATION_EXECUTION_QUEUE_NAME);
const verificationQueue = new LazyPublicationQueue(PUBLICATION_VERIFICATION_QUEUE_NAME);

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function actorId(projectId: string): string {
  return `project-api:${projectId}`;
}

function executionKey(planId: string, approvalId: string, planHash: string): string {
  return createHash('sha256')
    .update('PUBLICATION_EXECUTION_KEY_V1\0', 'utf8')
    .update(planId, 'utf8')
    .update('\0', 'utf8')
    .update(approvalId, 'utf8')
    .update('\0', 'utf8')
    .update(planHash, 'utf8')
    .digest('hex');
}

async function attachSourceReferences(
  draftId: string,
  references: DraftBody['sourceReferences'] | DraftVersionBody['sourceReferences']
) {
  for (const source of references ?? []) {
    await publicationService.addSourceReference(draftId, source);
  }
}

const defaultPublicationApi: PublicationApiPort = {
  listProposals(projectId, limit, offset) {
    return prisma.publicationProposal.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset
    });
  },

  async createProposal(projectId, body, requestActorId) {
    if (body.sourceType === 'P7_GROWTH_OPPORTUNITY') {
      return publicationService.createProposalFromGrowthOpportunity(
        projectId,
        body.opportunityIdentityId,
        requestActorId
      );
    }
    return publicationService.createManualProposal(projectId, { reason: body.reason }, requestActorId);
  },

  listDrafts(projectId, limit, offset) {
    return prisma.contentDraft.findMany({
      where: { projectId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      skip: offset
    });
  },

  async createDraft(projectId, body) {
    const proposal = await prisma.publicationProposal.findFirst({
      where: { id: body.proposalId, projectId },
      select: { id: true }
    });
    if (!proposal) {
      throw new NotFoundError('Publication proposal not found', 'PUBLICATION_PROPOSAL_NOT_FOUND');
    }
    const { proposalId, sourceReferences, schemaJson, ...draftInput } = body;
    const draft = await publicationService.createDraftFromProposal(proposalId, {
      ...draftInput,
      schemaJson: schemaJson as Prisma.InputJsonValue | null | undefined,
      generatedBy: 'HUMAN'
    });
    await attachSourceReferences(draft.id, sourceReferences);
    return draft;
  },

  async createDraftVersion(projectId, draftId, body) {
    const draft = await prisma.contentDraft.findFirst({
      where: { id: draftId, projectId },
      select: { id: true }
    });
    if (!draft) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
    const { expectedVersion, sourceReferences, schemaJson, ...changes } = body;
    const version = await publicationService.saveDraftVersion(
      draftId,
      expectedVersion,
      {
        ...changes,
        schemaJson: schemaJson as Prisma.InputJsonValue | null | undefined
      },
      'HUMAN'
    );
    await attachSourceReferences(draftId, sourceReferences);
    return version;
  },

  listPlans(projectId, limit, offset) {
    return prisma.publicationPlan.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      include: { preview: true },
      take: limit,
      skip: offset
    });
  },

  async createPlan(projectId, body) {
    const proposal = await prisma.publicationProposal.findFirst({
      where: { id: body.proposalId, projectId },
      select: { id: true }
    });
    const draft = await prisma.contentDraft.findFirst({
      where: { id: body.draftId, projectId },
      select: { id: true }
    });
    const site = await prisma.publicationSite.findFirst({
      where: { id: body.siteId, projectId, enabled: true },
      select: { id: true }
    });
    if (!proposal || !draft || !site) {
      throw new NotFoundError('Publication planning source not found', 'PUBLICATION_PLAN_SOURCE_NOT_FOUND');
    }
    if (body.channelId) {
      const channel = await prisma.publicationChannel.findFirst({
        where: { id: body.channelId, site: { projectId }, enabled: true },
        select: { id: true }
      });
      if (!channel) throw new NotFoundError('Publication channel not found', 'PUBLICATION_CHANNEL_NOT_FOUND');
    }
    throw new AppError(
      'Publication plan creation requires a configured mutation target snapshot provider',
      503,
      'MUTATION_NOT_CONFIGURED'
    );
  },

  getPlan(projectId, planId) {
    return prisma.publicationPlan.findFirst({
      where: { id: planId, projectId },
      include: {
        preview: true,
        approvals: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10 },
        executions: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10 }
      }
    });
  },

  approvePlan(projectId, planId, body, requestActorId) {
    return approvePublicationPlan(
      {
        projectId,
        planId,
        expectedPlanHash: body.expectedPlanHash,
        expectedContentHash: body.expectedContentHash,
        expectedPreviewHash: body.expectedPreviewHash,
        confirmedRisk: body.confirmedRisk,
        confirmedWarningCodes: body.confirmedWarningCodes,
        expiresAt: body.expiresAt
      },
      { actorId: requestActorId }
    );
  },

  async executePlan(projectId, planId) {
    const plan = await prisma.publicationPlan.findFirst({
      where: { id: planId, projectId },
      select: { id: true, planHash: true }
    });
    if (!plan) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');

    const approval = await prisma.publicationApproval.findFirst({
      where: { projectId, planId },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    if (!approval) {
      throw new AppError('Publication plan requires approval before execution', 409, 'APPROVAL_REQUIRED');
    }

    const key = executionKey(plan.id, approval.id, plan.planHash);
    let execution = await prisma.publicationExecution.findUnique({ where: { executionKey: key } });
    if (!execution) {
      execution = await prisma.publicationExecution.create({
        data: {
          projectId,
          planId,
          approvalId: approval.id,
          executionKey: key,
          status: 'APPROVED'
        }
      });
    }

    if (!['PR_CREATED', 'DEPLOYED', 'VERIFYING', 'VERIFIED', 'VERIFICATION_FAILED'].includes(execution.status)) {
      await executionQueue.add(
        'execute',
        { executionId: execution.id },
        buildPublicationExecutionJobOptions(key)
      );
    }
    return execution;
  },

  getExecution(projectId, executionId) {
    return prisma.publicationExecution.findFirst({
      where: { id: executionId, projectId },
      include: {
        verifications: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 },
        rollbackProposals: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 }
      }
    });
  },

  async verifyExecution(projectId, executionId) {
    const execution = await prisma.publicationExecution.findFirst({
      where: { id: executionId, projectId },
      select: { id: true, status: true }
    });
    if (!execution) {
      throw new NotFoundError('Publication execution not found', 'PUBLICATION_EXECUTION_NOT_FOUND');
    }
    await verificationQueue.add(
      'verify',
      { executionId },
      buildPublicationVerificationJobOptions(executionId)
    );
    return { executionId, projectId, queued: true, status: execution.status };
  },

  getDraft(projectId, draftId) {
    return prisma.contentDraft.findFirst({
      where: { id: draftId, projectId },
      include: {
        versions: { orderBy: [{ version: 'desc' }, { id: 'asc' }], take: 100 },
        sourceRefs: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 }
      }
    });
  }
};

function workspaceGate() {
  return requireFeature('PUBLICATION_WORKSPACE');
}

function executionGate() {
  return requireFeature('PUBLICATION_GIT_EXECUTION');
}

export function createPublicationRoutes(api: PublicationApiPort = defaultPublicationApi) {
  const router = Router();

  router.get('/projects/:projectId/publication/proposals', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const pagination = paginationSchema.parse(req.query);
      const data = await api.listProposals(projectId, pagination.limit, pagination.offset);
      res.json({ data, meta: pagination });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/proposals', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = createProposalSchema.parse(req.body);
      const data = await api.createProposal(projectId, body, actorId(projectId));
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/publication/drafts', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const pagination = paginationSchema.parse(req.query);
      const data = await api.listDrafts(projectId, pagination.limit, pagination.offset);
      res.json({ data, meta: pagination });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/drafts', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = createDraftSchema.parse(req.body);
      const data = await api.createDraft(projectId, body);
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/publication/drafts/:draftId', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const draftId = routeParam(req.params.draftId);
      const data = api.getDraft ? await api.getDraft(projectId, draftId) : null;
      if (!data) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/drafts/:draftId/versions', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const draftId = routeParam(req.params.draftId);
      const body = createDraftVersionSchema.parse(req.body);
      const data = await api.createDraftVersion(projectId, draftId, body);
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/publication/plans', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const pagination = paginationSchema.parse(req.query);
      const data = await api.listPlans(projectId, pagination.limit, pagination.offset);
      res.json({ data, meta: pagination });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/plans', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = createPlanSchema.parse(req.body);
      const data = await api.createPlan(projectId, body);
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/publication/plans/:planId', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const planId = routeParam(req.params.planId);
      const data = await api.getPlan(projectId, planId);
      if (!data) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/plans/:planId/approve', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const planId = routeParam(req.params.planId);
      const body = approvalSchema.parse(req.body);
      const plan = await api.getPlan(projectId, planId);
      if (!plan) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');
      const data = await api.approvePlan(projectId, planId, body, actorId(projectId));
      res.status(201).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/plans/:planId/execute', executionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const planId = routeParam(req.params.planId);
      emptyMutationSchema.parse(req.body);
      const plan = await api.getPlan(projectId, planId);
      if (!plan) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');
      const data = await api.executePlan(projectId, planId, actorId(projectId));
      res.status(202).json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/publication/executions/:executionId', workspaceGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const executionId = routeParam(req.params.executionId);
      const data = await api.getExecution(projectId, executionId);
      if (!data) {
        throw new NotFoundError('Publication execution not found', 'PUBLICATION_EXECUTION_NOT_FOUND');
      }
      res.json({ data });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/publication/executions/:executionId/verify', executionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const executionId = routeParam(req.params.executionId);
      emptyMutationSchema.parse(req.body);
      const execution = await api.getExecution(projectId, executionId);
      if (!execution) {
        throw new NotFoundError('Publication execution not found', 'PUBLICATION_EXECUTION_NOT_FOUND');
      }
      const data = await api.verifyExecution(projectId, executionId, actorId(projectId));
      res.status(202).json({ data });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
