import {
  Prisma,
  type MarketCode,
  type OptimizationExperimentObservation,
  type OptimizationFeedbackEffect,
  type OptimizationFeedbackEvidence,
  type OptimizationFeedbackProfile,
  type OptimizationMarketScopeMode,
  type PublicationExecutionStatus,
  type PublicationProposalSourceType,
  type PublicationVerificationStatus,
  type RecommendedActionType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  buildFeedbackProfileIdentity,
  buildFeedbackScopeKey
} from './feedback.identity.js';
import {
  OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
  OPTIMIZATION_FEEDBACK_WINDOW_LIMIT,
  type FeedbackMarketScopeMode
} from './feedback.types.js';

export type CreateFeedbackEvidenceInput = {
  projectId: string;
  experimentId: string;
  observationId: string;
  optimizationPlanId: string;
  candidateId: string;
  feedbackEvidenceVersion: string;
  evidenceKey: string;
  scopeKey: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  recommendedActionType: RecommendedActionType;
  effectState: OptimizationFeedbackEffect;
  feedbackValue: number;
  terminalWindowType: string;
  terminalWindowDays: number;
  inputCutoffAt: Date;
  sourceEvaluatorVersion: string;
  sourceObservationKey: string;
};

export type CreateFeedbackProfileInput = {
  projectId: string;
  feedbackProfileVersion: string;
  profileKey: string;
  scopeKey: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  recommendedActionType: RecommendedActionType;
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  windowLimit: number;
  oldestEvidenceCutoffAt: Date;
  newestEvidenceCutoffAt: Date;
  inputEvidenceIdsJson: Prisma.InputJsonValue;
  inputFingerprint: string;
};

export type CreateOrGetFeedbackEvidenceResult =
  | { kind: 'CREATED'; evidence: OptimizationFeedbackEvidence }
  | { kind: 'EXISTING'; evidence: OptimizationFeedbackEvidence };

export type CreateOrGetFeedbackProfileResult =
  | { kind: 'CREATED'; profile: OptimizationFeedbackProfile }
  | { kind: 'EXISTING'; profile: OptimizationFeedbackProfile };

export type FeedbackScopeLookup = {
  projectId: string;
  marketScopeMode: OptimizationMarketScopeMode;
  marketCode: MarketCode | null;
  locale: string | null;
  recommendedActionType: RecommendedActionType;
};

export type FeedbackContextObservation = Pick<
  OptimizationExperimentObservation,
  | 'id'
  | 'projectId'
  | 'experimentId'
  | 'observationKey'
  | 'windowType'
  | 'windowDays'
  | 'dueAt'
  | 'inputCutoffAt'
  | 'coverageState'
  | 'contaminationState'
  | 'effectState'
  | 'evaluatorVersion'
  | 'createdAt'
>;

export type FeedbackMaterializationContext = {
  experiment: {
    id: string;
    projectId: string;
    optimizationPlanId: string;
    publicationExecutionId: string;
    publicationVerificationId: string;
    verifiedAnchorAt: Date;
    observationScheduleJson: Prisma.JsonValue;
    observations: FeedbackContextObservation[];
  };
  optimizationPlan: {
    id: string;
    projectId: string;
    recommendedActionType: RecommendedActionType;
    candidate: {
      id: string;
      projectId: string;
      marketScopeMode: OptimizationMarketScopeMode;
      marketCode: MarketCode | null;
      locale: string | null;
    };
  };
  execution: {
    id: string;
    projectId: string;
    status: PublicationExecutionStatus;
  };
  verification: {
    id: string;
    projectId: string;
    executionId: string;
    status: PublicationVerificationStatus;
  };
  proposal: {
    id: string;
    projectId: string;
    sourceType: PublicationProposalSourceType;
    sourceReferenceId: string | null;
  };
};

export type FeedbackReconcileCandidate = {
  projectId: string;
  experimentId: string;
  observationId: string;
};

type FeedbackDb = Pick<
  Prisma.TransactionClient,
  | 'optimizationExperiment'
  | 'optimizationExperimentObservation'
  | 'optimizationFeedbackEvidence'
  | 'optimizationFeedbackProfile'
  | 'project'
