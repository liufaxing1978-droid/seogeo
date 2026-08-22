import {
  Prisma,
  type GrowthEvidenceQuality,
  type GrowthLifecycleStatus,
  type GrowthOpportunityType,
  type GrowthPriority,
  type GrowthScoreState,
  type MarketCode,
  type OptimizationCandidate,
  type OptimizationEligibilityState,
  type OptimizationMarketScopeMode,
  type OptimizationPlan,
  type RecommendedActionType,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type GrowthPlannerSource = {
  projectId: string;
  identityId: string;
  snapshotId: string;
  snapshotVersion: string;
  formulaVersion: string;
  opportunityType: GrowthOpportunityType;
  normalizedQuery: string;
  canonicalPage: string | null;
  growthScore: number | null;
  growthScoreState: GrowthScoreState;
  growthPriority: GrowthPriority;
  growthEvidenceQuality: GrowthEvidenceQuality;
  growthEvidenceCoverage: number;
  growthRankingEligible: boolean;
  growthLifecycleStatus: GrowthLifecycleStatus;
  sourceProvenance: unknown;
  sourceFactReferences: Array<{ type: string; id: string }>;
};

export type CreateOptimizationCandidateInput = {
  projectId: string;
  growthOpportunityIdentityId: string;
  growthSnapshotId: string;
  candidateVersion: string;
  candidateKey: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  opportunityType: GrowthOpportunityType;
  normalizedQuery: string;
  canonicalPage: string | null;
  growthScore: number | null;
  growthScoreState: GrowthScoreState;
  growthPriority: GrowthPriority;
  growthEvidenceQuality: GrowthEvidenceQuality;
  growthEvidenceCoverage: number;
  growthRankingEligible: boolean;
  growthLifecycleStatus: GrowthLifecycleStatus;
  sourceProvenance: unknown;
  eligibilityState: OptimizationEligibilityState;
  eligibilityReasonCodes: readonly string[];
};

export type CreateOptimizationPlanInput = {
  candidateId: string;
  projectId: string;
  planVersion: string;
  recommendedActionType: RecommendedActionType;
  sourceFactReferences: unknown;
  deterministicRank: number;
  aiRankAdjustment: number;
  historicalRankAdjustment: number;
  finalRank: number;
  advisoryContext: unknown;
  automationEligibility: boolean;
  explanation: unknown;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function assertCandidateIdentity(existing: OptimizationCandidate, input: CreateOptimizationCandidateInput): void {
  if (
    existing.projectId !== input.projectId ||
    existing.candidateKey !== input.candidateKey ||
    existing.candidateVersion !== input.candidateVersion ||
    existing.growthOpportunityIdentityId !== input.growthOpportunityIdentityId ||
    existing.growthSnapshotId !== input.growthSnapshotId
  ) {
    throw new Error('Optimization candidate identity conflict');
  }
}

function assertPlanIdentity(existing: OptimizationPlan, input: CreateOptimizationPlanInput): void {
  if (
    existing.candidateId !== input.candidateId ||
    existing.projectId !== input.projectId ||
    existing.planVersion !== input.planVersion
  ) {
    throw new Error('Optimization plan identity conflict');
  }
}

export class OptimizationRepository {
  async listLatestGrowthInputs(projectId: string): Promise<GrowthPlannerSource[]> {
    const identities = await prisma.growthOpportunityIdentity.findMany({
      where: { projectId },
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        projectId: true,
        normalizedQuery: true,
        canonicalPage: true,
        lifecycle: { select: { status: true } },
        snapshots: {
          orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            snapshotVersion: true,
            formulaVersion: true,
            primaryType: true,
            score: true,
            scoreState: true,
            priority: true,
            evidenceQuality: true,
            evidenceCoverage: true,
            rankingEligible: true,
            sourceProvenance: true,
            evidence: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true },
            },
          },
        },
      },
    });

    return identities.flatMap((identity) => {
      const snapshot = identity.snapshots[0];
      if (!snapshot || !identity.lifecycle) return [];

      return [{
        projectId: identity.projectId,
        identityId: identity.id,
        snapshotId: snapshot.id,
        snapshotVersion: snapshot.snapshotVersion,
        formulaVersion: snapshot.formulaVersion,
        opportunityType: snapshot.primaryType,
        normalizedQuery: identity.normalizedQuery,
        canonicalPage: identity.canonicalPage,
        growthScore: snapshot.score,
        growthScoreState: snapshot.scoreState,
        growthPriority: snapshot.priority,
        growthEvidenceQuality: snapshot.evidenceQuality,
        growthEvidenceCoverage: snapshot.evidenceCoverage,
        growthRankingEligible: snapshot.rankingEligible,
        growthLifecycleStatus: identity.lifecycle.status,
        sourceProvenance: snapshot.sourceProvenance,
        sourceFactReferences: [
          { type: 'GROWTH_OPPORTUNITY_IDENTITY', id: identity.id },
          { type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: snapshot.id },
          ...snapshot.evidence.map((item) => ({ type: 'GROWTH_OPPORTUNITY_EVIDENCE', id: item.id })),
        ],
      }];
    });
  }

  async createCandidate(input: CreateOptimizationCandidateInput): Promise<OptimizationCandidate> {
    const existing = await this.getCandidateByKey(input.projectId, input.candidateKey);
    if (existing) {
      assertCandidateIdentity(existing, input);
      return existing;
    }

    try {
      return await prisma.optimizationCandidate.create({
        data: {
          projectId: input.projectId,
          growthOpportunityIdentityId: input.growthOpportunityIdentityId,
          growthSnapshotId: input.growthSnapshotId,
          candidateVersion: input.candidateVersion,
          candidateKey: input.candidateKey,
          marketScopeMode: input.marketScopeMode,
          marketCode: input.marketCode,
          locale: input.locale,
          opportunityType: input.opportunityType,
          normalizedQuery: input.normalizedQuery,
          canonicalPage: input.canonicalPage,
          growthScore: input.growthScore,
          growthScoreState: input.growthScoreState,
          growthPriority: input.growthPriority,
          growthEvidenceQuality: input.growthEvidenceQuality,
          growthEvidenceCoverage: input.growthEvidenceCoverage,
          growthRankingEligible: input.growthRankingEligible,
          growthLifecycleStatus: input.growthLifecycleStatus,
          sourceProvenance: asJson(input.sourceProvenance),
          eligibilityState: input.eligibilityState,
          eligibilityReasonCodes: asJson([...input.eligibilityReasonCodes]),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.getCandidateByKey(input.projectId, input.candidateKey);
      if (!collided) throw error;
      assertCandidateIdentity(collided, input);
      return collided;
    }
  }

  getCandidateByKey(projectId: string, candidateKey: string): Promise<OptimizationCandidate | null> {
    return prisma.optimizationCandidate.findUnique({
      where: { projectId_candidateKey: { projectId, candidateKey } },
    });
  }

  listCandidates(projectId: string): Promise<OptimizationCandidate[]> {
    return prisma.optimizationCandidate.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async createPlan(input: CreateOptimizationPlanInput): Promise<OptimizationPlan> {
    const candidate = await prisma.optimizationCandidate.findUnique({
      where: { id: input.candidateId },
      select: { id: true, projectId: true },
    });
    if (!candidate) throw new Error('Optimization candidate not found');
    if (candidate.projectId !== input.projectId) throw new Error('Optimization plan project mismatch');

    const existing = await this.getPlan(input.candidateId, input.planVersion);
    if (existing) {
      assertPlanIdentity(existing, input);
      return existing;
    }

    try {
      return await prisma.optimizationPlan.create({
        data: {
          candidateId: input.candidateId,
          projectId: input.projectId,
          planVersion: input.planVersion,
          recommendedActionType: input.recommendedActionType,
          sourceFactReferences: asJson(input.sourceFactReferences),
          deterministicRank: input.deterministicRank,
          aiRankAdjustment: input.aiRankAdjustment,
          historicalRankAdjustment: input.historicalRankAdjustment,
          finalRank: input.finalRank,
          advisoryContext: asJson(input.advisoryContext),
          automationEligibility: input.automationEligibility,
          explanation: asJson(input.explanation),
        },
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.getPlan(input.candidateId, input.planVersion);
      if (!collided) throw error;
      assertPlanIdentity(collided, input);
      return collided;
    }
  }

  getPlan(candidateId: string, planVersion: string): Promise<OptimizationPlan | null> {
    return prisma.optimizationPlan.findUnique({
      where: { candidateId_planVersion: { candidateId, planVersion } },
    });
  }

  listPlans(projectId: string): Promise<OptimizationPlan[]> {
    return prisma.optimizationPlan.findMany({
      where: { projectId },
      orderBy: [{ finalRank: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}

export const optimizationRepository = new OptimizationRepository();
