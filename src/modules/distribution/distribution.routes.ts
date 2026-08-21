import type { DistributionMode, DistributionPlatform } from '@prisma/client';
import { Queue } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import {
  resolveDistributionCapability,
  type DistributionCapability
} from './distribution-adapter.js';
import { ManualHandoffDistributionAdapter } from './manual-handoff.adapter.js';
import {
  DISTRIBUTION_PREPARATION_QUEUE_NAME,
  DistributionPreparationQueue,
  type DistributionPreparationJobData
} from './distribution.queue.js';
import { DistributionRepository } from './distribution.repository.js';
import {
  DistributionService,
  DistributionServiceError,
  type DistributionPreparationQueuePort
} from './distribution.service.js';

const platformSchema = z.enum([
  'MEDIUM',
  'LINKEDIN',
  'SUBSTACK',
  'WORDPRESS',
  'BLOGGER',
  'REDDIT',
  'QUORA',
  'ZHIHU',
  'WIKIPEDIA',
  'WIKIDATA',
  'BAIDU_BAIKE'
]);

const modeSchema = z.enum([
  'CANONICAL_REPOST',
  'ADAPTED_ARTICLE',
  'SUMMARY',
  'SECONDARY_SITE',
  'COMMUNITY_DRAFT',
  'ENTITY_SUGGESTION'
]);

const createTargetSchema = z.object({
  publicationId: z.string().uuid(),
  platform: platformSchema,
  mode: modeSchema,
  targetKey: z.string().trim().min(1).max(120)
}).strict();

const prepareSchema = z.object({
  sourceContentVersion: z.number().int().min(1)
}).strict();

const emptyMutationSchema = z.object({}).strict();