>;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002'
  );
}

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalInputJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function assertEvidenceIdentity(
  existing: OptimizationFeedbackEvidence,
  input: CreateFeedbackEvidenceInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.experimentId !== input.experimentId
    || existing.observationId !== input.observationId
    || existing.optimizationPlanId !== input.optimizationPlanId
    || existing.candidateId !== input.candidateId
    || existing.feedbackEvidenceVersion !== input.feedbackEvidenceVersion
    || existing.evidenceKey !== input.evidenceKey
    || existing.scopeKey !== input.scopeKey
    || existing.marketScopeMode !== input.marketScopeMode
    || existing.marketCode !== input.marketCode
    || existing.locale !== input.locale
    || existing.recommendedActionType !== input.recommendedActionType
    || existing.effectState !== input.effectState
    || existing.feedbackValue !== input.feedbackValue
    || existing.terminalWindowType !== input.terminalWindowType
    || existing.terminalWindowDays !== input.terminalWindowDays
    || !sameDate(existing.inputCutoffAt, input.inputCutoffAt)
    || existing.sourceEvaluatorVersion !== input.sourceEvaluatorVersion
    || existing.sourceObservationKey !== input.sourceObservationKey
  ) {
    throw new Error('FEEDBACK_EVIDENCE_IDENTITY_COLLISION');
  }
}

function assertProfileIdentity(
  existing: OptimizationFeedbackProfile,
  input: CreateFeedbackProfileInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.feedbackProfileVersion !== input.feedbackProfileVersion
    || existing.profileKey !== input.profileKey
    || existing.scopeKey !== input.scopeKey
    || existing.marketScopeMode !== input.marketScopeMode
    || existing.marketCode !== input.marketCode
    || existing.locale !== input.locale
    || existing.recommendedActionType !== input.recommendedActionType
    || existing.sampleCount !== input.sampleCount
    || existing.positiveCount !== input.positiveCount
    || existing.neutralCount !== input.neutralCount
    || existing.negativeCount !== input.negativeCount
    || existing.rollingEffectBalance !== input.rollingEffectBalance
    || existing.historicalRankAdjustment !== input.historicalRankAdjustment
    || existing.windowLimit !== input.windowLimit
    || !sameDate(existing.oldestEvidenceCutoffAt, input.oldestEvidenceCutoffAt)
    || !sameDate(existing.newestEvidenceCutoffAt, input.newestEvidenceCutoffAt)
    || canonicalJson(existing.inputEvidenceIdsJson) !== canonicalJson(input.inputEvidenceIdsJson)
    || existing.inputFingerprint !== input.inputFingerprint
  ) {
    throw new Error('FEEDBACK_PROFILE_IDENTITY_COLLISION');
  }
}

function signedAdvisoryKey(scopeKey: string): bigint {
  if (!/^[0-9a-f]{64}$/.test(scopeKey)) {
    throw new Error('FEEDBACK_SCOPE_KEY_INVALID');
  }
  const unsigned = BigInt(`0x${scopeKey.slice(0, 16)}`);
  const signBit = 1n << 63n;
  const modulus = 1n << 64n;
  return unsigned >= signBit ? unsigned - modulus : unsigned;
}

const WINDOW_DAYS: Readonly<Record<string, number>> = {
  '7D': 7,
  '14D': 14,
  '28D': 28,
  '56D': 56
};

function terminalSchedule(value: Prisma.JsonValue): { windowType: string; windowDays: number } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  let terminal: { windowType: string; windowDays: number } | null = null;
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const windowType = record.windowType;
    const windowDays = record.windowDays;
    if (
      typeof windowType !== 'string'
      || !(windowType in WINDOW_DAYS)
      || typeof windowDays !== 'number'
      || WINDOW_DAYS[windowType] !== windowDays
      || seen.has(windowType)
    ) {
      return null;
    }
    seen.add(windowType);
    terminal = { windowType, windowDays };
  }
  return terminal;
}

function validFeedbackScopeMode(input: FeedbackScopeLookup): FeedbackMarketScopeMode | null {
  if (
    input.marketScopeMode === 'CONFIGURED_MARKET'
    && input.marketCode !== null
    && input.locale !== null
    && input.locale.trim().length > 0
  ) {
    return 'CONFIGURED_MARKET';
  }
  if (
    input.marketScopeMode === 'UNCONFIGURED_LEGACY'
    && input.marketCode === null
    && input.locale === null
  ) {
    return 'UNCONFIGURED_LEGACY';
  }
  return null;
}

export class OptimizationFeedbackRepository {
  constructor(private readonly db: FeedbackDb = prisma) {}

