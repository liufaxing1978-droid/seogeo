import type {
  GrowthLifecycleEventType,
  GrowthLifecycleStatus,
  GrowthOpportunityType,
  GrowthPriority
} from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireFeature } from '../../auth/require-feature.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

const BASIC_TYPES: readonly GrowthOpportunityType[] = [
  'RANKING_UPSIDE',
  'CTR_UNDERPERFORMANCE'
];

const opportunityTypeSchema = z.enum([
  'RANKING_UPSIDE',
  'CTR_UNDERPERFORMANCE',
  'CONTENT_GAP',
  'SEO_GAP',
  'GEO_CITABILITY_GAP',
  'AI_VISIBILITY_GAP',
  'KEYWORD_CANNIBALIZATION',
  'DECLINING_PERFORMANCE',
  'NEW_CONTENT_OPPORTUNITY'
]);
const prioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MONITOR', 'UNKNOWN']);
const boundedListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0)
}).strict();
const opportunityListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
  primaryType: opportunityTypeSchema.optional(),
  priority: prioritySchema.optional(),
  rankingEligible: z.enum(['true', 'false']).transform((value) => value === 'true').optional()
}).strict();
const lifecycleBodySchema = z.object({
  status: z.enum(['REVIEWED', 'PLANNED', 'IN_PROGRESS', 'DONE', 'DISMISSED'])
}).strict();

type OpportunityListInput = {
  limit: number;
  offset: number;
  basicOnly: boolean;
  primaryType?: GrowthOpportunityType;
  priority?: GrowthPriority;
  rankingEligible?: boolean;
};
type UserLifecycleTarget = 'REVIEWED' | 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED';

const allowedUserTransitions: Record<GrowthLifecycleStatus, readonly UserLifecycleTarget[]> = {
  NEW: ['REVIEWED', 'DISMISSED'],
  REVIEWED: ['PLANNED', 'DISMISSED'],
  PLANNED: ['IN_PROGRESS', 'DISMISSED'],
  IN_PROGRESS: ['DONE', 'DISMISSED'],
  DONE: [],
  DISMISSED: [],
  RESOLVED: [],
  REOPENED: ['REVIEWED', 'DISMISSED']
};

const lifecycleEventType: Record<UserLifecycleTarget, GrowthLifecycleEventType> = {
  REVIEWED: 'REVIEWED',
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'STARTED',
  DONE: 'DONE',
  DISMISSED: 'DISMISSED'
};

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function userLifecycleTimestamp(target: UserLifecycleTarget, now: Date) {
  switch (target) {
    case 'REVIEWED': return { reviewedAt: now };
    case 'PLANNED': return { plannedAt: now };
    case 'IN_PROGRESS': return { startedAt: now };
    case 'DONE': return { doneAt: now };
    case 'DISMISSED': return { dismissedAt: now };
  }
}

function basicOnly(planLevel: string): boolean {
  return planLevel === 'STANDARD';
}

function isBasicType(type: GrowthOpportunityType): boolean {
  return BASIC_TYPES.includes(type);
}

async function latestOpportunityWindowEnd(projectId: string): Promise<Date | null> {
  const latest = await prisma.growthOpportunitySnapshot.findFirst({
    where: { projectId },
    orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    select: { currentWindowEnd: true }
  });
  return latest?.currentWindowEnd ?? null;
}

async function latestTopicWindowEnd(projectId: string): Promise<Date | null> {
  const latest = await prisma.growthTopicClusterSnapshot.findFirst({
    where: { projectId },
    orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    select: { currentWindowEnd: true }
  });
  return latest?.currentWindowEnd ?? null;
}