const manualResultSchema = z.object({
  publicUrl: z.string().url().max(2_048).refine((value) => {
    try {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  }, 'publicUrl must use HTTP or HTTPS')
}).strict();

type CreateTargetBody = z.infer<typeof createTargetSchema>;

type DistributionTargetView = {
  id: string;
  projectId: string;
  platform: DistributionPlatform;
  mode: DistributionMode;
  capability: DistributionCapability;
  status: string;
  sourceContentVersion: number | null;
};

export interface DistributionApiPort {
  listCenter(projectId: string): Promise<unknown>;
  createTarget(projectId: string, body: CreateTargetBody): Promise<unknown>;
  getTarget(projectId: string, targetId: string): Promise<DistributionTargetView | null>;
  prepareTarget(projectId: string, targetId: string, sourceContentVersion: number): Promise<unknown>;
  approveArtifact(projectId: string, targetId: string, artifactId: string): Promise<unknown>;
  markManualActionRequired(projectId: string, targetId: string, artifactId: string): Promise<unknown>;
  publishArtifact(projectId: string, targetId: string, artifactId: string): Promise<unknown>;
  verifyArtifact(projectId: string, targetId: string, artifactId: string): Promise<unknown>;
  recordManualResult(projectId: string, targetId: string, artifactId: string, publicUrl: string): Promise<unknown>;
}

class LazyDistributionPreparationQueue implements DistributionPreparationQueuePort {
  private queue: Queue<DistributionPreparationJobData> | null = null;

  enqueue(targetId: string, sourceContentVersion: number) {
    if (!this.queue) {
      this.queue = new Queue<DistributionPreparationJobData>(DISTRIBUTION_PREPARATION_QUEUE_NAME, {
        connection: createRedisConnection()
      });
    }
    return new DistributionPreparationQueue(this.queue).enqueue(targetId, sourceContentVersion);
  }
}

const repository = new DistributionRepository();
const queuedService = new DistributionService({ queue: new LazyDistributionPreparationQueue() });
const service = new DistributionService();

function capabilityFor(platform: DistributionPlatform): DistributionCapability {
  return resolveDistributionCapability(platform, { trustedPublishAdapterConfigured: false });
}

function asTargetView(target: {
  id: string;
  projectId: string;
  platform: DistributionPlatform;
  mode: DistributionMode;
  status: string;
  sourceContentVersion: number | null;
}): DistributionTargetView {
  return {
    ...target,
    capability: capabilityFor(target.platform)
  };
}

function mapServiceError(error: unknown): never {
  if (error instanceof DistributionServiceError) {
    const status = error.code.endsWith('_NOT_FOUND') ? 404 : 409;
    throw new AppError(error.message, status, error.code);
  }
  throw error;
}

const defaultDistributionApi: DistributionApiPort = {
  async listCenter(projectId) {
    const [publications, targets] = await Promise.all([
      prisma.publicationExecution.findMany({
        where: { projectId, status: 'VERIFIED' },
        select: {
          id: true,
          status: true,
          createdAt: true,
          plan: {
            select: {
              draftVersion: true,
              targetPublicUrl: true,
              draft: { select: { title: true } }
            }
          }
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100
      }),
      prisma.distributionTarget.findMany({
        where: { projectId },
        select: {
          id: true,
          projectId: true,
          publicationId: true,
          platform: true,
          mode: true,
          targetKey: true,
          status: true,
          sourceContentVersion: true,
          updatedAt: true
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 200
      })
    ]);
    return {
      publications,
      targets: targets.map((target) => ({ ...target, capability: capabilityFor(target.platform) }))
    };
  },

  async createTarget(projectId, body) {
    const publication = await prisma.publicationExecution.findFirst({
      where: { id: body.publicationId, projectId, status: 'VERIFIED' },
      select: { id: true }
    });
    if (!publication) {
      throw new NotFoundError('Verified primary publication not found', 'DISTRIBUTION_PRIMARY_NOT_FOUND');
    }
    return repository.ensureTarget({ projectId, ...body });
  },

  async getTarget(projectId, targetId) {
    const target = await prisma.distributionTarget.findFirst({
      where: { id: targetId, projectId },
      select: {
        id: true,
        projectId: true,
        platform: true,
        mode: true,
        status: true,
        sourceContentVersion: true
      }
    });
    return target ? asTargetView(target) : null;
  },

  async prepareTarget(projectId, targetId, sourceContentVersion) {
    try {
      return await queuedService.requestPreparation({ projectId, targetId, sourceContentVersion });
    } catch (error) {
      return mapServiceError(error);
    }
  },

  async approveArtifact(projectId, targetId, artifactId) {
    try {
      return await service.approveArtifact({ projectId, targetId, artifactId });
    } catch (error) {
      return mapServiceError(error);
    }
  },

  async markManualActionRequired(projectId, targetId, artifactId) {
    const target = await prisma.distributionTarget.findFirst({ where: { id: targetId, projectId } });
    if (!target) throw new NotFoundError('Distribution target not found', 'DISTRIBUTION_TARGET_NOT_FOUND');
    try {
      await service.publishApprovedArtifact({
        projectId,
        targetId,
        artifactId,
        adapter: new ManualHandoffDistributionAdapter(target.platform as 'MEDIUM' | 'LINKEDIN' | 'SUBSTACK' | 'WORDPRESS' | 'BLOGGER')
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'DISTRIBUTION_MANUAL_ONLY') {
        return repository.getTarget(targetId);
      }
      return mapServiceError(error);
    }
    return repository.getTarget(targetId);
  },

  async publishArtifact() {
    throw new AppError(
      'Trusted distribution publishing adapter is not configured',
      503,
      'DISTRIBUTION_PUBLISH_ADAPTER_NOT_CONFIGURED'
    );
  },

  async verifyArtifact() {
    throw new AppError(
      'Trusted distribution verification adapter is not configured',
      503,
      'DISTRIBUTION_VERIFY_ADAPTER_NOT_CONFIGURED'
    );
  },

  async recordManualResult(projectId, targetId, artifactId, publicUrl) {
    try {
      return await service.recordManualPublicationResult({ projectId, targetId, artifactId, publicUrl });
    } catch (error) {
      return mapServiceError(error);
    }
  }
};

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function distributionGate() {
  return requireFeature('PUBLICATION_DISTRIBUTION');
}

async function requireTarget(api: DistributionApiPort, projectId: string, targetId: string) {
  const target = await api.getTarget(projectId, targetId);
  if (!target) throw new NotFoundError('Distribution target not found', 'DISTRIBUTION_TARGET_NOT_FOUND');
  return target;
}

export function createDistributionRoutes(api: DistributionApiPort = defaultDistributionApi) {
  const router = Router();

  router.get('/projects/:projectId/distribution', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const data = await api.listCenter(projectId);
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = createTargetSchema.parse(req.body);
      const data = await api.createTarget(projectId, body);
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets/:targetId/prepare', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const targetId = routeParam(req.params.targetId);
      const body = prepareSchema.parse(req.body);
      await requireTarget(api, projectId, targetId);
      const data = await api.prepareTarget(projectId, targetId, body.sourceContentVersion);
      res.status(202).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets/:targetId/artifacts/:artifactId/approve', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const targetId = routeParam(req.params.targetId);
      const artifactId = routeParam(req.params.artifactId);
      emptyMutationSchema.parse(req.body);
      await requireTarget(api, projectId, targetId);
      const data = await api.approveArtifact(projectId, targetId, artifactId);
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets/:targetId/artifacts/:artifactId/publish', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const targetId = routeParam(req.params.targetId);
      const artifactId = routeParam(req.params.artifactId);
      emptyMutationSchema.parse(req.body);
      const target = await requireTarget(api, projectId, targetId);
      if (target.capability === 'MANUAL_HANDOFF') {
        await api.markManualActionRequired(projectId, targetId, artifactId);
        throw new AppError('Distribution requires manual publishing handoff', 409, 'DISTRIBUTION_MANUAL_ONLY');
      }
      if (target.capability !== 'PUBLISH_API') {
        throw new AppError('Distribution target does not support automatic publishing', 409, 'DISTRIBUTION_NOT_SUPPORTED');
      }
      const data = await api.publishArtifact(projectId, targetId, artifactId);
      res.status(202).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets/:targetId/artifacts/:artifactId/verify', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const targetId = routeParam(req.params.targetId);
      const artifactId = routeParam(req.params.artifactId);
      emptyMutationSchema.parse(req.body);
      const target = await requireTarget(api, projectId, targetId);
      if (target.capability !== 'PUBLISH_API') {
        throw new AppError('Distribution target does not support trusted verification', 409, 'DISTRIBUTION_VERIFY_NOT_SUPPORTED');
      }
      const data = await api.verifyArtifact(projectId, targetId, artifactId);
      res.status(202).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/distribution/targets/:targetId/artifacts/:artifactId/manual-result', distributionGate(), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const targetId = routeParam(req.params.targetId);
      const artifactId = routeParam(req.params.artifactId);
      const body = manualResultSchema.parse(req.body);
      const target = await requireTarget(api, projectId, targetId);
      if (target.capability !== 'MANUAL_HANDOFF') {
        throw new AppError('Distribution target is not a manual handoff', 409, 'DISTRIBUTION_MANUAL_ONLY_REQUIRED');
      }
      const data = await api.recordManualResult(projectId, targetId, artifactId, body.publicUrl);
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });

  return router;
}