  async loadExperimentFeedbackContext(input: {
    projectId: string;
    experimentId: string;
  }): Promise<FeedbackMaterializationContext | null> {
    const row = await this.db.optimizationExperiment.findFirst({
      where: { id: input.experimentId, projectId: input.projectId },
      select: {
        id: true,
        projectId: true,
        optimizationPlanId: true,
        publicationExecutionId: true,
        publicationVerificationId: true,
        verifiedAnchorAt: true,
        observationScheduleJson: true,
        observations: {
          orderBy: [{ inputCutoffAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            projectId: true,
            experimentId: true,
            observationKey: true,
            windowType: true,
            windowDays: true,
            dueAt: true,
            inputCutoffAt: true,
            coverageState: true,
            contaminationState: true,
            effectState: true,
            evaluatorVersion: true,
            createdAt: true
          }
        },
        optimizationPlan: {
          select: {
            id: true,
            projectId: true,
            recommendedActionType: true,
            candidate: {
              select: {
                id: true,
                projectId: true,
                marketScopeMode: true,
                marketCode: true,
                locale: true
              }
            }
          }
        },
        publicationExecution: {
          select: {
            id: true,
            projectId: true,
            status: true,
            plan: {
              select: {
                proposal: {
                  select: {
                    id: true,
                    projectId: true,
                    sourceType: true,
                    sourceReferenceId: true
                  }
                }
              }
            }
          }
        },
        publicationVerification: {
          select: {
            id: true,
            projectId: true,
            executionId: true,
            status: true
          }
        }
      }
    });
    if (!row) return null;

    return {
      experiment: {
        id: row.id,
        projectId: row.projectId,
        optimizationPlanId: row.optimizationPlanId,
        publicationExecutionId: row.publicationExecutionId,
        publicationVerificationId: row.publicationVerificationId,
        verifiedAnchorAt: row.verifiedAnchorAt,
        observationScheduleJson: row.observationScheduleJson,
        observations: row.observations
      },
      optimizationPlan: row.optimizationPlan,
      execution: {
        id: row.publicationExecution.id,
        projectId: row.publicationExecution.projectId,
        status: row.publicationExecution.status
      },
      verification: row.publicationVerification,
      proposal: row.publicationExecution.plan.proposal
    };
  }

  findEvidenceForExperiment(experimentId: string): Promise<OptimizationFeedbackEvidence | null> {
    return this.db.optimizationFeedbackEvidence.findUnique({ where: { experimentId } });
  }

  private findEvidenceIdentity(input: CreateFeedbackEvidenceInput): Promise<OptimizationFeedbackEvidence | null> {
    return this.db.optimizationFeedbackEvidence.findFirst({
      where: {
        OR: [
          { experimentId: input.experimentId },
          { observationId: input.observationId },
          { projectId: input.projectId, evidenceKey: input.evidenceKey }
        ]
      },
      orderBy: { id: 'asc' }
    });
  }

  async createOrGetEvidence(
    input: CreateFeedbackEvidenceInput
  ): Promise<CreateOrGetFeedbackEvidenceResult> {
    const existing = await this.findEvidenceIdentity(input);
    if (existing) {
      assertEvidenceIdentity(existing, input);
      return { kind: 'EXISTING', evidence: existing };
    }

    try {
      const evidence = await this.db.optimizationFeedbackEvidence.create({ data: input });
      return { kind: 'CREATED', evidence };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findEvidenceIdentity(input);
      if (!raced) throw error;
      assertEvidenceIdentity(raced, input);
      return { kind: 'EXISTING', evidence: raced };
    }
  }

  listEvidenceForScope(input: {
    projectId: string;
    scopeKey: string;
  }): Promise<OptimizationFeedbackEvidence[]> {
    return this.db.optimizationFeedbackEvidence.findMany({
      where: { projectId: input.projectId, scopeKey: input.scopeKey },
      orderBy: [{ inputCutoffAt: 'asc' }, { observationId: 'asc' }]
    });
  }

  private findProfileIdentity(input: CreateFeedbackProfileInput): Promise<OptimizationFeedbackProfile | null> {
    return this.db.optimizationFeedbackProfile.findFirst({
      where: {
        projectId: input.projectId,
        OR: [
          { profileKey: input.profileKey },
          { inputFingerprint: input.inputFingerprint }
        ]
      },
      orderBy: { id: 'asc' }
    });
  }

  async createOrGetProfile(
    input: CreateFeedbackProfileInput
  ): Promise<CreateOrGetFeedbackProfileResult> {
    const existing = await this.findProfileIdentity(input);
    if (existing) {
      assertProfileIdentity(existing, input);
      return { kind: 'EXISTING', profile: existing };
    }

    try {
      const profile = await this.db.optimizationFeedbackProfile.create({
        data: {
          ...input,
          inputEvidenceIdsJson: canonicalInputJson(input.inputEvidenceIdsJson)
        }
      });
      return { kind: 'CREATED', profile };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findProfileIdentity(input);
      if (!raced) throw error;
      assertProfileIdentity(raced, input);
      return { kind: 'EXISTING', profile: raced };
    }
  }

  async findLatestProfileForScope(input: FeedbackScopeLookup): Promise<OptimizationFeedbackProfile | null> {
    const marketScopeMode = validFeedbackScopeMode(input);
    if (!marketScopeMode) return null;

    const scopeKey = buildFeedbackScopeKey({
      projectId: input.projectId,
      marketScopeMode,
      marketCode: input.marketCode,
      locale: input.locale,
      recommendedActionType: input.recommendedActionType
    });
    const latestEvidence = await this.db.optimizationFeedbackEvidence.findMany({
      where: { projectId: input.projectId, scopeKey },
      orderBy: [{ inputCutoffAt: 'desc' }, { observationId: 'desc' }],
      take: OPTIMIZATION_FEEDBACK_WINDOW_LIMIT,
      select: { id: true }
    });
    if (latestEvidence.length === 0) return null;

    const orderedEvidenceIds = latestEvidence.map((evidence) => evidence.id).reverse();
    const { inputFingerprint } = buildFeedbackProfileIdentity({
      projectId: input.projectId,
      scopeKey,
      orderedEvidenceIds
    });

    return this.db.optimizationFeedbackProfile.findFirst({
      where: {
        projectId: input.projectId,
        feedbackProfileVersion: OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
        scopeKey,
        inputFingerprint
      }
    });
  }

  async listRecentTerminalCandidates(input: {
    projectId: string;
    createdAtGte: Date;
    limit: number;
  }): Promise<readonly FeedbackReconcileCandidate[]> {
    if (input.limit <= 0) return [];
    const observations = await this.db.optimizationExperimentObservation.findMany({
      where: {
        projectId: input.projectId,
        createdAt: { gte: input.createdAtGte },
        experiment: { feedbackEvidence: { none: {} } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
      select: {
        id: true,
        projectId: true,
        windowType: true,
        windowDays: true,
        dueAt: true,
        experiment: {
          select: {
            id: true,
            verifiedAnchorAt: true,
            observationScheduleJson: true
          }
        }
      }
    });

    const result: FeedbackReconcileCandidate[] = [];
    for (const observation of observations) {
      const terminal = terminalSchedule(observation.experiment.observationScheduleJson);
      if (!terminal) continue;
      const dueAt = new Date(
        observation.experiment.verifiedAnchorAt.getTime() + terminal.windowDays * 24 * 60 * 60 * 1000
      );
      if (
        observation.windowType !== terminal.windowType
        || observation.windowDays !== terminal.windowDays
        || observation.dueAt.getTime() !== dueAt.getTime()
      ) {
        continue;
      }
      result.push({
        projectId: observation.projectId,
        experimentId: observation.experiment.id,
        observationId: observation.id
      });
      if (result.length >= input.limit) break;
    }
    return result;
  }

  async listFeedbackEnabledProjectIds(): Promise<readonly string[]> {
    const projects = await this.db.project.findMany({
      where: { planLevel: { in: ['ADVANCED', 'ENTERPRISE'] } },
      orderBy: { id: 'asc' },
      select: { id: true }
    });
    return projects.map((project) => project.id);
  }

  async withScopeLock<T>(
    scopeKey: string,
    run: (repository: OptimizationFeedbackRepository) => Promise<T>
  ): Promise<T> {
    const advisoryKey = signedAdvisoryKey(scopeKey);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'WITH lock_result AS MATERIALIZED (SELECT pg_advisory_xact_lock($1::bigint)) SELECT 1::int AS locked FROM lock_result',
        advisoryKey.toString()
      );
      return run(new OptimizationFeedbackRepository(tx));
    });
  }
}
