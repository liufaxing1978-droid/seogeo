import {
  Prisma,
  type MarketCode,
  type OptimizationExperiment,
  type OptimizationExperimentObservation,
  type PlanLevel,
  type PublicationExecutionStatus,
  type PublicationProposalSourceType,
  type PublicationVerificationStatus,
  type RecommendedActionType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { canonicalJson } from './experiment.identity.js';
import type { VisibilityExperimentScopeFact } from './experiment.scope.js';
import type {
  ExperimentContaminationState,
  ExperimentCoverageState,
  ExperimentEffectState,
  ExperimentWindowType
} from './experiment.types.js';

export type CreateExperimentInput = {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  experimentVersion: string;
  experimentKey: string;
  interventionType: RecommendedActionType;
  targetUrl: string;
  marketCode: MarketCode | null;
  locale: string | null;
  verifiedAnchorAt: Date;
  measurementScopeJson: Prisma.InputJsonValue;
  observationScheduleJson: Prisma.InputJsonValue;
  expectedDirectionJson: Prisma.InputJsonValue;
};

export type CreateExperimentObservationInput = {
  projectId: string;
  experimentId: string;
  observationVersion: string;
  observationKey: string;
  windowType: ExperimentWindowType;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: Prisma.InputJsonValue;
  observedSearchSourceRefs: Prisma.InputJsonValue;
  baselineVisibilitySourceRefs: Prisma.InputJsonValue;
  observedVisibilitySourceRefs: Prisma.InputJsonValue;
  baselineMetricsJson: Prisma.InputJsonValue;
  observedMetricsJson: Prisma.InputJsonValue;
  deltaMetricsJson: Prisma.InputJsonValue;
  coverageState: ExperimentCoverageState;
  contaminationState: ExperimentContaminationState;
  effectState: ExperimentEffectState;
  reasonCodes: Prisma.InputJsonValue;
  evaluatorVersion: string;
};

export type VerifiedExperimentStartContext = {
  project: { id: string; planLevel: PlanLevel };
  optimizationPlan: {
    id: string;
    projectId: string;
    recommendedActionType: RecommendedActionType;
    sourceFactReferences: Prisma.JsonValue;
    candidate: {
      id: string;
      projectId: string;
      growthSnapshotId: string;
      marketScopeMode: string;
      marketCode: MarketCode | null;
      locale: string | null;
      normalizedQuery: string;
      canonicalPage: string | null;
      sourceProvenance: Prisma.JsonValue;
    };
  };
  proposal: {
    id: string;
    projectId: string;
    sourceType: PublicationProposalSourceType;
    sourceReferenceId: string | null;
  };
  publicationPlan: {
    id: string;
    projectId: string;
    targetPublicUrl: string;
  };
  execution: {
    id: string;
    projectId: string;
    status: PublicationExecutionStatus;
  };
  verification: {
    id: string;
    projectId: string;
    status: PublicationVerificationStatus;
    observedUrl: string;
    observedAt: Date;
  };
};

export type ExperimentStartAuthorityInspection = {
  project: { id: string; planLevel: PlanLevel };
  proposal: {
    id: string;
    projectId: string;
    sourceType: PublicationProposalSourceType;
    sourceReferenceId: string | null;
  };
  publicationPlan: {
    id: string;
    projectId: string;
    targetPublicUrl: string;
  };
  execution: {
    id: string;
    projectId: string;
    status: PublicationExecutionStatus;
  };
  verification: {
    id: string;
    projectId: string;
    status: PublicationVerificationStatus;
    observedUrl: string | null;
    observedAt: Date | null;
  } | null;
};

export type ExperimentStartReasonCode =
  | 'EXPERIMENT_FEATURE_NOT_AVAILABLE'
  | 'EXPERIMENT_EXECUTION_NOT_VERIFIED'
  | 'EXPERIMENT_VERIFICATION_NOT_VERIFIED'
  | 'EXPERIMENT_P9_SOURCE_MISMATCH'
  | 'EXPERIMENT_VERIFICATION_URL_MISMATCH'
  | 'EXPERIMENT_INTERVENTION_NOT_SUPPORTED'
  | 'EXPERIMENT_MEASUREMENT_SCOPE_UNRESOLVED';

export type ExperimentStartResult =
  | { kind: 'STARTED'; experiment: OptimizationExperiment }
  | { kind: 'EXISTING'; experiment: OptimizationExperiment }
  | { kind: 'DEFERRED'; reasonCode: ExperimentStartReasonCode };

type ExperimentDb = Pick<
  Prisma.TransactionClient,
  | 'optimizationExperiment'
  | 'optimizationExperimentObservation'
  | 'optimizationPlan'
  | 'growthOpportunitySnapshot'
  | 'growthOpportunityEvidence'
  | 'visibilityMetricRow'
  | 'visibilityMetricSnapshot'
  | 'project'
  | 'publicationExecution'
  | 'publicationVerification'
>;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2002'
  );
}

function canonicalInputJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function assertExperimentIdentity(
  existing: OptimizationExperiment,
  input: CreateExperimentInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.optimizationPlanId !== input.optimizationPlanId
    || existing.publicationExecutionId !== input.publicationExecutionId
    || existing.publicationVerificationId !== input.publicationVerificationId
    || existing.experimentVersion !== input.experimentVersion
    || existing.experimentKey !== input.experimentKey
    || existing.interventionType !== input.interventionType
    || existing.targetUrl !== input.targetUrl
    || existing.marketCode !== input.marketCode
    || existing.locale !== input.locale
    || !sameDate(existing.verifiedAnchorAt, input.verifiedAnchorAt)
    || canonicalJson(existing.measurementScopeJson) !== canonicalJson(input.measurementScopeJson)
    || canonicalJson(existing.observationScheduleJson) !== canonicalJson(input.observationScheduleJson)
    || canonicalJson(existing.expectedDirectionJson) !== canonicalJson(input.expectedDirectionJson)
  ) {
    throw new Error('EXPERIMENT_IDENTITY_COLLISION');
  }
}

function assertObservationIdentity(
  existing: OptimizationExperimentObservation,
  input: CreateExperimentObservationInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.experimentId !== input.experimentId
    || existing.observationVersion !== input.observationVersion
    || existing.observationKey !== input.observationKey
    || existing.windowType !== input.windowType
    || existing.windowDays !== input.windowDays
    || !sameDate(existing.dueAt, input.dueAt)
    || !sameDate(existing.inputCutoffAt, input.inputCutoffAt)
    || canonicalJson(existing.baselineSearchSourceRefs) !== canonicalJson(input.baselineSearchSourceRefs)
    || canonicalJson(existing.observedSearchSourceRefs) !== canonicalJson(input.observedSearchSourceRefs)
    || canonicalJson(existing.baselineVisibilitySourceRefs) !== canonicalJson(input.baselineVisibilitySourceRefs)
    || canonicalJson(existing.observedVisibilitySourceRefs) !== canonicalJson(input.observedVisibilitySourceRefs)
    || canonicalJson(existing.baselineMetricsJson) !== canonicalJson(input.baselineMetricsJson)
    || canonicalJson(existing.observedMetricsJson) !== canonicalJson(input.observedMetricsJson)
    || canonicalJson(existing.deltaMetricsJson) !== canonicalJson(input.deltaMetricsJson)
    || existing.coverageState !== input.coverageState
    || existing.contaminationState !== input.contaminationState
    || existing.effectState !== input.effectState
    || canonicalJson(existing.reasonCodes) !== canonicalJson(input.reasonCodes)
    || existing.evaluatorVersion !== input.evaluatorVersion
  ) {
    throw new Error('EXPERIMENT_OBSERVATION_IDENTITY_COLLISION');
  }
}

export class OptimizationExperimentRepository {
  constructor(private readonly db: ExperimentDb = prisma) {}

