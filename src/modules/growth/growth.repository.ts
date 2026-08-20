import { createHash } from 'node:crypto';
import {
  Prisma,
  type GrowthComponentState,
  type GrowthEvidenceQuality,
  type GrowthEvidenceSeverity,
  type GrowthEvidenceSourceModule,
  type GrowthEvidenceState,
  type GrowthIdentityType as PrismaGrowthIdentityType,
  type GrowthLifecycleActorType,
  type GrowthLifecycleEventType,
  type GrowthLifecycleStatus,
  type GrowthOpportunityType,
  type GrowthPriority,
  type GrowthScoreState
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const GROWTH_IDENTITY_VERSION = 'GROWTH_IDENTITY_V1';

export type GrowthIdentityType =
  | 'QUERY_PAGE_GROWTH'
  | 'KEYWORD_CANNIBALIZATION'
  | 'NEW_CONTENT_OPPORTUNITY';

export type GrowthIdentityInput =
  | {
      projectId: string;
      identityType: 'QUERY_PAGE_GROWTH';
      normalizedQuery: string;
      canonicalPage: string;
    }
  | {
      projectId: string;
      identityType: 'KEYWORD_CANNIBALIZATION';
      normalizedQuery: string;
      canonicalPages: readonly string[];
    }
  | {
      projectId: string;
      identityType: 'NEW_CONTENT_OPPORTUNITY';
      normalizedQuery: string;
    };

type OpportunityEvidenceInput = {
  sourceModule: GrowthEvidenceSourceModule;
  sourceType: string;
  sourceId: string;
  sourceFactVersion: string;
  ruleKey: string;
  rootCauseKey: string;
  evidenceState: GrowthEvidenceState;
  severity?: GrowthEvidenceSeverity | null;
  numericValue?: number | null;
  textSummary?: string | null;
  fingerprint: string;
};

type ScoreBreakdownInput = {
  demandState: GrowthComponentState;
  demandScore?: number | null;
  positionPotentialState: GrowthComponentState;
  positionPotentialScore?: number | null;
  ctrGapState: GrowthComponentState;
  ctrGapScore?: number | null;
  siteGapState: GrowthComponentState;
  siteGapScore?: number | null;
  gscTrendState: GrowthComponentState;
  gscTrendScore?: number | null;
  p6VisibilityState: GrowthComponentState;
  p6VisibilityScore?: number | null;
  trendVisibilityDisplayState: GrowthComponentState;
  trendVisibilityDisplayScore?: number | null;
  availableWeight: number;
  evidenceCoverage: number;
  weightedTotal?: number | null;
  formulaVersion: string;
};

export type CreateOpportunitySnapshotInput = {
  opportunityIdentityId: string;
  projectId: string;
  snapshotVersion: string;
  formulaVersion: string;
  currentWindowStart: Date;
  currentWindowEnd: Date;
  previousWindowStart: Date;
  previousWindowEnd: Date;
  dataCutoffAt: Date;
  topicClusterId?: string | null;
  primaryType: GrowthOpportunityType;
  secondaryTypes: readonly GrowthOpportunityType[];
  score?: number | null;
  priority: GrowthPriority;
  scoreState: GrowthScoreState;
  evidenceQuality: GrowthEvidenceQuality;
  evidenceCoverage: number;
  rankingEligible: boolean;
  sourceProvenance: unknown;
  breakdown: ScoreBreakdownInput;
  evidence: readonly OpportunityEvidenceInput[];
};

export type CreateTopicClusterInput = {
  projectId: string;
  topicIdentityVersion: string;
  topicKey: string;
  primaryEntityId?: string | null;
  primaryQuery: string;
};

export type CreateTopicSnapshotInput = {
  topicClusterId: string;
  projectId: string;
  snapshotVersion: string;
  currentWindowStart: Date;
  currentWindowEnd: Date;
  previousWindowStart: Date;
  previousWindowEnd: Date;
  dataCutoffAt: Date;
  memberQueries: readonly string[];
  memberPages: readonly string[];
  sourceProvenance: unknown;
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  position?: number | null;
  topOpportunityScore?: number | null;
  topicScore?: number | null;
  priority: GrowthPriority;
  scoreState: GrowthScoreState;
  evidenceQuality: GrowthEvidenceQuality;
  evidenceCoverage: number;
  rankingEligible: boolean;
  trendVisibilityState: GrowthComponentState;
};

export type LifecyclePatch = {
  status: GrowthLifecycleStatus;
  latestSnapshotId?: string | null;
  reviewedAt?: Date | null;
  plannedAt?: Date | null;
  startedAt?: Date | null;
  doneAt?: Date | null;
  dismissedAt?: Date | null;
  resolvedAt?: Date | null;
  reopenedAt?: Date | null;
};

export type LifecycleEventInput = {
  eventType: GrowthLifecycleEventType;
  actorType: GrowthLifecycleActorType;
  actorId?: string | null;
  reasonCode: string;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function assertNonEmpty(value: string, name: string): string {
  if (!value.trim()) throw new Error(`${name} is required`);
  return value;
}

function stableIdentityPayload(input: GrowthIdentityInput) {
  const projectId = assertNonEmpty(input.projectId, 'projectId');
  const normalizedQuery = assertNonEmpty(input.normalizedQuery, 'normalizedQuery');

  if (input.identityType === 'QUERY_PAGE_GROWTH') {
    return {
      identityVersion: GROWTH_IDENTITY_VERSION,
      projectId,
      identityType: input.identityType,
      normalizedQuery,
      canonicalPage: assertNonEmpty(input.canonicalPage, 'canonicalPage')
    } as const;
  }

  if (input.identityType === 'KEYWORD_CANNIBALIZATION') {
    const canonicalPages = [...new Set(input.canonicalPages.map((page) => assertNonEmpty(page, 'canonicalPage')))].sort();
    if (canonicalPages.length < 2 || canonicalPages.length > 20) {
      throw new Error('KEYWORD_CANNIBALIZATION requires between 2 and 20 unique canonical pages');
    }
    return {
      identityVersion: GROWTH_IDENTITY_VERSION,
      projectId,
      identityType: input.identityType,
      normalizedQuery,
      canonicalPages
    } as const;
  }

  return {
    identityVersion: GROWTH_IDENTITY_VERSION,
    projectId,
    identityType: input.identityType,
    normalizedQuery
  } as const;
}

export function buildOpportunityKey(input: GrowthIdentityInput): string {
  return createHash('sha256').update(canonicalJson(stableIdentityPayload(input))).digest('hex');
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue;
}

function identityCanonicalPage(input: GrowthIdentityInput): string | null {
  return input.identityType === 'QUERY_PAGE_GROWTH' ? input.canonicalPage : null;
}

export class GrowthRepository {
  async getOrCreateOpportunityIdentity(input: GrowthIdentityInput) {
    const payload = stableIdentityPayload(input);
    const opportunityKey = buildOpportunityKey(input);
    return prisma.growthOpportunityIdentity.upsert({
      where: {
        projectId_opportunityKey: {
          projectId: input.projectId,
          opportunityKey
        }
      },
      create: {
        projectId: input.projectId,
        opportunityKey,
        identityVersion: GROWTH_IDENTITY_VERSION,
        identityType: input.identityType as PrismaGrowthIdentityType,
        normalizedQuery: input.normalizedQuery,
        canonicalPage: identityCanonicalPage(input),
        identityPayload: asJson(payload)
      },
      update: {}
    });
  }

  async createOpportunitySnapshot(input: CreateOpportunitySnapshotInput) {
    return prisma.$transaction(async (tx) => {
      const identity = await tx.growthOpportunityIdentity.findUnique({
        where: { id: input.opportunityIdentityId },
        select: { id: true, projectId: true }
      });
      if (!identity) throw new Error('Growth opportunity identity not found');
      if (identity.projectId !== input.projectId) {
        throw new Error('Growth opportunity identity project mismatch');
      }
      if (input.topicClusterId) {
        const topic = await tx.growthTopicCluster.findUnique({
          where: { id: input.topicClusterId },
          select: { projectId: true }
        });
        if (!topic || topic.projectId !== input.projectId) {
          throw new Error('Growth topic cluster project mismatch');
        }
      }

      const snapshot = await tx.growthOpportunitySnapshot.create({
        data: {
          opportunityIdentityId: input.opportunityIdentityId,
          projectId: input.projectId,
          snapshotVersion: input.snapshotVersion,
          formulaVersion: input.formulaVersion,
          currentWindowStart: input.currentWindowStart,
          currentWindowEnd: input.currentWindowEnd,
          previousWindowStart: input.previousWindowStart,
          previousWindowEnd: input.previousWindowEnd,
          dataCutoffAt: input.dataCutoffAt,
          topicClusterId: input.topicClusterId ?? null,
          primaryType: input.primaryType,
          secondaryTypes: [...input.secondaryTypes],
          score: input.score ?? null,
          priority: input.priority,
          scoreState: input.scoreState,
          evidenceQuality: input.evidenceQuality,
          evidenceCoverage: input.evidenceCoverage,
          rankingEligible: input.rankingEligible,
          sourceProvenance: asJson(input.sourceProvenance)
        }
      });

      await tx.growthScoreBreakdown.create({
        data: {
          snapshotId: snapshot.id,
          demandState: input.breakdown.demandState,
          demandScore: input.breakdown.demandScore ?? null,
          positionPotentialState: input.breakdown.positionPotentialState,
          positionPotentialScore: input.breakdown.positionPotentialScore ?? null,
          ctrGapState: input.breakdown.ctrGapState,
          ctrGapScore: input.breakdown.ctrGapScore ?? null,
          siteGapState: input.breakdown.siteGapState,
          siteGapScore: input.breakdown.siteGapScore ?? null,
          gscTrendState: input.breakdown.gscTrendState,
          gscTrendScore: input.breakdown.gscTrendScore ?? null,
          p6VisibilityState: input.breakdown.p6VisibilityState,
          p6VisibilityScore: input.breakdown.p6VisibilityScore ?? null,
          trendVisibilityDisplayState: input.breakdown.trendVisibilityDisplayState,
          trendVisibilityDisplayScore: input.breakdown.trendVisibilityDisplayScore ?? null,
          availableWeight: input.breakdown.availableWeight,
          evidenceCoverage: input.breakdown.evidenceCoverage,
          weightedTotal: input.breakdown.weightedTotal ?? null,
          formulaVersion: input.breakdown.formulaVersion
        }
      });

      if (input.evidence.length > 0) {
        await tx.growthOpportunityEvidence.createMany({
          data: input.evidence.map((evidence) => ({
            snapshotId: snapshot.id,
            projectId: input.projectId,
            sourceModule: evidence.sourceModule,
            sourceType: evidence.sourceType,
            sourceId: evidence.sourceId,
            sourceFactVersion: evidence.sourceFactVersion,
            ruleKey: evidence.ruleKey,
            rootCauseKey: evidence.rootCauseKey,
            evidenceState: evidence.evidenceState,
            severity: evidence.severity ?? null,
            numericValue: evidence.numericValue ?? null,
            textSummary: evidence.textSummary ?? null,
            fingerprint: evidence.fingerprint
          }))
        });
      }

      return snapshot;
    });
  }

  async ensureLifecycle(
    opportunityIdentityId: string,
    latestSnapshotId: string,
    input: { actorType: GrowthLifecycleActorType; actorId?: string | null; reasonCode: string }
  ) {
    return prisma.$transaction(async (tx) => {
      const identity = await tx.growthOpportunityIdentity.findUnique({
        where: { id: opportunityIdentityId },
        select: { id: true }
      });
      if (!identity) throw new Error('Growth opportunity identity not found');

      const existing = await tx.growthOpportunityLifecycle.findUnique({
        where: { opportunityIdentityId }
      });
      if (existing) {
        if (existing.latestSnapshotId === latestSnapshotId) return existing;
        return tx.growthOpportunityLifecycle.update({
          where: { opportunityIdentityId },
          data: { latestSnapshotId }
        });
      }

      const lifecycle = await tx.growthOpportunityLifecycle.create({
        data: {
          opportunityIdentityId,
          status: 'NEW',
          latestSnapshotId
        }
      });
      await tx.growthOpportunityLifecycleEvent.create({
        data: {
          opportunityIdentityId,
          eventType: 'CREATED',
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          fromStatus: null,
          toStatus: 'NEW',
          reasonCode: input.reasonCode
        }
      });
      return lifecycle;
    });
  }

  async updateLifecycle(
    opportunityIdentityId: string,
    patch: LifecyclePatch,
    event: LifecycleEventInput
  ) {
    return prisma.$transaction(async (tx) => {
      const current = await tx.growthOpportunityLifecycle.findUnique({
        where: { opportunityIdentityId }
      });
      if (!current) throw new Error('Growth opportunity lifecycle not found');

      const updated = await tx.growthOpportunityLifecycle.update({
        where: { opportunityIdentityId },
        data: {
          status: patch.status,
          ...(patch.latestSnapshotId !== undefined ? { latestSnapshotId: patch.latestSnapshotId } : {}),
          ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt } : {}),
          ...(patch.plannedAt !== undefined ? { plannedAt: patch.plannedAt } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.doneAt !== undefined ? { doneAt: patch.doneAt } : {}),
          ...(patch.dismissedAt !== undefined ? { dismissedAt: patch.dismissedAt } : {}),
          ...(patch.resolvedAt !== undefined ? { resolvedAt: patch.resolvedAt } : {}),
          ...(patch.reopenedAt !== undefined ? { reopenedAt: patch.reopenedAt } : {})
        }
      });

      await tx.growthOpportunityLifecycleEvent.create({
        data: {
          opportunityIdentityId,
          eventType: event.eventType,
          actorType: event.actorType,
          actorId: event.actorId ?? null,
          fromStatus: current.status,
          toStatus: patch.status,
          reasonCode: event.reasonCode
        }
      });
      return updated;
    });
  }

  async getOrCreateTopicCluster(input: CreateTopicClusterInput) {
    return prisma.growthTopicCluster.upsert({
      where: {
        projectId_topicIdentityVersion_topicKey: {
          projectId: input.projectId,
          topicIdentityVersion: input.topicIdentityVersion,
          topicKey: input.topicKey
        }
      },
      create: {
        projectId: input.projectId,
        topicIdentityVersion: input.topicIdentityVersion,
        topicKey: input.topicKey,
        primaryEntityId: input.primaryEntityId ?? null,
        primaryQuery: input.primaryQuery
      },
      update: {}
    });
  }

  async createTopicSnapshot(input: CreateTopicSnapshotInput) {
    return prisma.$transaction(async (tx) => {
      const topic = await tx.growthTopicCluster.findUnique({
        where: { id: input.topicClusterId },
        select: { projectId: true }
      });
      if (!topic) throw new Error('Growth topic cluster not found');
      if (topic.projectId !== input.projectId) throw new Error('Growth topic cluster project mismatch');

      return tx.growthTopicClusterSnapshot.create({
        data: {
          topicClusterId: input.topicClusterId,
          projectId: input.projectId,
          snapshotVersion: input.snapshotVersion,
          currentWindowStart: input.currentWindowStart,
          currentWindowEnd: input.currentWindowEnd,
          previousWindowStart: input.previousWindowStart,
          previousWindowEnd: input.previousWindowEnd,
          dataCutoffAt: input.dataCutoffAt,
          memberQueries: asJson([...input.memberQueries]),
          memberPages: asJson([...input.memberPages]),
          sourceProvenance: asJson(input.sourceProvenance),
          totalImpressions: input.totalImpressions,
          totalClicks: input.totalClicks,
          ctr: input.ctr,
          position: input.position ?? null,
          topOpportunityScore: input.topOpportunityScore ?? null,
          topicScore: input.topicScore ?? null,
          priority: input.priority,
          scoreState: input.scoreState,
          evidenceQuality: input.evidenceQuality,
          evidenceCoverage: input.evidenceCoverage,
          rankingEligible: input.rankingEligible,
          trendVisibilityState: input.trendVisibilityState
        }
      });
    });
  }
}

export const growthRepository = new GrowthRepository();