export interface GrowthRestRepository {
  listOpportunities(projectId: string, input: OpportunityListInput): Promise<unknown[]>;
  getOpportunity(projectId: string, identityId: string, basicSurface: boolean): Promise<unknown | null>;
  listTopics(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  listCannibalization(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  listNewContent(projectId: string, limit: number, offset: number): Promise<unknown[]>;
  transitionLifecycle(
    projectId: string,
    identityId: string,
    target: UserLifecycleTarget,
    actorId: string
  ): Promise<unknown>;
}

export const growthRestRepository: GrowthRestRepository = {
  async listOpportunities(projectId, input) {
    const currentWindowEnd = await latestOpportunityWindowEnd(projectId);
    if (!currentWindowEnd) return [];

    if (input.basicOnly && input.primaryType && !isBasicType(input.primaryType)) return [];
    const primaryTypes = input.basicOnly
      ? (input.primaryType ? [input.primaryType] : [...BASIC_TYPES])
      : (input.primaryType ? [input.primaryType] : undefined);

    const snapshots = await prisma.growthOpportunitySnapshot.findMany({
      where: {
        projectId,
        currentWindowEnd,
        ...(primaryTypes ? { primaryType: { in: primaryTypes } } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.rankingEligible === undefined ? {} : { rankingEligible: input.rankingEligible })
      },
      select: {
        id: true,
        opportunityIdentityId: true,
        currentWindowStart: true,
        currentWindowEnd: true,
        dataCutoffAt: true,
        primaryType: true,
        secondaryTypes: true,
        score: true,
        priority: true,
        scoreState: true,
        evidenceQuality: true,
        evidenceCoverage: true,
        rankingEligible: true,
        identity: {
          select: {
            opportunityKey: true,
            identityType: true,
            normalizedQuery: true,
            canonicalPage: true
          }
        },
        breakdown: {
          select: {
            demandScore: true,
            positionPotentialScore: true,
            ctrGapScore: true,
            siteGapScore: true,
            gscTrendScore: true,
            p6VisibilityScore: true
          }
        }
      },
      orderBy: [{ score: 'desc' }, { id: 'asc' }],
      skip: input.offset,
      take: input.limit
    });

    const identityIds = snapshots.map((row) => row.opportunityIdentityId);
    const lifecycles = identityIds.length > 0
      ? await prisma.growthOpportunityLifecycle.findMany({
          where: { opportunityIdentityId: { in: identityIds } },
          select: { opportunityIdentityId: true, status: true }
        })
      : [];
    const lifecycleByIdentity = new Map(
      lifecycles.map((row) => [row.opportunityIdentityId, row.status])
    );

    return snapshots.map((row) => ({
      id: row.opportunityIdentityId,
      snapshotId: row.id,
      opportunityKey: row.identity.opportunityKey,
      identityType: row.identity.identityType,
      normalizedQuery: row.identity.normalizedQuery,
      canonicalPage: row.identity.canonicalPage,
      currentWindowStart: row.currentWindowStart,
      currentWindowEnd: row.currentWindowEnd,
      dataCutoffAt: row.dataCutoffAt,
      primaryType: row.primaryType,
      secondaryTypes: row.secondaryTypes,
      score: row.score,
      priority: row.priority,
      scoreState: row.scoreState,
      evidenceQuality: row.evidenceQuality,
      evidenceCoverage: row.evidenceCoverage,
      rankingEligible: row.rankingEligible,
      demandScore: row.breakdown?.demandScore ?? null,
      positionPotentialScore: row.breakdown?.positionPotentialScore ?? null,
      ctrGapScore: row.breakdown?.ctrGapScore ?? null,
      siteGapScore: row.breakdown?.siteGapScore ?? null,
      gscTrendScore: row.breakdown?.gscTrendScore ?? null,
      p6VisibilityScore: row.breakdown?.p6VisibilityScore ?? null,
      lifecycleStatus: lifecycleByIdentity.get(row.opportunityIdentityId) ?? null
    }));
  },

  async getOpportunity(projectId, identityId, basicSurface) {
    const identity = await prisma.growthOpportunityIdentity.findFirst({
      where: { id: identityId, projectId },
      select: {
        id: true,
        opportunityKey: true,
        identityType: true,
        normalizedQuery: true,
        canonicalPage: true,
        identityVersion: true,
        createdAt: true
      }
    });
    if (!identity) return null;

    const history = await prisma.growthOpportunitySnapshot.findMany({
      where: { projectId, opportunityIdentityId: identityId },
      select: {
        id: true,
        snapshotVersion: true,
        formulaVersion: true,
        currentWindowStart: true,
        currentWindowEnd: true,
        previousWindowStart: true,
        previousWindowEnd: true,
        dataCutoffAt: true,
        primaryType: true,
        secondaryTypes: true,
        score: true,
        priority: true,
        scoreState: true,
        evidenceQuality: true,
        evidenceCoverage: true,
        rankingEligible: true,
        sourceProvenance: true,
        createdAt: true,
        breakdown: true
      },
      orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 24
    });
    const latest = history[0];
    if (!latest || (basicSurface && !isBasicType(latest.primaryType))) return null;

    const [evidence, lifecycle, lifecycleEvents] = await Promise.all([
      prisma.growthOpportunityEvidence.findMany({
        where: { projectId, snapshotId: latest.id },
        orderBy: [{ sourceModule: 'asc' }, { ruleKey: 'asc' }, { fingerprint: 'asc' }],
        take: 200
      }),
      prisma.growthOpportunityLifecycle.findUnique({ where: { opportunityIdentityId: identityId } }),
      prisma.growthOpportunityLifecycleEvent.findMany({
        where: { opportunityIdentityId: identityId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 100
      })
    ]);

    return {
      identity,
      snapshot: {
        id: latest.id,
        snapshotVersion: latest.snapshotVersion,
        formulaVersion: latest.formulaVersion,
        currentWindowStart: latest.currentWindowStart,
        currentWindowEnd: latest.currentWindowEnd,
        previousWindowStart: latest.previousWindowStart,
        previousWindowEnd: latest.previousWindowEnd,
        dataCutoffAt: latest.dataCutoffAt,
        primaryType: latest.primaryType,
        secondaryTypes: latest.secondaryTypes,
        score: latest.score,
        priority: latest.priority,
        scoreState: latest.scoreState,
        evidenceQuality: latest.evidenceQuality,
        evidenceCoverage: latest.evidenceCoverage,
        rankingEligible: latest.rankingEligible,
        sourceProvenance: latest.sourceProvenance,
        createdAt: latest.createdAt
      },
      breakdown: latest.breakdown,
      evidence,
      history: history.map(({ breakdown: _breakdown, ...row }) => row),
      lifecycle,
      lifecycleEvents
    };
  },

  async listTopics(projectId, limit, offset) {
    const currentWindowEnd = await latestTopicWindowEnd(projectId);
    if (!currentWindowEnd) return [];
    return prisma.growthTopicClusterSnapshot.findMany({
      where: { projectId, currentWindowEnd },
      include: {
        topicCluster: {
          select: {
            id: true,
            topicKey: true,
            topicIdentityVersion: true,
            primaryEntityId: true,
            primaryQuery: true
          }
        }
      },
      orderBy: [{ topicScore: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit
    });
  },

  async listCannibalization(projectId, limit, offset) {
    const currentWindowEnd = await latestOpportunityWindowEnd(projectId);
    if (!currentWindowEnd) return [];
    return prisma.growthOpportunitySnapshot.findMany({
      where: {
        projectId,
        currentWindowEnd,
        identity: { identityType: 'KEYWORD_CANNIBALIZATION' }
      },
      include: { identity: true, breakdown: true },
      orderBy: [{ score: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit
    });
  },

  async listNewContent(projectId, limit, offset) {
    const currentWindowEnd = await latestOpportunityWindowEnd(projectId);
    if (!currentWindowEnd) return [];
    return prisma.growthOpportunitySnapshot.findMany({
      where: {
        projectId,
        currentWindowEnd,
        identity: { identityType: 'NEW_CONTENT_OPPORTUNITY' }
      },
      include: { identity: true, breakdown: true },
      orderBy: [{ score: 'desc' }, { id: 'asc' }],
      skip: offset,
      take: limit
    });
  },

  async transitionLifecycle(projectId, identityId, target, actorId) {
    const now = new Date();
    return prisma.$transaction(async (tx) => {
      const identity = await tx.growthOpportunityIdentity.findFirst({
        where: { id: identityId, projectId },
        select: { id: true }
      });
      if (!identity) {
        throw new NotFoundError('Growth opportunity not found', 'GROWTH_OPPORTUNITY_NOT_FOUND');
      }

      const lifecycle = await tx.growthOpportunityLifecycle.findUnique({
        where: { opportunityIdentityId: identityId }
      });
      if (!lifecycle) {
        throw new NotFoundError('Growth lifecycle not found', 'GROWTH_LIFECYCLE_NOT_FOUND');
      }
      if (!allowedUserTransitions[lifecycle.status].includes(target)) {
        throw new AppError(
          `Cannot transition Growth lifecycle from ${lifecycle.status} to ${target}`,
          400,
          'GROWTH_LIFECYCLE_TRANSITION_INVALID'
        );
      }

      const updated = await tx.growthOpportunityLifecycle.update({
        where: { opportunityIdentityId: identityId },
        data: {
          status: target,
          ...userLifecycleTimestamp(target, now)
        }
      });
      await tx.growthOpportunityLifecycleEvent.create({
        data: {
          opportunityIdentityId: identityId,
          eventType: lifecycleEventType[target],
          actorType: 'USER',
          actorId,
          fromStatus: lifecycle.status,
          toStatus: target,
          reasonCode: 'USER_LIFECYCLE_TRANSITION'
        }
      });
      return updated;
    });
  }
};

export function createGrowthRoutes(injectedRepository: Partial<GrowthRestRepository> = {}) {
  const router = Router();
  const repository: GrowthRestRepository = { ...growthRestRepository, ...injectedRepository };

  router.get(
    '/projects/:projectId/growth/opportunities',
    requireFeature('GROWTH_OPPORTUNITIES'),
    async (req, res, next) => {
      try {
        const input = opportunityListSchema.parse(req.query);
        const projectId = routeParam(req.params.projectId);
        const data = await repository.listOpportunities(projectId, {
          limit: input.limit,
          offset: input.offset,
          basicOnly: basicOnly(res.locals.project.planLevel),
          primaryType: input.primaryType,
          priority: input.priority,
          rankingEligible: input.rankingEligible
        });
        res.json({ data, meta: { limit: input.limit, offset: input.offset } });
      } catch (error) { next(error); }
    }
  );

  router.get(
    '/projects/:projectId/growth/opportunities/:opportunityId',
    requireFeature('GROWTH_OPPORTUNITIES'),
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const opportunityId = routeParam(req.params.opportunityId);
        const data = await repository.getOpportunity(
          projectId,
          opportunityId,
          basicOnly(res.locals.project.planLevel)
        );
        if (!data) {
          throw new NotFoundError('Growth opportunity not found', 'GROWTH_OPPORTUNITY_NOT_FOUND');
        }
        res.json({ data });
      } catch (error) { next(error); }
    }
  );

  router.post(
    '/projects/:projectId/growth/opportunities/:opportunityId/lifecycle',
    requireFeature('GROWTH_OPPORTUNITIES'),
    async (req, res, next) => {
      try {
        const input = lifecycleBodySchema.parse(req.body);
        const projectId = routeParam(req.params.projectId);
        const opportunityId = routeParam(req.params.opportunityId);
        if (basicOnly(res.locals.project.planLevel)) {
          const visible = await repository.getOpportunity(projectId, opportunityId, true);
          if (!visible) {
            throw new NotFoundError('Growth opportunity not found', 'GROWTH_OPPORTUNITY_NOT_FOUND');
          }
        }
        const data = await repository.transitionLifecycle(
          projectId,
          opportunityId,
          input.status,
          `project-api:${projectId}`
        );
        res.json({ data });
      } catch (error) { next(error); }
    }
  );

  router.get(
    '/projects/:projectId/growth/topics',
    requireFeature('GROWTH_TOPIC_CLUSTERS'),
    async (req, res, next) => {
      try {
        const { limit, offset } = boundedListSchema.parse(req.query);
        const projectId = routeParam(req.params.projectId);
        res.json({
          data: await repository.listTopics(projectId, limit, offset),
          meta: { limit, offset }
        });
      } catch (error) { next(error); }
    }
  );

  router.get(
    '/projects/:projectId/growth/cannibalization',
    requireFeature('GROWTH_CANNIBALIZATION'),
    async (req, res, next) => {
      try {
        const { limit, offset } = boundedListSchema.parse(req.query);
        const projectId = routeParam(req.params.projectId);
        res.json({
          data: await repository.listCannibalization(projectId, limit, offset),
          meta: { limit, offset }
        });
      } catch (error) { next(error); }
    }
  );

  router.get(
    '/projects/:projectId/growth/new-content',
    requireFeature('GROWTH_NEW_CONTENT'),
    async (req, res, next) => {
      try {
        const { limit, offset } = boundedListSchema.parse(req.query);
        const projectId = routeParam(req.params.projectId);
        res.json({
          data: await repository.listNewContent(projectId, limit, offset),
          meta: { limit, offset }
        });
      } catch (error) { next(error); }
    }
  );

  return router;
}