  async listVisibilityScopeFacts(input: {
    projectId: string;
    growthSnapshotId: string;
  }): Promise<readonly VisibilityExperimentScopeFact[]> {
    const evidence = await this.db.growthOpportunityEvidence.findMany({
      where: {
        projectId: input.projectId,
        snapshotId: input.growthSnapshotId,
        sourceModule: 'P6_VISIBILITY',
        sourceType: 'VISIBILITY_METRIC_ROW'
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
      select: {
        snapshotId: true,
        projectId: true,
        sourceModule: true,
        sourceType: true,
        sourceId: true,
        sourceFactVersion: true,
        ruleKey: true
      }
    });
    if (evidence.length === 0) return [];

    const rows = await this.db.visibilityMetricRow.findMany({
      where: {
        projectId: input.projectId,
        id: { in: evidence.map((item) => item.sourceId) }
      },
      select: {
        id: true,
        projectId: true,
        visibilityMetricSnapshotId: true,
        metricType: true,
        dimensionType: true,
        dimensionKey: true,
        actorType: true,
        actorKey: true
      }
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const snapshotIds = [...new Set(rows.map((row) => row.visibilityMetricSnapshotId))];
    if (snapshotIds.length === 0) return [];

    const snapshots = await this.db.visibilityMetricSnapshot.findMany({
      where: {
        projectId: input.projectId,
        id: { in: snapshotIds }
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        formulaVersion: true,
        extractorVersion: true,
        subjectSetHash: true,
        scopeHash: true
      }
    });
    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));

    const facts: VisibilityExperimentScopeFact[] = [];
    for (const item of evidence) {
      const row = rowById.get(item.sourceId);
      if (!row) continue;
      const snapshot = snapshotById.get(row.visibilityMetricSnapshotId);
      if (!snapshot) continue;
      facts.push({ evidence: item, row, snapshot });
    }
    return facts;
  }

  async inspectStartAuthority(input: {
    projectId: string;
    publicationExecutionId: string;
  }): Promise<ExperimentStartAuthorityInspection | null> {
    const execution = await this.db.publicationExecution.findFirst({
      where: {
        id: input.publicationExecutionId,
        projectId: input.projectId
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        plan: {
          select: {
            id: true,
            projectId: true,
            targetPublicUrl: true,
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
    });
    if (!execution) return null;

    const project = await this.db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, planLevel: true }
    });
    if (!project) return null;

    const exactVerified = await this.db.publicationVerification.findFirst({
      where: {
        projectId: input.projectId,
        executionId: execution.id,
        status: 'VERIFIED',
        observedAt: { not: null },
        observedUrl: { not: null }
      },
      orderBy: [
        { observedAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        projectId: true,
        status: true,
        observedUrl: true,
        observedAt: true
      }
    });

    const verification = exactVerified ?? await this.db.publicationVerification.findFirst({
      where: {
        projectId: input.projectId,
        executionId: execution.id
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        projectId: true,
        status: true,
        observedUrl: true,
        observedAt: true
      }
    });

    return {
      project,
      proposal: execution.plan.proposal,
      publicationPlan: {
        id: execution.plan.id,
        projectId: execution.plan.projectId,
        targetPublicUrl: execution.plan.targetPublicUrl
      },
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        status: execution.status
      },
      verification
    };
  }

  async loadVerifiedStartContext(input: {
    projectId: string;
    publicationExecutionId: string;
  }): Promise<VerifiedExperimentStartContext | null> {
    const execution = await this.db.publicationExecution.findFirst({
      where: {
        id: input.publicationExecutionId,
        projectId: input.projectId
      },
      select: {
        id: true,
        projectId: true,
        status: true,
        plan: {
          select: {
            id: true,
            projectId: true,
            targetPublicUrl: true,
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
    });
    if (!execution) return null;

    const project = await this.db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, planLevel: true }
    });
    if (!project) return null;

    const sourceReferenceId = execution.plan.proposal.sourceReferenceId;
    if (!sourceReferenceId) return null;

    const optimizationPlan = await this.db.optimizationPlan.findFirst({
      where: {
        id: sourceReferenceId,
        projectId: input.projectId
      },
      select: {
        id: true,
        projectId: true,
        recommendedActionType: true,
        sourceFactReferences: true,
        candidate: {
          select: {
            id: true,
            projectId: true,
            growthSnapshotId: true,
            marketScopeMode: true,
            marketCode: true,
            locale: true,
            normalizedQuery: true,
            canonicalPage: true
          }
        }
      }
    });
    if (!optimizationPlan || optimizationPlan.candidate.projectId !== input.projectId) return null;

    const growthSnapshot = await this.db.growthOpportunitySnapshot.findFirst({
      where: {
        id: optimizationPlan.candidate.growthSnapshotId,
        projectId: input.projectId
      },
      select: { sourceProvenance: true }
    });
    if (!growthSnapshot) return null;

    const verification = await this.db.publicationVerification.findFirst({
      where: {
        projectId: input.projectId,
        executionId: execution.id,
        status: 'VERIFIED',
        observedAt: { not: null },
        observedUrl: { not: null }
      },
      orderBy: [
        { observedAt: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        projectId: true,
        status: true,
        observedUrl: true,
        observedAt: true
      }
    });
    if (!verification?.observedUrl || !verification.observedAt) return null;

    return {
      project,
      optimizationPlan: {
        id: optimizationPlan.id,
        projectId: optimizationPlan.projectId,
        recommendedActionType: optimizationPlan.recommendedActionType,
        sourceFactReferences: optimizationPlan.sourceFactReferences,
        candidate: {
          ...optimizationPlan.candidate,
          sourceProvenance: growthSnapshot.sourceProvenance
        }
      },
      proposal: execution.plan.proposal,
      publicationPlan: {
        id: execution.plan.id,
        projectId: execution.plan.projectId,
        targetPublicUrl: execution.plan.targetPublicUrl
      },
      execution: {
        id: execution.id,
        projectId: execution.projectId,
        status: execution.status
      },
      verification: {
        id: verification.id,
        projectId: verification.projectId,
        status: verification.status,
        observedUrl: verification.observedUrl,
        observedAt: verification.observedAt
      }
    };
  }

  async findExperimentForStart(input: {
    optimizationPlanId: string;
    publicationExecutionId: string;
    experimentVersion: string;
  }): Promise<OptimizationExperiment | null> {
    return this.db.optimizationExperiment.findUnique({
      where: {
        optimizationPlanId_publicationExecutionId_experimentVersion: {
          optimizationPlanId: input.optimizationPlanId,
          publicationExecutionId: input.publicationExecutionId,
          experimentVersion: input.experimentVersion
        }
      }
    });
  }

  async createOrGetExperiment(input: CreateExperimentInput): Promise<OptimizationExperiment> {
    const existing = await this.db.optimizationExperiment.findUnique({
      where: {
        projectId_experimentKey: {
          projectId: input.projectId,
          experimentKey: input.experimentKey
        }
      }
    });
    if (existing) {
      assertExperimentIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationExperiment.create({
        data: {
          projectId: input.projectId,
          optimizationPlanId: input.optimizationPlanId,
          publicationExecutionId: input.publicationExecutionId,
          publicationVerificationId: input.publicationVerificationId,
          experimentVersion: input.experimentVersion,
          experimentKey: input.experimentKey,
          interventionType: input.interventionType,
          targetUrl: input.targetUrl,
          marketCode: input.marketCode,
          locale: input.locale,
          verifiedAnchorAt: input.verifiedAnchorAt,
          measurementScopeJson: canonicalInputJson(input.measurementScopeJson),
          observationScheduleJson: canonicalInputJson(input.observationScheduleJson),
          expectedDirectionJson: canonicalInputJson(input.expectedDirectionJson)
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const byKey = await this.db.optimizationExperiment.findUnique({
        where: {
          projectId_experimentKey: {
            projectId: input.projectId,
            experimentKey: input.experimentKey
          }
        }
      });
      if (byKey) {
        assertExperimentIdentity(byKey, input);
        return byKey;
      }

      const byExecution = await this.db.optimizationExperiment.findUnique({
        where: {
          optimizationPlanId_publicationExecutionId_experimentVersion: {
            optimizationPlanId: input.optimizationPlanId,
            publicationExecutionId: input.publicationExecutionId,
            experimentVersion: input.experimentVersion
          }
        }
      });
      if (byExecution) {
        assertExperimentIdentity(byExecution, input);
        return byExecution;
      }

      throw error;
    }
  }

  async createOrGetObservation(
    input: CreateExperimentObservationInput
  ): Promise<OptimizationExperimentObservation> {
    const existing = await this.db.optimizationExperimentObservation.findUnique({
      where: {
        experimentId_observationKey: {
          experimentId: input.experimentId,
          observationKey: input.observationKey
        }
      }
    });
    if (existing) {
      assertObservationIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationExperimentObservation.create({
        data: {
          projectId: input.projectId,
          experimentId: input.experimentId,
          observationVersion: input.observationVersion,
          observationKey: input.observationKey,
          windowType: input.windowType,
          windowDays: input.windowDays,
          dueAt: input.dueAt,
          inputCutoffAt: input.inputCutoffAt,
          baselineSearchSourceRefs: canonicalInputJson(input.baselineSearchSourceRefs),
          observedSearchSourceRefs: canonicalInputJson(input.observedSearchSourceRefs),
          baselineVisibilitySourceRefs: canonicalInputJson(input.baselineVisibilitySourceRefs),
          observedVisibilitySourceRefs: canonicalInputJson(input.observedVisibilitySourceRefs),
          baselineMetricsJson: canonicalInputJson(input.baselineMetricsJson),
          observedMetricsJson: canonicalInputJson(input.observedMetricsJson),
          deltaMetricsJson: canonicalInputJson(input.deltaMetricsJson),
          coverageState: input.coverageState,
          contaminationState: input.contaminationState,
          effectState: input.effectState,
          reasonCodes: canonicalInputJson(input.reasonCodes),
          evaluatorVersion: input.evaluatorVersion
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.db.optimizationExperimentObservation.findUnique({
        where: {
          experimentId_observationKey: {
            experimentId: input.experimentId,
            observationKey: input.observationKey
          }
        }
      });
      if (!collided) throw error;
      assertObservationIdentity(collided, input);
      return collided;
    }
  }
}

const defaultRepository = new OptimizationExperimentRepository();

export function createOrGetExperiment(
  input: CreateExperimentInput
): Promise<OptimizationExperiment> {
  return defaultRepository.createOrGetExperiment(input);
}

export function createOrGetObservation(
  input: CreateExperimentObservationInput
): Promise<OptimizationExperimentObservation> {
  return defaultRepository.createOrGetObservation(input);
}